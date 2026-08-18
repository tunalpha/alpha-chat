/**
 * SwapProviderAuditLog — MongoDB model
 *
 * Ogni modifica alla configurazione provider viene registrata qui.
 * ISOLATO da payment audit log e alpha-wallet audit.
 *
 * NON registra mai API key, seed, o secrets.
 */

import { Schema, model } from "mongoose";
import type { SwapProviderStatus } from "./swap-provider-config.model.js";

export interface ISwapProviderAuditLog {
  adminId:        string;
  adminEmail?:    string;
  providerId:     string;
  previousStatus: SwapProviderStatus | null;
  newStatus:      SwapProviderStatus;
  previousIsPrimary:  boolean | null;
  newIsPrimary:       boolean;
  previousIsFallback: boolean | null;
  newIsFallback:      boolean;
  reason?:        string;
  timestamp:      Date;
}

const schema = new Schema<ISwapProviderAuditLog>(
  {
    adminId:            { type: String, required: true },
    adminEmail:         { type: String },
    providerId:         { type: String, required: true },
    previousStatus:     { type: String, default: null },
    newStatus:          { type: String, required: true },
    previousIsPrimary:  { type: Boolean, default: null },
    newIsPrimary:       { type: Boolean, required: true },
    previousIsFallback: { type: Boolean, default: null },
    newIsFallback:      { type: Boolean, required: true },
    reason:             { type: String },
    timestamp:          { type: Date, default: () => new Date() },
  },
  { collection: "swap_provider_audit_log", versionKey: false },
);

schema.index({ providerId: 1, timestamp: -1 });
schema.index({ adminId: 1,    timestamp: -1 });

export const SwapProviderAuditLogModel = model<ISwapProviderAuditLog>(
  "SwapProviderAuditLog",
  schema,
  "swap_provider_audit_log",
);
