/**
 * dynamic-fee-estimator.ts — Stima dinamica della network fee EVM
 *
 * Calcola il networkFeeCharged per ogni pagamento EVM basandosi su:
 *   - gasPrice live dall'RPC
 *   - gas stimati per ogni TX del ciclo (TX0, TX1, TX2, TX3)
 *   - prezzo live del token nativo (BNB/ETH/POL) da CoinGecko
 *   - safety margin configurabile per rete dall'Admin Panel
 *
 * Formula:
 *   totalGasUnits = TX0(21k) + TX1(live/fallback) + TX2(50k) + TX3(21k)
 *   totalNativeWei = totalGasUnits × gasPrice
 *   rawFee = totalNativeWei × nativePriceScaled × tokenDec / 1e18 / 1e6
 *   networkFeeCharged = ceil(rawFee × safetyMarginBps / 10_000)
 *
 * Dove nativePriceScaled = round(nativePriceUsd × 1_000_000) per evitare float.
 *
 * FAIL-CLOSED:
 *   - RPC unavailable per gasPrice → lancia DynamicFeeError
 *   - CoinGecko unavailable → lancia PriceUnavailableError
 *   - MAX_NETWORK_FEE superato → lancia AppError NETWORK_COST_TOO_HIGH
 *   MAI silenzioso, MAI fallback a flat fee.
 *
 * Gas fissi:
 *   TX0 = 21.000 gas (native ETH/BNB/POL transfer — sempre esatto)
 *   TX2 = 50.000 gas (feeWallet è sempre holder USDT esistente — costo costante)
 *   TX3 = 21.000 gas (native transfer — sempre esatto)
 *
 * TX1 (live estimate):
 *   Se recipientWallet e feeWallet disponibili: estimateGas live (più accurato).
 *   Altrimenti: TX1_FALLBACK_GAS = 80.000 (worst case: nuovo recipient).
 *
 * Audit trail:
 *   La funzione restituisce DynamicFeeResult con tutti i parametri usati,
 *   da salvare nel DB per calibrazione futura (§14 spec).
 */

import { createPublicClient, http, encodeFunctionData, getAddress } from "viem";
import { polygon, polygonAmoy, mainnet, bsc }                       from "viem/chains";
import type { Chain }                                                 from "viem";
import { logger }                                                     from "../lib/logger";
import { AppError }                                                   from "../errors/AppError";
import { getNativePriceUsd, PriceUnavailableError }                  from "./native-price-provider";
import { getNetworkFeeConfig }                                        from "../models/mc-network-fee-config.model";
import { RPC_CONFIGS, TOKEN_DECIMALS }                               from "./multichain-config";
import type { MCNetworkId }                                           from "../models/multichain-transfer.model";

// ─── Chain map locale (stesso pattern del service, autonomo) ──────────────────

const _polygonChain: Chain = (() => {
  const chainId = parseInt(process.env.POLYGON_CHAIN_ID ?? "137", 10);
  return chainId === 80002 ? polygonAmoy : polygon;
})();

const EVM_CHAIN_MAP: Partial<Record<MCNetworkId, Chain>> = {
  polygon:  _polygonChain,
  ethereum: mainnet,
  bsc:      bsc,
};

// ─── Costanti gas ─────────────────────────────────────────────────────────────

/** Gas per TX0 e TX3: native coin transfer EVM — sempre 21.000 esatto */
export const TX0_GAS_UNITS = 21_000n;
export const TX3_GAS_UNITS = 21_000n;

/**
 * Gas per TX2: feeWallet è sempre USDT holder esistente (slot warm).
 * Valore conservativo verificato: ERC-20 transfer a holder esistente = 45k–55k.
 * 50.000 include un margine di ~10% su 50k effettivo.
 */
export const TX2_GAS_UNITS = 50_000n;

/**
 * Gas fallback per TX1 quando non si può fare estimateGas live.
 * Worst case: primo trasferimento USDT verso un recipient mai esistito
 * (creazione storage slot ERC-20: +20k gas su ~60k base).
 */
export const TX1_FALLBACK_GAS = 80_000n;

// ─── Precisione prezzo nativo ─────────────────────────────────────────────────

/**
 * Fattore di scala per il prezzo nativo in USD.
 * Usato per evitare aritmetica floating point nelle operazioni BigInt.
 *
 * nativePriceScaled = round(priceUsd × NATIVE_PRICE_PRECISION)
 *
 * Con NATIVE_PRICE_PRECISION = 1_000_000:
 *   POL a $0.30 → 300_000
 *   BNB a $600  → 600_000_000
 *   ETH a $2500 → 2_500_000_000
 *
 * Poi nella formula si divide per NATIVE_PRICE_PRECISION per recuperare l'unità.
 */
const NATIVE_PRICE_PRECISION = 1_000_000n;

// ─── ABI minimo ERC-20 transfer ───────────────────────────────────────────────

const ERC20_TRANSFER_ABI = [
  {
    name:            "transfer",
    type:            "function" as const,
    stateMutability: "nonpayable" as const,
    inputs:  [
      { name: "to",    type: "address" as const },
      { name: "value", type: "uint256" as const },
    ],
    outputs: [{ type: "bool" as const }],
  },
] as const;

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export class DynamicFeeError extends Error {
  readonly code = "DYNAMIC_FEE_ERROR" as const;
  readonly httpStatus = 503;

  constructor(network: string, reason: string) {
    super(`[DynamicFee] Impossibile stimare la network fee su ${network}: ${reason}`);
    this.name = "DynamicFeeError";
    Object.setPrototypeOf(this, DynamicFeeError.prototype);
  }
}

export interface DynamicFeeParams {
  network:      MCNetworkId;
  /** Indirizzo contratto USDT (o altro token ERC-20) */
  assetAddress: string;
  /** Importo da trasferire in raw units (usato per l'estimateGas TX1) */
  grossAmount:  bigint;
  /**
   * Indirizzo del recipient — se disponibile consente estimateGas live per TX1.
   * Se null/undefined: usa TX1_FALLBACK_GAS (80k — worst case nuovo recipient).
   */
  recipientWallet?: string | null;
  /**
   * Indirizzo del feeWallet — usato come `from` in estimateGas TX1.
   * Se null/undefined: usa TX1_FALLBACK_GAS.
   */
  feeWallet?: string | null;
  /**
   * Safety margin override in bps. Se non fornito: legge dal DB via getNetworkFeeConfig().
   * Override utile per test o chiamate che hanno già letto la config.
   */
  safetyMarginBpsOverride?: bigint;
}

export interface DynamicFeeResult {
  /** Network fee addebitata al cliente in raw USDT units (immutabile per il transfer) */
  networkFeeCharged: bigint;

  // ── Audit trail (§14 spec) ────────────────────────────────────────────────
  /** gasPrice in wei al momento della stima */
  gasPriceWei:      bigint;
  /** Prezzo USD del token nativo al momento della stima */
  nativePriceUsd:   number;
  /** Gas TX0 usato nel calcolo (21.000 fisso) */
  tx0Gas:           number;
  /** Gas TX1 usato nel calcolo (live estimate o fallback 80.000) */
  tx1Gas:           number;
  /** Gas TX2 usato nel calcolo (50.000 fisso) */
  tx2Gas:           number;
  /** Gas TX3 usato nel calcolo (21.000 fisso) */
  tx3Gas:           number;
  /** Safety margin bps usato */
  safetyMarginBps:  number;
  /** true = TX1 stimato live via estimateGas; false = fallback 80k */
  isLiveEstimate:   boolean;
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Stima la network fee dinamica per un pagamento EVM.
 *
 * @throws DynamicFeeError se l'RPC non è raggiungibile
 * @throws PriceUnavailableError se CoinGecko non è disponibile e la cache è scaduta
 * @throws AppError(NETWORK_COST_TOO_HIGH) se la fee supera il max configurato per la rete
 */
export async function estimateDynamicNetworkFee(
  params: DynamicFeeParams,
): Promise<DynamicFeeResult> {
  const { network, assetAddress, grossAmount, recipientWallet, feeWallet } = params;

  // BTC non supportato da questo estimator
  if (network === "bitcoin") {
    throw new DynamicFeeError("bitcoin", "BTC usa miner fee separata — non supportato");
  }

  const chain  = EVM_CHAIN_MAP[network];
  const rpcCfg = RPC_CONFIGS[network];

  if (!chain || !rpcCfg?.primary) {
    throw new DynamicFeeError(network, "Chain o RPC non configurati");
  }

  const pc = createPublicClient({ chain, transport: http(rpcCfg.primary) });

  // ── 1. gasPrice live ──────────────────────────────────────────────────────
  let gasPrice: bigint;
  try {
    gasPrice = await pc.getGasPrice();
  } catch (rpcErr) {
    throw new DynamicFeeError(network, `RPC getGasPrice fallito: ${String(rpcErr)}`);
  }

  // ── 2. Gas TX1 (live o fallback) ─────────────────────────────────────────
  let tx1Gas: bigint       = TX1_FALLBACK_GAS;
  let isLiveEstimate        = false;

  const canEstimateLive =
    recipientWallet &&
    feeWallet &&
    assetAddress &&
    assetAddress !== "native" &&
    grossAmount > 0n;

  if (canEstimateLive) {
    try {
      // estimateGas simula: feeWallet → USDT.transfer(recipient, grossAmount)
      // Stima accurata per il recipient specifico (considera storage slot esistente/nuovo).
      const data = encodeFunctionData({
        abi:          ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args:         [getAddress(recipientWallet) as `0x${string}`, grossAmount],
      });

      const estimated = await pc.estimateGas({
        account: getAddress(feeWallet) as `0x${string}`,
        to:      getAddress(assetAddress) as `0x${string}`,
        data,
      });

      // Buffer 10% sulla stima live (il fallback include già margine implicito)
      tx1Gas        = (estimated * 110n) / 100n;
      isLiveEstimate = true;

      logger.debug(
        {
          network,
          recipientWallet,
          estimated:     estimated.toString(),
          tx1GasWithBuf: tx1Gas.toString(),
        },
        "[DynamicFee] TX1 estimateGas live ✓",
      );
    } catch (estErr) {
      // estimateGas fallito (feeWallet senza saldo, RPC timeout, ecc.)
      // Fail-safe: usa fallback 80k invece di bloccare il pagamento.
      logger.warn(
        { network, err: String(estErr) },
        "[DynamicFee] TX1 estimateGas fallito — uso fallback 80k",
      );
      tx1Gas        = TX1_FALLBACK_GAS;
      isLiveEstimate = false;
    }
  }

  // ── 3. Gas totali ─────────────────────────────────────────────────────────
  const totalGasUnits = TX0_GAS_UNITS + tx1Gas + TX2_GAS_UNITS + TX3_GAS_UNITS;

  // ── 4. Costo totale in native wei ─────────────────────────────────────────
  const totalNativeWei = totalGasUnits * gasPrice;

  // ── 5. Prezzo nativo live ─────────────────────────────────────────────────
  // Può lanciare PriceUnavailableError → il caller vede un errore 503.
  const nativePriceUsd = await getNativePriceUsd(network);

  // Conversione in intero con 6 decimali di precisione (evita float BigInt)
  const nativePriceScaled = BigInt(Math.round(nativePriceUsd * Number(NATIVE_PRICE_PRECISION)));

  // ── 6. Conversione in USDT raw units ─────────────────────────────────────
  // Trova i decimali del token (6 per USDT Polygon/ETH, 18 per USDT BSC)
  const tokenDecimalsNum = TOKEN_DECIMALS[assetAddress.toLowerCase()] ?? 6;
  const tokenDec         = 10n ** BigInt(tokenDecimalsNum);

  // Formula (BigInt-safe, zero floating point):
  //   totalNativeWei × nativePriceScaled × tokenDec / 1e18 / NATIVE_PRICE_PRECISION
  const rawFee =
    (totalNativeWei * nativePriceScaled * tokenDec) /
    (10n ** 18n) /
    NATIVE_PRICE_PRECISION;

  // ── 7. Safety margin ─────────────────────────────────────────────────────
  let safetyMarginBps: bigint;
  let safetyMarginNum: number;

  if (params.safetyMarginBpsOverride !== undefined) {
    safetyMarginBps = params.safetyMarginBpsOverride;
    safetyMarginNum = Number(params.safetyMarginBpsOverride);
  } else {
    const cfg       = await getNetworkFeeConfig(network);
    safetyMarginBps = BigInt(cfg.safetyMarginBps);
    safetyMarginNum = cfg.safetyMarginBps;

    // ── 8. MAX_NETWORK_FEE check ──────────────────────────────────────────
    //   Calcola la fee provvisoria per confrontarla con il cap PRIMA di applicare.
    if (cfg.maxNetworkFeeRaw !== null) {
      const provisionalFee = (rawFee * safetyMarginBps + 9_999n) / 10_000n;  // ceiling
      if (provisionalFee > cfg.maxNetworkFeeRaw) {
        logger.warn(
          {
            network,
            provisionalFee:    provisionalFee.toString(),
            maxNetworkFeeRaw:  cfg.maxNetworkFeeRaw.toString(),
            gasPrice:          gasPrice.toString(),
            nativePriceUsd,
          },
          "[DynamicFee] ⛔ Network fee supera il cap configurato → NETWORK_COST_TOO_HIGH",
        );
        throw new AppError(
          "NETWORK_COST_TOO_HIGH",
          503,
          `Network fee stimata (${provisionalFee} raw) supera il massimo configurato ` +
          `(${cfg.maxNetworkFeeRaw} raw) su ${network}. Riprova quando il gas scende.`,
        );
      }
    }
  }

  // ── 9. Ceiling della fee con safety margin ────────────────────────────────
  // ceil(rawFee × safetyMarginBps / 10_000)
  const networkFeeCharged = (rawFee * safetyMarginBps + 9_999n) / 10_000n;

  logger.debug(
    {
      network,
      gasPrice:           gasPrice.toString(),
      nativePriceUsd,
      totalGasUnits:      totalGasUnits.toString(),
      totalNativeWei:     totalNativeWei.toString(),
      rawFee:             rawFee.toString(),
      safetyMarginBps:    safetyMarginNum,
      networkFeeCharged:  networkFeeCharged.toString(),
      tokenDecimals:      tokenDecimalsNum,
      isLiveEstimate,
    },
    "[DynamicFee] Network fee stimata ✓",
  );

  return {
    networkFeeCharged,
    gasPriceWei:     gasPrice,
    nativePriceUsd,
    tx0Gas:          Number(TX0_GAS_UNITS),
    tx1Gas:          Number(tx1Gas),
    tx2Gas:          Number(TX2_GAS_UNITS),
    tx3Gas:          Number(TX3_GAS_UNITS),
    safetyMarginBps: safetyMarginNum,
    isLiveEstimate,
  };
}
