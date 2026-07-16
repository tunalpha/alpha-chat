/**
 * Sprint 16 Fase 5 — Safety Number.
 *
 * Genera il "numero di sicurezza" (fingerprint crittografico) di una coppia
 * (io, contatto) usando FingerprintGenerator di libsignal.
 *
 * Standard Signal: 5200 iterazioni HMAC-SHA512 → 30 byte → 60 cifre decimali.
 * Display: 12 gruppi di 5 cifre disposti su 4 righe × 3 colonne.
 *
 * Il Safety Number è:
 *   - SIMMETRICO: lo stesso su entrambi i dispositivi
 *   - STABILE: non cambia con i messaggi (solo con la Identity Key)
 *   - SPECIFICO alla coppia: A↔B ≠ A↔C
 */

import { FingerprintGenerator, base64ToArrayBuffer } from "@workspace/libsignal-ts";

const FINGERPRINT_ITERATIONS = 5200;

// ---------------------------------------------------------------------------
// generateSafetyNumber
// ---------------------------------------------------------------------------

/**
 * Genera il Safety Number tra due utenti.
 *
 * @param localId        Username/userId dell'utente locale
 * @param localIKBase64  Identity Key pubblica locale (base64)
 * @param remoteId       Username/userId del contatto
 * @param remoteIKBase64 Identity Key pubblica del contatto (base64)
 * @returns Stringa di 60 cifre decimali
 */
export async function generateSafetyNumber(
  localId: string,
  localIKBase64: string,
  remoteId: string,
  remoteIKBase64: string,
): Promise<string> {
  const gen = new FingerprintGenerator(FINGERPRINT_ITERATIONS);
  const localIK  = base64ToArrayBuffer(localIKBase64);
  const remoteIK = base64ToArrayBuffer(remoteIKBase64);
  return gen.createFor(localId, localIK, remoteId, remoteIK);
}

// ---------------------------------------------------------------------------
// formatSafetyNumber
// ---------------------------------------------------------------------------

/**
 * Formatta il Safety Number grezzo (60 cifre) in 4 righe × 3 gruppi di 5.
 *
 * Esempio:
 *   "12345 67890 12345"
 *   "67890 12345 67890"
 *   "12345 67890 12345"
 *   "67890 12345 67890"
 *
 * @returns Array[4] di Array[3] di stringhe a 5 cifre
 */
export function formatSafetyNumber(raw: string): string[][] {
  const groups: string[] = [];
  for (let i = 0; i < 60; i += 5) {
    groups.push(raw.slice(i, i + 5));
  }
  return [
    groups.slice(0, 3),
    groups.slice(3, 6),
    groups.slice(6, 9),
    groups.slice(9, 12),
  ];
}

// ---------------------------------------------------------------------------
// safetyNumberToQRPayload
// ---------------------------------------------------------------------------

/**
 * Costruisce il payload per il QR di verifica.
 * Non usa URL (privacy: nessun dato mandato in rete).
 * Formato: "alphachat-verify:{fingerprint}:{me}:{them}"
 */
export function safetyNumberToQRPayload(
  fingerprint: string,
  myUsername: string,
  theirUsername: string,
): string {
  return `alphachat-verify:${fingerprint}:${myUsername}:${theirUsername}`;
}
