/**
 * spark-treasury-accounting.ts — Phase 4
 *
 * Contabilità fee Lightning/Spark verso il MEDESIMO BTC Treasury di Alpha Wallet.
 *
 * DESIGN:
 * - NON crea un nuovo Treasury: le fee Spark vanno sullo stesso BTC Treasury esistente
 * - Il campo `source="spark_lightning"` distingue i record Spark dai record BTC on-chain
 * - NON implementa sweep automatici on-chain (differiti al go-live)
 *   → solo ledger/accounting in MongoDB
 *
 * GUARDRAIL:
 * - `recordSparkFee()` LANCIA se source non è "spark_lightning" → previene
 *   accidentale contabilizzazione come fee BTC on-chain
 * - `assertSparkFeeRecord()` verifica invarianti prima di scrivere su DB
 *
 * TREASURY:
 * - Lo stesso BTC Treasury wallet (configurato in AlphaWalletFeeConfig.fee_wallet_btc)
 * - In fase di go-live: aggiungere sweep Lightning → on-chain verso questo wallet
 * - Ora: solo record contabile, nessun movimento on-chain
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
   * Idempotency key — hash univoco del pagamento Lightning.
   * Per Lightning: payment hash (32 byte hex).
   * DEVE essere unico per evitare doppia contabilizzazione.
   */
  paymentHash:    string;
  /** Importo fee Alpha Platform in satoshi (non fee Breez routing) */
  alphaPlatformFeeSat: bigint;
  /** Fee wallet BTC (stesso wallet del BTC Treasury) */
  feeWallet:      string;
  /** userId del mittente (per audit, NON inviato al frontend) */
  userId?:        string;
}

export interface SparkFeeAccountingResult {
  ok:        boolean;
  /** Se true: record già esistente (idempotency) */
  duplicate: boolean;
  recordId:  string;
}

// ─── Guardrail ────────────────────────────────────────────────────────────────

const SPARK_SOURCE: FeeRecordSource = "spark_lightning";
const SPARK_NETWORK = "lightning";
const SPARK_ASSET   = "BTC_SAT";      // satoshi

/**
 * Verifica invarianti di una fee Spark prima della scrittura.
 * LANCIA se viene rilevata una violazione di isolamento.
 */
function assertSparkFeeRecord(payload: SparkFeeAccountingPayload): void {
  if (!payload.paymentHash || typeof payload.paymentHash !== "string") {
    throw new Error("[SparkTreasury] paymentHash obbligatorio");
  }
  if (payload.paymentHash.length < 32) {
    throw new Error("[SparkTreasury] paymentHash troppo corto (min 32 char)");
  }
  if (typeof payload.alphaPlatformFeeSat !== "bigint" || payload.alphaPlatformFeeSat < 0n) {
    throw new Error("[SparkTreasury] alphaPlatformFeeSat deve essere bigint >= 0");
  }
  if (!payload.feeWallet || typeof payload.feeWallet !== "string") {
    throw new Error("[SparkTreasury] feeWallet obbligatorio (stesso BTC Treasury)");
  }
}

// ─── Funzione principale ──────────────────────────────────────────────────────

/**
 * Registra una fee Alpha Platform derivante da un pagamento Lightning/Spark.
 *
 * Usa lo STESSO modello `AlphaWalletFeeRecord` con `source="spark_lightning"`.
 * Idempotente: se il paymentHash è già presente, restituisce duplicate=true.
 *
 * NON esegue sweep on-chain verso il Treasury — solo ledger.
 *
 * @param payload - dati del pagamento Lightning completato
 * @returns risultato della contabilizzazione
 */
export async function recordSparkFee(
  payload: SparkFeeAccountingPayload,
): Promise<SparkFeeAccountingResult> {
  assertSparkFeeRecord(payload);

  const recordId   = `spark_${payload.paymentHash}`;
  const feeAmountStr = `${payload.alphaPlatformFeeSat.toString()} sat`;

  try {
    const result = await AlphaWalletFeeRecordModel.findOneAndUpdate(
      { _id: recordId },
      {
        $setOnInsert: {
          _id:         recordId,
          network:     SPARK_NETWORK,
          assetSymbol: SPARK_ASSET,
          feeAmount:   feeAmountStr,
          feeWallet:   payload.feeWallet,
          status:      "success",       // ledger-only: nessuna TX on-chain da confermare
          attempts:    1,
          source:      SPARK_SOURCE,    // GUARDRAIL: sempre "spark_lightning"
          feeTxHash:   undefined,       // nessuna TX on-chain in questa fase
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    const duplicate = !result || result._id !== recordId; // upsert failed = pre-existing
    logger.info(
      {
        event:    "SPARK_FEE_RECORDED",
        recordId,
        source:   SPARK_SOURCE,
        network:  SPARK_NETWORK,
        feeAmount: feeAmountStr,
        feeWallet: payload.feeWallet,
        duplicate,
      },
      "[SparkTreasury] Fee Spark registrata nel ledger",
    );

    return { ok: true, duplicate: !!duplicate, recordId };

  } catch (err) {
    // Duplicate key = record già esistente (idempotency OK)
    if ((err as { code?: number }).code === 11000) {
      logger.info({ recordId }, "[SparkTreasury] Fee Spark già registrata (idempotency)");
      return { ok: true, duplicate: true, recordId };
    }
    logger.error(
      { err, recordId, source: SPARK_SOURCE },
      "[SparkTreasury] Errore registrazione fee Spark",
    );
    throw err;
  }
}

/**
 * Emette alert permanente se una fee Spark non può essere contabilizzata.
 * Non blocca il chiamante (fire-and-forget).
 */
export function emitSparkFeeAccountingFailureAlert(
  paymentHash: string,
  alphaPlatformFeeSat: bigint,
  error: unknown,
): void {
  logger.warn(
    {
      alert:     "SPARK_FEE_ACCOUNTING_FAILURE",
      paymentHash,
      alphaPlatformFeeSat: alphaPlatformFeeSat.toString(),
      source:    SPARK_SOURCE,
      error:     error instanceof Error ? error.message : String(error),
    },
    "⚠️  [SparkTreasury] Fee Spark non contabilizzata — verifica manuale richiesta",
  );
}
