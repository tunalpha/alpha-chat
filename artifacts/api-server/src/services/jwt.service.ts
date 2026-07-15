/**
 * JWT Service — ES256 (ECDSA P-256)
 *
 * Algoritmo conforme a 04b_Security.md (decisione SEC: ES256 definitivo).
 * Chiavi in formato PEM, lette da env vars. In development, generate automaticamente
 * all'avvio con un warning. In production, il server si rifiuta di avviarsi senza chiavi.
 *
 * Env vars richieste in production:
 *   JWT_PRIVATE_KEY  — PEM ECDSA P-256 privata (base64-encoded)
 *   JWT_PUBLIC_KEY   — PEM ECDSA P-256 pubblica (base64-encoded)
 */

import { SignJWT, jwtVerify, generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;          // user_id
  jti: string;          // JWT ID univoco — usato per revoca
  device_id: string;
  roles: string[];
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Caricamento chiavi
// ---------------------------------------------------------------------------

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;
const IS_PRODUCTION = process.env["NODE_ENV"] === "production";
const ACCESS_TOKEN_TTL = 15 * 60; // 15 minuti in secondi

async function loadKeys(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  if (_privateKey && _publicKey) {
    return { privateKey: _privateKey, publicKey: _publicKey };
  }

  const privateKeyPem = process.env["JWT_PRIVATE_KEY"];
  const publicKeyPem = process.env["JWT_PUBLIC_KEY"];

  if (privateKeyPem && publicKeyPem) {
    const { importPKCS8, importSPKI } = await import("jose");
    _privateKey = await importPKCS8(
      Buffer.from(privateKeyPem, "base64").toString("utf8"),
      "ES256",
    );
    _publicKey = await importSPKI(
      Buffer.from(publicKeyPem, "base64").toString("utf8"),
      "ES256",
    );
    return { privateKey: _privateKey, publicKey: _publicKey };
  }

  if (IS_PRODUCTION) {
    logger.fatal("JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set in production");
    process.exit(1);
  }

  // Development: genera chiavi temporanee e logga un warning
  logger.warn(
    "JWT keys not set — generating ephemeral keys for DEVELOPMENT only. " +
    "All tokens will be invalid after restart. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY.",
  );
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });

  // Stampa le chiavi per comodità in development
  const pkcs8 = await exportPKCS8(privateKey);
  const spki = await exportSPKI(publicKey);
  logger.debug({
    JWT_PRIVATE_KEY: Buffer.from(pkcs8).toString("base64"),
    JWT_PUBLIC_KEY: Buffer.from(spki).toString("base64"),
  }, "Generated ephemeral JWT keys — copy to .env to persist");

  _privateKey = privateKey;
  _publicKey = publicKey;
  return { privateKey: _privateKey, publicKey: _publicKey };
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Genera un access token ES256.
 */
export async function signAccessToken(params: {
  userId: string;
  deviceId: string;
  roles?: string[];
}): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const { privateKey } = await loadKeys();
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_TTL;

  const token = await new SignJWT({
    device_id: params.deviceId,
    roles: params.roles ?? [],
  })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(params.userId)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer("alpha-chat-api")
    .setAudience("alpha-chat-client")
    .sign(privateKey);

  return { token, jti, expiresAt: new Date(exp * 1000) };
}

/**
 * Verifica e decodifica un access token.
 * Lancia un'eccezione se il token è invalido, scaduto o non firmato con la chiave corretta.
 */
export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { publicKey } = await loadKeys();
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["ES256"],
    issuer: "alpha-chat-api",
    audience: "alpha-chat-client",
  });

  return payload as unknown as JwtPayload;
}
