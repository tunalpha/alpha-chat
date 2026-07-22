/**
 * chat-transfer-audit.model.ts — Chat Payment Engine (Sprint 1)
 *
 * Collection: chat_transfer_audit
 * Append-only — mai cancellata. Ogni transizione di stato produce una riga.
 * Usata per audit, debugging e recovery.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import type { ChatTransferStatus } from "../payment/state-machine";

// ---------------------------------------------------------------------------
// Interfacce TypeScript
// ---------------------------------------------------------------------------

export type AuditTriggeredBy =
  | "sender"
  | "recipient"
  | "scheduler"
  | "recovery"
  | "system"
  | "admin";

export interface IChatTransferAudit {
  transfer_id:   string;
  from_status:   ChatTransferStatus | null;
  to_status:     ChatTransferStatus;
  triggered_by:  AuditTriggeredBy;
  tx_hash:       string | null;
  note:          string | null;
  ip:            string | null;
}

export interface ChatTransferAuditDocument extends IChatTransferAudit, Document {
  createdAt: Date;
}

export interface ChatTransferAuditModel extends Model<ChatTransferAuditDocument> {}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ChatTransferAuditSchema = new Schema<ChatTransferAuditDocument>(
  {
    transfer_id:  { type: String, required: true },
    from_status:  { type: String, default: null },
    to_status:    { type: String, required: true },
    triggered_by: {
      type: String,
      enum: ["sender", "recipient", "scheduler", "recovery", "system", "admin"],
      required: true,
    },
    tx_hash:      { type: String, default: null },
    note:         { type: String, default: null },
    ip:           { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // solo createdAt
    collection: "chat_transfer_audit",
  },
);

// ---------------------------------------------------------------------------
// Indici
// ---------------------------------------------------------------------------

// Query audit per transfer
ChatTransferAuditSchema.index({ transfer_id: 1, createdAt: -1 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ChatTransferAuditModel = mongoose.model<
  ChatTransferAuditDocument,
  ChatTransferAuditModel
>("ChatTransferAudit", ChatTransferAuditSchema);
