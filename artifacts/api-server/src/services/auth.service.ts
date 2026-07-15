/**
 * AuthService — logica di business per autenticazione.
 *
 * Regole (07_Backend_Standards.md):
 * - Tutta la logica vive qui, non nel Controller.
 * - Il Controller è "stupido": estrae dati dalla request, chiama il Service, formatta la response.
 * - Ogni metodo pubblico ha: logging strutturato, gestione errori con AppError, JSDoc.
 *
 * Ordine chiamate (08_Authentication_Flow.md):
 *   register: check unicità → hash → crea user → crea sessione → sign JWT → return
 */

import { createHmac } from "node:crypto";
import { AppError } from "../errors/AppError";
import { hashPassword } from "./password.service";
import { signAccessToken } from "./jwt.service";
import { generateRefreshToken } from "./refresh-token.service";
import { UserRepository } from "../repositories/user.repository";
import { SessionRepository } from "../repositories/session.repository";
import { UserPrekeysModel } from "../models/user-prekeys.model";
import { logger } from "../lib/logger";
import type { RegisterInput } from "../validation/auth.schemas";
import type { IUserDocument } from "../models/user.model";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizza e hasha un numero di telefono E.164 con il pepper server-side.
 * Conforme a 04b_Security.md: HMAC-SHA256(PEPPER, normalize(phone)).
 */
function hashPhone(phone: string): string {
  const pepper = process.env["PHONE_HMAC_PEPPER"] ?? "dev_pepper_insecure_change_in_prod";
  const normalized = phone.replace(/\s/g, "").toLowerCase();
  return createHmac("sha256", pepper).update(normalized).digest("hex");
}

/**
 * Formatta il profilo pubblico utente da restituire al client.
 */
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
// Istanze repository (singleton leggero — nessuno stato)
// ---------------------------------------------------------------------------

const userRepo = new UserRepository();
const sessionRepo = new SessionRepository();

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export interface RegisterResult {
  user: ReturnType<typeof formatUserProfile>;
  tokens: {
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
    refresh_token_expires_at: string;
  };
  is_new_device: boolean;
}

export interface RegisterServiceParams extends RegisterInput {
  userAgent?: string | null;
  ipHash?: string | null;
  countryCode?: string | null;
}

/**
 * Registra un nuovo utente e crea la prima sessione.
 *
 * Flusso (08_Authentication_Flow.md § 3):
 * 1. Check unicità username
 * 2. Check unicità email (se fornita)
 * 3. Check unicità phone (se fornito)
 * 4. Hash password (Argon2id)
 * 5. Hash phone (HMAC-SHA256 + pepper)
 * 6. Crea utente
 * 7. Salva Signal keys (se fornite)
 * 8. Crea sessione + genera refresh token
 * 9. Firma access token (ES256)
 * 10. Restituisce user + tokens
 */
export async function register(params: RegisterServiceParams): Promise<RegisterResult> {
  const { username, display_name, password, email, phone, device_id, device_name,
    device_type, signal_keys, userAgent, ipHash, countryCode } = params;

  // ── 1. Unicità username ────────────────────────────────────────────────────
  const usernameAvailable = await userRepo.isUsernameAvailable(username);
  if (!usernameAvailable) {
    logger.warn({ username }, "Registration failed: username taken");
    throw new AppError("USERNAME_TAKEN", 409, "username");
  }

  // ── 2. Unicità email ───────────────────────────────────────────────────────
  if (email) {
    const emailAvailable = await userRepo.isEmailAvailable(email);
    if (!emailAvailable) {
      logger.warn({ email: "[REDACTED]" }, "Registration failed: email taken");
      throw new AppError("EMAIL_TAKEN", 409, "email");
    }
  }

  // ── 3. Unicità phone ───────────────────────────────────────────────────────
  let phoneHash: string | null = null;
  if (phone) {
    phoneHash = hashPhone(phone);
    const phoneAvailable = await userRepo.isPhoneHashAvailable(phoneHash);
    if (!phoneAvailable) {
      logger.warn("Registration failed: phone taken");
      throw new AppError("PHONE_TAKEN", 409, "phone");
    }
  }

  // ── 4. Hash password ───────────────────────────────────────────────────────
  const passwordHash = await hashPassword(password);

  // ── 5 & 6. Crea utente ─────────────────────────────────────────────────────
  const user = await userRepo.create({
    username,
    display_name,
    password_hash: passwordHash,
    email: email ?? null,
    phone_hash: phoneHash,
  });

  // ── 7. Salva Signal keys (opzionale in Sprint 2) ───────────────────────────
  if (signal_keys) {
    await UserPrekeysModel.create({
      user_id: user._id,
      device_id,
      identity_key: signal_keys.identity_key,
      signed_prekey: {
        ...signal_keys.signed_prekey,
        created_at: new Date(),
      },
      one_time_prekeys: signal_keys.one_time_prekeys,
      last_prekey_upload_at: new Date(),
    });
    logger.info({ userId: user._id.toString(), deviceId: device_id }, "Signal keys stored");
  }

  // ── 8. Crea sessione ───────────────────────────────────────────────────────
  const refreshToken = generateRefreshToken();
  const { session } = await sessionRepo.upsert({
    userId: user._id,
    deviceId: device_id,
    deviceName: device_name ?? null,
    deviceType: device_type,
    refreshToken,
    countryCode: countryCode ?? null,
    ipHash: ipHash ?? null,
    userAgent: userAgent ?? null,
  });

  // ── 9. Firma access token ──────────────────────────────────────────────────
  const { token: accessToken, expiresAt: accessExpiresAt } = await signAccessToken({
    userId: user._id.toString(),
    deviceId: device_id,
    roles: [],
  });

  logger.info(
    { userId: user._id.toString(), username, deviceId: device_id },
    "User registered successfully",
  );

  return {
    user: formatUserProfile(user),
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: accessExpiresAt.toISOString(),
      refresh_token_expires_at: session.expires_at.toISOString(),
    },
    is_new_device: true,
  };
}
