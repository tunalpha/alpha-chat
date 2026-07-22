/**
 * processed-tx.model.ts — Anti-replay per transazioni blockchain (Sprint 1)
 *
 * Collection: processed_txs
 * Ogni txHash può essere registrato una sola volta (unique index).
 * Garantisce che una TX blockchain non venga usata per due deposit diversi.
 *
 * Ispirato concettualmente a lib/anti-replay.js di getusda.xyz,
 * reimplementato da zero in TypeScript. (ADR-001)
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// ---------------------------------------------------------------------------
// Interfacce TypeScript
// ---------------------------------------------------------------------------

export interface IProcessedTx {
  tx_hash: string;   // 0x... lowercase — unique
  purpose: string;   // es. "chat-transfer-deposit"
}

export interface ProcessedTxDocument extends IProcessedTx, Document {
  createdAt: Date;
}

export interface ProcessedTxModel extends Model<ProcessedTxDocument> {}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ProcessedTxSchema = new Schema<ProcessedTxDocument>(
  {
    tx_hash: { type: String, required: true },
    purpose: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "processed_txs",
  },
);

// ---------------------------------------------------------------------------
// Indici
// ---------------------------------------------------------------------------

// CRITICO — garantisce anti-replay: un txHash accettato una sola volta
ProcessedTxSchema.index({ tx_hash: 1 }, { unique: true });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ProcessedTxModel = mongoose.model<ProcessedTxDocument, ProcessedTxModel>(
  "ProcessedTx",
  ProcessedTxSchema,
);
