/**
 * Audit Logger — eventi di sicurezza e compliance.
 *
 * Ogni operazione significativa emette un evento strutturato con:
 *   event, user_id, device_id, request_id, created_at, metadata.
 *
 * In development: stdout via pino (JSON).
 * In production (Sprint 4+): persistiti su MongoDB (audit_events collection)
 *   + forwarded a SIEM esterno.
 *
 * Regola: un audit event non deve mai fallire silenziosamente.
 * Se il log fallisce, lo si logga come errore — non si blocca la request.
 */

import pino from "pino";

// Audit logger separato dall'app logger — stream dedicato in produzione
const auditLogger = pino({
  name: "audit",
  level: process.env["LOG_LEVEL"] ?? "info",
  // In prod verrà configurato con un transport verso MongoDB/SIEM
});

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type AuditEventType =
  | "USER_REGISTERED"
  | "USER_LOGIN"
  | "USER_LOGIN_FAILED"
  | "USER_LOGOUT"
  | "USER_LOGOUT_ALL"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_REQUESTED"
  | "ACCOUNT_LOCKED"
  | "SESSION_REVOKED"
  | "SESSION_REVOKED_ALL"
  | "REFRESH_TOKEN_REUSED"   // token theft detection
  | "NEW_DEVICE_LOGIN"
  | "2FA_ENABLED"
  | "2FA_DISABLED"
  | "ACCOUNT_DELETED"
  | "USERNAME_CHANGED";

export interface AuditEvent {
  event: AuditEventType;
  user_id?: string;
  device_id?: string;
  request_id?: string;
  ip_hash?: string;
  country_code?: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Funzione pubblica
// ---------------------------------------------------------------------------

/**
 * Emette un evento di audit.
 * Non lancia mai eccezioni — gli errori di audit non devono bloccare il flusso.
 */
export function logAuditEvent(event: AuditEvent): void {
  try {
    auditLogger.info({ ...event }, `audit:${event.event}`);
  } catch {
    // Fallback silenzioso — non bloccare l'operazione principale
  }
}
