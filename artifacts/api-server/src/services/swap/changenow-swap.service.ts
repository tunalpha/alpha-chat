/**
 * ChangeNOW Swap Service — business logic
 *
 * Responsabilità:
 *   - Verifica pair BTC→USDT su chain specifica (senza assumere disponibilità)
 *   - Quote/stima importo USDT ricevuto
 *   - Creazione exchange con persistenza MongoDB
 *   - Commit funds (write-before-submit: fundsCommitted=true PRIMA del broadcast)
 *   - Polling status con aggiornamento DB
 *   - Recovery dopo reload/riavvio PWA
 *
 * ═══════════════════════════════════════════════════════════════
 *  REGOLA DOUBLE-SEND (ASSOLUTA):
 *    fundsCommitted=true → blocco assoluto su nuovo exchange
 *    Il flag è scritto su MongoDB PRIMA del broadcast BTC.
 *    Recovery: cerca swap esistente → riprende polling senza nuovo send.
 *
 *  REGOLA DESTINATION TX (ASSOLUTA):
 *    destinationTxHash  ← CnTransactionResponse.payoutHash (TX EVM)
 *    btcTxHash          ← CnTransactionResponse.payinHash  (TX BTC)
 *    I due campi sono semanticamente distinti e NON sostituibili.
 *
 *  REGOLA COMPLETED (ASSOLUTA):
 *    isCompleted = true SOLO se:
 *      (1) cnStatus === "finished"
 *      (2) destinationTxHash presente e non vuoto
 *      (3) destinationTxHash !== btcTxHash
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
  cnGetExchangeAmount,
  cnCreateTransaction,
  cnGetTransactionStatus,
  cnIsPairAvailable,
  CN_USDT_TICKERS,
  CN_FROM_CURRENCY,
  type CnApiStatus,
} from "./changenow.service.js";
import { isProviderEnabled } from "./swap-provider-router.service.js";
import { AppError } from "../../errors/AppError.js";

const logger = pino({ name: "changenow-swap-service" });

// ── Status mapping ChangeNOW API → internal ───────────────────────────────────

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

// ── Guards interni ────────────────────────────────────────────────────────────

async function assertChangeNowEnabled(): Promise<void> {
  const enabled = await isProviderEnabled("changenow");
  if (!enabled) {
    throw new AppError("CHANGENOW_DISABLED", 503);
  }
}

function assertSupportedToChain(
  toChain: string
): asserts toChain is CnToChain {
  if (!["ethereum", "polygon", "bsc"].includes(toChain)) {
    throw new AppError("UNSUPPORTED_TO_CHAIN", 400);
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface CheckPairResult {
  available:    boolean;
  fromCurrency: string;
  toCurrency:   string;
  toChain:      string;
}

export interface QuoteResult {
  fromCurrency:             string;
  toCurrency:               string;
  toChain:                  CnToChain;
  fromAmount:               number;
  estimatedToAmount:        number;
  transactionSpeedForecast: string | null;
}

export interface CreateExchangeParams {
  userId:                string;
  fromAmountBtc:         number;
  toChain:               CnToChain;
  destinationEvmAddress: string;
  btcRefundAddress?:     string;
}

export interface CreateExchangeResult {
  swapId:            string;
  exchangeId:        string;
  btcDepositAddress: string;
  estimatedToAmount: number;
  fromAmount:        number;
  toChain:           CnToChain;
  toAsset:           "USDT";
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
  toChain:               CnToChain;
  refundDetails:         { refundHash?: string; refundAddress?: string } | null;
  isTerminal:            boolean;
  /** true SOLO se: finished + destinationTxHash presente + destinationTxHash ≠ btcTxHash */
  isCompleted:           boolean;
}

// ── Public service functions ──────────────────────────────────────────────────

/**
 * Verifica la disponibilità della coppia BTC→USDT su una chain specifica.
 * Chiama sempre l'API ChangeNOW — non assume disponibilità.
 */
export async function checkPairAvailability(
  toChain: string
): Promise<CheckPairResult> {
  await assertChangeNowEnabled();
  assertSupportedToChain(toChain);

  const toCurrency = CN_USDT_TICKERS[toChain];
  if (!toCurrency) throw new AppError("UNSUPPORTED_TO_CHAIN", 400);

  const available = await cnIsPairAvailable(toCurrency);
  logger.info({ toChain, toCurrency, available }, "pair availability checked");

  if (!available) {
    logger.warn({ toChain, toCurrency }, "Pair not available on ChangeNOW");
  }

  return { available, fromCurrency: CN_FROM_CURRENCY, toCurrency, toChain };
}

/**
 * Ottieni una stima dell'importo USDT ricevuto per un dato importo BTC.
 * Non imposta fundsCommitted — nessun movimento di fondi.
 */
export async function getQuote(params: {
  fromAmountBtc: number;
  toChain:       CnToChain;
}): Promise<QuoteResult> {
  await assertChangeNowEnabled();
  assertSupportedToChain(params.toChain);

  const toCurrency = CN_USDT_TICKERS[params.toChain];
  if (!toCurrency) throw new AppError("UNSUPPORTED_TO_CHAIN", 400);

  const result = await cnGetExchangeAmount({
    amount:       params.fromAmountBtc,
    fromCurrency: CN_FROM_CURRENCY,
    toCurrency,
  });

  return {
    fromCurrency:             CN_FROM_CURRENCY,
    toCurrency,
    toChain:                  params.toChain,
    fromAmount:               params.fromAmountBtc,
    estimatedToAmount:        result.estimatedAmount,
    transactionSpeedForecast: result.transactionSpeedForecast ?? null,
  };
}

/**
 * Crea un nuovo exchange ChangeNOW e lo persiste su MongoDB.
 *
 * DOUBLE-SEND PREVENTION:
 *   • Se l'utente ha uno swap attivo con fundsCommitted=true → 409
 *   • Se ha uno swap non-terminale non-committed → 409 (evita duplicati)
 *   Solo dopo verifica assenza conflitti viene chiamata l'API ChangeNOW.
 *   Un failure dell'API ChangeNOW NON imposta fundsCommitted.
 */
export async function createExchange(
  params: CreateExchangeParams
): Promise<CreateExchangeResult> {
  await assertChangeNowEnabled();
  assertSupportedToChain(params.toChain);

  // 1. Guard anti-duplicati: cerca swap attivo per questo utente
  const existingActive = await ChangeNowSwapModel.findOne({
    userId:   params.userId,
    cnStatus: { $nin: CN_TERMINAL_STATUSES },
  }).lean();

  if (existingActive) {
    if (existingActive.fundsCommitted) {
      logger.warn(
        { userId: params.userId, existingSwapId: String(existingActive._id) },
        "createExchange blocked: fundsCommitted=true on existing swap"
      );
      throw new AppError("FUNDS_ALREADY_COMMITTED", 409);
    }
    logger.warn(
      { userId: params.userId, existingSwapId: String(existingActive._id) },
      "createExchange blocked: active swap already exists"
    );
    throw new AppError("ACTIVE_SWAP_EXISTS", 409);
  }

  const toCurrency = CN_USDT_TICKERS[params.toChain]!;

  // 2. Crea exchange su ChangeNOW (failure qui NON imposta fundsCommitted)
  const cnTx = await cnCreateTransaction({
    fromCurrency:   CN_FROM_CURRENCY,
    toCurrency,
    amount:         params.fromAmountBtc,
    address:        params.destinationEvmAddress,
    refundAddress:  params.btcRefundAddress,
  });

  // 3. Persisti su MongoDB con fundsCommitted=false
  const swap = await ChangeNowSwapModel.create({
    userId:                params.userId,
    provider:              "changenow",
    exchangeId:            cnTx.id,
    fromChain:             "bitcoin",
    toChain:               params.toChain,
    fromAsset:             "BTC",
    toAsset:               "USDT",
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
    { userId: params.userId, swapId: String(swap._id), exchangeId: cnTx.id, toChain: params.toChain },
    "ChangeNOW exchange created"
  );

  return {
    swapId:            String(swap._id),
    exchangeId:        cnTx.id,
    btcDepositAddress: cnTx.payinAddress,
    estimatedToAmount: cnTx.expectedReceiveAmount,
    fromAmount:        params.fromAmountBtc,
    toChain:           params.toChain,
    toAsset:           "USDT",
  };
}

/**
 * Segna fundsCommitted=true e persiste il btcTxHash.
 *
 * CRITICO — WRITE-BEFORE-SUBMIT:
 *   Chiamare PRIMA del broadcast BTC.
 *   Da questo momento: nessun nuovo exchange, nessun fallback automatico.
 *
 * INVARIANTE:
 *   btcTxHash qui è il txid della TX Bitcoin di deposito.
 *   NON viene mai copiato in destinationTxHash (campo EVM).
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
    // Già committed — idempotent
    if (existing.fundsCommitted) {
      logger.info({ swapId: params.swapId }, "commitFunds: already committed (idempotent)");
      return { swapId: params.swapId, fundsCommitted: true };
    }
    throw new AppError("COMMIT_FAILED", 500);
  }

  logger.info(
    { swapId: params.swapId, userId: params.userId, btcTxHash: params.btcTxHash },
    "Funds committed — BTC TX broadcast registered"
  );
  return { swapId: params.swapId, fundsCommitted: true };
}

/**
 * Interroga ChangeNOW per lo stato corrente e aggiorna il DB.
 *
 * REGOLA DESTINATION TX:
 *   destinationTxHash ← cnTx.payoutHash (TX EVM di uscita)
 *   btcTxHash         ← cnTx.payinHash  (TX BTC di deposito, già nota)
 *   Guard finale: destinationTxHash !== btcTxHash.
 *
 * COMPLETAMENTO:
 *   isCompleted=true solo se cnStatus="finished" AND destinationTxHash presente
 *   AND destinationTxHash !== btcTxHash.
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

  // Se già terminale → restituisci senza chiamare ChangeNOW
  if (CN_TERMINAL_STATUSES.includes(swap.cnStatus)) {
    return _toStatusResult(swap);
  }

  // Polling ChangeNOW
  const cnTx = await cnGetTransactionStatus(swap.exchangeId);
  const newStatus: CnSwapStatus = CN_STATUS_MAP[cnTx.status] ?? "error";

  // btcTxHash: preferisce il valore già in DB (impostato da commitFunds),
  // altrimenti prende da ChangeNOW
  const btcTxHash = swap.btcTxHash ?? cnTx.payinHash ?? null;

  // destinationTxHash: SOLO dal payoutHash ChangeNOW
  // Guard: NON può essere uguale al btcTxHash
  const rawDestTx = cnTx.payoutHash ?? null;
  const destinationTxHash =
    rawDestTx && rawDestTx !== btcTxHash ? rawDestTx : null;

  // Refund details: aggiorna se ChangeNOW ne ha di nuovi
  const refundDetails = cnTx.refundHash
    ? { refundHash: cnTx.refundHash }
    : (swap.refundDetails ?? null);

  // Aggiorna DB
  await ChangeNowSwapModel.findOneAndUpdate(
    { _id: params.swapId },
    {
      $set: {
        cnStatus:         newStatus,
        btcTxHash,
        destinationTxHash,
        refundDetails,
        // Se ChangeNOW ha rilevato il deposito → fundsCommitted=true
        fundsCommitted:   swap.fundsCommitted || !!btcTxHash,
      },
    }
  );

  const updated = await ChangeNowSwapModel.findById(params.swapId);
  if (!updated) throw new AppError("SWAP_NOT_FOUND", 404);
  return _toStatusResult(updated);
}

/**
 * Recupera lo swap attivo per un utente (recovery post-reload).
 * Restituisce null se non esiste uno swap non-terminale.
 *
 * RECOVERY:
 *   Il frontend salva swapId in localStorage["cn_swap_active_id"].
 *   Su mount chiama /active → se esiste → riprende polling senza nuovo send.
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

  // isCompleted richiede TUTTE le condizioni (spec: nessun completed senza dest TX)
  const isCompleted =
    swap.cnStatus === "finished" &&
    !!swap.destinationTxHash &&
    swap.destinationTxHash !== swap.btcTxHash;

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
    toChain:               swap.toChain,
    refundDetails:         swap.refundDetails ?? null,
    isTerminal,
    isCompleted,
  };
}
