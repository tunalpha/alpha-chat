/**
 * spark-sweep.service.ts — Sweep Alpha Spark Fee Wallet → Treasury
 *
 * Architettura:
 *   - Auto-sweep: scheduler chiama checkAndQueueAutoSweep() ogni 15 min
 *   - Manuale:    admin super_admin chiama triggerManualSweep()
 *   - Entrambi:   creano un'operazione pendente e chiamano executePendingSweep()
 *
 * IDEMPOTENZA:
 *   - Un solo sweep in "processing" alla volta (lock MongoDB)
 *   - Pre-broadcast pattern: operazione creata PRIMA di inviare la TX
 *   - Recovery: reconcileProcessingSweeps() controlla history SDK su restart
 *
 * SICUREZZA:
 *   - mnemonic letto da env tramite executor — mai in questo file
 *   - treasuryAddress da config MongoDB — mai hardcoded
 *
 * ISOLAMENTO:
 *   - NON modifica il main payment flow, sendPayment, payment scheduler
 *   - NON importa da wallet utenti, chain adapter, push notification, conversazioni
 */

import { randomUUID }              from "crypto";
import { AlphaWalletFeeRecordModel } from "../models/alpha-wallet-fee-record.model.js";
import { SparkSweepOperationModel }  from "../models/spark-sweep-operation.model.js";
import type { ISparkSweepOperation } from "../models/spark-sweep-operation.model.js";
import { getSparkFeeConfig }         from "../models/spark-fee-config.model.js";
import { logger }                    from "../lib/logger.js";
import {
  sweepFeeWalletTo,
  listFeeWalletRecentPayments,
} from "./spark-fee-wallet-executor.js";

// ─── Costanti ─────────────────────────────────────────────────────────────────

/** Dopo quanti ms un'operazione "processing" è considerata stale e riconciliata */
const PROCESSING_STALE_MS = 15 * 60 * 1000; // 15 minuti

/** Finestra temporale di ricerca in history SDK (ms) per la riconciliazione:
 *  SDK_TIMEOUT (60s) + 1 min di tolleranza */
const RECONCILE_TX_WINDOW_MS = 60_000 + 60_000;

/** Minimo importo sweep in satoshi (evita dust Spark) */
const MIN_SWEEP_SAT = 1000n;

// ─── Prezzo BTC/EUR ───────────────────────────────────────────────────────────

let _btcPriceEurCache: { price: number; fetchedAt: number } | null = null;
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/** Recupera il prezzo BTC/EUR da CoinGecko con cache 5 minuti */
export async function fetchBtcPriceEur(): Promise<number> {
  const now = Date.now();
  if (_btcPriceEurCache && now - _btcPriceEurCache.fetchedAt < PRICE_CACHE_TTL_MS) {
    return _btcPriceEurCache.price;
  }

  const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur";
  const resp = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`CoinGecko error: ${resp.status}`);
  const data = await resp.json() as { bitcoin?: { eur?: number } };
  const price = data?.bitcoin?.eur;
  if (!price || typeof price !== "number" || price <= 0) {
    throw new Error("CoinGecko: prezzo BTC/EUR non disponibile");
  }
  _btcPriceEurCache = { price, fetchedAt: now };
  logger.info({ btcPriceEur: price }, "[SparkSweep] Prezzo BTC/EUR aggiornato");
  return price;
}

/** Converte EUR in satoshi usando il prezzo corrente */
export function eurToSat(eur: number, btcPriceEur: number): number {
  if (btcPriceEur <= 0) throw new Error("btcPriceEur deve essere > 0");
  return Math.round((eur / btcPriceEur) * 100_000_000);
}

/** Invalida la cache del prezzo (per test) */
export function _invalidatePriceCache(): void {
  _btcPriceEurCache = null;
}

// ─── Validazione treasury address ─────────────────────────────────────────────

export function isValidTreasuryAddress(addr: string | null | undefined): addr is string {
  if (!addr || typeof addr !== "string") return false;
  return addr.startsWith("sp1") || addr.startsWith("sprt");
}

// ─── Saldo ledger disponibile per sweep ──────────────────────────────────────

/** Calcola il saldo ledger disponibile: success - swept (fee records Spark) */
export async function getLedgerAvailableSat(): Promise<number> {
  const [successAgg, sweptAgg] = await Promise.all([
    AlphaWalletFeeRecordModel.aggregate([
      { $match: { source: "spark_lightning", status: "success" } },
      { $group: { _id: null, total: { $sum: "$feeAmountSat" } } },
    ]),
    AlphaWalletFeeRecordModel.aggregate([
      { $match: { source: "spark_lightning", status: "swept" } },
      { $group: { _id: null, total: { $sum: "$feeAmountSat" } } },
    ]),
  ]);
  const success = (successAgg[0]?.total as number | undefined) ?? 0;
  const swept   = (sweptAgg[0]?.total as number | undefined) ?? 0;
  return Math.max(0, success - swept);
}

// ─── Lock atomico ────────────────────────────────────────────────────────────

/**
 * Verifica se esiste già un'operazione in processing (lock).
 * Se esiste ed è stale → avvia riconciliazione.
 * @returns true se il lock è occupato (non procedere)
 */
async function checkConcurrentLock(): Promise<boolean> {
  const processing = await SparkSweepOperationModel.findOne({ status: "processing" });
  if (!processing) return false;

  const age = Date.now() - (processing.startedAt ?? processing.createdAt).getTime();
  if (age < PROCESSING_STALE_MS) {
    logger.warn(
      { operationId: processing._id, ageMs: age },
      "[SparkSweep] Lock occupato — sweep già in processing, skip",
    );
    return true; // lock attivo, non procedere
  }

  // Stale → riconcilia asincrono
  logger.warn(
    { operationId: processing._id, ageMs: age },
    "[SparkSweep] Operazione processing stale — avvio riconciliazione",
  );
  void reconcileProcessingSweeps().catch(e =>
    logger.error({ err: e }, "[SparkSweep] Riconciliazione fallita"),
  );
  return true; // aspetta che la riconciliazione finisca prima di tentare
}

// ─── Creazione operazione ─────────────────────────────────────────────────────

interface QueueSweepParams {
  type:           "auto" | "manual";
  requestedBy?:   string;
  amountSat:      number;
  thresholdEur:   number;
  thresholdSat:   number;
  btcPriceEur:    number;
  priceTimestamp: Date;
  treasuryAddress: string;
}

async function createSweepOperation(p: QueueSweepParams): Promise<ISparkSweepOperation> {
  const op = await SparkSweepOperationModel.create({
    _id:                randomUUID(),
    type:               p.type,
    status:             "pending",
    requestedBy:        p.requestedBy,
    availableAmountSat: p.amountSat,
    amountSat:          p.amountSat,
    thresholdEur:       p.thresholdEur,
    thresholdSat:       p.thresholdSat,
    btcPriceEur:        p.btcPriceEur,
    priceTimestamp:     p.priceTimestamp,
    treasuryAddress:    p.treasuryAddress,
  });
  return op.toObject();
}

// ─── Esecuzione sweep ─────────────────────────────────────────────────────────

/**
 * Esegue uno sweep pending: acquire lock → SDK send → aggiorna stato.
 * Chiamato in background dopo la creazione dell'operazione.
 * NON lancia — gestisce gli errori internamente.
 */
export async function executePendingSweep(operationId: string): Promise<void> {
  // Acquire lock: cambia stato da pending → processing (atomico)
  const op = await SparkSweepOperationModel.findOneAndUpdate(
    { _id: operationId, status: "pending" },
    { $set: { status: "processing", startedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!op) {
    logger.warn({ operationId }, "[SparkSweep] Operazione non trovata o già processing — skip");
    return;
  }

  logger.info(
    { operationId, amountSat: op.amountSat, treasury: `${op.treasuryAddress.slice(0, 12)}…` },
    "[SparkSweep] Avvio sweep",
  );

  try {
    // Esegui lo sweep via SDK executor (mnemonic da env)
    const result = await sweepFeeWalletTo(
      op.treasuryAddress,
      BigInt(op.amountSat),
    );

    // Aggiorna operazione a success
    await SparkSweepOperationModel.findByIdAndUpdate(operationId, {
      $set: {
        status:       "success",
        paymentId:    result.paymentId,
        networkFeeSat: result.feeSat,
        netAmountSat: result.netAmountSat,
        completedAt:  new Date(),
      },
    });

    // Marca i fee records come swept
    await markFeeRecordsSwept(op.amountSat, result.paymentId);

    logger.info(
      { operationId, paymentId: result.paymentId, netAmountSat: result.netAmountSat },
      "[SparkSweep] Sweep completato con successo",
    );

  } catch (err) {
    const errMsg = (err instanceof Error) ? err.message : String(err);

    // SICUREZZA: assicurati che errMsg non contenga mnemonic
    const safeErrMsg = errMsg.replace(/\b\w{3,}\s+\w{3,}\s+\w{3,}\s+\w{3,}/g, "[REDACTED]");

    logger.error(
      { operationId, err: safeErrMsg },
      "[SparkSweep] Sweep fallito — fee records NON marcati swept",
    );

    await SparkSweepOperationModel.findByIdAndUpdate(operationId, {
      $set: {
        status:      "failed",
        lastError:   safeErrMsg,
        completedAt: new Date(),
      },
    });
  }
}

/** Marca i fee records success come swept, proporzionalmente all'importo dello sweep */
async function markFeeRecordsSwept(amountSat: number, sweepPaymentId: string): Promise<void> {
  // Marca i record success più vecchi fino a copertura dell'importo sweep
  const records = await AlphaWalletFeeRecordModel.find(
    { source: "spark_lightning", status: "success" },
    { _id: 1, feeAmountSat: 1 },
  ).sort({ createdAt: 1 }).lean();

  let remaining = amountSat;
  const toMark: string[] = [];
  for (const r of records) {
    if (remaining <= 0) break;
    toMark.push(String(r._id));
    remaining -= (r.feeAmountSat as number) ?? 0;
  }

  if (toMark.length > 0) {
    await AlphaWalletFeeRecordModel.updateMany(
      { _id: { $in: toMark }, status: "success" },
      { $set: { status: "swept", feePaymentId: sweepPaymentId } },
    );
    logger.info(
      { markedCount: toMark.length, sweepPaymentId },
      "[SparkSweep] Fee records marcati come swept",
    );
  }
}

// ─── Auto-sweep (scheduler) ───────────────────────────────────────────────────

/**
 * Controlla saldo vs soglia e accoda uno sweep automatico se necessario.
 * Chiamato dallo scheduler ogni 15 minuti.
 * Non lancia — gestisce gli errori internamente.
 */
export async function checkAndQueueAutoSweep(): Promise<void> {
  try {
    const cfg = await getSparkFeeConfig();

    if (!cfg.auto_sweep_enabled) {
      return; // auto-sweep disabilitato dall'admin
    }

    if (!isValidTreasuryAddress(cfg.sweep_treasury_spark_address)) {
      logger.warn("[SparkSweep] Auto-sweep: treasury address non configurato o invalido — skip");
      return;
    }

    const [availableSat, btcPriceEur] = await Promise.all([
      getLedgerAvailableSat(),
      fetchBtcPriceEur(),
    ]);

    const thresholdSat = eurToSat(cfg.sweep_threshold_eur, btcPriceEur);

    if (availableSat < thresholdSat) {
      logger.info(
        { availableSat, thresholdSat, thresholdEur: cfg.sweep_threshold_eur },
        "[SparkSweep] Auto-sweep: saldo sotto soglia — skip",
      );
      return;
    }

    if (BigInt(availableSat) < MIN_SWEEP_SAT) {
      logger.info({ availableSat }, "[SparkSweep] Auto-sweep: importo troppo basso (dust) — skip");
      return;
    }

    // Controlla lock concorrente
    if (await checkConcurrentLock()) return;

    logger.info(
      { availableSat, thresholdSat, btcPriceEur, thresholdEur: cfg.sweep_threshold_eur },
      "[SparkSweep] Auto-sweep: soglia raggiunta — accodamento sweep",
    );

    const op = await createSweepOperation({
      type:            "auto",
      amountSat:       availableSat,
      thresholdEur:    cfg.sweep_threshold_eur,
      thresholdSat,
      btcPriceEur,
      priceTimestamp:  new Date(),
      treasuryAddress: cfg.sweep_treasury_spark_address!,
    });

    // Fire-and-forget: esegui lo sweep in background
    void executePendingSweep(op._id).catch(e =>
      logger.error({ err: e }, "[SparkSweep] executePendingSweep fallito"),
    );

  } catch (err) {
    logger.error({ err }, "[SparkSweep] checkAndQueueAutoSweep fallito");
  }
}

// ─── Manual sweep ─────────────────────────────────────────────────────────────

export interface ManualSweepResult {
  ok:          boolean;
  operationId?: string;
  error?:      string;
}

/**
 * Avvia un prelievo manuale (super_admin).
 * Il prelievo manuale è consentito anche sotto la soglia automatica.
 */
export async function triggerManualSweep(adminEmail: string): Promise<ManualSweepResult> {
  const cfg = await getSparkFeeConfig();

  if (!isValidTreasuryAddress(cfg.sweep_treasury_spark_address)) {
    return { ok: false, error: "Treasury Spark address non configurato o invalido" };
  }

  const availableSat = await getLedgerAvailableSat();

  if (availableSat <= 0) {
    return { ok: false, error: "Nessun saldo disponibile da prelevare" };
  }

  if (BigInt(availableSat) < MIN_SWEEP_SAT) {
    return { ok: false, error: `Importo troppo basso (min ${MIN_SWEEP_SAT} sat)` };
  }

  // Controlla lock concorrente
  if (await checkConcurrentLock()) {
    return { ok: false, error: "Sweep già in corso — riprova tra qualche minuto" };
  }

  let btcPriceEur: number;
  let thresholdSat: number;
  try {
    btcPriceEur  = await fetchBtcPriceEur();
    thresholdSat = eurToSat(cfg.sweep_threshold_eur, btcPriceEur);
  } catch (err) {
    // Prezzo non disponibile: usa valori placeholder (il prelievo manuale è sempre consentito)
    btcPriceEur  = 0;
    thresholdSat = 0;
    logger.warn({ err }, "[SparkSweep] Prezzo BTC/EUR non disponibile — sweep manuale con prezzo=0");
  }

  const op = await createSweepOperation({
    type:            "manual",
    requestedBy:     adminEmail,
    amountSat:       availableSat,
    thresholdEur:    cfg.sweep_threshold_eur,
    thresholdSat,
    btcPriceEur,
    priceTimestamp:  new Date(),
    treasuryAddress: cfg.sweep_treasury_spark_address!,
  });

  logger.info(
    { operationId: op._id, adminEmail, availableSat },
    "[SparkSweep] Sweep manuale accodato",
  );

  // Fire-and-forget — il client può fare polling dello status
  void executePendingSweep(op._id).catch(e =>
    logger.error({ err: e }, "[SparkSweep] executePendingSweep (manual) fallito"),
  );

  return { ok: true, operationId: op._id };
}

// ─── Preview prelievo (per dialog admin) ─────────────────────────────────────

export interface SweepPreview {
  availableSat:    number;
  btcPriceEur:     number | null;
  thresholdEur:    number;
  thresholdSat:    number;
  treasuryAddress: string | null;
  isAboveThreshold: boolean;
  canSweep:        boolean;
  reason?:         string;
}

export async function getSweepPreview(): Promise<SweepPreview> {
  const cfg          = await getSparkFeeConfig();
  const availableSat = await getLedgerAvailableSat();

  let btcPriceEur: number | null = null;
  let thresholdSat = 0;
  try {
    btcPriceEur  = await fetchBtcPriceEur();
    thresholdSat = eurToSat(cfg.sweep_threshold_eur, btcPriceEur);
  } catch { /* prezzo non disponibile */ }

  const treasuryAddress   = cfg.sweep_treasury_spark_address ?? null;
  const isAboveThreshold  = btcPriceEur !== null && availableSat >= thresholdSat;
  const processing        = await SparkSweepOperationModel.findOne({ status: "processing" });
  const canSweep = availableSat > 0 &&
    BigInt(availableSat) >= MIN_SWEEP_SAT &&
    isValidTreasuryAddress(treasuryAddress) &&
    !processing;

  return {
    availableSat,
    btcPriceEur,
    thresholdEur:     cfg.sweep_threshold_eur,
    thresholdSat,
    treasuryAddress,
    isAboveThreshold,
    canSweep,
    reason: processing ? "Sweep già in corso" :
            !isValidTreasuryAddress(treasuryAddress) ? "Treasury address non configurato" :
            availableSat <= 0 ? "Nessun saldo disponibile" : undefined,
  };
}

// ─── Storico e status ─────────────────────────────────────────────────────────

export async function getSweepHistory(
  page = 1,
  limit = 20,
): Promise<{ operations: ISparkSweepOperation[]; total: number }> {
  const skip  = (page - 1) * limit;
  const [operations, total] = await Promise.all([
    SparkSweepOperationModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    SparkSweepOperationModel.countDocuments(),
  ]);
  return { operations, total };
}

export interface SweepStatus {
  hasPending:    boolean;
  hasProcessing: boolean;
  lastSweep:     ISparkSweepOperation | null;
  autoSweepEnabled: boolean;
  thresholdEur:  number;
}

export async function getSweepStatus(): Promise<SweepStatus> {
  const [pending, processing, lastSweep, cfg] = await Promise.all([
    SparkSweepOperationModel.findOne({ status: "pending" }).lean(),
    SparkSweepOperationModel.findOne({ status: "processing" }).lean(),
    SparkSweepOperationModel.findOne({ status: "success" }).sort({ completedAt: -1 }).lean(),
    getSparkFeeConfig(),
  ]);
  return {
    hasPending:       !!pending,
    hasProcessing:    !!processing,
    lastSweep:        lastSweep as ISparkSweepOperation | null,
    autoSweepEnabled: cfg.auto_sweep_enabled,
    thresholdEur:     cfg.sweep_threshold_eur,
  };
}

// ─── Recovery: riconcilia operazioni processing ───────────────────────────────

/**
 * Chiamato all'avvio del server o dopo PROCESSING_STALE_MS.
 * Controlla operazioni stuck in "processing" e le riconcilia con
 * la history reale del SDK.
 */
export async function reconcileProcessingSweeps(): Promise<void> {
  const stale = await SparkSweepOperationModel.find({
    status:    "processing",
    startedAt: { $lt: new Date(Date.now() - PROCESSING_STALE_MS) },
  }).lean();

  if (!stale.length) return;

  logger.info({ count: stale.length }, "[SparkSweep] Riconciliazione operazioni processing stale");

  // Ottieni history recente dal SDK
  let recentPayments: Awaited<ReturnType<typeof listFeeWalletRecentPayments>>;
  try {
    recentPayments = await listFeeWalletRecentPayments(50);
  } catch (err) {
    logger.warn({ err }, "[SparkSweep] Impossibile ottenere history SDK per reconciliation");
    recentPayments = [];
  }

  for (const op of stale) {
    // Cerca un pagamento verso il treasury nell'intervallo di tempo dell'operazione
    const opStartMs   = (op.startedAt ?? op.createdAt).getTime();
    const windowEndMs = opStartMs + RECONCILE_TX_WINDOW_MS;

    const found = recentPayments.find(p =>
      p.amountSat >= op.amountSat * 0.95 &&  // tolleranza 5% per network fee
      p.timestamp * 1000 >= opStartMs &&
      p.timestamp * 1000 <= windowEndMs &&
      p.status !== "failed",
    );

    if (found) {
      // Pagamento trovato → operazione completata
      logger.info(
        { operationId: op._id, paymentId: found.paymentId },
        "[SparkSweep] Riconciliazione: pagamento trovato in history — marco success",
      );
      await SparkSweepOperationModel.findByIdAndUpdate(op._id, {
        $set: {
          status:       "success",
          paymentId:    found.paymentId,
          networkFeeSat: Math.max(0, op.amountSat - found.amountSat),
          netAmountSat: found.amountSat,
          completedAt:  new Date(),
        },
      });
      await markFeeRecordsSwept(op.amountSat, found.paymentId);
    } else {
      // Pagamento non trovato → marco failed (si potrà riprovare)
      logger.warn(
        { operationId: op._id },
        "[SparkSweep] Riconciliazione: pagamento non trovato — marco failed",
      );
      await SparkSweepOperationModel.findByIdAndUpdate(op._id, {
        $set: {
          status:      "failed",
          lastError:   "Riconciliazione: pagamento non trovato nella history SDK dopo timeout",
          completedAt: new Date(),
        },
      });
    }
  }
}
