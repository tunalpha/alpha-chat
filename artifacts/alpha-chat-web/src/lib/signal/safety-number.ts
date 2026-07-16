/**
 * Sprint 16 Fase 5 — Safety Number (WebCrypto nativo).
 *
 * Reimplementa l'algoritmo di FingerprintGenerator di libsignal usando
 * SOLO window.crypto.subtle — senza msrcrypto né dipendenze Node.js.
 *
 * Algoritmo (identico a @privacyresearch/libsignal-protocol-typescript):
 *   VERSION = 0 come Uint16 LE (2 byte)
 *   initial = VERSION || publicKey || identifier_latin1
 *   hash[0]  = SHA-512(initial || publicKey)
 *   hash[i]  = SHA-512(hash[i-1] || publicKey)   per i = 1..4999
 *   display  = 6 gruppi × 5 byte da hash[4999], ognuno % 100000 → 5 cifre
 *   fingerprint = sort([local_display, remote_display]).join('')
 *
 * Standard Signal: 5200 iterazioni → 60 cifre decimali.
 * Compatibile con il Safety Number di Signal Messenger.
 *
 * ⚠ Non importare FingerprintGenerator da @workspace/libsignal-ts qui:
 *   quella classe usa `require('msrcrypto')` che non funziona nel browser.
 */

const FINGERPRINT_ITERATIONS = 5200;
const FINGERPRINT_VERSION    = 0;       // Uint16 LE → [0, 0]

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

function concatBuffers(...parts: ArrayBuffer[]): ArrayBuffer {
  const total  = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const result = new Uint8Array(total);
  let offset   = 0;
  for (const p of parts) {
    result.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  }
  return result.buffer;
}

/** Codifica la stringa come Latin-1 (charCode per byte, ≤ 0xFF). */
function latin1ToBuffer(str: string): ArrayBuffer {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c > 0xff) throw new RangeError(`Carattere non Latin-1 a posizione ${i}: ${c}`);
    buf[i] = c;
  }
  return buf.buffer;
}

/**
 * Iterative SHA-512 chain.
 * Primo passo: SHA-512(initial || key).
 * Passi successivi (×count−1): SHA-512(risultato_precedente || key).
 * Totale: count operazioni SHA-512.
 */
async function iterateHash(
  initial: ArrayBuffer,
  key: ArrayBuffer,
  count: number,
): Promise<ArrayBuffer> {
  let current = await crypto.subtle.digest("SHA-512", concatBuffers(initial, key));
  for (let i = 1; i < count; i++) {
    current = await crypto.subtle.digest("SHA-512", concatBuffers(current, key));
  }
  return current;
}

/**
 * Genera la stringa di display a 30 cifre per una singola parte
 * (6 gruppi × 5 byte → ciascuno % 100000 zero-padded a 5 cifre).
 */
async function getDisplayStringFor(
  identifier: string,
  publicKey: ArrayBuffer,
  iterations: number,
): Promise<string> {
  const versionBuf    = new Uint16Array([FINGERPRINT_VERSION]).buffer;
  const identifierBuf = latin1ToBuffer(identifier);
  const initial       = concatBuffers(versionBuf, publicKey, identifierBuf);

  const hashBuf = await iterateHash(initial, publicKey, iterations);
  const hash    = new Uint8Array(hashBuf);

  let display = "";
  for (let offset = 0; offset < 30; offset += 5) {
    // 5 byte big-endian → intero 40-bit → % 100000 → 5 cifre
    const value =
      hash[offset + 0] * 2 ** 32 +
      hash[offset + 1] * 2 ** 24 +
      hash[offset + 2] * 2 ** 16 +
      hash[offset + 3] * 2 ** 8  +
      hash[offset + 4];
    display += (value % 100_000).toString().padStart(5, "0");
  }
  return display;
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/**
 * Genera il Safety Number tra due utenti.
 *
 * @param localId        Username dell'utente locale (ASCII)
 * @param localIKBase64  Identity Key pubblica locale (base64)
 * @param remoteId       Username del contatto (ASCII)
 * @param remoteIKBase64 Identity Key pubblica del contatto (base64)
 * @returns Stringa di 60 cifre decimali, identica su entrambi i dispositivi
 */
export async function generateSafetyNumber(
  localId: string,
  localIKBase64: string,
  remoteId: string,
  remoteIKBase64: string,
): Promise<string> {
  const localIK  = base64ToBuffer(localIKBase64);
  const remoteIK = base64ToBuffer(remoteIKBase64);

  const [localStr, remoteStr] = await Promise.all([
    getDisplayStringFor(localId,  localIK,  FINGERPRINT_ITERATIONS),
    getDisplayStringFor(remoteId, remoteIK, FINGERPRINT_ITERATIONS),
  ]);

  // Ordina lessicograficamente → risultato identico su entrambe le parti
  return [localStr, remoteStr].sort().join("");
}

// ---------------------------------------------------------------------------
// Utility base64 — usata solo internamente (evita dipendenza da libsignal-ts)
// ---------------------------------------------------------------------------

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// formatSafetyNumber
// ---------------------------------------------------------------------------

/**
 * Formatta i 60 caratteri in 4 righe × 3 gruppi × 5 cifre.
 * Es: [["12345","67890","12345"], ["67890","12345","67890"], ...]
 */
export function formatSafetyNumber(raw: string): string[][] {
  const groups: string[] = [];
  for (let i = 0; i < 60; i += 5) groups.push(raw.slice(i, i + 5));
  return [
    groups.slice(0,  3),
    groups.slice(3,  6),
    groups.slice(6,  9),
    groups.slice(9, 12),
  ];
}

// ---------------------------------------------------------------------------
// safetyNumberToQRPayload
// ---------------------------------------------------------------------------

/**
 * Payload per il QR di verifica.
 * Formato: "alphachat-verify:{fingerprint}:{me}:{them}"
 * Nessun URL (privacy — nessun dato inviato in rete).
 */
export function safetyNumberToQRPayload(
  fingerprint: string,
  myUsername: string,
  theirUsername: string,
): string {
  return `alphachat-verify:${fingerprint}:${myUsername}:${theirUsername}`;
}
