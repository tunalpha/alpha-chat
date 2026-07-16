/**
 * Audit Logger — eventi di sicurezza e compliance.
 *
 * Ogni operazione significativa emette un evento strutturato con:
 *   event, user_id, device_id, request_id, created_at, metadata.
 *
 * In development: stdout via pino (JSON).
 * In production (Sprint 5+): persistiti su MongoDB (audit_events collection)
 *   + forwarded a SIEM esterno.
 *
 * Regola: un audit event non deve mai fallire silenziosamente.
 * Se il log fallisce, lo si logga come errore — non si blocca la request.
 */

import pino from "pino";

const auditLogger = pino({
  name: "audit",
  level: process.env["LOG_LEVEL"] ?? "info",
});

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type AuditEventType =
  // Registrazione
  | "USER_REGISTERED"
  // Login / Logout
  | "USER_LOGIN"
  | "USER_LOGIN_FAILED"
  | "USER_LOGOUT"
  | "USER_LOGOUT_ALL"
  // Token
  | "REFRESH_TOKEN_REUSED"         // CTO Sprint 4
  // Account
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_REQUESTED"
  | "ACCOUNT_LOCKED"
  // Sessioni / Device
  | "SESSION_REVOKED"
  | "SESSION_REVOKED_ALL"
  | "NEW_DEVICE_LOGIN"
  | "DEVICE_REMOVED"               // CTO Sprint 4
  | "DEVICE_RENAMED"               // CTO Sprint 4
  | "TRUST_STATUS_CHANGED"         // CTO Sprint 4
  // 2FA
  | "2FA_ENABLED"
  | "2FA_DISABLED"
  // Account lifecycle
  | "ACCOUNT_DELETED"
  | "USERNAME_CHANGED"
  // Conversations (Sprint 5B)
  | "CONVERSATION_CREATED"
  // Messages (Sprint 6)
  | "MESSAGE_SENT"
  // Inviti (Sprint 9)
  | "INVITE_GENERATED"
  | "INVITE_REDEEMED"
  | "INVITE_REDEEM_FAILED"
  | "INVITE_REVOKED"
  // Messaggi — azioni (Sprint 6+)
  | "MESSAGE_EDITED"
  | "MESSAGE_DELETED_EVERYONE"
  | "MESSAGE_DELETED_ME"
  | "MESSAGE_SECURE_DESTROYED"
  // Media
  | "MEDIA_UPLOADED"
  // Privacy (Sprint 15)
  | "PRIVACY_SETTINGS_UPDATED"
  | "DISAPPEARING_MESSAGES_SET"
  // Block (Sprint 15)
  | "USER_BLOCKED"
  | "USER_UNBLOCKED";

export interface AuditEvent {
  event: AuditEventType;
  user_id?: string;
  device_id?: string;
  family_id?: string;              // CTO Sprint 4 — refresh token family
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
    // Fallback silenzioso
  }
}
