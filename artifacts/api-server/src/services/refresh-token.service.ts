/**
 * Refresh Token Service
 *
 * Formato:  rt_<ULID>  — prefisso leggibile + ID univoco temporale
 * Storage:  SHA-256(token) nella collection sessions (mai in chiaro)
 * Durata:   30 giorni
 * Rotazione: obbligatoria ad ogni uso (invariante S-02)
 *
 * Invariante S-03: se un token già revocato viene usato, revoca tutto.
 */

import { createHash, randomBytes } from "node:crypto";
import { SessionModel, type ISessionDocument } from "../models/session.model";
import { AppError } from "../errors/AppError";
import mongoose from "mongoose";

const REFRESH_TOKEN_TTL_DAYS = 30;
const REFRESH_TOKEN_PREFIX = "rt_";

// ---------------------------------------------------------------------------
// Generazione
// ---------------------------------------------------------------------------

/**
 * Genera un nuovo refresh token opaco.
 * Formato: rt_<32 bytes hex>
 */
export function generateRefreshToken(): string {
  return REFRESH_TOKEN_PREFIX + randomBytes(32).toString("hex");
}

/**
 * Calcola SHA-256 del token per storage nel DB.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Data di scadenza a partire da adesso.
 */
export function refreshTokenExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return d;
}

// ---------------------------------------------------------------------------
// Creazione sessione
// ---------------------------------------------------------------------------

export interface CreateSessionParams {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  deviceName: string | null;
  deviceType: "ios" | "android" | "web" | "desktop";
  countryCode?: string | null;
  city?: string | null;
  ipHash?: string | null;
}

/**
 * Crea o aggiorna una sessione per il device specificato.
 * Se esiste già una sessione per (user_id, device_id), viene aggiornata.
 * Restituisce il refresh token in chiaro (da consegnare al client).
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
      refresh_token_hash: tokenHash,
      expires_at: expiresAt,
      device_name: params.deviceName,
      device_type: params.deviceType,
      country_code: params.countryCode ?? null,
      city: params.city ?? null,
      ip_hash: params.ipHash ?? null,
      last_used_at: now,
      deleted_at: null,
      push_enabled: true,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return { refreshToken: rawToken, session };
}

// ---------------------------------------------------------------------------
// Rotazione (invariante S-02)
// ---------------------------------------------------------------------------

/**
 * Ruota il refresh token di una sessione.
 * Lancia AppError se:
 * - token non trovato → REFRESH_TOKEN_INVALID
 * - token scaduto     → REFRESH_TOKEN_EXPIRED
 * - sessione revocata → avvia token theft detection (S-03)
 */
export async function rotateRefreshToken(rawToken: string): Promise<{
  newRefreshToken: string;
  session: ISessionDocument;
  isNewDevice: boolean;
}> {
  const hash = hashRefreshToken(rawToken);

  const session = await SessionModel.findOne({ refresh_token_hash: hash });

  if (!session) {
    throw new AppError("REFRESH_TOKEN_INVALID", 401);
  }

  // Sessione già revocata → token theft (S-03)
  if (session.deleted_at !== null) {
    await SessionModel.updateMany(
      { user_id: session.user_id },
      { deleted_at: new Date() },
    );
    throw new AppError("REFRESH_TOKEN_REUSED", 401);
  }

  if (session.expires_at < new Date()) {
    throw new AppError("REFRESH_TOKEN_EXPIRED", 401);
  }

  // Genera nuovo token e aggiorna atomicamente
  const newRawToken = generateRefreshToken();
  const newHash = hashRefreshToken(newRawToken);

  session.refresh_token_hash = newHash;
  session.expires_at = refreshTokenExpiresAt();
  session.last_used_at = new Date();
  await session.save();

  // Primo refresh = non nuovo device (già creato in login/register)
  return { newRefreshToken: newRawToken, session, isNewDevice: false };
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
export async function revokeAllSessions(
  userId: mongoose.Types.ObjectId,
): Promise<number> {
  const result = await SessionModel.updateMany(
    { user_id: userId, deleted_at: null },
    { deleted_at: new Date() },
  );
  return result.modifiedCount;
}
