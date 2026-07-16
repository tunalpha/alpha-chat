/**
 * AuthService — logica di business per autenticazione.
 *
 * Regole (07_Backend_Standards.md):
 * - Tutta la logica vive qui, non nel Controller.
 * - Il Controller è "stupido": estrae dati, chiama il Service, formatta la response.
 * - Ogni metodo pubblico ha: logging strutturato, gestione errori con AppError, JSDoc.
 *
 * Ordine login (08_Authentication_Flow.md + CTO review Sprint 2):
 *   Validation → Repository → Password Verify → Rate Limit → Device Trust
 *   → Session → JWT → Refresh → Response → Audit Log
 */

import { createHmac, createHash } from "node:crypto";
import { AppError } from "../errors/AppError";
import { hashPassword, verifyPassword } from "./password.service";
import { signAccessToken } from "./jwt.service";
import {
  generateRefreshToken,
  rotateRefreshToken,
  revokeAllSessions,
} from "./refresh-token.service";
import { UserRepository } from "../repositories/user.repository";
import { SessionRepository } from "../repositories/session.repository";
import { UserPrekeysModel } from "../models/user-prekeys.model";
import { SessionModel } from "../models/session.model";
import {
  recordFailedAttempt,
  clearFailedAttempts,
  loginFailKey,
} from "../lib/rate-limiter";
import { blockJti } from "../lib/jti-blocklist";
import { logAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";
import type { RegisterInput, LoginInput } from "../validation/auth.schemas";
import type { IUserDocument } from "../models/user.model";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEVICE_TRUST_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashPhone(phone: string): string {
  const pepper = process.env["PHONE_HMAC_PEPPER"] ?? "dev_pepper_insecure_change_in_prod";
  return createHmac("sha256", pepper).update(phone.replace(/\s/g, "").toLowerCase()).digest("hex");
}

export function formatUserProfile(user: IUserDocument) {
  return {
    id: user._id.toString(),
    username: user.username,
    display_name: user.display_name,
    email: user.email,
    email_verified: user.email_verified,
    is_verified: user.is_verified,
    created_at: user.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Repository singletons
// ---------------------------------------------------------------------------

const userRepo = new UserRepository();
const sessionRepo = new SessionRepository();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecoveryCardPayload {
  emergency_id:    string;
  recovery_secret: string;  // Base58, mostrato UNA SOLA VOLTA
  version:         number;
  generated_at:    string;
  checksum:        string;
}

export interface AuthResult {
  user: ReturnType<typeof formatUserProfile>;
  tokens: {
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
    refresh_token_expires_at: string;
  };
  is_new_device: boolean;
  requires_2fa: false;
  /** Sprint 22: Recovery Card — presente solo alla prima registrazione */
  recovery_card?: RecoveryCardPayload;
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export interface RegisterServiceParams extends RegisterInput {
  userAgent?: string | null;
  ipHash?: string | null;
  countryCode?: string | null;
  requestId?: string;
}

/**
 * Registra un nuovo utente e crea la prima sessione.
 * Flusso: 08_Authentication_Flow.md § 3
 */
export async function register(params: RegisterServiceParams): Promise<AuthResult> {
  const { username, display_name, password, email, phone, device_id, device_name,
    device_type, signal_keys, userAgent, ipHash, countryCode, requestId } = params;

  // 1. Unicità username
  if (!(await userRepo.isUsernameAvailable(username))) {
    logger.warn({ username }, "Registration failed: username taken");
    throw new AppError("USERNAME_TAKEN", 409, "username");
  }

  // 2. Unicità email
  if (email && !(await userRepo.isEmailAvailable(email))) {
    throw new AppError("EMAIL_TAKEN", 409, "email");
  }

  // 3. Unicità phone
  let phoneHash: string | null = null;
  if (phone) {
    phoneHash = hashPhone(phone);
    if (!(await userRepo.isPhoneHashAvailable(phoneHash))) {
      throw new AppError("PHONE_TAKEN", 409, "phone");
    }
  }

  // 4 & 5. Hash password + crea utente
  const passwordHash = await hashPassword(password);
  const user = await userRepo.create({
    username, display_name, password_hash: passwordHash,
    email: email ?? null, phone_hash: phoneHash,
  });

  // 6. Signal keys (opzionali)
  if (signal_keys) {
    await UserPrekeysModel.create({
      user_id: user._id, device_id,
      identity_key: signal_keys.identity_key,
      signed_prekey: { ...signal_keys.signed_prekey, created_at: new Date() },
      one_time_prekeys: signal_keys.one_time_prekeys,
      last_prekey_upload_at: new Date(),
    });
  }

  // 7. Sessione + tokens
  const refreshToken = generateRefreshToken();
  const { session } = await sessionRepo.upsert({
    userId: user._id, deviceId: device_id, deviceName: device_name ?? null,
    deviceType: device_type, refreshToken,
    countryCode: countryCode ?? null, ipHash: ipHash ?? null, userAgent: userAgent ?? null,
  });

  const { token: accessToken, expiresAt: accessExpiresAt } = await signAccessToken({
    userId: user._id.toString(), deviceId: device_id, roles: [],
  });

  // 8. Audit
  logAuditEvent({
    event: "USER_REGISTERED",
    user_id: user._id.toString(), device_id,
    request_id: requestId, ip_hash: ipHash ?? undefined,
    country_code: countryCode, created_at: new Date().toISOString(),
    metadata: { username },
  });

  logger.info({ userId: user._id.toString(), username, deviceId: device_id }, "User registered");

  // Sprint 22: genera Recovery Card alla registrazione (mostrata una sola volta)
  let recoveryCard: RecoveryCardPayload | undefined;
  try {
    const { generateRecoveryCard } = await import("./account-recovery.service");
    const card = await generateRecoveryCard(user._id, username);
    recoveryCard = {
      emergency_id:    card.emergency_id,
      recovery_secret: card.recovery_secret,
      version:         card.version,
      generated_at:    card.generated_at,
      checksum:        card.checksum,
    };
  } catch (e) {
    logger.error({ err: e }, "Recovery card generation failed (non-blocking)");
  }

  return {
    user: formatUserProfile(user),
    tokens: {
      access_token: accessToken, refresh_token: refreshToken,
      access_token_expires_at: accessExpiresAt.toISOString(),
      refresh_token_expires_at: session.expires_at.toISOString(),
    },
    is_new_device: true,
    requires_2fa: false,
    recovery_card: recoveryCard,
  };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export interface LoginServiceParams extends LoginInput {
  userAgent?: string | null;
  ipHash?: string | null;
  countryCode?: string | null;
  requestId?: string;
}

export type LoginResult =
  | (AuthResult & { requires_2fa: false })
  | {
      requires_2fa: true;
      totp_challenge_token: string;
      totp_challenge_expires_at: string;
      user: null;
      tokens: null;
      is_new_device: boolean;
    };

/**
 * Login con username/email + password.
 * Ordine: Repository → Password Verify → Rate Limit → Device Trust → Session → JWT → Audit
 */
export async function login(params: LoginServiceParams): Promise<LoginResult> {
  const { identifier, password, device_id, device_name, device_type,
    userAgent, ipHash, countryCode, requestId } = params;

  // 1. Trova utente
  const isEmail = identifier.includes("@");
  const user = isEmail
    ? await userRepo.findByEmail(identifier)
    : await userRepo.findByUsername(identifier);

  if (!user) {
    logger.warn({ identifier: isEmail ? "[email]" : identifier }, "Login failed: not found");
    throw new AppError("INVALID_CREDENTIALS", 401);
  }

  // 2. Account sospeso / bloccato
  if (user.status === "suspended") throw new AppError("ACCOUNT_SUSPENDED", 403);
  if (user.locked_until && user.locked_until > new Date()) throw new AppError("ACCOUNT_LOCKED", 423);

  // 3. Verifica password
  const passwordOk = user.password_hash
    ? await verifyPassword(user.password_hash, password)
    : false;

  // 4. Rate limit — DOPO password verify (ordine CTO)
  if (!passwordOk) {
    const { shouldLock, lockMinutes } = await recordFailedAttempt(loginFailKey(user._id.toString()));
    if (shouldLock && lockMinutes > 0) {
      const lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
      await userRepo.lockAccount(user._id, lockedUntil);
      logAuditEvent({ event: "ACCOUNT_LOCKED", user_id: user._id.toString(),
        ip_hash: ipHash ?? undefined, created_at: new Date().toISOString(),
        metadata: { lockMinutes } });
    }
    logAuditEvent({ event: "USER_LOGIN_FAILED", user_id: user._id.toString(),
      device_id, request_id: requestId, ip_hash: ipHash ?? undefined,
      created_at: new Date().toISOString() });
    throw new AppError("INVALID_CREDENTIALS", 401);
  }

  // 5. Password corretta — azzera contatore
  await clearFailedAttempts(loginFailKey(user._id.toString()));
  await userRepo.recordSuccessfulLogin(user._id, { ipHash: ipHash ?? null, countryCode: countryCode ?? null });

  // 6. 2FA
  if (user.totp_enabled) {
    const challengeToken = `chall_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const existingSession = await SessionModel.findOne({ user_id: user._id, device_id, deleted_at: null });
    return {
      requires_2fa: true, totp_challenge_token: challengeToken,
      totp_challenge_expires_at: expiresAt, user: null, tokens: null,
      is_new_device: existingSession === null,
    };
  }

  // 7. Device Trust
  const existingSession = await SessionModel.findOne({ user_id: user._id, device_id, deleted_at: null });
  const isNewDevice = existingSession === null;

  // 8. Sessione + tokens
  const refreshToken = generateRefreshToken();
  const { session } = await sessionRepo.upsert({
    userId: user._id, deviceId: device_id, deviceName: device_name ?? null,
    deviceType: device_type, refreshToken,
    countryCode: countryCode ?? null, ipHash: ipHash ?? null, userAgent: userAgent ?? null,
  });

  // Incrementa login_count e aggiorna is_trusted
  const newLoginCount = (existingSession?.login_count ?? 0) + 1;
  const isTrusted = newLoginCount >= DEVICE_TRUST_THRESHOLD;
  await SessionModel.updateOne({ _id: session._id }, { login_count: newLoginCount, is_trusted: isTrusted });

  const { token: accessToken, expiresAt: accessExpiresAt } = await signAccessToken({
    userId: user._id.toString(), deviceId: device_id, roles: [],
  });

  // 9. Audit + Security Events + DMS check-in
  logAuditEvent({
    event: isNewDevice ? "NEW_DEVICE_LOGIN" : "USER_LOGIN",
    user_id: user._id.toString(), device_id,
    request_id: requestId, ip_hash: ipHash ?? undefined, country_code: countryCode,
    created_at: new Date().toISOString(),
    metadata: { is_trusted: isTrusted, login_count: newLoginCount },
  });

  // Sprint 19 — DMS check-in + security timeline (fire-and-forget, mai blocking)
  void import("./dead-man-switch.service").then(({ dmsCheckIn }) =>
    dmsCheckIn(user._id.toString()).catch(() => {}),
  );
  void import("./security-timeline.service").then(({ logSecurityEvent }) =>
    logSecurityEvent({
      user_id: user._id.toString(),
      event_type: isNewDevice ? "NEW_DEVICE" : "LOGIN",
      metadata: { device_name: device_name ?? null },
      ip: ipHash ?? undefined,
    }).catch(() => {}),
  );

  if (isNewDevice) {
    logger.info({ userId: user._id.toString(), deviceId: device_id }, "New device login");
  }

  return {
    user: formatUserProfile(user),
    tokens: {
      access_token: accessToken, refresh_token: refreshToken,
      access_token_expires_at: accessExpiresAt.toISOString(),
      refresh_token_expires_at: session.expires_at.toISOString(),
    },
    is_new_device: isNewDevice, requires_2fa: false,
  };
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export interface RefreshServiceParams {
  refreshToken: string;
  requestId?: string;
  ipHash?: string | null;
}

/**
 * Ruota il refresh token e rilascia nuovi token.
 * Invariante S-02: ogni refresh token è monouso.
 * Invariante S-03: se il token è già stato usato → revoca famiglia + audit.
 */
export async function refresh(params: RefreshServiceParams): Promise<{
  tokens: AuthResult["tokens"];
}> {
  const { refreshToken, requestId, ipHash } = params;

  const { newRefreshToken, session } = await rotateRefreshToken(
    refreshToken,
    { requestId: requestId, ipHash: ipHash ?? undefined },
  );

  const { token: accessToken, expiresAt: accessExpiresAt } = await signAccessToken({
    userId: session.user_id.toString(),
    deviceId: session.device_id,
    roles: [],
  });

  logger.info(
    { userId: session.user_id.toString(), deviceId: session.device_id },
    "Token refreshed",
  );

  return {
    tokens: {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      access_token_expires_at: accessExpiresAt.toISOString(),
      refresh_token_expires_at: session.expires_at.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Logout (sessione corrente)
// ---------------------------------------------------------------------------

export interface LogoutServiceParams {
  userId: string;
  deviceId: string;
  jti: string;
  accessTokenExpiresAt: Date;
  requestId?: string;
  ipHash?: string | null;
}

/**
 * Revoca la sessione del device corrente e aggiunge il JTI alla blocklist.
 * L'access token diventa immediatamente inutilizzabile.
 */
export async function logout(params: LogoutServiceParams): Promise<void> {
  const { userId, deviceId, jti, accessTokenExpiresAt, requestId, ipHash } = params;

  // Revoca sessione (refresh token invalidato)
  await sessionRepo.revokeByUserDevice(
    new (await import("mongoose")).default.Types.ObjectId(userId),
    deviceId,
  );

  // Blocklist JTI (access token invalidato immediatamente)
  await blockJti(jti, accessTokenExpiresAt);

  logAuditEvent({
    event: "USER_LOGOUT",
    user_id: userId, device_id: deviceId,
    request_id: requestId, ip_hash: ipHash ?? undefined,
    created_at: new Date().toISOString(),
  });

  logger.info({ userId, deviceId }, "User logged out");
}

// ---------------------------------------------------------------------------
// Logout All (tutte le sessioni)
// ---------------------------------------------------------------------------

export interface LogoutAllServiceParams {
  userId: string;
  deviceId: string;
  jti: string;
  accessTokenExpiresAt: Date;
  requestId?: string;
  ipHash?: string | null;
}

/**
 * Revoca tutte le sessioni dell'utente e blocklist il JTI corrente.
 * Usato da "disconnetti da tutti i dispositivi".
 */
export async function logoutAll(params: LogoutAllServiceParams): Promise<{ revokedCount: number }> {
  const { userId, deviceId, jti, accessTokenExpiresAt, requestId, ipHash } = params;

  const mongoose = await import("mongoose");
  const userObjectId = new mongoose.default.Types.ObjectId(userId);

  const revokedCount = await revokeAllSessions(userObjectId);
  await blockJti(jti, accessTokenExpiresAt);

  logAuditEvent({
    event: "USER_LOGOUT_ALL",
    user_id: userId, device_id: deviceId,
    request_id: requestId, ip_hash: ipHash ?? undefined,
    created_at: new Date().toISOString(),
    metadata: { revoked_sessions: revokedCount },
  });

  logger.info({ userId, deviceId, revokedCount }, "User logged out from all devices");

  return { revokedCount };
}
