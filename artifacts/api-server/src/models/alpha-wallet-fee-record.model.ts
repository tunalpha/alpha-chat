/**
 * Alpha Wallet Platform Fee Record (Phase G #90)
 *
 * Ogni TX di platform fee (la seconda TX che va al fee wallet dopo il pagamento
 * principale dell'utente) genera un record qui.
 *
 * Idempotency key: _id = mainTxHash
 * Questo garantisce che lo stesso pagamento non generi due addebiti di fee.
 *
 * Stati:
 *   success          — fee raccolta correttamente
 *   failed_transient — primo tentativo fallito, retry in corso
 *   failed_permanent — tutti i tentativi esauriti, alert emesso
 */

import mongoose from "mongoose";
import { logger } from "../lib/logger";

export type FeeRecordStatus = "success" | "failed_transient" | "failed_permanent";

/**
 * Source di una fee record — identifica l'origine del pagamento.
 *
 * GUARDRAIL: una fee Spark NON deve mai essere contabilizzata come fee BTC on-chain.
 * Il campo `source` è obbligatorio per tutte le nuove fee record.
 * Default retrocompatibile: `btc_onchain` per record pre-esistenti senza il campo.
 */
export type FeeRecordSource = "btc_onchain" | "spark_lightning";

export interface IAlphaWalletFeeRecord {
  /** Idempotency key = txHash della TX principale del pagamento */
  _id:        string;
  network:    string;
  assetSymbol: string;
  /** Importo fee in formato human-readable (es. "0.10") */
  feeAmount:  string;
  feeWallet:  string;
  status:     FeeRecordStatus;
  attempts:   number;
  /** txHash della TX fee, se raccolta con successo */
  feeTxHash?: string;
  /** Ultimo messaggio di errore */
  lastError?: string;
  /**
   * Sorgente della fee — identifica il sistema che ha generato questa fee.
   *
   * ISOLAMENTO TREASURY:
   * - btc_onchain  → fee raccolta via TX EVM/BTC (Alpha Wallet Pay)
   * - spark_lightning → fee raccolta via Lightning (Spark — futura)
   *
   * Le fee Spark vengono accreditate allo STESSO BTC Treasury ma con source distinta
   * per separare la contabilità. NON confondere mai source nel reporting.
   */
  source?:    FeeRecordSource;
  createdAt:  Date;
  updatedAt:  Date;
}

const FeeRecordSchema = new mongoose.Schema<IAlphaWalletFeeRecord>(
  {
    _id:         { type: String, required: true },   // mainTxHash — idempotency key
    network:     { type: String, required: true },
    assetSymbol: { type: String, required: true },
    feeAmount:   { type: String, required: true },
    feeWallet:   { type: String, required: true },
    status:      {
      type:    String,
      enum:    ["success", "failed_transient", "failed_permanent"],
      required: true,
    },
    attempts:    { type: Number, required: true, min: 1 },
    feeTxHash:   { type: String },
    lastError:   { type: String },
    /**
     * Source retrocompatibile: assente sui record pre-esistenti = btc_onchain.
     * GUARDRAIL: i record Spark DEVONO avere source="spark_lightning".
     */
    source: {
      type:    String,
      enum:    ["btc_onchain", "spark_lightning"],
      default: undefined, // pre-existing records treated as btc_onchain in query logic
    },
  },
  {
    timestamps:   true,           // createdAt / updatedAt auto
    _id:          false,          // usa la nostra stringa come _id
    collection:   "alpha_wallet_fee_records",
  },
);

// Indice per query admin (per status + rete)
FeeRecordSchema.index({ status: 1, network: 1, createdAt: -1 });

export const AlphaWalletFeeRecordModel =
  (mongoose.models.AlphaWalletFeeRecord as mongoose.Model<IAlphaWalletFeeRecord>) ??
  mongoose.model<IAlphaWalletFeeRecord>("AlphaWalletFeeRecord", FeeRecordSchema);

// ─── Funzione di alert permanente ────────────────────────────────────────────
/**
 * Emette un log strutturato WARN di allerta quando una fee è permanentemente
 * non raccolta. Non blocca mai il chiamante.
 */
export function emitPermanentFeeFailureAlert(record: Partial<IAlphaWalletFeeRecord>): void {
  logger.warn(
    {
      alert:      "ALPHA_WALLET_FEE_PERMANENT_FAILURE",
      mainTxHash: record._id,
      network:    record.network,
      assetSymbol: record.assetSymbol,
      feeAmount:  record.feeAmount,
      feeWallet:  record.feeWallet,
      attempts:   record.attempts,
      lastError:  record.lastError,
    },
    "⚠️  [AlphaWalletFee] Platform fee non raccolta dopo tutti i tentativi — intervento manuale richiesto",
  );
}
