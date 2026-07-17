/**
 * Account Recovery Service — Sprint 22
 *
 * Implementa recupero account privacy-first:
 * - Nessuna email obbligatoria
 * - Recovery Card generata automaticamente alla registrazione
 * - Recovery Secret mai in chiaro nel DB (argon2id)
 * - Password temporanea usa-e-getta (15 min)
 * - Revoca completa di tutte le sessioni al recupero
 */

import crypto from "node:crypto";
import mongoose from "mongoose";
import argon2 from "argon2";
import { UserModel } from "../models/user.model";
import { base58Encode } from "../lib/base58";
import { hashPassword } from "./password.service";
import { revokeAllSessions } from "./refresh-token.service";
import { AppError } from "../errors/AppError";
import { logAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";
import { recordFailedAttempt, clearFailedAttempts } from "../lib/rate-limiter";
import { sendRecoveryEmail } from "./email.service";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface RecoveryCardData {
  username:          string;
  emergency_id:      string;
  recovery_secret:   string; // Base58, mostrato UNA SOLA VOLTA
  version:           number;
  generated_at:      string; // ISO
  checksum:          string; // SHA-256 troncato (8 hex chars)
}

export interface RecoveryStatus {
  has_recovery_card:   boolean;
  has_recovery_email:  boolean;
  has_phoenix_code:    boolean;
  card_version:        number | null;
  card_generated_at:   string | null;
  last_recovery_at:    string | null;
  recovery_email_masked: string | null;
}

export interface TempPasswordResult {
  temp_password:     string;  // mostrata all'utente
  expires_at:        string;  // ISO
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TEMP_PASSWORD_TTL_MS = 15 * 60 * 1000; // 15 minuti
const TEMP_PASSWORD_LENGTH = 20;
// Charset senza caratteri ambigui (0,O,I,l,1)
const TEMP_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

const EMAIL_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minuti
const MAX_RECOVER_ATTEMPTS = 5; // anti-brute force per window
const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRecoverySecret(): { plain: string; hash: Promise<string> } {
  const bytes  = crypto.randomBytes(32);
  const plain  = base58Encode(bytes);
  const hash   = argon2.hash(plain, ARGON2_OPTS);
  return { plain, hash };
}

function generateEmergencyId(): string {
  return crypto.randomUUID().toUpperCase();
}

function generateTempPassword(): string {
  const bytes = crypto.randomBytes(TEMP_PASSWORD_LENGTH);
  return Array.from(bytes)
    .map((b) => TEMP_CHARSET[b % TEMP_CHARSET.length]!)
    .join("");
}

function computeChecksum(username: string, emergencyId: string, secret: string): string {
  return crypto
    .createHash("sha256")
    .update(`${username}:${emergencyId}:${secret}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  const visible = local.length <= 2 ? local[0]! : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

function emailTokenKey(token: string): string {
  return `recovery_email_token:${token}`;
}

// ---------------------------------------------------------------------------
// generateRecoveryCard — chiamato alla registrazione
// ---------------------------------------------------------------------------

export async function generateRecoveryCard(
  userId: mongoose.Types.ObjectId,
  username: string,
): Promise<RecoveryCardData> {
  const emergencyId = generateEmergencyId();
  const { plain, hash } = generateRecoverySecret();
  const secretHash = await hash;
  const version = 1;
  const generatedAt = new Date();
  const checksum = computeChecksum(username, emergencyId, plain);

  await UserModel.findByIdAndUpdate(userId, {
    $set: {
      recovery_secret_hash:     secretHash,
      recovery_emergency_id:    emergencyId,
      recovery_card_version:    version,
      recovery_card_generated_at: generatedAt,
      require_password_change:  false,
    },
  });

  logAuditEvent({
    event: "RECOVERY_CARD_GENERATED",
    user_id: userId.toString(),
    created_at: new Date().toISOString(),
    metadata: { version },
  });

  return { username, emergency_id: emergencyId, recovery_secret: plain, version, generated_at: generatedAt.toISOString(), checksum };
}

// ---------------------------------------------------------------------------
// recoverByCard — recupero con Recovery Card
// ---------------------------------------------------------------------------

export async function recoverByCard(params: {
  username: string;
  emergencyId: string;
  recoverySecret: string;
  requestId?: string;
  ipHash?: string;
}): Promise<TempPasswordResult> {
  const { username, emergencyId, recoverySecret, requestId, ipHash } = params;

  const rateLimitKey = `recovery_card:${username}`;
  const rl = await recordFailedAttempt(rateLimitKey);
  if (rl.count > MAX_RECOVER_ATTEMPTS) {
    throw new AppError("TOO_MANY_REQUESTS", 429);
  }

  const user = await UserModel.findOne({ username });
  if (!user || !user.recovery_secret_hash || !user.recovery_emergency_id) {
    // Non rivelare se l'utente esiste
    throw new AppError("INVALID_RECOVERY_CREDENTIALS", 400);
  }

  const emergencyMatch = user.recovery_emergency_id.toUpperCase() === emergencyId.toUpperCase();
  if (!emergencyMatch) {
    throw new AppError("INVALID_RECOVERY_CREDENTIALS", 400);
  }

  const secretValid = await argon2.verify(user.recovery_secret_hash, recoverySecret);
  if (!secretValid) {
    throw new AppError("INVALID_RECOVERY_CREDENTIALS", 400);
  }

  // Credenziali corrette — azzera rate limit
  await clearFailedAttempts(rateLimitKey);

  // Genera password temporanea
  const tempPassword = generateTempPassword();
  const tempHash     = await hashPassword(tempPassword);
  const expiresAt    = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);

  // Revoca tutte le sessioni
  await revokeAllSessions(user._id);

  await UserModel.findByIdAndUpdate(user._id, {
    $set: {
      temp_password_hash:     tempHash,
      temp_password_expires_at: expiresAt,
      require_password_change: true,
      last_recovery_at:       new Date(),
    },
  });

  logAuditEvent({
    event: "ACCOUNT_RECOVERED_CARD",
    user_id: user._id.toString(),
    request_id: requestId,
    ip_hash: ipHash,
    created_at: new Date().toISOString(),
    metadata: { method: "card" },
  });

  logger.info({ userId: user._id.toString(), username }, "Account recovered via Recovery Card");

  return { temp_password: tempPassword, expires_at: expiresAt.toISOString() };
}

// ---------------------------------------------------------------------------
// recoverByEmail — richiesta link email
// ---------------------------------------------------------------------------

export async function requestEmailRecovery(params: {
  username: string;
  email: string;
  requestId?: string;
}): Promise<void> {
  const { username, email } = params;

  const rateLimitKey = `recovery_email:${username}`;
  const rl = await recordFailedAttempt(rateLimitKey);
  if (rl.count > MAX_RECOVER_ATTEMPTS) {
    throw new AppError("TOO_MANY_REQUESTS", 429);
  }

  // Risposta sempre uguale (non rivelare se utente/email esistono)
  const user = await UserModel.findOne({ username });
  if (!user || !user.recovery_email || user.recovery_email.toLowerCase() !== email.toLowerCase()) {
    logger.info({ username }, "Email recovery: user/email mismatch (silenced)");
    return; // risposta identica al caso corretto
  }

  // Genera token monouso
  const token     = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);

  await UserModel.findByIdAndUpdate(user._id, {
    $set: {
      recovery_email_token:          token,
      recovery_email_token_expires_at: expiresAt,
    },
  });

  // Invia email di recupero nella lingua dell'utente
  const EMAIL_TTL_MINUTES = Math.round(EMAIL_TOKEN_TTL_MS / 60_000);
  await sendRecoveryEmail({
    to:              user.recovery_email,
    username:        user.username,
    recoveryToken:   token,
    expiresInMinutes: EMAIL_TTL_MINUTES,
    lang:            (user as { language?: string }).language ?? "it",
  });

  logAuditEvent({
    event: "RECOVERY_EMAIL_REQUESTED",
    user_id: user._id.toString(),
    request_id: params.requestId,
    created_at: new Date().toISOString(),
    metadata: { email_masked: maskEmail(email) },
  });
}

// ---------------------------------------------------------------------------
// verifyEmailToken — verifica link email + genera temp password
// ---------------------------------------------------------------------------

export async function verifyEmailToken(params: {
  token: string;
  requestId?: string;
  ipHash?: string;
}): Promise<TempPasswordResult> {
  const { token } = params;

  const user = await UserModel.findOne({
    recovery_email_token: token,
    recovery_email_token_expires_at: { $gt: new Date() },
  });

  if (!user) {
    throw new AppError("INVALID_RECOVERY_TOKEN", 400);
  }

  const tempPassword = generateTempPassword();
  const tempHash     = await hashPassword(tempPassword);
  const expiresAt    = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);

  // Revoca tutte le sessioni
  await revokeAllSessions(user._id);

  await UserModel.findByIdAndUpdate(user._id, {
    $set: {
      temp_password_hash:             tempHash,
      temp_password_expires_at:       expiresAt,
      require_password_change:        true,
      last_recovery_at:               new Date(),
      recovery_email_token:           null,
      recovery_email_token_expires_at: null,
    },
  });

  logAuditEvent({
    event: "ACCOUNT_RECOVERED_EMAIL",
    user_id: user._id.toString(),
    request_id: params.requestId,
    ip_hash: params.ipHash,
    created_at: new Date().toISOString(),
    metadata: { method: "email" },
  });

  logger.info({ userId: user._id.toString() }, "Account recovered via email");

  return { temp_password: tempPassword, expires_at: expiresAt.toISOString() };
}

// ---------------------------------------------------------------------------
// regenerateRecoveryCard — invalidation + nuova card (da impostazioni, autenticato)
// ---------------------------------------------------------------------------

export async function regenerateRecoveryCard(
  userId: mongoose.Types.ObjectId,
  username: string,
): Promise<RecoveryCardData> {
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  const emergencyId = generateEmergencyId();
  const { plain, hash } = generateRecoverySecret();
  const secretHash = await hash;
  const version    = (user.recovery_card_version ?? 0) + 1;
  const generatedAt = new Date();
  const checksum = computeChecksum(username, emergencyId, plain);

  await UserModel.findByIdAndUpdate(userId, {
    $set: {
      recovery_secret_hash:     secretHash,
      recovery_emergency_id:    emergencyId,
      recovery_card_version:    version,
      recovery_card_generated_at: generatedAt,
    },
  });

  logAuditEvent({
    event: "RECOVERY_CARD_REGENERATED",
    user_id: userId.toString(),
    created_at: new Date().toISOString(),
    metadata: { version, previous_invalidated: true },
  });

  logger.info({ userId: userId.toString(), version }, "Recovery Card rigenerata");

  return { username, emergency_id: emergencyId, recovery_secret: plain, version, generated_at: generatedAt.toISOString(), checksum };
}

// ---------------------------------------------------------------------------
// setRecoveryEmail — imposta email di recupero (opzionale)
// ---------------------------------------------------------------------------

export async function setRecoveryEmail(
  userId: mongoose.Types.ObjectId,
  email: string,
): Promise<void> {
  await UserModel.findByIdAndUpdate(userId, {
    $set: { recovery_email: email.toLowerCase().trim() },
  });

  logAuditEvent({
    event: "RECOVERY_EMAIL_SET",
    user_id: userId.toString(),
    created_at: new Date().toISOString(),
    metadata: { email_masked: maskEmail(email) },
  });
}

// ---------------------------------------------------------------------------
// getRecoveryStatus — dashboard recovery
// ---------------------------------------------------------------------------

export async function getRecoveryStatus(userId: mongoose.Types.ObjectId): Promise<RecoveryStatus> {
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  return {
    has_recovery_card:    !!user.recovery_secret_hash,
    has_recovery_email:   !!user.recovery_email,
    has_phoenix_code:     !!user.phoenix_code_hash,
    card_version:         (user as any).recovery_card_version ?? null,
    card_generated_at:    (user as any).recovery_card_generated_at?.toISOString() ?? null,
    last_recovery_at:     (user as any).last_recovery_at?.toISOString() ?? null,
    recovery_email_masked: user.recovery_email ? maskEmail(user.recovery_email) : null,
  };
}

// ---------------------------------------------------------------------------
// changeTempPassword — cambio password dopo recupero (req autenticato)
// ---------------------------------------------------------------------------

export async function changeTempPassword(
  userId: mongoose.Types.ObjectId,
  tempPassword: string,
  newPassword: string,
  /** deviceId della sessione corrente — viene mantenuta, le altre revocate */
  currentDeviceId?: string,
): Promise<void> {
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  if (!user.temp_password_hash || !user.temp_password_expires_at) {
    throw new AppError("NO_TEMP_PASSWORD", 400);
  }

  if (user.temp_password_expires_at < new Date()) {
    logAuditEvent({
      event: "TEMP_PASSWORD_EXPIRED",
      user_id: userId.toString(), created_at: new Date().toISOString(),
    });
    throw new AppError("TEMP_PASSWORD_EXPIRED", 400);
  }

  const { verifyPassword } = await import("./password.service");
  // FIX: verifyPassword(hash, plaintext) — hash prima, plaintext dopo
  const valid = await verifyPassword(user.temp_password_hash, tempPassword);
  if (!valid) throw new AppError("INVALID_TEMP_PASSWORD", 400);

  const newHash = await hashPassword(newPassword);

  await UserModel.findByIdAndUpdate(userId, {
    $set: {
      password_hash:            newHash,
      temp_password_hash:       null,
      temp_password_expires_at: null,
      require_password_change:  false,
    },
  });

  // Sprint 22: revoca tutte le sessioni ECCETTO quella corrente
  if (currentDeviceId) {
    const { SessionRepository } = await import("../repositories/session.repository");
    const sessionRepo = new SessionRepository();
    await sessionRepo.revokeAllExceptDevice(userId, currentDeviceId);
  }

  logAuditEvent({
    event: "TEMP_PASSWORD_CHANGED",
    user_id: userId.toString(),
    created_at: new Date().toISOString(),
    metadata: { method: "forced_change", device_kept: currentDeviceId ?? null },
  });

  logger.info({ userId: userId.toString() }, "Password temporanea sostituita, sessioni revocate");
}
