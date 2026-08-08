/**
 * multichain-payment.service.ts — Multi-Chain Payment Engine
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  HARDENING C-1 — EVM DOUBLE-PAY FIX
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVM release usa 2 TX separate. Per impedire doppio pagamento al destinatario:
 *
 *    TX1 (netAmount → recipient)
 *      ↓ IMMEDIATE DB PERSIST tx_hash_release
 *    TX2 (projectFee → feeWallet)
 *      ↓ FINAL DB UPDATE status=released
 *
 *  Il catch/rollback ha condizione { tx_hash_release: null }:
 *    - TX1 non inviata → tx_hash_release è null → rollback a pending ✓ safe
 *    - TX1 inviata     → tx_hash_release SET    → rollback non esegue ✓ no double-pay
 *
 *  Lo scheduler vede { status:"releasing", tx_hash_release:SET, tx_hash_fee:null }
 *  e chiama retryEVMFeeTx() per inviare solo TX2.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  HARDENING M-1 — BTC DUST FEE
 * ═══════════════════════════════════════════════════════════════════════════
 *  Se projectFee BTC < 546 sat (dust threshold), rifiuta il transfer in
 *  fase di creazione con BTC_PROJECT_FEE_BELOW_DUST (422).
 *  Così projectFee ≠ networkFee — mai confuse, mai perse silenziosamente.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ISOLAMENTO: Non modifica USDA, chat_transfers, usda-custodial.service.ts.
 */

import { randomUUID } from "crypto";
import mongoose from "mongoose";
import {
  MultiChainTransferModel,
  type MultiChainTransferDocument,
  type MultiChainTransferStatus,
  type MCNetworkId,
  type MCAssetSymbol,
} from "../models/multichain-transfer.model";
import { adapterRegistry }          from "../blockchain/adapter-registry";
import {
  FEATURE_FLAGS,
  TOKEN_CONTRACTS,
  TOKEN_DECIMALS,
  buildDefaultFeeRegistry,
  BTC_FEE_CONFIG,
  RPC_CONFIGS,
  getEVMFlatNetworkFee,
  NATIVE_ASSET_SYMBOL,
} from "../blockchain/multichain-config";
import { calculateFee, assertFeeInvariant, DEFAULT_FEE_BPS } from "../blockchain/fee-config";
import {
  calculatePaymentQuote,
  computeGrossFromNet,
  type AmountMode,
  type PaymentQuote,
} from "./payment-quote";
import { generateEscrowWallet, decryptEscrowKeyHex } from "../blockchain/escrow-crypto";
import { multichainError }          from "../blockchain/errors";
import { AppError }                 from "../errors/AppError";
import { logger }                   from "../lib/logger";
import type { BitcoinAdapter }      from "../blockchain/bitcoin/bitcoin-adapter";
import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon, polygonAmoy } from "viem/chains";

// ─── SplitTxAdapter — C-01/C-02/C-03 ─────────────────────────────────────────

/**
 * SplitTxAdapter — interfaccia minima per adapter EVM che supportano
 * il pattern build+sign / broadcast separato (C-01, C-02, C-03).
 *
 * Implementata da EvmAdapter. Non richiesta da BitcoinAdapter (UTXO atomico).
 * Usata nel service per la type-narrowing locale senza importare EvmAdapter
 * direttamente (evita dipendenze circolari).
 */
interface SplitTxAdapter {
  buildAndSignToken(params: {
    signerPk:     string;
    tokenAddress: string;
    to:           string;
    amount:       bigint;
  }): Promise<{ rawTx: `0x${string}`; txHash: `0x${string}` }>;
  broadcastAndWait(
    rawTx:  `0x${string}`,
    txHash: `0x${string}`,
  ): Promise<{ networkFee: bigint }>;
}

// ─── Fee registry (singleton) ──────────────────────────────────────────────────

const feeRegistry = buildDefaultFeeRegistry();

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Dust threshold Bitcoin in satoshi.
 * Un output sotto questa soglia viene rifiutato dai nodi come "non-standard".
 * M-1: projectFee BTC < DUST → rifiutare il transfer, non silenziarlo.
 */
const BTC_DUST_THRESHOLD_SAT = 546n;

// ─── Types ─────────────────────────────────────────────────────────────────────

export { AmountMode, PaymentQuote, calculatePaymentQuote, computeGrossFromNet };

export interface CreateMultiChainTransferParams {
  senderId:        string;
  recipientId:     string;
  conversationId:  string;
  senderWallet:    string;
  recipientWallet: string;
  network:         MCNetworkId;
  asset:           MCAssetSymbol;
  /**
   * Modalità importo (default: "send_amount" per backward compat).
   *   "send_amount"     — grossAmountUnits è il lordo inserito dal mittente
   *   "recipient_exact" — targetNetAmountUnits è il netto che il destinatario deve ricevere
   */
  amountMode?:          AmountMode;
  /**
   * Importo lordo in base units (BigInt come stringa).
   * Obbligatorio per amountMode=send_amount (default).
   */
  grossAmountUnits?:    string;
  /**
   * Importo netto target in base units (BigInt come stringa).
   * Obbligatorio per amountMode=recipient_exact.
   * Il service calcola il gross amount minimo garantendo netAmount ≥ targetNetAmount.
   */
  targetNetAmountUnits?: string;
  /** Chiave idempotenza — UUID generato dal client */
  clientRef:       string;
  /** Scadenza in ore (default: 24) */
  expiresInHours?: number;
}

/**
 * GasReserveDepletedError — lanciata da ensureMultiChainEscrowGas quando il wallet
 * del gas station non ha fondi nativi sufficienti per il top-up dell'escrow.
 *
 * Intercettata da releaseMultiChainTransfer/releaseFromWaitingForGas per transizionare
 * il transfer a "waiting_for_gas" invece di "failed". Il deposito è preservato.
 *
 * NOTA: non contiene mai PK, seed, o altri secret.
 */
export class GasReserveDepletedError extends Error {
  readonly code = "GAS_RESERVE_DEPLETED" as const;

  constructor(
    public readonly network: MCNetworkId,
    public readonly escrowAddress: string,
    public readonly required: bigint,
    public readonly available: bigint,
  ) {
    super(
      `Gas station reserve depleted on ${network}: ` +
      `required ${required} wei, available ${available} wei — transfer → waiting_for_gas`,
    );
    this.name = "GasReserveDepletedError";
    Object.setPrototypeOf(this, GasReserveDepletedError.prototype);
  }
}

export interface MultiChainTransferInfo {
  transferId:       string;
  clientRef:        string;
  escrowWallet:     string;
  network:          MCNetworkId;
  asset:            MCAssetSymbol;
  grossAmount:      string;
  projectFee:       string;
  netAmount:        string;
  feeBps:           number;
  feeWallet:        string | null;
  status:           MultiChainTransferStatus;
  expiresAt:        Date;
  txHashDeposit:    string | null;
  txHashRelease:    string | null;
  txHashFee:        string | null;
  /**
   * Importo minimo che il mittente deve depositare nell'escrow.
   *   BTC: grossAmount + estimatedMinerFee + buffer
   *   EVM: grossAmount + networkFeeCharged (se > 0)
   *   Null se nessuna fee aggiuntiva configurata.
   */
  minDepositAmount:   string | null;
  /**
   * Commissione flat addebitata al cliente per la network fee EVM.
   * Calcolata al create time e immutabile — invariante rispetto a cambi di configurazione.
   * Null per BTC (inclusa nel minDepositAmount tramite buffer miner fee).
   *
   * SEPARAZIONE: networkFeeCharged ≠ projectFee ≠ networkFeeActual
   */
  networkFeeCharged:  string | null;
  /**
   * Gas effettivamente consumato in unità native (wei POL/ETH/BNB o satoshi BTC).
   * Popolato dopo il release. Separato da networkFeeCharged (quanto addebitato al cliente).
   */
  networkFeeActual:   string;
  /**
   * Asset nativo usato per il gas: "POL" | "ETH" | "BNB" | "BTC".
   * Null per transfer pre-modifica.
   */
  networkFeeAsset:    string | null;
  /**
   * Numero di tentativi di release falliti per gas insufficiente.
   * 0 = nessun problema di gas. >0 = in waiting_for_gas o uscito da waiting_for_gas.
   */
  gasRetryCount:      number;
  /**
   * Modalità importo scelta dal mittente:
   *   "send_amount"     — gross inserito direttamente (comportamento classico)
   *   "recipient_exact" — net target inserito; gross calcolato inversamente
   * Null per transfer pre-STEP 3 (backward compat — si comportano come send_amount).
   */
  amountMode:         AmountMode | null;
  /**
   * ID MongoDB del mittente — usato per ownership validation lato controller (H-02).
   * Non esporre mai nei log o nelle risposte JSON pubbliche al client.
   */
  senderId:           string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toInfo(doc: MultiChainTransferDocument): MultiChainTransferInfo {
  return {
    transferId:        doc.transfer_id,
    clientRef:         doc.client_ref,
    escrowWallet:      doc.escrow_wallet,
    network:           doc.network,
    asset:             doc.asset,
    grossAmount:       doc.gross_amount,
    projectFee:        doc.project_fee,
    netAmount:         doc.net_amount,
    feeBps:            doc.fee_bps,
    feeWallet:         doc.fee_wallet,
    status:            doc.status,
    expiresAt:         doc.expires_at,
    txHashDeposit:     doc.tx_hash_deposit,
    txHashRelease:     doc.tx_hash_release,
    txHashFee:         doc.tx_hash_fee,
    minDepositAmount:  doc.min_deposit_amount ?? null,
    networkFeeCharged: doc.network_fee_charged ?? null,
    networkFeeActual:  doc.network_fee,
    networkFeeAsset:   doc.network_fee_asset ?? null,
    gasRetryCount:     doc.gas_retry_count ?? 0,
    amountMode:        (doc.amount_mode as AmountMode | null) ?? null,
    senderId:          doc.sender_id?.toString() ?? "",
  };
}

function getAssetAddress(network: MCNetworkId, asset: MCAssetSymbol): string {
  if (network === "polygon") {
    if (asset === "USDT") return TOKEN_CONTRACTS.polygon.USDT;
    if (asset === "USDA") return TOKEN_CONTRACTS.polygon.USDA;
  }
  if (network === "ethereum" && asset === "USDT") return TOKEN_CONTRACTS.ethereum.USDT;
  if (network === "bsc"      && asset === "USDT") return TOKEN_CONTRACTS.bsc.USDT;
  if (network === "bitcoin"  && asset === "BTC")  return "native";
  throw multichainError("INVALID_ASSET", { network, asset });
}

function getDecimals(network: MCNetworkId, asset: MCAssetSymbol): number {
  if (network === "bitcoin") return 8;
  const address = getAssetAddress(network, asset);
  return TOKEN_DECIMALS[address.toLowerCase()] ?? 18;
}

function assertFeatureEnabled(network: MCNetworkId, asset: MCAssetSymbol): void {
  if (network === "polygon" && asset === "USDT" && !FEATURE_FLAGS.ENABLE_POLYGON_USDT) {
    throw multichainError("FEATURE_DISABLED", { network, asset, flag: "ENABLE_POLYGON_USDT" });
  }
  if (network === "ethereum" && !FEATURE_FLAGS.ENABLE_ETHEREUM_USDT) {
    throw multichainError("FEATURE_DISABLED", { network, asset, flag: "ENABLE_ETHEREUM_USDT" });
  }
  if (network === "bsc" && !FEATURE_FLAGS.ENABLE_BSC_USDT) {
    throw multichainError("FEATURE_DISABLED", { network, asset, flag: "ENABLE_BSC_USDT" });
  }
  if (network === "bitcoin" && !FEATURE_FLAGS.ENABLE_BITCOIN) {
    throw multichainError("FEATURE_DISABLED", { network, asset, flag: "ENABLE_BITCOIN" });
  }
}

/** True se la chain usa UTXO nativo (Bitcoin) */
export function isBitcoin(network: MCNetworkId): boolean {
  return network === "bitcoin";
}

// ─── Atomic lock ────────────────────────────────────────────────────────────────

async function acquireMCLock(
  transferId: string,
  fromStatus: MultiChainTransferStatus,
  toStatus: MultiChainTransferStatus,
): Promise<MultiChainTransferDocument | null> {
  const result = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: transferId, status: fromStatus },
    { $set: { status: toStatus, locked_at: new Date() } },
    { returnDocument: "after" },
  );
  if (!result) {
    logger.warn({ transferId, fromStatus, toStatus }, "[MCPayment] Lock non acquisito");
    return null;
  }
  logger.info({ transferId, fromStatus, toStatus }, "[MCPayment] Lock acquisito");
  return result;
}

// ─── Multi-Chain Gas Station ───────────────────────────────────────────────────

/**
 * Garantisce che il wallet escrow EVM abbia abbastanza gas nativo per TX1 + TX2.
 *
 * Usa GAS_STATION_PRIVATE_KEY per inviare POL/ETH/BNB all'escrow prima del release.
 * ISOLAMENTO: funzione indipendente da usda-custodial.service.ts e da ensureEscrowGas.
 * Per Polygon utilizza lo stesso GAS_STATION_PRIVATE_KEY env var (wallet condiviso).
 *
 * Se GAS_STATION_PRIVATE_KEY non è configurato → warning + continua (il release
 * fallirà con "insufficient gas" se l'escrow non ha già il gas).
 */
const MC_GAS_LIMIT_PER_TX  = 80_000n;   // gas per ERC-20 transfer (con buffer su ~65k)
const MC_GAS_TX_COUNT       = 2n;        // TX1 (recipient) + TX2 (feeWallet)
const MC_GAS_STATION_BUFFER = 2n;        // 2× safety margin per gas price in salita
const MC_GAS_STATION_CAP    = 500_000_000_000_000_000n; // 0.5 native coin cap

/**
 * Map chain EVM per createPublicClient / createWalletClient nel gas station.
 *
 * POLYGON_CHAIN_ID=80002 → Polygon Amoy testnet (per test script)
 * POLYGON_CHAIN_ID=137   → Polygon Mainnet (default produzione)
 *
 * Viene letto al caricamento del modulo → impostare POLYGON_CHAIN_ID
 * PRIMA dell'import dinamico nei testnet scripts.
 */
const _polygonChain: Chain = (() => {
  const chainId = parseInt(process.env.POLYGON_CHAIN_ID ?? "137", 10);
  return chainId === 80002 ? polygonAmoy : polygon;
})();

const MC_CHAIN_MAP: Partial<Record<MCNetworkId, Chain>> = {
  polygon: _polygonChain,
  // ethereum: mainnet,  // aggiungere con ETH import quando abilitato
  // bsc: bsc,           // aggiungere con BSC import quando abilitato
};

/**
 * Garantisce che il wallet escrow EVM abbia abbastanza gas nativo per TX1 + TX2.
 *
 * Comportamento Gas Reserve Protection (STEP 2):
 *   - Se GAS_STATION_PRIVATE_KEY non configurato → warning + continua (dev/test)
 *   - Se escrow ha già gas sufficiente → skip top-up
 *   - Se gas station NON ha fondi per il top-up → throw GasReserveDepletedError
 *     (mai "failed", mai rollback del deposito)
 *   - Se la TX di top-up fallisce post-check (race condition) → throw GasReserveDepletedError
 *
 * Il caller (releaseMultiChainTransfer / releaseFromWaitingForGas) intercetta
 * GasReserveDepletedError e transiziona il transfer a "waiting_for_gas".
 */
async function ensureMultiChainEscrowGas(
  network: MCNetworkId,
  escrowAddress: string,
): Promise<void> {
  // BTC non richiede gas nativo dal gas station — il miner fee è nell'UTXO
  if (isBitcoin(network)) return;

  // Verifica configurazione prima di qualsiasi chiamata RPC
  const gsPk = process.env.GAS_STATION_PRIVATE_KEY;
  if (!gsPk) {
    // H-03: KEY MANCANTE = gas non disponibile. Il transfer va a waiting_for_gas (recuperabile).
    // MAI continuare senza chiave gas station su reti EVM: il payout fallirebbe silenziosamente
    // lasciando l'escrow bloccato. L'admin configura GAS_STATION_PRIVATE_KEY e il transfer
    // si recupera automaticamente via processWaitingForGasTransfers().
    logger.warn(
      { network, escrowAddress },
      "[MCGasStation] ⚠️  GAS_STATION_PRIVATE_KEY non configurato — GasReserveDepletedError (H-03)",
    );
    throw new GasReserveDepletedError(network, escrowAddress, 1n, 0n);
  }

  const chain = MC_CHAIN_MAP[network];
  if (!chain) {
    logger.warn({ network }, "[MCGasStation] Chain non ancora supportata — skip gas top-up");
    return;
  }

  const rpcConfig = RPC_CONFIGS[network];
  if (!rpcConfig.primary) {
    logger.warn({ network, escrowAddress }, "[MCGasStation] RPC primario non configurato — skip gas top-up");
    return;
  }

  const normalizedPk = gsPk.startsWith("0x") ? gsPk : `0x${gsPk}`;
  const gsAccount    = privateKeyToAccount(normalizedPk as `0x${string}`);

  const publicClient = createPublicClient({ chain, transport: http(rpcConfig.primary) });

  // Leggi gas price + saldo escrow in parallelo
  const [gasPrice, escrowNativeBalance] = await Promise.all([
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: escrowAddress as `0x${string}` }),
  ]);

  // Costo stimato: 2 ERC-20 transfer × 80k gas × gasPrice × buffer 2×
  const estimatedCost = MC_GAS_LIMIT_PER_TX * MC_GAS_TX_COUNT * gasPrice * MC_GAS_STATION_BUFFER;

  if (escrowNativeBalance >= estimatedCost) {
    logger.debug(
      { network, escrowAddress, nativeBalance: escrowNativeBalance.toString(), estimatedCost: estimatedCost.toString() },
      "[MCGasStation] Saldo nativo escrow sufficiente — skip top-up",
    );
    return;
  }

  // Top-up necessario — calcola importo
  let topUp = estimatedCost - escrowNativeBalance;
  if (topUp > MC_GAS_STATION_CAP) {
    logger.warn(
      { network, escrowAddress, topUp: topUp.toString(), cap: MC_GAS_STATION_CAP.toString() },
      "[MCGasStation] Top-up oltre il cap — limitato al cap di sicurezza",
    );
    topUp = MC_GAS_STATION_CAP;
  }

  // ★ GAS RESERVE CHECK: verifica saldo gas station PRIMA di tentare la TX ★
  // Se il gas station non ha fondi, lanciamo GasReserveDepletedError invece di
  // lasciare che sendTransaction fallisca con un errore tecnico non gestito.
  const gsBalance = await publicClient.getBalance({ address: gsAccount.address });

  if (gsBalance < topUp) {
    const err = new GasReserveDepletedError(network, escrowAddress, topUp, gsBalance);
    logger.warn(
      {
        network,
        escrowAddress,
        gsAddress:    gsAccount.address,
        required:     topUp.toString(),
        available:    gsBalance.toString(),
        estimatedCost: estimatedCost.toString(),
        gasPrice:     gasPrice.toString(),
      },
      "[MCGasStation] ⚠️  Riserva gas insufficiente — GasReserveDepletedError",
    );
    throw err;
  }

  const walletClient = createWalletClient({ account: gsAccount, chain, transport: http(rpcConfig.primary) });

  logger.info(
    {
      network,
      escrowAddress,
      gsAddress:     gsAccount.address,
      topUp:         topUp.toString(),
      gsBalance:     gsBalance.toString(),
      estimatedCost: estimatedCost.toString(),
      gasPrice:      gasPrice.toString(),
    },
    "[MCGasStation] Top-up nativo in corso",
  );

  try {
    const txHash = await walletClient.sendTransaction({
      to:    escrowAddress as `0x${string}`,
      value: topUp,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    logger.info(
      { network, escrowAddress, txHash, topUp: topUp.toString() },
      "[MCGasStation] Top-up nativo confermato ✓",
    );
  } catch (txErr: unknown) {
    // TX fallita dopo il balance check (race condition, gas price spike, ecc.)
    // Wrappare come GasReserveDepletedError per attivare la protezione waiting_for_gas.
    const wrapped = new GasReserveDepletedError(network, escrowAddress, topUp, gsBalance);
    logger.warn(
      { err: txErr, network, escrowAddress, gsAddress: gsAccount.address },
      "[MCGasStation] Top-up TX fallita (race condition?) — GasReserveDepletedError",
    );
    throw wrapped;
  }
}

// ─── Bitcoin minimum deposit estimation ────────────────────────────────────────

/**
 * Stima il deposito minimo BTC richiesto nell'escrow.
 * Usa BTC_FEE_CONFIG.ESTIMATE_RATE (configurabile via env) per la stima.
 *
 * Formula:
 *   minDeposit = grossAmount + estimatedMinerFee + BTC_FEE_CONFIG.BUFFER_SAT
 *
 * La miner fee è stimata per: 1 input, 3 output (recipient + feeWallet + change).
 */
async function estimateBtcMinDeposit(grossAmount: bigint): Promise<string> {
  const { estimateTxVbytes, calcMinerFee } = await import("../blockchain/bitcoin/bitcoin-utxo");
  const vbytes    = estimateTxVbytes(1, 3);
  const minerFee  = calcMinerFee(vbytes, BTC_FEE_CONFIG.ESTIMATE_RATE);
  return (grossAmount + minerFee + BTC_FEE_CONFIG.BUFFER_SAT).toString();
}

// ─── Service functions ─────────────────────────────────────────────────────────

/**
 * Crea un trasferimento multi-chain.
 *
 * M-1: per Bitcoin, rifiuta se projectFee < 546 sat (dust threshold).
 * Questo garantisce che projectFee ≠ networkFee e non viene mai persa silenziosamente.
 */
export async function createMultiChainTransfer(
  params: CreateMultiChainTransferParams,
): Promise<MultiChainTransferInfo> {
  assertFeatureEnabled(params.network, params.asset);

  // ── Determina modalità e calcola quote (funzione PURA, invariata tra preview e create) ──
  // calculatePaymentQuote gestisce entrambe le modalità in modo centralizzato.
  // Nessuna logica di calcolo fee duplicata.
  const effectiveMode: AmountMode = params.amountMode ?? "send_amount";

  // Rifiuta zero-amount prima di passare al motore di quote (che lancerebbe QUOTE_ERROR generico)
  const rawGross = params.grossAmountUnits ?? "0";
  if (BigInt(rawGross) === 0n) {
    throw multichainError("INVALID_AMOUNT", { grossAmountUnits: rawGross });
  }

  const feeConfig   = feeRegistry.resolve(params.network, params.asset);

  const quote = calculatePaymentQuote({
    amountMode:           effectiveMode,
    grossAmountUnits:     params.grossAmountUnits,
    targetNetAmountUnits: params.targetNetAmountUnits,
    network:              params.network,
    asset:                params.asset,
    feeBps:               feeConfig.feeBps,
    feeWallet:            feeConfig.feeWallet,
  });

  const grossAmount       = BigInt(quote.grossAmount);
  const projectFee        = BigInt(quote.projectFee);
  const networkFeeCharged = BigInt(quote.networkFeeCharged);
  const networkFeeAsset   = NATIVE_ASSET_SYMBOL[params.network];

  // M-1: Dust check per Bitcoin
  // projectFee < 546 sat non può essere un output P2WPKH valido.
  // Rifiutiamo qui (creazione) invece di perdere la fee silenziosamente al release.
  if (isBitcoin(params.network) && projectFee < BTC_DUST_THRESHOLD_SAT) {
    throw multichainError("BTC_PROJECT_FEE_BELOW_DUST", {
      projectFee:    projectFee.toString(),
      dustThreshold: BTC_DUST_THRESHOLD_SAT.toString(),
      grossAmount:   grossAmount.toString(),
      hint:          `Aumenta grossAmountUnits oppure riduci la fee rate. ` +
                     `projectFee minima: ${BTC_DUST_THRESHOLD_SAT} sat`,
    });
  }

  // Wallet escrow usa-e-getta
  const escrow = generateEscrowWallet();

  // Deposito minimo:
  //   BTC: gross + estimatedMinerFee + buffer (il cliente finanzia i miner)
  //   EVM: gross + networkFeeCharged (se > 0 — il cliente copre il gas station)
  //   EVM senza fee: null → detect usa grossAmount come soglia (backward compat)
  const minDepositAmount = isBitcoin(params.network)
    ? await estimateBtcMinDeposit(grossAmount)
    : networkFeeCharged > 0n
      ? (grossAmount + networkFeeCharged).toString()
      : null;

  const transferId   = randomUUID();
  const expiresAt    = new Date(Date.now() + (params.expiresInHours ?? 24) * 3_600_000);
  const assetAddress = getAssetAddress(params.network, params.asset);
  const decimals     = getDecimals(params.network, params.asset);

  const doc = await MultiChainTransferModel.create({
    transfer_id:          transferId,
    client_ref:           params.clientRef,
    sender_id:            new mongoose.Types.ObjectId(params.senderId),
    recipient_id:         new mongoose.Types.ObjectId(params.recipientId),
    conversation_id:      new mongoose.Types.ObjectId(params.conversationId),
    message_id:           null,
    network:              params.network,
    asset:                params.asset,
    asset_address:        assetAddress,
    decimals,
    gross_amount:         quote.grossAmount,
    project_fee:          quote.projectFee,
    net_amount:           quote.netAmount,
    network_fee:          "0",
    fee_bps:              quote.feeBps,
    fee_wallet:           feeConfig.feeWallet,
    sender_wallet:        params.senderWallet,
    recipient_wallet:     params.recipientWallet,
    escrow_wallet:        escrow.address,
    escrow_encrypted_pk:  escrow.encryptedPk,
    status:               "awaiting_deposit",
    tx_hash_deposit:      null,
    tx_hash_release:      null,
    tx_hash_fee:          null,
    tx_hash_refund:       null,
    // Network fee charged to client — immutabile per questo transfer (§10)
    // Separato da project_fee (0.10%) e da network_fee (gas reale in native wei)
    network_fee_charged:  networkFeeCharged > 0n ? networkFeeCharged.toString() : null,
    network_fee_asset:    networkFeeCharged > 0n ? networkFeeAsset : null,
    expires_at:           expiresAt,
    locked_at:            null,
    completed_at:         null,
    min_deposit_amount:   minDepositAmount,
    // STEP 3: modalità importo — preservata nel DB per audit e display
    amount_mode:          effectiveMode,
  });

  logger.info(
    {
      transferId,
      network:          params.network,
      asset:            params.asset,
      amountMode:       effectiveMode,
      grossAmount:      quote.grossAmount,
      projectFee:       quote.projectFee,
      netAmount:        quote.netAmount,
      minDepositAmount: minDepositAmount ?? "N/A (EVM)",
      escrow:           escrow.address,
    },
    "[MCPayment] Transfer creato",
  );

  return toInfo(doc);
}

/**
 * Rileva il deposito on-chain nel wallet escrow.
 *
 * BTC: controlla saldo UTXO nativo (getBalance) vs minDepositAmount.
 * EVM: controlla saldo token ERC-20 (getTokenBalance) vs grossAmount.
 */
export async function detectMultiChainDeposit(transferId: string): Promise<MultiChainTransferInfo> {
  const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
  if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
  if (doc.status !== "awaiting_deposit") return toInfo(doc);

  assertFeatureEnabled(doc.network, doc.asset);

  const adapter = adapterRegistry.get(doc.network);

  const balance = isBitcoin(doc.network)
    ? await adapter.getBalance(doc.escrow_wallet)
    : await adapter.getTokenBalance(doc.asset_address, doc.escrow_wallet);

  // Usa min_deposit_amount se impostato nel DB (incluso sia per BTC che per EVM con fee flat).
  // Null → fallback a grossAmount (backward compat per transfer pre-modifica senza fee flat).
  //   BTC: min_deposit_amount = gross + estimatedMinerFee + buffer
  //   EVM: min_deposit_amount = gross + network_fee_charged (se > 0)
  const required = doc.min_deposit_amount
    ? BigInt(doc.min_deposit_amount)
    : BigInt(doc.gross_amount);

  if (balance < required) {
    logger.debug(
      { transferId, balance: balance.toString(), required: required.toString(), network: doc.network },
      "[MCPayment] Deposito insufficiente — in attesa",
    );
    return toInfo(doc);
  }

  const updated = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: transferId, status: "awaiting_deposit" },
    { $set: { status: "pending" } },
    { returnDocument: "after" },
  );

  if (!updated) return toInfo(doc);

  logger.info(
    { transferId, balance: balance.toString(), required: required.toString(), network: doc.network },
    "[MCPayment] Deposito rilevato — status → pending",
  );

  return toInfo(updated);
}

/**
 * Rilascia il trasferimento.
 *
 * EVM — 2 TX con persistenza progressiva (C-1 fix):
 *   TX1 → recipient  →  PERSIST tx_hash_release  →  TX2 → feeWallet  →  FINAL released
 *   Se TX2 fallisce: tx_hash_release è già in DB → il catch non fa rollback.
 *   Lo scheduler chiama retryEVMFeeTx() per completare solo TX2.
 *
 * BTC — 1 TX multi-output (atomica):
 *   buildAndBroadcastPayout → txid → PERSIST tx_hash_release + tx_hash_fee + released
 */
export async function releaseMultiChainTransfer(transferId: string): Promise<MultiChainTransferInfo> {
  const locked = await acquireMCLock(transferId, "pending", "releasing");
  if (!locked) {
    const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
    if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
    return toInfo(doc);
  }

  assertFeatureEnabled(locked.network, locked.asset);

  try {
    if (isBitcoin(locked.network)) {
      return await _releaseBitcoin(locked);
    }
    return await _releaseEvm(locked);
  } catch (err) {
    // ★ GAS RESERVE PROTECTION: se il gas station è vuoto, NON fallire il transfer. ★
    // Il deposito è al sicuro nell'escrow. Il transfer va in "waiting_for_gas" e
    // viene ripristinato automaticamente dallo scheduler quando il gas torna disponibile.
    if (err instanceof GasReserveDepletedError) {
      return await _transitionToWaitingForGas(transferId, locked, err);
    }

    // Errore non gas-related: rollback atomico (C-1 safe).
    // { tx_hash_release: null } impedisce il rollback se TX1 è già in DB.
    // In quel caso lo scheduler completerà TX2 via retryEVMFeeTx().
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing", tx_hash_release: null },
      { $set: { status: "pending", locked_at: null } },
    );
    logger.error(
      { err, transferId },
      "[MCPayment] Release fallita — rollback (solo se tx_hash_release era null)",
    );
    throw err;
  }
}

/**
 * Ritenta il release di un transfer in stato "waiting_for_gas".
 *
 * Chiamato dallo scheduler quando rileva transfer in waiting_for_gas.
 * La logica è identica a releaseMultiChainTransfer ma acquisisce il lock
 * da "waiting_for_gas" invece che da "pending".
 *
 * Idempotenza garantita:
 *   - tx_hash_release presente → C-1 recovery via retryEVMFeeTx
 *   - Gas ancora insufficiente → torna a waiting_for_gas, gas_retry_count++
 *   - Errore non-gas → torna a waiting_for_gas (conservativo)
 */
export async function releaseFromWaitingForGas(transferId: string): Promise<MultiChainTransferInfo> {
  const locked = await acquireMCLock(transferId, "waiting_for_gas", "releasing");
  if (!locked) {
    const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
    if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
    return toInfo(doc);
  }

  assertFeatureEnabled(locked.network, locked.asset);

  try {
    if (isBitcoin(locked.network)) {
      return await _releaseBitcoin(locked);
    }
    return await _releaseEvm(locked);
  } catch (err) {
    if (err instanceof GasReserveDepletedError) {
      // Gas ancora insufficiente — torna a waiting_for_gas con retry count++
      return await _transitionToWaitingForGas(transferId, locked, err);
    }

    // Errore non gas-related (RPC, TX, ecc.).
    // C-1: se tx_hash_release è già impostato, non tornare indietro.
    // Torna a waiting_for_gas (conservativo) se TX1 non era ancora partita.
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing", tx_hash_release: null },
      { $set: { status: "waiting_for_gas", locked_at: null } },
    );
    logger.error(
      { err, transferId },
      "[MCPayment] releaseFromWaitingForGas: errore non-gas — torno a waiting_for_gas",
    );
    throw err;
  }
}

// ─── Gas Reserve Protection — Helpers ────────────────────────────────────────

/**
 * Trasla il transfer in "waiting_for_gas" quando il gas station è esaurito.
 *
 * Incrementa gas_retry_count, azzera locked_at (il transfer non è più in lock state),
 * e lancia _fireGasDepletedAlert per avvisare l'admin.
 *
 * Restituisce toInfo() del documento aggiornato senza lanciare eccezioni.
 * Il caller (releaseMultiChainTransfer / releaseFromWaitingForGas) ritorna
 * direttamente questa risposta: nessun 5xx verso il client.
 */
async function _transitionToWaitingForGas(
  transferId: string,
  doc: MultiChainTransferDocument,
  err: GasReserveDepletedError,
): Promise<MultiChainTransferInfo> {
  const updated = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: transferId, status: "releasing" },
    {
      $set: { status: "waiting_for_gas", locked_at: null },
      $inc: { gas_retry_count: 1 },
    },
    { returnDocument: "after" },
  );

  const retryCount = updated?.gas_retry_count ?? 1;
  _fireGasDepletedAlert(transferId, doc, err, retryCount);

  return toInfo(updated ?? doc);
}

/**
 * Emette un alert strutturato quando il gas station è esaurito.
 *
 * SICUREZZA: non includere mai private_key, escrow_encrypted_pk,
 * GAS_STATION_PRIVATE_KEY o altri secret nell'oggetto di log.
 *
 * L'alert è scritto a livello "error" dal logger pino (JSON structured)
 * per essere intercettato da qualsiasi sistema di monitoring.
 */
function _fireGasDepletedAlert(
  transferId: string,
  doc: MultiChainTransferDocument,
  err: GasReserveDepletedError,
  gasRetryCount: number,
): void {
  const nativeUnit = NATIVE_ASSET_SYMBOL[doc.network] ?? doc.network.toUpperCase();
  // NOTA: non includere escrow_encrypted_pk, private_key, seed phrase o chiavi crittografiche
  const alert = {
    transferId,
    network:          doc.network,
    asset:            doc.asset,
    escrowWallet:     doc.escrow_wallet,
    nativeRequired:   err.required.toString(),
    nativeAvailable:  err.available.toString(),
    nativeUnit,
    reason:           "Gas station reserve insufficient for EVM payout TX",
    depositPreserved: true,      // il deposito è al sicuro nell'escrow
    autoRecovery:     true,      // lo scheduler ritenta automaticamente
    timestamp:        new Date().toISOString(),
    gasRetryCount,
  };

  logger.error(
    alert,
    "[MCPayment:ALERT] ⚠️  GAS RESERVE DEPLETED — transfer → waiting_for_gas (recovery automatica)",
  );
  // Hook futuro: email/webhook/Telegram alert qui
}

// ─── Release EVM ──────────────────────────────────────────────────────────────

/**
 * Release EVM: 2 TX separate con persistenza progressiva (C-1 fix).
 *
 * Invariante post-TX1: tx_hash_release è in DB prima di tentare TX2.
 * Questo rende il sistema sicuro rispetto a crash/retry.
 */
async function _releaseEvm(doc: MultiChainTransferDocument): Promise<MultiChainTransferInfo> {
  const adapter    = adapterRegistry.get(doc.network);
  const signerPk   = decryptEscrowKeyHex(doc.escrow_encrypted_pk);
  const netAmount  = BigInt(doc.net_amount);
  const projectFee = BigInt(doc.project_fee);

  // TX2 amount = projectFee + networkFeeCharged (entrambe vanno al feeWallet — separati in DB)
  // Se network_fee_charged è null (transfer pre-modifica o fee = 0), tx2Amount = projectFee
  const networkFeeCharged = BigInt(doc.network_fee_charged ?? "0");
  const tx2Amount = projectFee + networkFeeCharged;

  let totalNetworkFee = 0n;

  // Gas station: garantisce che l'escrow abbia gas nativo sufficiente per TX1 + TX2
  // Non-blocking: se GAS_STATION_PRIVATE_KEY non è configurato, logga warning e continua
  await ensureMultiChainEscrowGas(doc.network, doc.escrow_wallet);

  const splitAdapter = adapter as unknown as SplitTxAdapter;

  // TX 1: netAmount → destinatario
  // ★ C-01 FIX: sign → PERSIST tx_hash_release → broadcast
  // Il hash è in DB PRIMA del broadcast: se crash dopo broadcast ma prima di
  // questa write, il catch { tx_hash_release: null } non fa rollback.
  // Lo scheduler verifica on-chain e completa il recovery.
  logger.info(
    { transferId: doc.transfer_id, to: doc.recipient_wallet, amount: netAmount.toString() },
    "[MCPayment] EVM: costruzione e firma TX1 (C-01)",
  );
  const { rawTx: tx1Raw, txHash: tx1Hash } = await splitAdapter.buildAndSignToken({
    signerPk,
    tokenAddress: doc.asset_address,
    to:           doc.recipient_wallet,
    amount:       netAmount,
  });

  // PERSIST tx_hash_release PRIMA del broadcast
  await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: doc.transfer_id, status: "releasing" },
    { $set: { tx_hash_release: tx1Hash } },
  );

  logger.info(
    { transferId: doc.transfer_id, tx1Hash, to: doc.recipient_wallet },
    "[MCPayment] EVM: TX1 hash persistito — broadcast in corso",
  );
  const { networkFee: fee1 } = await splitAdapter.broadcastAndWait(tx1Raw, tx1Hash);
  totalNetworkFee += fee1;

  // TX 2: (projectFee + networkFeeCharged) → feeWallet
  // ★ C-02 FIX: sign → PERSIST tx_hash_fee → broadcast
  // Lo scheduler (processStuckReleasingTransfers) vede tx_hash_fee impostato →
  // verifica on-chain → se confermato marca released; se non trovato → clears hash → retry.
  let txHashFee: string | null = null;
  if (doc.fee_wallet && tx2Amount > 0n) {
    logger.info(
      {
        transferId:        doc.transfer_id,
        to:                doc.fee_wallet,
        tx2Amount:         tx2Amount.toString(),
        projectFee:        projectFee.toString(),
        networkFeeCharged: networkFeeCharged.toString(),
      },
      "[MCPayment] EVM: costruzione e firma TX2 (C-02)",
    );
    const { rawTx: tx2Raw, txHash: tx2Hash } = await splitAdapter.buildAndSignToken({
      signerPk,
      tokenAddress: doc.asset_address,
      to:           doc.fee_wallet,
      amount:       tx2Amount,
    });

    // PERSIST tx_hash_fee PRIMA del broadcast
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: doc.transfer_id, status: "releasing" },
      { $set: { tx_hash_fee: tx2Hash } },
    );

    logger.info(
      { transferId: doc.transfer_id, tx2Hash, to: doc.fee_wallet },
      "[MCPayment] EVM: TX2 hash persistito — broadcast in corso",
    );
    const { networkFee: fee2 } = await splitAdapter.broadcastAndWait(tx2Raw, tx2Hash);
    totalNetworkFee += fee2;
    txHashFee = tx2Hash;
  } else if (tx2Amount > 0n) {
    logger.warn(
      { transferId: doc.transfer_id, tx2Amount: tx2Amount.toString() },
      "[MCPayment] Fee wallet non configurato — TX2 saltata",
    );
  }

  // FINAL UPDATE: hashes già in DB dal pre-broadcast persist — aggiorniamo status + fees
  const completed = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: doc.transfer_id, status: "releasing" },
    {
      $set: {
        status:          "released",
        tx_hash_release: tx1Hash,   // ridondante ma safe (idempotent)
        tx_hash_fee:     txHashFee, // ridondante ma safe (idempotent)
        network_fee:     totalNetworkFee.toString(),
        completed_at:    new Date(),
        locked_at:       null,
      },
    },
    { returnDocument: "after" },
  );

  logger.info(
    { transferId: doc.transfer_id, tx1Hash, txFee: txHashFee },
    "[MCPayment] EVM release completato",
  );

  return toInfo(completed!);
}

/**
 * Release Bitcoin: 1 TX unica multi-output (atomica per design UTXO).
 *
 * Output: recipient + feeWallet + change (miner fee dedotta dall'UTXO).
 * tx_hash_release = tx_hash_fee = stesso txid (stessa TX).
 */
async function _releaseBitcoin(doc: MultiChainTransferDocument): Promise<MultiChainTransferInfo> {
  const btcAdapter = adapterRegistry.get("bitcoin") as BitcoinAdapter;

  logger.info(
    {
      transferId:  doc.transfer_id,
      escrow:      doc.escrow_wallet,
      recipient:   doc.recipient_wallet,
      netAmount:   doc.net_amount,
      projectFee:  doc.project_fee,
      feeWallet:   doc.fee_wallet,
    },
    "[MCPayment] BTC: costruzione TX multi-output",
  );

  const result = await btcAdapter.buildAndBroadcastPayout({
    encryptedPk:   doc.escrow_encrypted_pk,
    escrowAddress: doc.escrow_wallet,
    recipient:     doc.recipient_wallet,
    netAmount:     BigInt(doc.net_amount),
    feeWallet:     doc.fee_wallet,
    projectFee:    BigInt(doc.project_fee),
  });

  // BTC: 1 TX unica → tx_hash_release e tx_hash_fee puntano allo stesso txid
  const completed = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: doc.transfer_id },
    {
      $set: {
        status:          "released",
        tx_hash_release: result.txid,
        tx_hash_fee:     result.txid,
        network_fee:     result.networkFee.toString(),
        completed_at:    new Date(),
        locked_at:       null,
      },
    },
    { returnDocument: "after" },
  );

  logger.info(
    { transferId: doc.transfer_id, txid: result.txid, networkFee: result.networkFee.toString() },
    "[MCPayment] BTC release completato (1 TX unica)",
  );

  return toInfo(completed!);
}

/**
 * Retry TX2 (fee wallet) per trasferimenti EVM con TX1 già confermata.
 *
 * Chiamato dallo scheduler quando rileva:
 *   { status:"releasing", tx_hash_release:SET, tx_hash_fee:null, fee_wallet:SET }
 *
 * Questo è il percorso di recovery per il caso C-1:
 *   TX1 → Bob ✓ | crash/TX2 failure | scheduler → retryEVMFeeTx → TX2 → fee wallet
 *
 * Idempotente: se il doc non è più in stato atteso, è un no-op.
 */
export async function retryEVMFeeTx(transferId: string): Promise<void> {
  const doc = await MultiChainTransferModel.findOne({
    transfer_id:     transferId,
    status:          "releasing",
    tx_hash_release: { $ne: null },
    tx_hash_fee:     null,
  });

  if (!doc) {
    logger.debug({ transferId }, "[MCPayment] retryEVMFeeTx: doc non trovato o già completato");
    return;
  }

  if (isBitcoin(doc.network)) {
    // BTC non usa 2 TX — non dovremmo mai arrivare qui
    logger.warn({ transferId }, "[MCPayment] retryEVMFeeTx chiamato su Bitcoin — ignorato");
    return;
  }

  const projectFee        = BigInt(doc.project_fee);
  // tx2Amount = projectFee + networkFeeCharged (deve coincidere con _releaseEvm)
  // Per transfer pre-modifica (network_fee_charged = null), tx2Amount = projectFee
  const networkFeeCharged = BigInt(doc.network_fee_charged ?? "0");
  const tx2Amount         = projectFee + networkFeeCharged;

  if (!doc.fee_wallet || tx2Amount === 0n) {
    // Nessun fee da inviare — finalizza direttamente
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing" },
      { $set: { status: "released", completed_at: new Date(), locked_at: null } },
    );
    logger.info({ transferId }, "[MCPayment] retryEVMFeeTx: nessun fee wallet — released direttamente");
    return;
  }

  try {
    const adapter      = adapterRegistry.get(doc.network);
    const splitAdapter = adapter as unknown as SplitTxAdapter;
    const signerPk     = decryptEscrowKeyHex(doc.escrow_encrypted_pk);

    logger.info(
      {
        transferId,
        to:                doc.fee_wallet,
        tx2Amount:         tx2Amount.toString(),
        projectFee:        projectFee.toString(),
        networkFeeCharged: networkFeeCharged.toString(),
      },
      "[MCPayment] retryEVMFeeTx: costruzione e firma TX2 (C-02)",
    );

    // ★ C-02 FIX: sign → PERSIST tx_hash_fee → broadcast
    const { rawTx: tx2Raw, txHash: tx2Hash } = await splitAdapter.buildAndSignToken({
      signerPk,
      tokenAddress: doc.asset_address,
      to:           doc.fee_wallet,
      amount:       tx2Amount,
    });

    // PERSIST tx_hash_fee PRIMA del broadcast
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing" },
      { $set: { tx_hash_fee: tx2Hash } },
    );

    logger.info(
      { transferId, tx2Hash, to: doc.fee_wallet },
      "[MCPayment] retryEVMFeeTx: TX2 hash persistito — broadcast in corso",
    );
    const { networkFee: fee2 } = await splitAdapter.broadcastAndWait(tx2Raw, tx2Hash);

    const prevFee = BigInt(doc.network_fee ?? "0");

    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing" },
      {
        $set: {
          status:       "released",
          tx_hash_fee:  tx2Hash,  // ridondante (già persistito sopra)
          network_fee:  (prevFee + fee2).toString(),
          completed_at: new Date(),
          locked_at:    null,
        },
      },
    );

    logger.info(
      { transferId, txHash: tx2Hash },
      "[MCPayment] retryEVMFeeTx: TX2 completata → released",
    );
  } catch (err) {
    logger.error({ err, transferId }, "[MCPayment] retryEVMFeeTx: TX2 fallita — lo scheduler riproverà");
    // Non aggiorniamo lo stato: resta "releasing" con tx_hash_release impostato.
    // Il scheduler rinoverà il lock e riproverà al prossimo ciclo.
    throw err;
  }
}

/**
 * Rimborsa il mittente.
 *
 * EVM: sendToken (saldo token ERC-20 → sender)
 * BTC: sendNative (UTXO → sender, miner fee dedotta)
 *
 * Verifica saldo reale dell'escrow prima di inviare (evita TX con importo 0).
 */
export async function refundMultiChainTransfer(transferId: string): Promise<MultiChainTransferInfo> {
  const locked = await acquireMCLock(transferId, "pending", "refunding");
  if (!locked) {
    // Prova anche da awaiting_deposit (transfer scaduti con deposito parziale)
    const fromAwaiting = await acquireMCLock(transferId, "awaiting_deposit", "refunding");
    if (!fromAwaiting) {
      const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
      if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
      return toInfo(doc);
    }
    return _doRefund(fromAwaiting);
  }
  return _doRefund(locked);
}

async function _doRefund(doc: MultiChainTransferDocument): Promise<MultiChainTransferInfo> {
  assertFeatureEnabled(doc.network, doc.asset);

  try {
    const adapter  = adapterRegistry.get(doc.network);
    const signerPk = decryptEscrowKeyHex(doc.escrow_encrypted_pk);

    // H-01: saldo reale dell'escrow — DENTRO il try block.
    // Se getBalance/getTokenBalance lancia un'eccezione RPC, il catch intercetta.
    // Il catch usa { tx_hash_refund: null } come condizione → nessun rollback se il
    // hash è già staged. processStuckRefundingTransfers() recupera al prossimo ciclo.
    const balance = isBitcoin(doc.network)
      ? await adapter.getBalance(doc.escrow_wallet)
      : await adapter.getTokenBalance(doc.asset_address, doc.escrow_wallet);

    // H-07: saldo zero → refunded immediato, locked_at azzerato
    if (balance === 0n) {
      const completed = await MultiChainTransferModel.findOneAndUpdate(
        { transfer_id: doc.transfer_id },
        { $set: { status: "refunded", completed_at: new Date(), locked_at: null } }, // locked_at: null (H-07)
        { returnDocument: "after" },
      );
      return toInfo(completed!);
    }

    let refundTxHash: string;
    let networkFee: bigint;

    if (isBitcoin(doc.network)) {
      // BTC: 1 TX atomica — TXID disponibile solo post-broadcast (UTXO-based, non pre-firmabile)
      // Per BTC il rischio di double-refund è minore (UTXO già speso = TX fallisce)
      // Rimane priorità per Sprint futuro se BTC viene abilitato in produzione.
      const result = await adapter.sendNative({ signerPk, to: doc.sender_wallet, amount: balance });
      refundTxHash = result.txHash;
      networkFee   = result.networkFee;
    } else {
      // EVM: ★ C-03 FIX: sign → PERSIST tx_hash_refund → broadcast ★
      // Se crash dopo broadcast ma prima di questa write → hash è in DB →
      // catch { tx_hash_refund: null } NON fa rollback → processStuckRefundingTransfers verifica on-chain.
      const splitAdapter = adapter as unknown as SplitTxAdapter;
      const { rawTx, txHash } = await splitAdapter.buildAndSignToken({
        signerPk,
        tokenAddress: doc.asset_address,
        to:           doc.sender_wallet,
        amount:       balance,
      });

      // PERSIST tx_hash_refund PRIMA del broadcast
      await MultiChainTransferModel.findOneAndUpdate(
        { transfer_id: doc.transfer_id, status: "refunding" },
        { $set: { tx_hash_refund: txHash } },
      );

      logger.info(
        { transferId: doc.transfer_id, txHash, to: doc.sender_wallet },
        "[MCPayment] EVM: refund hash persistito — broadcast in corso (C-03)",
      );
      const result = await splitAdapter.broadcastAndWait(rawTx, txHash);
      refundTxHash = txHash;
      networkFee   = result.networkFee;
    }

    const completed = await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: doc.transfer_id },
      {
        $set: {
          status:         "refunded",
          tx_hash_refund: refundTxHash,
          network_fee:    networkFee.toString(),
          completed_at:   new Date(),
          locked_at:      null,
        },
      },
      { returnDocument: "after" },
    );

    logger.info(
      { transferId: doc.transfer_id, txHash: refundTxHash, amount: balance.toString(), network: doc.network },
      "[MCPayment] Refund completato",
    );

    return toInfo(completed!);
  } catch (err) {
    // C-03: rollback SOLO se tx_hash_refund è ancora null.
    // Se il hash è già in DB (pre-broadcast staging), NON fare rollback:
    // processStuckRefundingTransfers() verificherà on-chain al prossimo ciclo.
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: doc.transfer_id, status: "refunding", tx_hash_refund: null },
      { $set: { status: "pending", locked_at: null } },
    );
    throw err;
  }
}

/**
 * Recupera un trasferimento per transfer_id o client_ref.
 */
export async function getMultiChainTransfer(transferId: string): Promise<MultiChainTransferInfo> {
  const doc = await MultiChainTransferModel.findOne({
    $or: [{ transfer_id: transferId }, { client_ref: transferId }],
  });
  if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
  return toInfo(doc);
}

/**
 * Verifica se un client_ref è già stato usato (idempotency check).
 */
export async function findByClientRef(clientRef: string): Promise<MultiChainTransferInfo | null> {
  const doc = await MultiChainTransferModel.findOne({ client_ref: clientRef });
  return doc ? toInfo(doc) : null;
}
