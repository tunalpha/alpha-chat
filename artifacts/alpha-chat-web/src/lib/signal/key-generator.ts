/**
 * Signal Protocol — Generazione chiavi crittografiche (Fase 1).
 *
 * Libreria: @noble/curves (Curve25519/Ed25519 — stesse primitive di libsignal).
 *
 * ZERO PLAINTEXT RULE:
 *   Tutte le chiavi private generate qui rimangono locali.
 *   Solo le chiavi pubbliche vengono trasmesse al server.
 *
 * Nota: In Fase 2 (X3DH) e Fase 3 (Double Ratchet) le sessioni
 *   verranno instaurate e cifrate usando le stesse primitive,
 *   integrate con la libreria @signalapp/libsignal-client lato server.
 */

// ed25519 + x25519 sono nello stesso modulo Curve25519 in @noble/curves
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import type {
  IdentityKeyPair,
  SignedPreKeyPair,
  OneTimePreKeyPair,
} from "./types";

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

/** Genera un Registration ID casuale nel range Signal spec (1–16383) */
export function generateRegistrationId(): number {
  const buf = crypto.getRandomValues(new Uint8Array(2));
  // Maschera a 14 bit → 0–16383, poi +1 → 1–16383
  return (((buf[0]! << 8) | buf[1]!) & 0x3fff) + 1;
}

/** Uint8Array → base64 (browser nativo, no dipendenze) */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** base64 → Uint8Array */
export function fromBase64(str: string): Uint8Array {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Identity Key (Ed25519 — signing + long-term identity)
// ---------------------------------------------------------------------------

/**
 * Genera un Identity Key Pair Ed25519.
 * La chiave privata NON lascia mai il dispositivo.
 */
export function generateIdentityKeyPair(): IdentityKeyPair {
  const privateKey = ed25519.utils.randomSecretKey(); // 32 byte seed
  const publicKey = ed25519.getPublicKey(privateKey);  // 32 byte
  return { keyType: "identity", privateKey, publicKey };
}

// ---------------------------------------------------------------------------
// Signed PreKey (X25519 DH — medium-term)
// ---------------------------------------------------------------------------

/**
 * Genera un Signed PreKey X25519 e lo firma con l'Identity Key.
 *
 * Signal spec: la firma attesta che la chiave DH appartiene allo stesso
 * dispositivo che controlla l'Identity Key.
 * La firma usa Ed25519 sulla chiave pubblica X25519.
 */
export function generateSignedPreKey(
  keyId: number,
  identityPrivateKey: Uint8Array,
): SignedPreKeyPair {
  const privateKey = x25519.utils.randomSecretKey(); // 32 byte
  const publicKey = x25519.getPublicKey(privateKey);  // 32 byte
  const signature = ed25519.sign(publicKey, identityPrivateKey); // 64 byte
  return {
    keyType: "signed-pre-key",
    keyId,
    privateKey,
    publicKey,
    signature,
    createdAt: Date.now(),
  };
}

/**
 * Verifica la firma di un Signed PreKey ricevuto (lato client, pre-X3DH).
 * Ritorna true se la firma è valida.
 */
export function verifySignedPreKey(
  signedPreKeyPublic: Uint8Array,
  signature: Uint8Array,
  identityPublicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, signedPreKeyPublic, identityPublicKey);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// One-Time PreKeys (X25519 DH — single-use pool)
// ---------------------------------------------------------------------------

/**
 * Genera un batch di One-Time PreKeys X25519.
 *
 * Signal spec: ogni chiave viene usata una sola volta per X3DH,
 * poi eliminata dal pool locale. Il server mantiene solo le chiavi pubbliche
 * e le distribuisce una alla volta.
 *
 * @param startKeyId   ID della prima chiave del batch
 * @param count        Numero di chiavi da generare (default 100)
 */
export function generateOneTimePreKeys(
  startKeyId: number,
  count: number = 100,
): OneTimePreKeyPair[] {
  return Array.from({ length: count }, (_, i) => {
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    return {
      keyType: "one-time-pre-key" as const,
      keyId: startKeyId + i,
      privateKey,
      publicKey,
    };
  });
}
