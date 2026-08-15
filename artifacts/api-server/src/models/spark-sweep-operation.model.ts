/**
 * Spark Sweep Operation — MongoDB model
 *
 * Traccia ogni operazione di sweep dal Alpha Spark Fee Wallet → Treasury.
 *
 * Ciclo di vita:
 *   pending    → operazione accodata, non ancora in esecuzione
 *   processing → SDK connesso, transazione inviata (o in corso)
 *   success    → pagamento confermato, fee records marcati swept
 *   failed     → errore, fee records NON marcati swept
 *
 * IDEMPOTENZA:
 *   Un solo sweep può essere in stato "processing" alla volta.
 *   Un sweep in "processing" da >15 min viene riconciliato con la
 *   history reale del wallet prima di essere riprovato o fallito.
 *
 * SICUREZZA:
 *   Il mnemonic non è mai salvato in questo modello.
 *   Solo paymentId (pubblico) viene salvato come prova della transazione.
 */

import mongoose from "mongoose";

export type SweepStatus = "pending" | "processing" | "success" | "failed";
export type SweepType   = "auto" | "manual";

export interface ISparkSweepOperation {
  _id: string;                       // UUID operazione

  /** auto = scheduler, manual = super_admin via API */
  type: SweepType;

  /** Stato corrente dell'operazione */
  status: SweepStatus;

  /** Admin che ha richiesto il prelievo (solo type=manual) */
  requestedBy?: string;

  // ─── Importo ─────────────────────────────────────────────────────────────
  /** Saldo ledger disponibile al momento dello sweep (sat) */
  availableAmountSat: number;

  /** Importo effettivamente spedito al treasury (sat) */
  amountSat: number;

  // ─── Prezzo BTC ──────────────────────────────────────────────────────────
  /** Soglia in EUR configurata al momento dello sweep */
  thresholdEur: number;

  /** Soglia convertita in SAT al momento dello sweep */
  thresholdSat: number;

  /** Tasso BTC/EUR utilizzato per la conversione */
  btcPriceEur: number;

  /** Timestamp del fetch del prezzo */
  priceTimestamp: Date;

  // ─── Destinazione ────────────────────────────────────────────────────────
  /** Spark address del treasury (destinazione sweep) */
  treasuryAddress: string;

  // ─── Risultato ───────────────────────────────────────────────────────────
  /** Spark payment ID (disponibile solo su success) */
  paymentId?: string;

  /** Fee di rete/provider in satoshi (Breez routing fee) */
  networkFeeSat?: number;

  /** Importo netto ricevuto dal treasury (amountSat - networkFeeSat) */
  netAmountSat?: number;

  // ─── Errore ──────────────────────────────────────────────────────────────
  lastError?: string;

  // ─── Timestamp ciclo di vita ─────────────────────────────────────────────
  startedAt?: Date;
  completedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const SweepOperationSchema = new mongoose.Schema<ISparkSweepOperation>(
  {
    _id:                { type: String, required: true },
    type:               { type: String, enum: ["auto", "manual"], required: true },
    status:             { type: String, enum: ["pending", "processing", "success", "failed"], required: true },
    requestedBy:        { type: String },

    availableAmountSat: { type: Number, required: true },
    amountSat:          { type: Number, required: true },

    thresholdEur:       { type: Number, required: true },
    thresholdSat:       { type: Number, required: true },
    btcPriceEur:        { type: Number, required: true },
    priceTimestamp:     { type: Date,   required: true },

    treasuryAddress:    { type: String, required: true },

    paymentId:          { type: String },
    networkFeeSat:      { type: Number },
    netAmountSat:       { type: Number },

    lastError:          { type: String },
    startedAt:          { type: Date },
    completedAt:        { type: Date },
  },
  {
    timestamps: true,
    _id:        false,
    collection: "spark_sweep_operations",
  },
);

// Indice per trovare l'unica operazione processing (lock) e per l'admin
SweepOperationSchema.index({ status: 1, createdAt: -1 });

export const SparkSweepOperationModel =
  (mongoose.models.SparkSweepOperation as mongoose.Model<ISparkSweepOperation>) ??
  mongoose.model<ISparkSweepOperation>("SparkSweepOperation", SweepOperationSchema);
