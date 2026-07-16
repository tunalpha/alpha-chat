/**
 * SecurityTimeline Service — Sprint 19
 *
 * Gestisce la timeline degli eventi di sicurezza per utente.
 * Mai contenuti di conversazioni — solo eventi tecnici.
 */

import { SecurityEventModel, type SecurityEventType } from "../models/security-event.model";
import { logger } from "../lib/logger";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

export interface SecurityEventEntry {
  id: string;
  event_type: SecurityEventType;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface LogSecurityEventParams {
  user_id: string;
  event_type: SecurityEventType;
  metadata: Record<string, unknown>;
  ip?: string;
}

// ---------------------------------------------------------------------------
// Scrittura evento
// ---------------------------------------------------------------------------

export async function logSecurityEvent(params: LogSecurityEventParams): Promise<void> {
  try {
    const ip_hash = params.ip
      ? crypto.createHash("sha256").update(params.ip).digest("hex").slice(0, 16)
      : null;

    await SecurityEventModel.create({
      user_id: params.user_id,
      event_type: params.event_type,
      metadata: params.metadata,
      ip_hash,
      created_at: new Date(),
      expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000),
    });
  } catch (err) {
    // Non interrompe mai il flusso principale
    logger.warn({ err }, "SecurityTimeline: failed to log event");
  }
}

// ---------------------------------------------------------------------------
// Lettura timeline (paginata)
// ---------------------------------------------------------------------------

export async function getTimeline(params: {
  userId: string;
  limit?: number;
  before?: Date;
}): Promise<SecurityEventEntry[]> {
  const { userId, limit = 50, before } = params;

  const query: Record<string, unknown> = { user_id: userId };
  if (before) query["created_at"] = { $lt: before };

  const docs = await SecurityEventModel
    .find(query)
    .sort({ created_at: -1 })
    .limit(Math.min(limit, 100))
    .lean();

  return docs.map(doc => ({
    id: doc._id.toString(),
    event_type: doc.event_type,
    metadata: doc.metadata ?? {},
    created_at: doc.created_at.toISOString(),
  }));
}
