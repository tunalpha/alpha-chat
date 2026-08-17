/**
 * Li.Fi EVM Swap Client
 *
 * Responsabilità:
 *   - Quote: GET /v1/quote con integrator=alpha-chat, fee=0.0025
 *   - Execute: REST transactionRequest + viem sendTransaction (NO @lifi/sdk EVM/createConfig)
 *   - Status: GET /v1/status per recovery
 *
 * NOTE VERSIONE:
 *   @lifi/sdk v4.4.0 ha rimosso createConfig() ed EVM() (erano API v3).
 *   Usiamo executeRoute tramite approccio REST-first:
 *     1. /v1/quote   → route con transactionRequest (pronto per sendTransaction)
 *     2. viem sendTransaction → firma e broadcast con Alpha Wallet interno
 *     3. /v1/status  → polling stato
 *   L'approvazione ERC-20 è gestita localmente via readContract + writeContract.
 *
 * SICUREZZA:
 *   - API key Li.Fi: mai usata qui (solo server-side), le quote pubbliche non la richiedono
 *   - integrator + fee sono parametri pubblici accettati senza autenticazione
 *   - Lock module-level anti-double-click gestito in useEvmSwapState
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain.
 */

import {
  createPublicClient, http, erc20Abi, maxUint256,
  type WalletClient, type PublicClient,
} from "viem";
import {
  LIFI_INTEGRATOR, LIFI_FEE, LIFI_SLIPPAGE, QUOTE_VALIDITY_MS,
  NATIVE_ADDRESS, tokenAddressForLiFi,
  type EvmToken, type EvmSwapQuote,
} from "./types.js";

// ── Wallet state ─────────────────────────────────────────────────────────────

let _currentGetWallet: (() => Promise<WalletClient>) | null = null;
let _currentSwitchChain: ((chainId: number) => Promise<void>) | null = null;

/**
 * Registra i callback del wallet da usare per l'esecuzione.
 * Non serve più init SDK — la configurazione è solo locale.
 * Firma invariata rispetto alla versione precedente.
 */
export function configureLiFiWallet(
  getWalletClient: () => Promise<WalletClient>,
  switchChain: (chainId: number) => Promise<void>,
): void {
  _currentGetWallet  = getWalletClient;
  _currentSwitchChain = switchChain;
}

/**
 * Rimuove i callback wallet correnti dal modulo.
 * Chiamare in cleanup useEffect su unmount per evitare
 * che il modulo chiami getWalletClient su un componente già smontato.
 */
export function clearLiFiWallet(): void {
  _currentGetWallet   = null;
  _currentSwitchChain = null;
}

// ── Quote ─────────────────────────────────────────────────────────────────────

const LIFI_API = "https://li.quest/v1";

export interface LiFiQuoteParams {
  fromChainId:  number;
  toChainId:    number;
  fromToken:    EvmToken;
  toToken:      EvmToken;
  /** Importo da inviare in unità minime. Obbligatorio se toAmount non è impostato. */
  fromAmount?:  string;
  /**
   * Importo desiderato in output (exact-output mode). Quando impostato, Li.Fi calcola
   * automaticamente il fromAmount necessario. Usa raw units (unità minime del toToken).
   * Alternativo a fromAmount — impostare uno dei due, non entrambi.
   */
  toAmount?:    string;
  fromAddress:  string;  // wallet address dell'utente
  /** Slippage massimo (0.005 = 0.5%). Default: LIFI_SLIPPAGE */
  slippage?:    number;
}

/** Errore restituito se quote non disponibile */
export class LiFiQuoteError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = "LiFiQuoteError";
  }
}

/** Recupera una quote Li.Fi (REST, senza SDK — più testabile e stabile). */
export async function fetchLiFiQuote(params: LiFiQuoteParams): Promise<EvmSwapQuote> {
  if (!params.fromAmount && !params.toAmount) {
    throw new Error("LiFiQuoteParams: fromAmount o toAmount deve essere impostato.");
  }

  const qs = new URLSearchParams({
    fromChain:   String(params.fromChainId),
    toChain:     String(params.toChainId),
    fromToken:   tokenAddressForLiFi(params.fromToken),
    toToken:     tokenAddressForLiFi(params.toToken),
    ...(params.fromAmount ? { fromAmount: params.fromAmount } : {}),
    ...(params.toAmount   ? { toAmount:   params.toAmount   } : {}),
    fromAddress: params.fromAddress,
    integrator:  LIFI_INTEGRATOR,
    fee:         String(LIFI_FEE),
    slippage:    String(params.slippage ?? LIFI_SLIPPAGE),
  });

  const res  = await fetch(`${LIFI_API}/quote?${qs}`, {
    headers: { Accept: "application/json" },
  });
  const body = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    throw new LiFiQuoteError(
      (body.code as number) ?? res.status,
      (body.message as string) ?? `Li.Fi quote error ${res.status}`,
    );
  }

  return parseQuoteResponse(body, params);
}

function parseQuoteResponse(
  body: Record<string, unknown>,
  params: LiFiQuoteParams,
): EvmSwapQuote {
  const estimate = (body.estimate as Record<string, unknown>) ?? {};
  const action   = (body.action   as Record<string, unknown>) ?? {};
  const feeCosts = (estimate.feeCosts as unknown[]) ?? [];
  const gasCosts = (estimate.gasCosts as unknown[]) ?? [];

  // Fee Alpha (integrator share)
  let alphaFeeUSD = "0.00";
  for (const fc of feeCosts) {
    const f = fc as Record<string, unknown>;
    const split = (f.feeSplit as Record<string, unknown> | undefined);
    const recipients = (split?.recipients as unknown[]) ?? [];
    for (const rec of recipients) {
      const r = rec as Record<string, unknown>;
      if (r.name === LIFI_INTEGRATOR && r.walletAddress == null) {
        const feeRaw = String(r.fee ?? "0");
        const token  = (f.token as Record<string, unknown> | undefined);
        const dec    = (token?.decimals as number) ?? 6;
        const usdPer = parseFloat(String(token?.priceUSD ?? "1"));
        const human  = Number(BigInt(feeRaw)) / 10 ** dec;
        alphaFeeUSD  = (human * usdPer).toFixed(4);
      }
    }
  }

  // Gas cost USD
  let gasCostUSD = "0.00";
  for (const gc of gasCosts) {
    const g = gc as Record<string, unknown>;
    gasCostUSD = (parseFloat(gasCostUSD) + parseFloat(String(g.amountUSD ?? "0"))).toFixed(4);
  }

  // Total fee USD
  let totalFeeUSD = "0.00";
  for (const fc of feeCosts) {
    const f = fc as Record<string, unknown>;
    totalFeeUSD = (parseFloat(totalFeeUSD) + parseFloat(String(f.amountUSD ?? "0"))).toFixed(4);
  }
  totalFeeUSD = (parseFloat(totalFeeUSD) + parseFloat(gasCostUSD)).toFixed(4);

  const toAmount    = String(estimate.toAmount    ?? "0");
  const toAmountMin = String(estimate.toAmountMin ?? "0");
  const tool        = String((body.tool as string) ?? "lifi");

  // Importo da inviare calcolato da Li.Fi (rilevante in exact-output mode)
  const computedFromAmount = String(action.fromAmount ?? params.fromAmount ?? "0");

  return {
    route:        body,   // Li.Fi Route (opaque) — contiene transactionRequest
    routeId:      String((body.id as string) ?? `${Date.now()}`),
    fromChainId:  params.fromChainId,
    toChainId:    params.toChainId,
    fromToken:    params.fromToken,
    toToken:      params.toToken,
    fromAmount:   params.fromAmount,
    toAmount,
    toAmountMin,
    alphaFeeUSD,
    gasCostUSD,
    totalFeeUSD,
    slippage:     params.slippage ?? LIFI_SLIPPAGE,
    expiresAt:    Date.now() + QUOTE_VALIDITY_MS,
    tool,
    computedFromAmount,
  };
}

// ── Execute ───────────────────────────────────────────────────────────────────

export interface ExecuteCallbacks {
  /** Chiamato quando è richiesta la firma dell'approvazione ERC-20 */
  onApproving?: () => void;
  /** Chiamato quando la TX di swap è stata inviata */
  onTxSubmitted?: (txHash: string, chainId: number) => void;
}

/**
 * Esegue uno swap Li.Fi tramite REST + viem (NO @lifi/sdk EVM provider).
 *
 * Flusso:
 *   1. Estrae transactionRequest dal route Li.Fi
 *   2. Se il token non è nativo → controlla allowance ERC-20 → approve se necessario
 *   3. sendTransaction con viem WalletClient (Alpha Wallet interno)
 *
 * Il wallet deve essere già registrato via configureLiFiWallet().
 */
export async function executeLiFiSwap(
  quote: EvmSwapQuote,
  callbacks?: ExecuteCallbacks,
): Promise<{ txHash: string }> {
  if (!_currentGetWallet) {
    throw new Error("LiFiClient: wallet non configurato. Chiama configureLiFiWallet() prima.");
  }

  // Verifica scadenza quote (client-side guard)
  if (Date.now() > quote.expiresAt) {
    throw new Error("QUOTE_EXPIRED");
  }

  // Estrae il transactionRequest dal route Li.Fi
  // Li.Fi /v1/quote risponde con `transactionRequest` ready-to-sign per swap same-chain
  const route  = quote.route as Record<string, unknown>;
  const txReq  = route.transactionRequest as Record<string, string | undefined> | undefined;

  if (!txReq?.to || !txReq?.data) {
    throw new Error(
      "La quote non contiene dati della transazione (transactionRequest). " +
      "Premi 'Riprova' per ottenere una nuova quote.",
    );
  }

  const walletClient = await _currentGetWallet();
  const account = walletClient.account;
  if (!account) throw new Error("ALPHA_WALLET_NO_KEYSTORE");

  // ── ERC-20 approval check ─────────────────────────────────────────────────
  const isNative =
    !quote.fromToken.address ||
    quote.fromToken.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase();

  if (!isNative) {
    const estimate = route.estimate as Record<string, unknown> | undefined;
    const approvalAddress = estimate?.approvalAddress as string | undefined;

    if (approvalAddress) {
      await _handleErc20Approval(
        walletClient,
        quote.fromToken.address as `0x${string}`,
        approvalAddress as `0x${string}`,
        BigInt(quote.fromAmount),
        quote.fromChainId,
        callbacks,
      );
    }
  }

  // ── Invia swap transaction ────────────────────────────────────────────────
  const txHash = await walletClient.sendTransaction({
    to:    txReq.to    as `0x${string}`,
    data:  txReq.data  as `0x${string}`,
    value: txReq.value ? BigInt(txReq.value) : 0n,
    chain: null,   // non impone chain switch — il wallet è già sulla chain giusta
    account,
  });

  callbacks?.onTxSubmitted?.(txHash, quote.fromChainId);

  return { txHash };
}

/**
 * Controlla l'allowance ERC-20 e invia `approve(MAX_UINT256)` se necessario.
 * Attende la conferma on-chain prima di procedere con lo swap.
 */
async function _handleErc20Approval(
  walletClient: WalletClient,
  tokenAddress:    `0x${string}`,
  spenderAddress:  `0x${string}`,
  needed:          bigint,
  chainId:         number,
  callbacks?:      ExecuteCallbacks,
): Promise<void> {
  const account = walletClient.account!;
  const publicClient = _makePublicClient(chainId);

  const allowance = await publicClient.readContract({
    address:      tokenAddress,
    abi:          erc20Abi,
    functionName: "allowance",
    args:         [account.address, spenderAddress],
  });

  if ((allowance as bigint) >= needed) return; // allowance sufficiente

  // Chiede all'utente di firmare l'approval
  callbacks?.onApproving?.();

  const approvalHash = await walletClient.writeContract({
    address:      tokenAddress,
    abi:          erc20Abi,
    functionName: "approve",
    args:         [spenderAddress, maxUint256],
    chain:        null,
    account,
  });

  // Attende conferma on-chain (max 3 min)
  await publicClient.waitForTransactionReceipt({
    hash:    approvalHash,
    timeout: 180_000,
  });
}

/**
 * Crea un PublicClient viem per la chain richiesta.
 * Usato solo per letture (allowance) e attesa receipt approval — nessuna chiave privata.
 */
function _makePublicClient(chainId: number): PublicClient {
  const rpc = _publicRpc(chainId);
  return createPublicClient({ transport: http(rpc) }) as PublicClient;
}

function _publicRpc(chainId: number): string {
  switch (chainId) {
    case 137: {
      // Usa il segreto VITE_POLYGON_RPC se disponibile (iniettato nel bundle)
      const env = (typeof import.meta !== "undefined"
        ? (import.meta as { env?: { VITE_POLYGON_RPC?: string } }).env?.VITE_POLYGON_RPC
        : undefined) ?? "";
      return env || "https://polygon-rpc.com";
    }
    case 56:  return "https://bsc-dataseed.binance.org";
    case 1:   return "https://cloudflare-eth.com";
    default:  return "https://polygon-rpc.com";
  }
}

// ── Status (per recovery) ─────────────────────────────────────────────────────

export type LiFiStatus = "PENDING" | "DONE" | "FAILED" | "INVALID" | "NOT_FOUND";

export interface LiFiStatusResult {
  status:   LiFiStatus;
  txHash?:  string;
  toAmount?: string;
}

/** Controlla lo stato di uno swap Li.Fi via txHash + chain. */
export async function getLiFiStatus(
  txHash: string,
  fromChainId: number,
  toChainId: number,
): Promise<LiFiStatusResult> {
  const qs = new URLSearchParams({
    txHash,
    fromChain: String(fromChainId),
    toChain:   String(toChainId),
  });

  try {
    const res  = await fetch(`${LIFI_API}/status?${qs}`, { headers: { Accept: "application/json" } });
    const body = await res.json() as Record<string, unknown>;

    if (!res.ok) return { status: "INVALID" };

    return {
      status:   (body.status as LiFiStatus) ?? "PENDING",
      txHash:   (body.receiving as Record<string, unknown>)?.txHash as string | undefined,
      toAmount: (body.receiving as Record<string, unknown>)?.amount as string | undefined,
    };
  } catch {
    return { status: "PENDING" };
  }
}

// ── Fee verification helper (per test) ────────────────────────────────────────

/**
 * Verifica che una risposta quote contenga la fee integrator al 25 bps.
 * Usato nei test per garantire che la fee non sia stata rimossa per errore.
 */
export function verifyAlphaFeeInResponse(quoteBody: Record<string, unknown>): {
  found: boolean;
  bps: number;
} {
  const estimate = (quoteBody.estimate as Record<string, unknown>) ?? {};
  const feeCosts = (estimate.feeCosts as unknown[]) ?? [];

  for (const fc of feeCosts) {
    const f = fc as Record<string, unknown>;
    const split = (f.feeSplit as Record<string, unknown> | undefined);
    const recipients = (split?.recipients as unknown[]) ?? [];
    for (const rec of recipients) {
      const r = rec as Record<string, unknown>;
      if (r.name === LIFI_INTEGRATOR) {
        const lifiFee = BigInt(String(split!.lifiFee ?? "0"));
        const intFee  = BigInt(String(split!.integratorFee ?? "0"));
        const total   = lifiFee + intFee;
        if (total === 0n) return { found: true, bps: 0 };
        const pctStr = String(f.percentage ?? "0");
        const pct    = parseFloat(pctStr);
        const intBps = Math.round((pct / 2) * 10000);
        return { found: true, bps: intBps };
      }
    }
  }
  return { found: false, bps: 0 };
}
