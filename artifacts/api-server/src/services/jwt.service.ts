/**
 * JWT Service — ES256 (ECDSA P-256)
 *
 * Algoritmo conforme a 04b_Security.md (SEC: ES256 definitivo).
 *
 * ── Env vars ─────────────────────────────────────────────────────────────────
 *   JWT_PRIVATE_KEY  — PEM ECDSA P-256 privata, base64-encoded (richiesto in prod)
 *   JWT_PUBLIC_KEY   — PEM ECDSA P-256 pubblica, base64-encoded (richiesto in prod)
 *   JWT_KEY_ID       — kid esplicito (opzionale; default: SHA-256 della chiave pubblica)
 *
 * ── Rotazione chiavi ─────────────────────────────────────────────────────────
 *   Strategia: rotazione graduale con finestra di sovrapposizione.
 *   1. Genera una nuova coppia (new_priv, new_pub).
 *   2. Imposta JWT_PRIVATE_KEY=new_priv, JWT_PUBLIC_KEY=new_pub, JWT_KEY_ID=new_kid.
 *   3. Aggiungi l'OLD public key in JWT_PUBLIC_KEYS_LEGACY (JSON array base64 PEM).
 *   4. Deploy. I token firmati con la vecchia chiave continuano a essere verificati
 *      finché non scadono (~15 min). Dopo 15 minuti rimuovi JWT_PUBLIC_KEYS_LEGACY.
 *
 * ── Development ──────────────────────────────────────────────────────────────
 *   Se le chiavi non sono settate, vengono generate effimere con un warning.
 *   I token sono invalidi dopo il riavvio del processo.
 */

import {
  SignJWT, jwtVerify,
  generateKeyPair, exportPKCS8, exportSPKI, importPKCS8, importSPKI,
} from "jose";
import { createHash, randomUUID } from "node:crypto";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;        // user_id
  jti: string;        // univoco — per blocklist Redis
  kid: string;        // key ID — per rotazione
  device_id: string;
  roles: string[];
  iat: number;
  nbf: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minuti
const IS_PRODUCTION = process.env["NODE_ENV"] === "production";

// ---------------------------------------------------------------------------
// Stato interno (cache chiavi)
// ---------------------------------------------------------------------------

interface KeySet {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
  /** Chiavi legacy per verifica durante rotazione: kid → CryptoKey */
  legacyPublicKeys: Map<string, CryptoKey>;
}

let _keySet: KeySet | null = null;

// ---------------------------------------------------------------------------
// Derivazione kid da chiave pubblica
// ---------------------------------------------------------------------------

async function deriveKid(publicKey: CryptoKey): Promise<string> {
  const spki = await exportSPKI(publicKey);
  const der = Buffer.from(spki);
  return createHash("sha256").update(der).digest("base64url").slice(0, 22);
}

// ---------------------------------------------------------------------------
// Caricamento chiavi
// ---------------------------------------------------------------------------

async function loadKeySet(): Promise<KeySet> {
  if (_keySet) return _keySet;

  const privateKeyPem = process.env["JWT_PRIVATE_KEY"];
  const publicKeyPem = process.env["JWT_PUBLIC_KEY"];
  const legacyPems = process.env["JWT_PUBLIC_KEYS_LEGACY"]; // JSON array base64 PEM

  if (privateKeyPem && publicKeyPem) {
    const privateKey = await importPKCS8(
      Buffer.from(privateKeyPem, "base64").toString("utf8"),
      "ES256",
    );
    const publicKey = await importSPKI(
      Buffer.from(publicKeyPem, "base64").toString("utf8"),
      "ES256",
    );
    const kid = process.env["JWT_KEY_ID"] ?? (await deriveKid(publicKey));

    // Chiavi legacy per rotazione graduale
    const legacyPublicKeys = new Map<string, CryptoKey>();
    if (legacyPems) {
      const parsed = JSON.parse(legacyPems) as string[];
      for (const pem64 of parsed) {
        const legacyKey = await importSPKI(
          Buffer.from(pem64, "base64").toString("utf8"),
          "ES256",
        );
        const legacyKid = await deriveKid(legacyKey);
        legacyPublicKeys.set(legacyKid, legacyKey);
      }
    }

    _keySet = { privateKey, publicKey, kid, legacyPublicKeys };
    logger.info({ kid, legacyCount: legacyPublicKeys.size }, "JWT keys loaded");
    return _keySet;
  }

  if (IS_PRODUCTION) {
    logger.fatal("JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set in production");
    process.exit(1);
  }

  // Development — chiavi effimere
  logger.warn(
    "JWT keys not set — generating ephemeral keys (DEVELOPMENT only). " +
    "Tokens become invalid after restart.",
  );
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = await deriveKid(publicKey);

  const pkcs8 = await exportPKCS8(privateKey);
  const spki = await exportSPKI(publicKey);
  logger.debug(
    {
      JWT_PRIVATE_KEY: Buffer.from(pkcs8).toString("base64"),
      JWT_PUBLIC_KEY: Buffer.from(spki).toString("base64"),
      JWT_KEY_ID: kid,
    },
    "Ephemeral JWT keys — copy to env to persist across restarts",
  );

  _keySet = { privateKey, publicKey, kid, legacyPublicKeys: new Map() };
  return _keySet;
}

/** Espone il kid corrente (per includere nelle risposte di debug). */
export async function getCurrentKid(): Promise<string> {
  const ks = await loadKeySet();
  return ks.kid;
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Genera un access token ES256 firmato.
 * Include kid nell'header per supportare la rotazione delle chiavi.
 */
export async function signAccessToken(params: {
  userId: string;
  deviceId: string;
  roles?: string[];
}): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const { privateKey, kid } = await loadKeySet();
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({
    device_id: params.deviceId,
    roles: params.roles ?? [],
  })
    .setProtectedHeader({ alg: "ES256", kid })
    .setSubject(params.userId)
    .setJti(jti)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(exp)
    .setIssuer("alpha-chat-api")
    .setAudience("alpha-chat-client")
    .sign(privateKey);

  return { token, jti, expiresAt: new Date(exp * 1000) };
}

/**
 * Verifica un access token.
 * Supporta chiavi legacy durante la rotazione: usa il kid nell'header
 * per scegliere automaticamente la chiave di verifica corretta.
 */
export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { publicKey, kid, legacyPublicKeys } = await loadKeySet();

  // Estrai kid dall'header senza verificare ancora la firma
  const [headerB64] = token.split(".");
  let tokenKid: string | undefined;
  try {
    const header = JSON.parse(Buffer.from(headerB64 ?? "", "base64url").toString()) as {
      kid?: string;
    };
    tokenKid = header.kid;
  } catch {
    // header malformato — la verifica fallirà comunque
  }

  // Scegli la chiave: se il kid corrisponde a una chiave legacy, usala
  let verifyKey = publicKey;
  if (tokenKid && tokenKid !== kid) {
    const legacy = legacyPublicKeys.get(tokenKid);
    if (legacy) verifyKey = legacy;
  }

  const { payload } = await jwtVerify(token, verifyKey, {
    algorithms: ["ES256"],
    issuer: "alpha-chat-api",
    audience: "alpha-chat-client",
    // jose verifica automaticamente: exp, nbf, iat, iss, aud
  });

  return payload as unknown as JwtPayload;
}

/** Azzera la cache — usato nei test per ricaricare le chiavi. */
export function _resetKeyCache(): void {
  _keySet = null;
}
