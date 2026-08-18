/**
 * ChangeNOW Swap Service — BTC → any EVM token
 *
 * Versione estesa: supporta tutti gli 8 ticker BTC→EVM verificati via API.
 * Precedente versione: solo BTC→USDT (3 chain).
 *
 * ═══════════════════════════════════════════════════════════════
 *  REGOLA DOUBLE-SEND (ASSOLUTA):
 *    fundsCommitted=true → blocco assoluto su nuovo exchange
 *    Il flag è scritto su MongoDB PRIMA del broadcast BTC.
 *
 *  REGOLA DESTINATION TX (ASSOLUTA):
 *    destinationTxHash  ← CnTransactionResponse.payoutHash (TX EVM out)
 *    btcTxHash          ← CnTransactionResponse.payinHash  (TX BTC in)
 *    I due campi NON sono mai intercambiabili.
 *
 *  REGOLA COMPLETED (ASSOLUTA):
 *    isCompleted = true SOLO se:
 *      (1) cnStatus === "finished"
 *      (2) destinationTxHash presente e non vuoto
 *      (3) destinationTxHash !== btcTxHash
 *
 *  TICKER VALIDI (verificati 2026-08-18):
 *    usdterc20, usdtmatic, usdtbsc, usdcmatic, eth, pol, matic, bnbbsc
 *
 *  FEE ARCHITECTURE:
 *    Nessuna fee Alpha aggiuntiva sui flussi ChangeNOW.
 *    Il Partner Program ChangeNOW eroga 0,40% di revenue share al Partner balance.
 *    Il payout al destinatario è esattamente quello calcolato da ChangeNOW.
 * ═══════════════════════════════════════════════════════════════
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 */

import pino from "pino";
import {
  ChangeNowSwapModel,
  type IChangeNowSwap,
  type CnSwapStatus,
  type CnToChain,
} from "../../models/changenow-swap.model.js";
import {
  CnApiError,
  cnGetMinAmount,
  cnGetExchangeAmount,
  cnCreateTransaction,
  cnGetTransactionStatus,
  getCnBtcDestToken,
  CN_BTC_VALID_TICKERS,
  type CnApiStatus,
} from "./changenow.service.js";
import { isProviderEnabled } from "./swap-provider-router.service.js";
import { AppError } from "../../errors/AppError.js";

const logger = pino({ name: "changenow-swap-service" });

// ── Status mapping ────────────────────────────────────────────────────────────

const CN_STATUS_MAP: Record<CnApiStatus, CnSwapStatus> = {
  new:        "created",
  waiting:    "waiting",
  confirming: "confirming",
  exchanging: "exchanging",
  sending:    "sending",
  finished:   "finished",
  failed:     "failed",
  refunded:   "refunded",
  expired:    "expired",
  verifying:  "verifying",
};

/** Statuses terminali — nessun ulteriore polling necessario */
export const CN_TERMINAL_STATUSES: CnSwapStatus[] = [
  "finished", "failed", "refunded", "expired", "error",
];

// ── Guards ────────────────────────────────────────────────────────────────────

async function assertChangeNowEnabled(): Promise<void> {
  const enabled = await isProviderEnabled("changenow");
  if (!enabled) throw new AppError("CHANGENOW_DISABLED", 503);
}

function assertValidTicker(ticker: string): void {
  if (!CN_BTC_VALID_TICKERS.has(ticker)) {
    throw new AppError("UNSUPPORTED_BTC_DESTINATION", 400);
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface CheckPairResult {
  available:    boolean;
  fromCurrency: string;
  toTicker:     string;
  toAsset:      string;
  toChain:      string;
  minAmountBtc: number;
}

export interface QuoteResult {
  fromCurrency:             string;
  toTicker:                 string;
  toAsset:                  string;
  toChain:                  CnToChain;
  fromAmount:               number;
  estimatedToAmount:        number;
  transactionSpeedForecast: string | null;
  minAmountBtc:             number;
}

export interface CreateExchangeParams {
  userId:                string;
  fromAmountBtc:         number;
  /** Ticker ChangeNOW del token destinazione (es. "usdtmatic", "eth", "pol") */
  toTicker:              string;
  destinationEvmAddress: string;
  btcRefundAddress?:     string;
}

export interface CreateExchangeResult {
  swapId:            string;
  exchangeId:        string;
  btcDepositAddress: string;
  estimatedToAmount: number;
  fromAmount:        number;
  toTicker:          string;
  toAsset:           string;
  toChain:           CnToChain;
  toChainName:       string;
}

export interface CommitFundsParams {
  swapId:    string;
  userId:    string;
  btcTxHash: string;
}

export interface SwapStatusResult {
  swapId:                string;
  exchangeId:            string;
  cnStatus:              CnSwapStatus;
  fromAmount:            number;
  estimatedToAmount:     number;
  btcDepositAddress:     string;
  destinationEvmAddress: string;
  btcTxHash:             string | null;
  destinationTxHash:     string | null;
  fundsCommitted:        boolean;
  toTicker:              string;
  toAsset:               string;
  toChain:               CnToChain;
  toChainName:           string;
  refundDetails:         { refundHash?: string; refundAddress?: string } | null;
  isTerminal:            boolean;
  /** true SOLO se: finished + destinationTxHash presente + destinationTxHash ≠ btcTxHash */
  isCompleted:           boolean;
}

// ── Public service functions ──────────────────────────────────────────────────

/**
 * Verifica la disponibilità della coppia BTC→{toTicker} via API ChangeNOW.
 * Chiama sempre l'API — non assume disponibilità.
 */
export async function checkPairAvailability(
  toTicker: string
): Promise<CheckPairResult> {
  await assertChangeNowEnabled();
  assertValidTicker(toTicker);

  const dest = getCnBtcDestToken(toTicker)!;

  try {
    const { minAmount } = await cnGetMinAmount("btc", toTicker);
    logger.info({ toTicker, available: true, minAmount }, "BTC→EVM pair available");
    return {
      available:    true,
      fromCurrency: "btc",
      toTicker,
      toAsset:      dest.symbol,
      toChain:      dest.chain,
      minAmountBtc: minAmount,
    };
  } catch (err) {
    if (err instanceof CnApiError && err.isClientError) {
      logger.warn({ toTicker, httpStatus: err.httpStatus }, "BTC→EVM pair not available on ChangeNOW");
      return {
        available:    false,
        fromCurrency: "btc",
        toTicker,
        toAsset:      dest.symbol,
        toChain:      dest.chain,
        minAmountBtc: dest.minAmountBtc,
      };
    }
    logger.warn({ toTicker }, "ChangeNOW API provider error during BTC pair check");
    throw new AppError("CHANGENOW_API_ERROR", 503);
  }
}

/**
 * Ottieni una stima dell'importo token ricevuto per un dato importo BTC.
 */
export async function getQuote(params: {
  fromAmountBtc: number;
  toTicker:      string;
}): Promise<QuoteResult> {
  await assertChangeNowEnabled();
  assertValidTicker(params.toTicker);

  const dest = getCnBtcDestToken(params.toTicker)!;

  const result = await cnGetExchangeAmount({
    amount:       params.fromAmountBtc,
    fromCurrency: "btc",
    toCurrency:   params.toTicker,
  });

  return {
    fromCurrency:             "btc",
    toTicker:                 params.toTicker,
    toAsset:                  dest.symbol,
    toChain:                  dest.chain,
    fromAmount:               params.fromAmountBtc,
    estimatedToAmount:        result.estimatedAmount,
    transactionSpeedForecast: result.transactionSpeedForecast ?? null,
    minAmountBtc:             dest.minAmountBtc,
  };
}

/**
 * Crea un nuovo exchange ChangeNOW BTC→EVM e persiste su MongoDB.
 *
 * DOUBLE-SEND PREVENTION:
 *   • Se l'utente ha uno swap attivo non-terminale → 409
 *   Solo dopo verifica viene chiamata l'API ChangeNOW.
 */
export async function createExchange(
  params: CreateExchangeParams
): Promise<CreateExchangeResult> {
  await assertChangeNowEnabled();
  assertValidTicker(params.toTicker);

  const dest = getCnBtcDestToken(params.toTicker)!;

  if (!params.destinationEvmAddress || params.destinationEvmAddress.length < 10) {
    throw new AppError("EVM_DESTINATION_ADDRESS_REQUIRED", 400);
  }

  // Guard anti-duplicati
  const existingActive = await ChangeNowSwapModel.findOne({
    userId:   params.userId,
    cnStatus: { $nin: CN_TERMINAL_STATUSES },
  }).lean();

  if (existingActive) {
    const code = existingActive.fundsCommitted
      ? "FUNDS_ALREADY_COMMITTED"
      : "ACTIVE_SWAP_EXISTS";
    logger.warn({ userId: params.userId, code }, "createExchange blocked");
    throw new AppError(code, 409);
  }

  // Crea exchange su ChangeNOW
  const cnTx = await cnCreateTransaction({
    fromCurrency:  "btc",
    toCurrency:    params.toTicker,
    amount:        params.fromAmountBtc,
    address:       params.destinationEvmAddress,
    refundAddress: params.btcRefundAddress,
  });

  // Persisti
  const swap = await ChangeNowSwapModel.create({
    userId:                params.userId,
    provider:              "changenow",
    exchangeId:            cnTx.id,
    fromChain:             "bitcoin",
    toChain:               dest.chain,
    fromAsset:             "BTC",
    toAsset:               dest.symbol,
    toTicker:              params.toTicker,
    fromAmount:            params.fromAmountBtc,
    estimatedToAmount:     cnTx.expectedReceiveAmount,
    btcDepositAddress:     cnTx.payinAddress,
    destinationEvmAddress: params.destinationEvmAddress,
    cnStatus:              "created",
    btcTxHash:             null,
    destinationTxHash:     null,
    fundsCommitted:        false,
    refundDetails:         null,
  });

  logger.info(
    { userId: params.userId, swapId: String(swap._id), exchangeId: cnTx.id, toTicker: params.toTicker },
    "BTC→EVM exchange created"
  );

  return {
    swapId:            String(swap._id),
    exchangeId:        cnTx.id,
    btcDepositAddress: cnTx.payinAddress,
    estimatedToAmount: cnTx.expectedReceiveAmount,
    fromAmount:        params.fromAmountBtc,
    toTicker:          params.toTicker,
    toAsset:           dest.symbol,
    toChain:           dest.chain,
    toChainName:       dest.chainName,
  };
}

/**
 * Segna fundsCommitted=true e persiste il btcTxHash.
 * CRITICO — chiamare PRIMA del broadcast BTC (write-before-submit).
 */
export async function commitFunds(
  params: CommitFundsParams
): Promise<{ swapId: string; fundsCommitted: true }> {
  const swap = await ChangeNowSwapModel.findOneAndUpdate(
    { _id: params.swapId, userId: params.userId, fundsCommitted: false },
    {
      $set: {
        fundsCommitted: true,
        btcTxHash:      params.btcTxHash,
        cnStatus:       "waiting",
      },
    },
    { new: true }
  );

  if (!swap) {
    const existing = await ChangeNowSwapModel.findOne({
      _id:    params.swapId,
      userId: params.userId,
    });
    if (!existing) throw new AppError("SWAP_NOT_FOUND", 404);
    if (existing.fundsCommitted) {
      logger.info({ swapId: params.swapId }, "commitFunds: already committed (idempotent)");
      return { swapId: params.swapId, fundsCommitted: true };
    }
    throw new AppError("COMMIT_FAILED", 500);
  }

  logger.info({ swapId: params.swapId, btcTxHash: params.btcTxHash }, "Funds committed");
  return { swapId: params.swapId, fundsCommitted: true };
}

/**
 * Interroga ChangeNOW per lo stato corrente e aggiorna il DB.
 * Resiliente: se ChangeNOW non risponde, usa il dato DB.
 */
export async function getSwapStatus(params: {
  swapId: string;
  userId: string;
}): Promise<SwapStatusResult> {
  const swap = await ChangeNowSwapModel.findOne({
    _id:    params.swapId,
    userId: params.userId,
  });
  if (!swap) throw new AppError("SWAP_NOT_FOUND", 404);

  // Già terminale → nessun polling
  if (CN_TERMINAL_STATUSES.includes(swap.cnStatus)) {
    return _toStatusResult(swap);
  }

  try {
    const cnTx = await cnGetTransactionStatus(swap.exchangeId);
    const newStatus: CnSwapStatus = CN_STATUS_MAP[cnTx.status] ?? "error";

    const btcTxHash       = swap.btcTxHash ?? cnTx.payinHash ?? null;
    const rawDestTx       = cnTx.payoutHash ?? null;
    const destinationTxHash = rawDestTx && rawDestTx !== btcTxHash ? rawDestTx : null;
    const refundDetails   = cnTx.refundHash
      ? { refundHash: cnTx.refundHash }
      : (swap.refundDetails ?? null);

    await ChangeNowSwapModel.findOneAndUpdate(
      { _id: params.swapId },
      {
        $set: {
          cnStatus:         newStatus,
          btcTxHash,
          destinationTxHash,
          refundDetails,
          fundsCommitted:   swap.fundsCommitted || !!btcTxHash,
        },
      }
    );

    const updated = await ChangeNowSwapModel.findById(params.swapId);
    if (!updated) throw new AppError("SWAP_NOT_FOUND", 404);
    return _toStatusResult(updated);
  } catch (err) {
    // Se fallisce il polling ChangeNOW → usa dato DB (resilienza)
    if (err instanceof AppError) throw err;
    logger.warn({ swapId: params.swapId, err: String(err) }, "Status fetch failed — using DB state");
    return _toStatusResult(swap);
  }
}

/**
 * Recupera lo swap attivo (non-terminale) per un utente.
 * Usato per recovery post-reload PWA.
 */
export async function getActiveSwapForUser(
  userId: string
): Promise<SwapStatusResult | null> {
  const swap = await ChangeNowSwapModel.findOne({
    userId,
    cnStatus: { $nin: CN_TERMINAL_STATUSES },
  }).sort({ createdAt: -1 });

  if (!swap) return null;
  return _toStatusResult(swap);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _toStatusResult(swap: IChangeNowSwap): SwapStatusResult {
  const isTerminal = CN_TERMINAL_STATUSES.includes(swap.cnStatus);

  const isCompleted =
    swap.cnStatus === "finished" &&
    !!swap.destinationTxHash &&
    swap.destinationTxHash !== swap.btcTxHash;

  // Deriva toChainName dal toTicker se disponibile, altrimenti dal toChain
  const dest = getCnBtcDestToken(swap.toTicker);
  const toChainName = dest?.chainName ?? (
    swap.toChain === "ethereum" ? "Ethereum"
    : swap.toChain === "polygon"  ? "Polygon"
    : "BSC"
  );

  return {
    swapId:                String(swap._id),
    exchangeId:            swap.exchangeId,
    cnStatus:              swap.cnStatus,
    fromAmount:            swap.fromAmount,
    estimatedToAmount:     swap.estimatedToAmount,
    btcDepositAddress:     swap.btcDepositAddress,
    destinationEvmAddress: swap.destinationEvmAddress,
    btcTxHash:             swap.btcTxHash,
    destinationTxHash:     swap.destinationTxHash,
    fundsCommitted:        swap.fundsCommitted,
    toTicker:              swap.toTicker,
    toAsset:               swap.toAsset,
    toChain:               swap.toChain,
    toChainName,
    refundDetails:         swap.refundDetails ?? null,
    isTerminal,
    isCompleted,
  };
}
