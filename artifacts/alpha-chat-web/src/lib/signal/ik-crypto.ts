/**
 * Sprint 28 — IK Crypto: wrapping/unwrapping dell'Identity Key condivisa.
 *
 * Schema crittografico (tutto WebCrypto nativo — nessun package esterno):
 *
 *   salt     = random(32 byte) → base64
 *   wrap_key = PBKDF2-SHA512(password, salt, 600_000 iter) → AES-256-GCM key
 *   blob     = iv(12B) || AES-GCM(wrap_key, pubKey(32B) || privKey(32B)) || tag(16B)
 *            = 92 byte totali → base64 (124 char)
 *
 * PBKDF2-SHA512 a 600k iterazioni: standard OWASP 2023 per password-based encryption.
 * Nessuna dipendenza extra: WebCrypto è disponibile su tutti i browser moderni.
 *
 * Zero Plaintext Rule:
 *   - la chiave privata non transita mai sul server in chiaro
 *   - il blob è opaco per il server (non ha né password né wrap_key)
 *   - se la password è sbagliata, AES-GCM lancia (authentication tag fallisce)
 */

import { initSignalLibrary, type KeyPairType } from "@workspace/libsignal-ts";

const PBKDF2_ITERATIONS = 600_000;

// ---------------------------------------------------------------------------
// wrapIdentityKeyPair — cifra il key pair con la password
// ---------------------------------------------------------------------------

/**
 * Cifra l'Identity Key Pair (pubKey + privKey) con la password dell'utente.
 *
 * @returns blob  — base64(iv || ciphertext || tag), 124 caratteri
 * @returns salt  — base64(random 32 byte), indipendente dal sale password
 */
export async function wrapIdentityKeyPair(
  keyPair: KeyPairType,
  password: string,
): Promise<{ blob: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const wrapKey = await _deriveWrapKey(password, salt);

  // Concatena pubKey (32B) + privKey (32B) = 64B di plaintext
  const plaintext = new Uint8Array(64);
  plaintext.set(new Uint8Array(keyPair.pubKey), 0);
  plaintext.set(new Uint8Array(keyPair.privKey), 32);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrapKey,
    plaintext,
  );

  // blob = iv(12) || ciphertext+tag(80) = 92 byte
  const blobBytes = new Uint8Array(12 + ciphertextWithTag.byteLength);
  blobBytes.set(iv, 0);
  blobBytes.set(new Uint8Array(ciphertextWithTag), 12);

  return {
    blob: _ab2b64(blobBytes.buffer),
    salt: _ab2b64(salt.buffer),
  };
}

// ---------------------------------------------------------------------------
// unwrapIdentityKeyPair — decifra il blob con la password
// ---------------------------------------------------------------------------

/**
 * Decifra il blob IK con la password dell'utente.
 *
 * @throws Error("IK_DECRYPTION_FAILED") se la password è sbagliata o il blob è corrotto.
 * @returns KeyPairType completo (pubKey + privKey)
 */
export async function unwrapIdentityKeyPair(
  blob: string,
  password: string,
  salt: string,
): Promise<KeyPairType> {
  const blobBytes = _b642u8(blob);
  const saltBytes = _b642u8(salt);

  if (blobBytes.length < 28) {
    // 12 (IV) + almeno 16 (tag) = minimo 28 byte
    throw new Error("IK_DECRYPTION_FAILED: blob troppo corto");
  }

  const iv = blobBytes.slice(0, 12);
  const ciphertextWithTag = blobBytes.slice(12);

  const wrapKey = await _deriveWrapKey(password, saltBytes);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      wrapKey,
      ciphertextWithTag,
    );
  } catch {
    throw new Error("IK_DECRYPTION_FAILED: password errata o blob corrotto");
  }

  const bytes = new Uint8Array(plaintext);
  if (bytes.length < 64) {
    throw new Error("IK_DECRYPTION_FAILED: plaintext troppo corto");
  }

  return {
    pubKey: bytes.slice(0, 32).buffer,
    privKey: bytes.slice(32, 64).buffer,
  };
}

// ---------------------------------------------------------------------------
// Helpers privati
// ---------------------------------------------------------------------------

async function _deriveWrapKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // Cast esplicito: WebCrypto richiede Uint8Array<ArrayBuffer>, non ArrayBufferLike
  const saltBuf = new Uint8Array(salt.buffer instanceof ArrayBuffer ? salt.buffer : salt.buffer.slice(0)) as Uint8Array<ArrayBuffer>;
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuf,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-512",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function _ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function _b642u8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// generateAndWrapSharedIdentityKey — helper ad alto livello
// ---------------------------------------------------------------------------

/**
 * Genera un nuovo Identity Key Pair e lo cifra con la password.
 *
 * Usato in due scenari:
 *   1. Registrazione: nuova IK condivisa generata prima dell'account.
 *   2. Migrazione legacy: utente senza blob nel server.
 *
 * Garantisce che WASM sia caricato prima di generare il key pair.
 */
export async function generateAndWrapSharedIdentityKey(password: string): Promise<{
  ikKeyPair: KeyPairType;
  blob: string;
  salt: string;
}> {
  await initSignalLibrary();
  const { generateIdentityKeyPair } = await import("./key-generator");
  const ikKeyPair = await generateIdentityKeyPair();
  const { blob, salt } = await wrapIdentityKeyPair(ikKeyPair, password);
  return { ikKeyPair, blob, salt };
}
