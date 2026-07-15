/**
 * Refresh Token Service
 *
 * Formato:  rt_<32 byte hex>  — prefisso leggibile + 256 bit casuali
 * Storage:  SHA-256(token) nella collection sessions (mai in chiaro)
 * Durata:   30 giorni
 * Rotazione: obbligatoria ad ogni uso (invariante S-02)
 *
 * Invariante S-03: se un token già revocato viene usato:
 *   → revoca tutte le sessioni dello stesso family_id
 *   → genera audit REFRESH_TOKEN_REUSED
 *   → lancia REFRESH_TOKEN_REUSED (401)
 */

import { createHash, randomBytes } from "node:crypto";
import { SessionModel, type ISessionDocument } from "../models/session.model";
import { AppError } from "../errors/AppError";
import { logAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";
import mongoose from "mongoose";

const REFRESH_TOKEN_TTL_DAYS = 30;
const REFRESH_TOKEN_PREFIX = "rt_";

// ---------------------------------------------------------------------------
// Generazione
// ---------------------------------------------------------------------------

/** Genera un nuovo refresh token opaco. Formato: rt_<32 bytes hex> */
export function generateRefreshToken(): string {
  return REFRESH_TOKEN_PREFIX + randomBytes(32).toString("hex");
}

/** Calcola SHA-256 del token per storage nel DB. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Data di scadenza a partire da adesso (+30 giorni). */
export function refreshTokenExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return d;
}

// ---------------------------------------------------------------------------
// Creazione sessione (legacy — mantenuto per compatibilità Sprint 1 tests)
// ---------------------------------------------------------------------------

export interface CreateSessionParams {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  deviceName: string | null;
  deviceType: "ios" | "android" | "web" | "desktop";
  countryCode?: string | null;
  ipHash?: string | null;
}

/**
 * Crea o aggiorna una sessione.
 * Usare preferibilmente SessionRepository.upsert() per il supporto family_id.
 */
export async function createSession(
  params: CreateSessionParams,
): Promise<{ refreshToken: string; session: ISessionDocument }> {
  const rawToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = refreshTokenExpiresAt();
  const now = new Date();

  const session = await SessionModel.findOneAndUpdate(
    { user_id: params.userId, device_id: params.deviceId },
    {
      $set: {
        refresh_token_hash: tokenHash,
        expires_at: expiresAt,
        device_name: params.deviceName,
        device_type: params.deviceType,
        country_code: params.countryCode ?? null,
        ip_hash: params.ipHash ?? null,
        last_used_at: now,
        deleted_at: null,
        push_enabled: true,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  return { refreshToken: rawToken, session };
}

// ---------------------------------------------------------------------------
// Rotazione (invariante S-02 + S-03)
// ---------------------------------------------------------------------------

/**
 * Ruota il refresh token di una sessione.
 *
 * Lancia AppError se:
 * - token non trovato                 → REFRESH_TOKEN_INVALID (401)
 * - token scaduto                     → REFRESH_TOKEN_EXPIRED (401)
 * - token già revocato (theft, S-03)  → revoca famiglia + REFRESH_TOKEN_REUSED (401)
 */
export async function rotateRefreshToken(
  rawToken: string,
  context?: { requestId?: string; ipHash?: string },
): Promise<{
  newRefreshToken: string;
  session: ISessionDocument;
}> {
  const hash = hashRefreshToken(rawToken);

  // 1. Cerca la sessione per hash corrente (token ancora valido)
  let session = await SessionModel.findOne({ refresh_token_hash: hash });

  // 2. Non trovato per hash corrente — controlla se è un token già ruotato (S-03)
  if (!session) {
    const staleSession = await SessionModel.findOne({ previous_refresh_token_hash: hash });
    if (staleSession) {
      // Token già ruotato usato di nuovo → theft detection
      logger.warn(
        { userId: staleSession.user_id.toString(), familyId: staleSession.family_id },
        "Refresh token reuse detected (previous_hash match) — revoking family",
      );
      await SessionModel.updateMany(
        { family_id: staleSession.family_id },
        { deleted_at: new Date() },
      );
      logAuditEvent({
        event: "REFRESH_TOKEN_REUSED",
        user_id: staleSession.user_id.toString(),
        device_id: staleSession.device_id,
        family_id: staleSession.family_id,
        request_id: context?.requestId,
        ip_hash: context?.ipHash,
        created_at: new Date().toISOString(),
      });
      throw new AppError("REFRESH_TOKEN_REUSED", 401);
    }
    throw new AppError("REFRESH_TOKEN_INVALID", 401);
  }

  // 3. Sessione esplicitamente revocata (es. logout) → S-03
  if (session.deleted_at !== null) {
    logger.warn(
      { userId: session.user_id.toString(), familyId: session.family_id },
      "Refresh token reuse detected (revoked session) — revoking family",
    );
    await SessionModel.updateMany(
      { family_id: session.family_id },
      { deleted_at: new Date() },
    );
    logAuditEvent({
      event: "REFRESH_TOKEN_REUSED",
      user_id: session.user_id.toString(),
      device_id: session.device_id,
      family_id: session.family_id,
      request_id: context?.requestId,
      ip_hash: context?.ipHash,
      created_at: new Date().toISOString(),
    });
    throw new AppError("REFRESH_TOKEN_REUSED", 401);
  }

  if (session.expires_at < new Date()) {
    throw new AppError("REFRESH_TOKEN_EXPIRED", 401);
  }

  // 4. Rotazione: conserva hash vecchio in previous_refresh_token_hash
  const newRawToken = generateRefreshToken();
  const newHash = hashRefreshToken(newRawToken);

  session.previous_refresh_token_hash = hash; // conserva per theft detection al prossimo uso
  session.refresh_token_hash = newHash;
  session.expires_at = refreshTokenExpiresAt();
  session.last_used_at = new Date();
  await session.save();

  return { newRefreshToken: newRawToken, session };
}

// ---------------------------------------------------------------------------
// Revoca
// ---------------------------------------------------------------------------

/** Revoca una singola sessione tramite refresh token. */
export async function revokeSession(rawToken: string): Promise<void> {
  const hash = hashRefreshToken(rawToken);
  await SessionModel.updateOne(
    { refresh_token_hash: hash },
    { deleted_at: new Date() },
  );
}

/** Revoca tutte le sessioni di un utente tranne quella corrente. */
export async function revokeAllOtherSessions(
  userId: mongoose.Types.ObjectId,
  currentDeviceId: string,
): Promise<number> {
  const result = await SessionModel.updateMany(
    { user_id: userId, device_id: { $ne: currentDeviceId }, deleted_at: null },
    { deleted_at: new Date() },
  );
  return result.modifiedCount;
}

/** Revoca tutte le sessioni di un utente. */
export async function revokeAllSessions(userId: mongoose.Types.ObjectId): Promise<number> {
  const result = await SessionModel.updateMany(
    { user_id: userId, deleted_at: null },
    { deleted_at: new Date() },
  );
  return result.modifiedCount;
}
