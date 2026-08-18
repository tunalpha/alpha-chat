/**
 * ChangeNOW EVM→EVM Swap Service
 *
 * Gestisce swap EVM→EVM via ChangeNOW (es. POL→USDC, ETH→USDT).
 *
 * ═══════════════════════════════════════════════════════════════
 *  SOURCE OF TRUTH: ChangeNOW API è la fonte dello stato operativo.
 *
 *  REGOLA COMPLETED (ASSOLUTA):
 *    isCompleted =
 *      cnStatus === "finished"
 *      && destinationTxHash !== null
 *      && destinationTxHash !== depositTxHash
 *
 *  REGOLA DOUBLE-SEND:
 *    fundsCommitted=true → blocco assoluto su nuovo exchange dello stesso utente.
 *    Il flag viene scritto su MongoDB prima del commit TX.
 *
 *  CAMPO SEPARATI:
 *    depositTxHash    = TX utente → payinAddress ChangeNOW
 *    destinationTxHash = TX ChangeNOW → utente (payoutHash)
 *    Mai intercambiabili.
 *
 *  SICUREZZA:
 *    API key ChangeNOW mai in risposta, mai loggata.
 *    Il server crea l'ordine e fornisce il depositEvmAddress.
 *    Firma e broadcast TX EVM avvengono nel wallet dell'utente.
 *    Il server NON custodisce fondi, NON fa broadcast server-side.
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 * ═══════════════════════════════════════════════════════════════
 */

import pino from "pino";
import {
  ChangeNowEvmSwapModel,
  type IChangeNowEvmSwap,
  CN_EVM_TERMINAL_STATUSES,
} from "../../models/changenow-evm-swap.model.js";
import {
  cnGetExchangeAmount,
  cnCreateTransaction,
  cnGetTransactionStatus,
  CN_STATUS_MAP,
  CN_EVM_TOKENS,
  type CnApiStatus,
} from "./changenow.service.js";
import { isProviderEnabled } from "./swap-provider-router.service.js";
import { AppError } from "../../errors/AppError.js";

const logger = pino({ name: "changenow-evm-swap-service" });

// ── Guard ─────────────────────────────────────────────────────────────────────

async function assertChangeNowEnabled(): Promise<void> {
  const enabled = await isProviderEnabled("changenow");
  if (!enabled) throw new AppError("CHANGENOW_DISABLED", 503);
}

function assertValidTicker(ticker: string, label: string): void {
  const exists = CN_EVM_TOKENS.some(t => t.ticker === ticker);
  if (!exists) throw new AppError(`INVALID_EVM_TOKEN_${label.toUpperCase()}`, 400);
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface EvmPairResult {
  available:  boolean;
  from:       string;
  to:         string;
  minAmount?: number;
}

export interface EvmQuoteResult {
  fromTicker:        string;
  toTicker:          string;
  fromAmount:        number;
  estimatedToAmount: number;
  minAmount:         number;
}

export interface EvmCreateInput {
  userId:               string;
  fromTicker:           string;
  toTicker:             string;
  fromAmount:           number;
  destinationEvmAddress: string;
  refundEvmAddress:     string;   // address on source chain for refund
}

export interface EvmCreateResult {
  swapId:             string;
  exchangeId:         string;
  depositEvmAddress:  string;     // ChangeNOW's EVM address — user sends here
  expectedFromAmount: number;
  expectedToAmount:   number;
  fromTicker:         string;
  toTicker:           string;
  destinationAddress: string;     // user's destination (read-only — never from user input)
}

export interface EvmSwapStatusResult {
  swapId:               string;
  exchangeId:           string;
  cnStatus:             string;
  fromAmount:           number;
  estimatedToAmount:    number;
  depositEvmAddress:    string;
  destinationAddress:   string;
  /** TX utente→payinAddress (depositTxHash) */
  depositTxHash:        string | null;
  /** TX ChangeNOW→utente (payoutHash) — diverso da depositTxHash */
  destinationTxHash:    string | null;
  fundsCommitted:       boolean;
  fromTicker:           string;
  toTicker:             string;
  refundDetails:        { refundHash?: string; refundAddress?: string } | null;
  isTerminal:           boolean;
  /**
   * COMPLETED (ASSOLUTO): cnStatus==="finished"
   *   && destinationTxHash != null
   *   && destinationTxHash !== depositTxHash
   */
  isCompleted:          boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toStatusResult(doc: IChangeNowEvmSwap): EvmSwapStatusResult {
  const isTerminal = CN_EVM_TERMINAL_STATUSES.includes(doc.cnStatus as any);
  const isCompleted = (
    doc.cnStatus === "finished"
    && doc.destinationTxHash != null
    && doc.destinationTxHash.length > 0
    && doc.destinationTxHash !== doc.depositTxHash
  );

  return {
    swapId:               doc._id.toString(),
    exchangeId:           doc.exchangeId,
    cnStatus:             doc.cnStatus,
    fromAmount:           doc.fromAmount,
    estimatedToAmount:    doc.estimatedToAmount,
    depositEvmAddress:    doc.depositEvmAddress,
    destinationAddress:   doc.destinationEvmAddress,
    depositTxHash:        doc.depositTxHash,
    destinationTxHash:    doc.destinationTxHash,
    fundsCommitted:       doc.fundsCommitted,
    fromTicker:           doc.fromTicker,
    toTicker:             doc.toTicker,
    refundDetails:        doc.refundDetails ?? null,
    isTerminal,
    isCompleted,
  };
}

// ── Check pair ────────────────────────────────────────────────────────────────

export async function checkEvmPair(
  fromTicker: string,
  toTicker:   string
): Promise<EvmPairResult> {
  await assertChangeNowEnabled();
  assertValidTicker(fromTicker, "from");
  assertValidTicker(toTicker, "to");
  if (fromTicker === toTicker) {
    return { available: false, from: fromTicker, to: toTicker };
  }
  try {
    const res = await cnGetExchangeAmount({ amount: 1, fromCurrency: fromTicker, toCurrency: toTicker });
    // Se la coppia non esiste, l'API lancia errore
    return {
      available: true,
      from:      fromTicker,
      to:        toTicker,
      minAmount: res.minAmount,
    };
  } catch {
    return { available: false, from: fromTicker, to: toTicker };
  }
}

// ── Quote ─────────────────────────────────────────────────────────────────────

export async function getEvmQuote(params: {
  fromTicker:  string;
  toTicker:    string;
  fromAmount:  number;
}): Promise<EvmQuoteResult> {
  await assertChangeNowEnabled();
  const { fromTicker, toTicker, fromAmount } = params;
  assertValidTicker(fromTicker, "from");
  assertValidTicker(toTicker, "to");
  if (fromAmount <= 0) throw new AppError("INVALID_AMOUNT", 400);

  const res = await cnGetExchangeAmount({
    amount:       fromAmount,
    fromCurrency: fromTicker,
    toCurrency:   toTicker,
  });

  return {
    fromTicker,
    toTicker,
    fromAmount,
    estimatedToAmount: res.estimatedAmount,
    minAmount:         res.minAmount ?? 0,
  };
}

// ── Create exchange ───────────────────────────────────────────────────────────

export async function createEvmExchange(input: EvmCreateInput): Promise<EvmCreateResult> {
  await assertChangeNowEnabled();
  const { userId, fromTicker, toTicker, fromAmount, destinationEvmAddress, refundEvmAddress } = input;

  assertValidTicker(fromTicker, "from");
  assertValidTicker(toTicker, "to");
  if (!destinationEvmAddress || destinationEvmAddress.length < 10) {
    throw new AppError("EVM_DESTINATION_ADDRESS_REQUIRED", 400);
  }
  if (fromAmount <= 0) throw new AppError("INVALID_AMOUNT", 400);

  // Guard: nessuno swap attivo non-terminale
  const existing = await ChangeNowEvmSwapModel.findOne({
    userId,
    cnStatus: { $nin: CN_EVM_TERMINAL_STATUSES },
    fundsCommitted: true,
  }).lean();
  if (existing) throw new AppError("ACTIVE_EVM_SWAP_EXISTS", 409);

  // Crea exchange su ChangeNOW
  const tx = await cnCreateTransaction({
    fromCurrency:  fromTicker,
    toCurrency:    toTicker,
    amount:        fromAmount,
    address:       destinationEvmAddress,
    refundAddress: refundEvmAddress || destinationEvmAddress,
  });

  // Persist su MongoDB
  const doc = await ChangeNowEvmSwapModel.create({
    userId,
    exchangeId:           tx.id,
    fromTicker,
    toTicker,
    fromAmount:           tx.expectedSendAmount,
    estimatedToAmount:    tx.expectedReceiveAmount,
    depositEvmAddress:    tx.payinAddress,
    destinationEvmAddress,
    refundEvmAddress:     refundEvmAddress || destinationEvmAddress,
    cnStatus:             CN_STATUS_MAP[tx.status as CnApiStatus] ?? "created",
    depositTxHash:        null,
    destinationTxHash:    null,
    fundsCommitted:       false,
    refundDetails:        null,
    error:                null,
  });

  logger.info(
    { swapId: doc._id.toString(), exchangeId: tx.id, fromTicker, toTicker },
    "EVM swap created"
  );

  return {
    swapId:             doc._id.toString(),
    exchangeId:         tx.id,
    depositEvmAddress:  tx.payinAddress,
    expectedFromAmount: tx.expectedSendAmount,
    expectedToAmount:   tx.expectedReceiveAmount,
    fromTicker,
    toTicker,
    destinationAddress: destinationEvmAddress,
  };
}

// ── Commit funds (write-before-submit) ────────────────────────────────────────

export async function commitEvmFunds(
  userId:        string,
  swapId:        string,
  depositTxHash: string
): Promise<void> {
  const doc = await ChangeNowEvmSwapModel.findOne({ _id: swapId, userId });
  if (!doc) throw new AppError("EVM_SWAP_NOT_FOUND", 404);
  if (CN_EVM_TERMINAL_STATUSES.includes(doc.cnStatus as any)) {
    throw new AppError("EVM_SWAP_ALREADY_TERMINAL", 409);
  }
  doc.fundsCommitted = true;
  if (depositTxHash) doc.depositTxHash = depositTxHash;
  await doc.save();
  logger.info({ swapId, depositTxHash }, "EVM swap funds committed");
}

// ── Poll status ───────────────────────────────────────────────────────────────

export async function getEvmSwapStatus(
  userId:  string,
  swapId:  string
): Promise<EvmSwapStatusResult> {
  const doc = await ChangeNowEvmSwapModel.findOne({ _id: swapId, userId });
  if (!doc) throw new AppError("EVM_SWAP_NOT_FOUND", 404);

  // Se già terminale, resituisci il DB senza chiamare ChangeNOW
  if (CN_EVM_TERMINAL_STATUSES.includes(doc.cnStatus as any)) {
    return toStatusResult(doc);
  }

  // Aggiorna da ChangeNOW (source of truth)
  try {
    const tx = await cnGetTransactionStatus(doc.exchangeId);
    const newStatus = CN_STATUS_MAP[tx.status as CnApiStatus] ?? doc.cnStatus;

    // Aggiorna solo se lo stato avanza (mai retrocedere)
    const ORDER: string[] = [
      "created","waiting","confirming","exchanging","sending","finished",
      "failed","refunded","expired","verifying","error"
    ];
    const currentIdx = ORDER.indexOf(doc.cnStatus);
    const newIdx     = ORDER.indexOf(newStatus);

    if (newIdx > currentIdx || CN_EVM_TERMINAL_STATUSES.includes(newStatus as any)) {
      doc.cnStatus = newStatus as any;
    }

    // depositTxHash (payinHash) — NON sovrascrivere se già valorizzato
    if (tx.payinHash && !doc.depositTxHash) {
      doc.depositTxHash = tx.payinHash;
    }

    // destinationTxHash (payoutHash) — SOLO se diverso da depositTxHash
    if (
      tx.payoutHash
      && tx.payoutHash !== doc.depositTxHash
      && !doc.destinationTxHash
    ) {
      doc.destinationTxHash = tx.payoutHash;
    }

    if (tx.refundHash && !doc.refundDetails?.refundHash) {
      doc.refundDetails = { refundHash: tx.refundHash };
    }

    await doc.save();
  } catch (err) {
    // Errore rete: usa dati DB (non interrompere polling)
    logger.warn({ swapId, err: (err as Error).message }, "EVM swap status fetch failed — using DB state");
  }

  return toStatusResult(doc);
}

// ── Get active swap (recovery) ────────────────────────────────────────────────

export async function getActiveEvmSwapForUser(
  userId: string
): Promise<EvmSwapStatusResult | null> {
  const doc = await ChangeNowEvmSwapModel.findOne({
    userId,
    cnStatus: { $nin: CN_EVM_TERMINAL_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!doc) return null;
  return toStatusResult(doc as IChangeNowEvmSwap);
}
