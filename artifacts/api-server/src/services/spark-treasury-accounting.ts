/**
 * spark-treasury-accounting.ts — Phase 4 + C2+A Fee Collection
 *
 * Contabilità fee Lightning/Spark verso il MEDESIMO BTC Treasury di Alpha Wallet.
 *
 * ARCHITETTURA C2+A:
 *   Tier 1 (real-time) — il client tenta l'invio fee immediatamente post-pagamento
 *   Tier 2 (on-connect) — le fee pendenti vengono aggregate e inviate al login/apertura app
 *
 * DESIGN:
 * - recordSparkFee()         → crea record con status="pending_collection"
 * - markSparkFeeCollected()  → aggiorna a status="success" con feePaymentId
 * - markSparkFeesBulkCollected() → aggiorna N record con un solo feePaymentId (aggregazione Tier-2)
 * - getSparkFeePending()     → lista fee pendenti per utente (per Tier-2 client)
 * - alertStaleSparkFees()    → emette alert per fee bloccate > 24h
 *
 * GUARDRAIL:
 * - recordSparkFee() LANCIA se source non è "spark_lightning"
 * - Idempotente su paymentHash (upsert $setOnInsert)
 * - markSparkFeeCollected() è idempotente: se già success → duplicate=true
 *
 * TREASURY:
 * - Lo stesso BTC Treasury wallet (configurato in AlphaWalletFeeConfig.fee_wallet_btc)
 * - Lo sweep Spark → on-chain è differito al go-live (step separato, richede ALPHA_SPARK_FEE_ADDRESS)
 *
 * ISOLAMENTO:
 * - NON importa da BTC fee engine, MultiChain, USDA, Payment Engine
 * - NON modifica collectPlatformFeeReliable() esistente (solo record Spark nuovi)
 */

import { AlphaWalletFeeRecordModel, type FeeRecordSource } from "../models/alpha-wallet-fee-record.model";
import { logger } from "../lib/logger";

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface SparkFeeAccountingPayload {
  /**
   * Idempotency key — payment ID univoco del pagamento Lightning principale.
   * Per Lightning: payment ID restituito dall'SDK Breez (UUID-like, ≥16 char).
   * DEVE essere unico per evitare doppia contabilizzazione.
   */
  paymentHash:    string;
  /** Importo fee Alpha Platform in satoshi (non fee Breez routing) */
  alphaPlatformFeeSat: bigint;
  /** Fee wallet di riferimento (BTC_FEE_WALLET come placeholder, poi ALPHA_SPARK_FEE_ADDRESS) */
  feeWallet:      string;
  /** userId del mittente (per lookup fee pendenti per utente) */
  userId?:        string;
}

export interface SparkFeeAccountingResult {
  ok:        boolean;
  /** Se true: record già esistente (idempotency) */
  duplicate: boolean;
  recordId:  string;
}

export interface SparkFeePendingRecord {
  /** ID del record = "spark_" + mainPaymentId */
  recordId:      string;
  /** ID del pagamento principale — usato per marcare come raccolto */
  mainPaymentId: string;
  /** Fee in satoshi */
  feeAmountSat:  number;
}

export interface SparkFeePendingResult {
  records:  SparkFeePendingRecord[];
  totalSat: number;
}

// ─── Guardrail ────────────────────────────────────────────────────────────────

const SPARK_SOURCE: FeeRecordSource = "spark_lightning";
const SPARK_NETWORK = "lightning";
const SPARK_ASSET   = "BTC_SAT";      // satoshi

function assertSparkFeeRecord(payload: SparkFeeAccountingPayload): void {
  if (!payload.paymentHash || typeof payload.paymentHash !== "string") {
    throw new Error("[SparkTreasury] paymentHash obbligatorio");
  }
  if (payload.paymentHash.length < 16) {
    throw new Error("[SparkTreasury] paymentHash troppo corto (min 16 char)");
  }
  if (typeof payload.alphaPlatformFeeSat !== "bigint" || payload.alphaPlatformFeeSat < 0n) {
    throw new Error("[SparkTreasury] alphaPlatformFeeSat deve essere bigint >= 0");
  }
  if (typeof payload.feeWallet !== "string") {
    throw new Error("[SparkTreasury] feeWallet deve essere una stringa");
  }
}

// ─── Funzioni principali ──────────────────────────────────────────────────────

/**
 * Registra una fee Alpha Platform derivante da un pagamento Lightning/Spark.
 *
 * IMPORTANTE: scrive con status="pending_collection".
 * La fee NON è ancora stata raccolta fisicamente — il client tenterà l'invio Spark
 * (Tier 1) e/o lo scheduler lo riproverà al prossimo avvio (Tier 2).
 *
 * Idempotente: se il paymentHash è già presente, restituisce duplicate=true.
 *
 * NON esegue sweep on-chain verso il Treasury — solo ledger.
 */
export async function recordSparkFee(
  payload: SparkFeeAccountingPayload,
): Promise<SparkFeeAccountingResult> {
  assertSparkFeeRecord(payload);

  const recordId      = `spark_${payload.paymentHash}`;
  const feeAmountSat  = Number(payload.alphaPlatformFeeSat);
  const feeAmountStr  = `${feeAmountSat} sat`;

  try {
    const result = await AlphaWalletFeeRecordModel.findOneAndUpdate(
      { _id: recordId },
      {
        $setOnInsert: {
          _id:           recordId,
          mainPaymentId: payload.paymentHash,   // campo esplicito per audit e query
          network:       SPARK_NETWORK,
          assetSymbol:   SPARK_ASSET,
          feeAmount:     feeAmountStr,
          feeAmountSat,
          feeWallet:     payload.feeWallet || "pending-wallet-setup",
          status:        "pending_collection",  // C2+A: inizia sempre come pending
          attempts:      1,
          source:        SPARK_SOURCE,
          userId:        payload.userId ?? null,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    const isNewRecord = result?._id === recordId && result?.status === "pending_collection";
    const duplicate   = !isNewRecord;

    logger.info(
      {
        event:     "SPARK_FEE_PENDING_RECORDED",
        recordId,
        source:    SPARK_SOURCE,
        feeAmount: feeAmountStr,
        duplicate,
      },
      "[SparkTreasury] Fee Spark registrata come pending_collection",
    );

    return { ok: true, duplicate, recordId };

  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      logger.info({ recordId }, "[SparkTreasury] Fee Spark già registrata (idempotency)");
      return { ok: true, duplicate: true, recordId };
    }
    logger.error({ err, recordId }, "[SparkTreasury] Errore registrazione fee Spark");
    throw err;
  }
}

/**
 * Marca una singola fee come raccolta (Tier 1).
 *
 * Idempotente: se già status="success" con lo stesso feePaymentId → duplicate=true.
 * Se lo stesso record viene marcato con un feePaymentId diverso → errore (double-collect).
 */
export async function markSparkFeeCollected(
  recordId:     string,
  feePaymentId: string,
): Promise<{ ok: boolean; duplicate: boolean }> {
  const existing = await AlphaWalletFeeRecordModel.findById(recordId);
  if (!existing) {
    logger.warn({ recordId }, "[SparkTreasury] markSparkFeeCollected: record non trovato");
    return { ok: false, duplicate: false };
  }

  // Già collected con lo stesso paymentId → idempotent
  if (existing.status === "success" && existing.feePaymentId === feePaymentId) {
    return { ok: true, duplicate: true };
  }

  // Già collected con paymentId diverso → errore potenziale doppia riscossione
  if (existing.status === "success" && existing.feePaymentId && existing.feePaymentId !== feePaymentId) {
    logger.error(
      { recordId, existingId: existing.feePaymentId, newId: feePaymentId },
      "[SparkTreasury] ⚠️ DOPPIA RISCOSSIONE RILEVATA — feePaymentId diverso su record già success",
    );
    return { ok: false, duplicate: false };
  }

  await AlphaWalletFeeRecordModel.findOneAndUpdate(
    { _id: recordId, status: "pending_collection" },
    {
      $set: {
        status:       "success",
        feePaymentId,
        collectedAt:  new Date(),
      },
    },
  );

  logger.info(
    { recordId, feePaymentId },
    "[SparkTreasury] Fee Spark raccolta con successo (Tier 1)",
  );
  return { ok: true, duplicate: false };
}

/**
 * Marca N fee pendenti come raccolte con un singolo feePaymentId aggregato (Tier 2).
 *
 * Usato quando il client aggrega più fee pendenti in un unico pagamento Spark.
 * Idempotente: record già success vengono ignorati.
 *
 * @returns numero di record aggiornati
 */
export async function markSparkFeesBulkCollected(
  recordIds:    string[],
  feePaymentId: string,
): Promise<{ ok: boolean; updated: number }> {
  if (!recordIds.length) return { ok: true, updated: 0 };

  const result = await AlphaWalletFeeRecordModel.updateMany(
    { _id: { $in: recordIds }, status: "pending_collection" },
    {
      $set: {
        status:       "success",
        feePaymentId,
        collectedAt:  new Date(),
      },
    },
  );

  logger.info(
    { recordIds, feePaymentId, updated: result.modifiedCount },
    "[SparkTreasury] Fee Spark raccolte in bulk (Tier 2)",
  );
  return { ok: true, updated: result.modifiedCount };
}

/**
 * Restituisce le fee pendenti per un utente (per il client Tier-2).
 *
 * Il client chiama questo endpoint al login/connect e, se il fee address è
 * configurato, tenta un unico pagamento aggregato verso Alpha Spark Fee Wallet.
 */
export async function getSparkFeePending(
  userId: string,
): Promise<SparkFeePendingResult> {
  const records = await AlphaWalletFeeRecordModel.find(
    { userId, status: "pending_collection" },
    { _id: 1, feeAmountSat: 1 },
  ).lean();

  const mapped: SparkFeePendingRecord[] = records.map(r => ({
    recordId:      String(r._id),
    mainPaymentId: String(r._id).replace(/^spark_/, ""),
    feeAmountSat:  (r.feeAmountSat as number | undefined) ?? 0,
  }));

  const totalSat = mapped.reduce((s, r) => s + r.feeAmountSat, 0);

  return { records: mapped, totalSat };
}

/**
 * Emette alert per fee Spark bloccate in pending_collection da più di maxAgeMs.
 * Chiamato dallo scheduler backend (non bloccante).
 */
export async function alertStaleSparkFees(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale  = await AlphaWalletFeeRecordModel.countDocuments({
    status:    "pending_collection",
    source:    "spark_lightning",
    createdAt: { $lt: cutoff },
  });

  if (stale > 0) {
    logger.warn(
      { staleCount: stale, maxAgeHours: maxAgeMs / 3600000 },
      `⚠️ [SparkTreasury] ${stale} fee pendenti da più di ${maxAgeMs / 3600000}h — verifica Spark Fee Wallet`,
    );
  }
}

/**
 * Emette alert permanente se una fee Spark non può essere contabilizzata.
 * Non blocca mai il chiamante (fire-and-forget).
 */
export function emitSparkFeeAccountingFailureAlert(
  paymentHash: string,
  alphaPlatformFeeSat: bigint,
  error: unknown,
): void {
  logger.warn(
    {
      alert:              "SPARK_FEE_ACCOUNTING_FAILURE",
      paymentHash,
      alphaPlatformFeeSat: alphaPlatformFeeSat.toString(),
      source:             SPARK_SOURCE,
      error:              error instanceof Error ? error.message : String(error),
    },
    "⚠️  [SparkTreasury] Fee Spark non contabilizzata — verifica manuale richiesta",
  );
}
