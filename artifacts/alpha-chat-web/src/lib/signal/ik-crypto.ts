/**
 * Sprint 28 — IK Crypto: wrapping/unwrapping dell'Identity Key condivisa.
 *
 * Schema crittografico (tutto WebCrypto nativo — nessun package esterno):
 *
 *   salt     = random(32 byte) → base64
 *   wrap_key = PBKDF2-SHA512(password, salt, 600_000 iter) → AES-256-GCM key
 *   plaintext = JSON.stringify({ pub: base64(pubKey), priv: base64(privKey) })
 *   blob     = iv(12B) || AES-GCM(wrap_key, plaintext) || tag(16B) → base64
 *
 * Il formato JSON+base64 gestisce chiavi di lunghezza arbitraria:
 *   - pubKey di Signal = 33 byte (prefisso 0x05 + 32 byte raw Curve25519)
 *   - privKey di Signal = 32 byte
 *   Serializzare come byte-array fisso 32+32 troncherebbe il pubKey.
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
 * Usa JSON+base64 internamente per gestire chiavi di lunghezza arbitraria.
 *
 * @returns blob  — base64(iv || ciphertext || tag)
 * @returns salt  — base64(random 32 byte), indipendente dal sale password
 */
export async function wrapIdentityKeyPair(
  keyPair: KeyPairType,
  password: string,
): Promise<{ blob: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const wrapKey = await _deriveWrapKey(password, salt);

  // Serializza entrambe le chiavi come base64 in JSON.
  // Questo preserva la lunghezza esatta (pubKey Signal = 33B, privKey = 32B).
  const plaintext = new TextEncoder().encode(JSON.stringify({
    pub:  _ab2b64(keyPair.pubKey),
    priv: _ab2b64(keyPair.privKey),
  }));

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrapKey,
    plaintext,
  );

  // blob = iv(12) || ciphertext+tag
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
 * @returns KeyPairType completo (pubKey + privKey con le dimensioni originali)
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

  let parsed: { pub: string; priv: string };
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { pub: string; priv: string };
    if (!parsed.pub || !parsed.priv) throw new Error("missing fields");
  } catch {
    throw new Error("IK_DECRYPTION_FAILED: formato plaintext non valido");
  }

  return {
    pubKey:  _b642ab(parsed.pub),
    privKey: _b642ab(parsed.priv),
  };
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

// ---------------------------------------------------------------------------
// Helpers privati
// ---------------------------------------------------------------------------

async function _deriveWrapKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // Cast esplicito: WebCrypto richiede Uint8Array<ArrayBuffer>, non ArrayBufferLike
  const saltBuf = new Uint8Array(
    salt.buffer instanceof ArrayBuffer ? salt.buffer : salt.buffer.slice(0)
  ) as Uint8Array<ArrayBuffer>;
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

/** ArrayBuffer → base64 string */
function _ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** base64 string → Uint8Array */
function _b642u8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** base64 string → ArrayBuffer */
function _b642ab(b64: string): ArrayBuffer {
  const u8 = _b642u8(b64);
  // Assicura un ArrayBuffer puro (non SharedArrayBuffer) per compatibilità libsignal
  const buf = new ArrayBuffer(u8.length);
  new Uint8Array(buf).set(u8);
  return buf;
}
