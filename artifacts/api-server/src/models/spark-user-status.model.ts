/**
 * spark-user-status.model.ts — Registro per-utente dell'abilitazione Spark/Lightning
 *
 * SCOPE: solo tracking amministrativo. NON modifica:
 *   - Breez SDK, connect/send/receive, fee model, Payment Engine, Chat, Signal
 *
 * PRIVACY: NON contiene mnemonic, seed, private key, PIN, credenziali Breez,
 * API key, dati crittografici o segreti del wallet.
 *
 * Un record viene creato/aggiornato quando l'utente si connette effettivamente
 * a Spark Lightning (stato "connected" nel client SparkWalletContext).
 *
 * Distinzione stati:
 *   A) Spark globale disponibile   → AdminSettings.spark_lightning_enabled
 *   B) Utente con Spark configurato → spark_user_status.status = "enabled"
 *   C) Utente connesso ora          → (dato client-side, non tracciabile server)
 *
 * Collection: spark_user_status
 * Indice unico su userId (no duplicati per utente).
 */

import mongoose from "mongoose";

// ─── Interfaccia TypeScript ────────────────────────────────────────────────────

export interface ISparkUserStatus {
  /** ObjectId MongoDB dell'utente (stringa) — join con users._id */
  userId: string;

  /** Stato Spark registrato dall'utente. */
  status: "enabled" | "disabled";

  /** Timestamp auto-gestito da Mongoose (timestamps:true). */
  createdAt: Date;

  /** Timestamp auto-gestito da Mongoose (timestamps:true). */
  updatedAt: Date;

  /**
   * Ultima volta che l'utente ha effettuato una connessione Spark riuscita.
   * Null se il record è stato creato ma nessuna connessione è avvenuta.
   */
  lastSeenAt: Date | null;
}

// ─── Schema ────────────────────────────────────────────────────────────────────

const SparkUserStatusSchema = new mongoose.Schema<ISparkUserStatus>(
  {
    userId:     { type: String, required: true },
    status:     { type: String, enum: ["enabled", "disabled"], required: true },
    lastSeenAt: { type: Date, default: null },
  },
  {
    timestamps: true,               // createdAt / updatedAt auto
    collection: "spark_user_status",
    versionKey: false,
  },
);

// Indice unico — un solo record per utente
SparkUserStatusSchema.index({ userId: 1 }, { unique: true });
// Indice per query admin (filtro status + ordinamento updatedAt)
SparkUserStatusSchema.index({ status: 1, updatedAt: -1 });

// ─── Export ────────────────────────────────────────────────────────────────────

export const SparkUserStatusModel =
  (mongoose.models.SparkUserStatus as mongoose.Model<ISparkUserStatus>) ??
  mongoose.model<ISparkUserStatus>("SparkUserStatus", SparkUserStatusSchema);
