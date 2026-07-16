/**
 * Media E2E Encryption — Fase 3.
 *
 * AES-256-GCM symmetric encryption per blob media (audio, immagine, video, documento).
 *
 * ⚠ Zero Plaintext Rule:
 *   - Il blob originale non lascia mai il dispositivo
 *   - La chiave AES viene wrappata via Signal SessionCipher (mai inviata in chiaro)
 *   - Il server vede solo byte cifrati opachi
 *   - Nessuna crittografia custom: usa esclusivamente Web Crypto API (standard NIST)
 *
 * Schema:
 *   Blob → AES-256-GCM encrypt → encryptedBlob → upload
 *   AES Key + IV → JSON metadata → Signal encrypt → message ciphertext
 *
 *   Download: message ciphertext → Signal decrypt → AES Key + IV → AES decrypt → render
 */

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const AES_KEY_BITS = 256;  // AES-256
const GCM_IV_BYTES = 12;   // 96-bit IV — standard per AES-GCM

// ---------------------------------------------------------------------------
// Generazione materiale crittografico
// ---------------------------------------------------------------------------

/**
 * Genera una chiave AES-256-GCM casuale, non esportabile per il runtime
 * ma esportabile per il wrapping Signal.
 *
 * Ogni media file usa una chiave unica (no key reuse).
 */
export async function generateMediaKey(): Promise<{
  key: CryptoKey;
  keyBase64: string; // esportato per wrapping Signal
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_BITS },
    true, // extractable per export
    ["encrypt", "decrypt"],
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  return { key, keyBase64: rawToBase64(raw) };
}

/** Genera un IV casuale da 96-bit per AES-GCM */
export function generateIV(): { iv: Uint8Array; ivBase64: string } {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  return { iv, ivBase64: rawToBase64(iv.buffer as ArrayBuffer) };
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

/**
 * Cifra un Blob con AES-256-GCM.
 * Restituisce un Blob con byte opachi (include autotag GCM a 128 bit).
 *
 * @param blob    Blob da cifrare
 * @param key     CryptoKey AES-GCM
 * @param iv      IV a 12 byte (usare sempre un IV fresco per chiave distinta)
 */
export async function encryptBlob(
  blob: Blob,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<Blob> {
  const plainBytes = await blob.arrayBuffer();
  const cipherBytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    plainBytes,
  );
  return new Blob([cipherBytes], { type: "application/octet-stream" });
}

/**
 * Decifra un ArrayBuffer con AES-256-GCM.
 * Verifica l'integrità del GCM tag (autenticazione AEAD).
 *
 * @throws  DOMException se il tag GCM non corrisponde (dati corrotti o manomessi)
 */
export async function decryptBuffer(
  encrypted: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, encrypted);
}

/** Importa una chiave AES-256 da base64 */
export async function importKeyBase64(keyBase64: string): Promise<CryptoKey> {
  const raw = base64ToRaw(keyBase64);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false, // non ri-esportabile dopo l'import (sicurezza)
    ["decrypt"],
  );
}

// ---------------------------------------------------------------------------
// Pipeline completa
// ---------------------------------------------------------------------------

/**
 * Cifra un Blob in un'unica operazione.
 * Genera internamente chiave + IV casuali.
 *
 * Returns:
 *   encryptedBlob — blob da caricare sul server
 *   keyBase64     — chiave AES da wrappare con Signal
 *   ivBase64      — IV da includere nel metadata Signal
 */
export async function encryptMediaBlob(blob: Blob): Promise<{
  encryptedBlob: Blob;
  keyBase64: string;
  ivBase64: string;
}> {
  const { key, keyBase64 } = await generateMediaKey();
  const { iv, ivBase64 } = generateIV();
  const encryptedBlob = await encryptBlob(blob, key, iv);
  return { encryptedBlob, keyBase64, ivBase64 };
}

/**
 * Scarica il blob cifrato e lo decifra localmente.
 * Il server non partecipa alla decifratura.
 *
 * @param fetchFn    Funzione che ritorna i byte cifrati
 * @param keyBase64  Chiave AES (estratta dal metadata Signal-decifrato)
 * @param ivBase64   IV (estratto dal metadata Signal-decifrato)
 * @param mimeType   MIME type originale (per Blob type e playback corretto)
 * @returns          ObjectURL del blob decifrato
 */
export async function decryptAndCreateObjectUrl(
  fetchFn: () => Promise<ArrayBuffer>,
  keyBase64: string,
  ivBase64: string,
  mimeType = "application/octet-stream",
): Promise<string> {
  const encrypted = await fetchFn();
  const key = await importKeyBase64(keyBase64);
  const iv = base64ToUint8Array(ivBase64);
  const decrypted = await decryptBuffer(encrypted, key, iv);
  const blob = new Blob([decrypted], { type: mimeType });
  return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// Helpers Base64 ↔ ArrayBuffer
// ---------------------------------------------------------------------------

export function rawToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToRaw(b64: string): ArrayBuffer {
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

export function base64ToUint8Array(b64: string): Uint8Array {
  return new Uint8Array(base64ToRaw(b64));
}
