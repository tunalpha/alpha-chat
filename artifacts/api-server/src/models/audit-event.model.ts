/**
 * AuditEvent — persistenza MongoDB degli eventi di audit.
 *
 * Ogni evento emesso da logAuditEvent() viene anche scritto qui
 * per alimentare il SOC feed e le query admin.
 *
 * TTL automatico: 90 giorni (configurato tramite index).
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";
import type { AuditEventType } from "../lib/audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IAuditEvent {
  event: AuditEventType;
  user_id: string | null;
  device_id: string | null;
  family_id: string | null;
  request_id: string | null;
  ip_hash: string | null;
  country_code: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export type IAuditEventDocument = IAuditEvent & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const auditEventSchema = new Schema<IAuditEventDocument>(
  {
    event:        { type: String, required: true },
    user_id:      { type: String, default: null },
    device_id:    { type: String, default: null },
    family_id:    { type: String, default: null },
    request_id:   { type: String, default: null },
    ip_hash:      { type: String, default: null },
    country_code: { type: String, default: null },
    metadata:     { type: Schema.Types.Mixed, default: null },
    created_at:   { type: Date,   default: () => new Date() },
  },
  { timestamps: false },
);

// ---------------------------------------------------------------------------
// Indici
// ---------------------------------------------------------------------------

// TTL: rimuove automaticamente i documenti dopo 90 giorni
auditEventSchema.index({ created_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
auditEventSchema.index({ event: 1, created_at: -1 });
auditEventSchema.index({ user_id: 1, created_at: -1 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const AuditEventModel: Model<IAuditEventDocument> =
  mongoose.models["AuditEvent"] ??
  mongoose.model<IAuditEventDocument>("AuditEvent", auditEventSchema);
