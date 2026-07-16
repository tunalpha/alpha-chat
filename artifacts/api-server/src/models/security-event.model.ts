/**
 * SecurityEvent — Sprint 19
 *
 * Timeline degli eventi di sicurezza per utente.
 * Mai contenuti di conversazioni. Solo eventi tecnici.
 * TTL 90 giorni per auto-pulizia.
 */

import mongoose, { Document, Model, Schema } from "mongoose";

export type SecurityEventType =
  | "LOGIN"
  | "LOGOUT"
  | "LOGOUT_ALL"
  | "NEW_DEVICE"
  | "DEVICE_REMOVED"
  | "DEVICE_RENAMED"
  | "IDENTITY_VERIFIED"
  | "KEY_CHANGE"
  | "PASSWORD_CHANGED"
  | "PHOENIX_CODE_SET"
  | "EMERGENCY_LOCK"
  | "PHOENIX_PROTOCOL"
  | "DMS_CONFIGURED"
  | "DMS_WARNING_SENT"
  | "DMS_ACTION_EXECUTED"
  | "RECOVERY_CONTACT_ADDED"
  | "RECOVERY_CONTACT_REMOVED"
  | "SESSION_REVOKED"
  | "TWO_FA_ENABLED"
  | "TWO_FA_DISABLED";

export interface ISecurityEvent {
  user_id: mongoose.Types.ObjectId;
  event_type: SecurityEventType;
  metadata: Record<string, unknown>;
  ip_hash: string | null;
  created_at: Date;
  /** Per TTL MongoDB — auto-eliminazione dopo 90gg */
  expires_at: Date;
}

export type ISecurityEventDocument = ISecurityEvent & Document;

const schema = new Schema<ISecurityEventDocument>(
  {
    user_id:    { type: Schema.Types.ObjectId, required: true, ref: "User" },
    event_type: { type: String, required: true },
    metadata:   { type: Schema.Types.Mixed, default: {} },
    ip_hash:    { type: String, default: null },
    expires_at: { type: Date, required: true, default: () => new Date(Date.now() + 90 * 24 * 3600 * 1000) },
    created_at: { type: Date, default: () => new Date() },
  },
  { _id: true, timestamps: false },
);

schema.index({ user_id: 1, created_at: -1 }); // timeline query
schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL

export const SecurityEventModel: Model<ISecurityEventDocument> =
  mongoose.models["SecurityEvent"] ??
  mongoose.model<ISecurityEventDocument>("SecurityEvent", schema);
