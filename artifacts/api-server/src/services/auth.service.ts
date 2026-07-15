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

import { createHmac } from "node:crypto";
import { AppError } from "../errors/AppError";
import { hashPassword, verifyPassword } from "./password.service";
import { signAccessToken } from "./jwt.service";
import { generateRefreshToken } from "./refresh-token.service";
import { UserRepository } from "../repositories/user.repository";
import { SessionRepository } from "../repositories/session.repository";
import { UserPrekeysModel } from "../models/user-prekeys.model";
import { SessionModel } from "../models/session.model";
import {
  recordFailedAttempt,
  clearFailedAttempts,
  loginFailKey,
  LOGIN_THRESHOLDS,
} from "../lib/rate-limiter";
import { logAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";
import type { RegisterInput, LoginInput } from "../validation/auth.schemas";
import type { IUserDocument } from "../models/user.model";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEVICE_TRUST_THRESHOLD = 3; // login consecutivi prima di diventare trusted

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
// Shared token builder
// ---------------------------------------------------------------------------

async function buildTokens(
  userId: string,
  deviceId: string,
  sessionExpiresAt: Date,
) {
  const { token: accessToken, expiresAt: accessExpiresAt } = await signAccessToken({
    userId,
    deviceId,
    roles: [],
  });
  const refreshToken = generateRefreshToken();
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt: sessionExpiresAt };
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

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
}

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
  const user = await userRepo.create({ username, display_name, password_hash: passwordHash,
    email: email ?? null, phone_hash: phoneHash });

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
    user_id: user._id.toString(),
    device_id,
    request_id: requestId,
    ip_hash: ipHash ?? undefined,
    country_code: countryCode,
    created_at: new Date().toISOString(),
    metadata: { username },
  });

  logger.info({ userId: user._id.toString(), username, deviceId: device_id }, "User registered");

  return {
    user: formatUserProfile(user),
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: accessExpiresAt.toISOString(),
      refresh_token_expires_at: session.expires_at.toISOString(),
    },
    is_new_device: true,
    requires_2fa: false,
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
 * Ordine (CTO review + 08_Authentication_Flow.md):
 * Repository → Password Verify → Rate Limit → Device Trust → Session → JWT → Audit
 */
export async function login(params: LoginServiceParams): Promise<LoginResult> {
  const { identifier, password, device_id, device_name, device_type,
    userAgent, ipHash, countryCode, requestId } = params;

  // 1. Trova utente (username o email)
  const isEmail = identifier.includes("@");
  const user = isEmail
    ? await userRepo.findByEmail(identifier)
    : await userRepo.findByUsername(identifier);

  // Risposta uguale per "non trovato" e "password errata" (anti-enumeration)
  if (!user) {
    logger.warn({ identifier: isEmail ? "[email]" : identifier }, "Login failed: user not found");
    throw new AppError("INVALID_CREDENTIALS", 401);
  }

  // 2. Account sospeso
  if (user.status === "suspended") {
    throw new AppError("ACCOUNT_SUSPENDED", 403);
  }

  // 3. Account bloccato
  if (user.locked_until && user.locked_until > new Date()) {
    throw new AppError("ACCOUNT_LOCKED", 423);
  }

  // 4. Verifica password
  const passwordOk = user.password_hash
    ? await verifyPassword(user.password_hash, password)
    : false;

  // 5. Rate limit — gestito DOPO password verify (ordine CTO)
  if (!passwordOk) {
    const { shouldLock, lockMinutes } = await recordFailedAttempt(loginFailKey(user._id.toString()));

    if (shouldLock && lockMinutes > 0) {
      const lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
      await userRepo.lockAccount(user._id, lockedUntil);
      logger.warn({ userId: user._id.toString(), lockMinutes }, "Account locked");
      logAuditEvent({ event: "ACCOUNT_LOCKED", user_id: user._id.toString(),
        ip_hash: ipHash ?? undefined, created_at: new Date().toISOString(),
        metadata: { lockMinutes } });
    }

    logAuditEvent({ event: "USER_LOGIN_FAILED", user_id: user._id.toString(),
      device_id, request_id: requestId, ip_hash: ipHash ?? undefined,
      created_at: new Date().toISOString() });

    throw new AppError("INVALID_CREDENTIALS", 401);
  }

  // 6. Password corretta — azzera contatore
  await clearFailedAttempts(loginFailKey(user._id.toString()));
  await userRepo.recordSuccessfulLogin(user._id, { ipHash: ipHash ?? null, countryCode: countryCode ?? null });

  // 7. 2FA (se abilitato)
  if (user.totp_enabled) {
    // TODO Sprint 5: genera challenge token e lo persiste in Redis
    // Per ora ritorniamo un placeholder — il client mostrerà la schermata TOTP
    const challengeToken = `chall_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Determina se il device è nuovo (per il branch is_new_device dopo 2FA)
    const existingSession = await SessionModel.findOne({
      user_id: user._id, device_id, deleted_at: null,
    });

    return {
      requires_2fa: true,
      totp_challenge_token: challengeToken,
      totp_challenge_expires_at: expiresAt,
      user: null,
      tokens: null,
      is_new_device: existingSession === null,
    };
  }

  // 8. Device Trust — check se device è già noto
  const existingSession = await SessionModel.findOne({
    user_id: user._id, device_id, deleted_at: null,
  });
  const isNewDevice = existingSession === null;

  // 9. Sessione + tokens
  const refreshToken = generateRefreshToken();
  const { session } = await sessionRepo.upsert({
    userId: user._id, deviceId: device_id, deviceName: device_name ?? null,
    deviceType: device_type, refreshToken,
    countryCode: countryCode ?? null, ipHash: ipHash ?? null, userAgent: userAgent ?? null,
  });

  // Aggiorna login_count e is_trusted
  const newLoginCount = (existingSession?.login_count ?? 0) + 1;
  const isTrusted = newLoginCount >= DEVICE_TRUST_THRESHOLD;
  await SessionModel.updateOne(
    { _id: session._id },
    { login_count: newLoginCount, is_trusted: isTrusted },
  );

  const { token: accessToken, expiresAt: accessExpiresAt } = await signAccessToken({
    userId: user._id.toString(), deviceId: device_id, roles: [],
  });

  // 10. Audit
  logAuditEvent({
    event: isNewDevice ? "NEW_DEVICE_LOGIN" : "USER_LOGIN",
    user_id: user._id.toString(),
    device_id, request_id: requestId, ip_hash: ipHash ?? undefined,
    country_code: countryCode, created_at: new Date().toISOString(),
    metadata: { is_trusted: isTrusted, login_count: newLoginCount },
  });

  if (isNewDevice) {
    logger.info({ userId: user._id.toString(), deviceId: device_id }, "New device login detected");
    // TODO Sprint 4: emetti WebSocket event agli altri device dell'utente
  }

  return {
    user: formatUserProfile(user),
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: accessExpiresAt.toISOString(),
      refresh_token_expires_at: session.expires_at.toISOString(),
    },
    is_new_device: isNewDevice,
    requires_2fa: false,
  };
}

// Re-export per compatibilità
export { buildTokens };
