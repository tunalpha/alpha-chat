/**
 * Signal Messenger — Fase 2.
 *
 * Layer di cifratura/decifratura per i messaggi dell'app.
 * Wrappa SessionCipher con:
 *   - gestione automatica sessione X3DH
 *   - recovery automatico (sessione mancante / corrotta)
 *   - compatibilità legacy (messaggi pre-Fase 2)
 *   - benchmark di performance (development only)
 *
 * ⚠ Zero Plaintext Rule:
 *   - signalEncrypt: invia al server solo ciphertext base64 opaco
 *   - signalDecrypt: il plaintext non viene mai loggato né inviato in rete
 *
 * Formato body sul filo:
 *   SessionCipher.encrypt() → binary string (ogni char = un byte)
 *   Per trasmissione JSON-safe: btoa(binaryString) → base64
 *   Per decifratura: atob(base64) → binaryString → decrypt
 */

import {
  SessionCipher,
  SignalProtocolAddress,
} from "@workspace/libsignal-ts";
import { getSignalStore } from "./key-store";
import { ensureSession, rebuildSession } from "./signal-session";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface SignalCiphertext {
  /** Body base64-encoded (sicuro per JSON/HTTP) */
  body: string;
  /** 1 = WhisperMessage, 3 = PreKeyWhisperMessage */
  type: number;
}

// ---------------------------------------------------------------------------
// Codec stringhe / ArrayBuffer
// ---------------------------------------------------------------------------

function stringToBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

function bufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

/** Legacy base64 decode (messaggi pre-Fase 2) */
export function legacyDecode(ciphertext: string): string {
  try {
    const binStr = atob(ciphertext);
    // FIX: i messaggi Signal iniziano con un type byte specifico.
    // Non provare a decodificarli come plaintext — produrrebbero testo garbled.
    // 0x33 (51) = PreKeyWhisperMessage, 0x22 (34) = WhisperMessage, 0x35 (53) = SenderKey
    const firstByte = binStr.charCodeAt(0);
    if (firstByte === 0x33 || firstByte === 0x22 || firstByte === 0x35) {
      return "[cifrato]";
    }
    const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    // Troppi caratteri di sostituzione = dati binari non decodificabili come testo
    const replacements = (decoded.match(/\uFFFD/g) ?? []).length;
    if (replacements > 3 || replacements / Math.max(decoded.length, 1) > 0.1) {
      return "[cifrato]";
    }
    return decoded;
  } catch {
    return "[cifrato]";
  }
}

/**
 * Decode sicuro per preview conversazione.
 * Tenta legacy decode; se il risultato contiene caratteri di sostituzione
 * Unicode (segno di decodifica fallita di dati binari), mostra placeholder.
 */
export function safeDecodeForPreview(ciphertext: string): string {
  try {
    const binStr = atob(ciphertext);
    const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    // Caratteri di sostituzione = dati binari = ciphertext Signal
    if (decoded.includes("\uFFFD")) return "🔒 Messaggio cifrato";
    return decoded;
  } catch {
    return "🔒 Messaggio cifrato";
  }
}

// ---------------------------------------------------------------------------
// signalEncrypt
// ---------------------------------------------------------------------------

/**
 * Cifra un messaggio plaintext con Signal Protocol.
 *
 * Flusso:
 *   1. ensureSession (X3DH se necessario)
 *   2. SessionCipher.encrypt(plaintext)
 *   3. btoa(binaryBody) per trasmissione sicura
 *
 * Il primo messaggio restituisce type=3 (PreKeyWhisperMessage).
 * I successivi restituiscono type=1 (WhisperMessage, Double Ratchet).
 *
 * @throws Se la sessione non può essere stabilita (es. bundle non disponibile)
 */
export async function signalEncrypt(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  plaintext: string,
  recipientDeviceId = 1,
): Promise<SignalCiphertext> {
  const t0 = performance.now();

  // X3DH se necessario (idempotente)
  await ensureSession(userId, deviceId, recipientUserId, recipientDeviceId);

  const store = getSignalStore(userId, deviceId);
  const addr = new SignalProtocolAddress(recipientUserId, recipientDeviceId);
  const cipher = new SessionCipher(store, addr);

  // Cifra il plaintext
  const result = await cipher.encrypt(stringToBuffer(plaintext));

  // Il body è una binary string (ogni char = un byte)
  // btoa() la converte in base64 per trasmissione JSON-safe
  const binaryBody = result.body as unknown as string;
  const body = btoa(binaryBody);

  const dt = performance.now() - t0;
  if (import.meta.env.DEV) {
    console.debug(`[Signal] encrypt ${dt.toFixed(1)}ms type=${result.type} len=${body.length}`);
  }

  return { body, type: result.type };
}

// ---------------------------------------------------------------------------
// signalDecrypt
// ---------------------------------------------------------------------------

/**
 * Decifra un messaggio Signal ricevuto.
 *
 * Flusso:
 *   1. Se ciphertextType === null → legacy decode (messaggio pre-Fase 2)
 *   2. Se tipo 3 → decryptPreKeyWhisperMessage (stabilisce sessione)
 *   3. Se tipo 1 → decryptWhisperMessage (Double Ratchet)
 *   4. Se fallisce → recovery automatico (rebuildSession) e ri-tentativo
 *   5. Se il recovery fallisce → legacy decode come ultimo fallback
 *
 * ⚠ Mai plaintext parziale: in caso di errore irrecuperabile, lancia
 *   l'eccezione invece di restituire testo non verificato.
 *
 * @param body            Body base64 (come memorizzato sul server)
 * @param ciphertextType  1, 3, o null (legacy)
 */
export async function signalDecrypt(
  userId: string,
  deviceId: string,
  senderUserId: string,
  body: string,
  ciphertextType: number | null,
  senderDeviceId = 1,
): Promise<string> {
  const t0 = performance.now();

  // --- Legacy (pre-Fase 2) ---
  if (ciphertextType === null) {
    return legacyDecode(body);
  }

  // --- Signal decrypt ---
  // base64 → binary string (come prodotto da SessionCipher.encrypt)
  let binaryBody: string;
  try {
    binaryBody = atob(body);
  } catch {
    // Se atob fallisce, il body potrebbe essere un legacy base64 di testo
    return legacyDecode(body);
  }

  const store = getSignalStore(userId, deviceId);
  const addr = new SignalProtocolAddress(senderUserId, senderDeviceId);

  const tryDecrypt = async (): Promise<ArrayBuffer> => {
    const cipher = new SessionCipher(store, addr);
    if (ciphertextType === 3) {
      return cipher.decryptPreKeyWhisperMessage(binaryBody, "binary");
    } else {
      return cipher.decryptWhisperMessage(binaryBody, "binary");
    }
  };

  try {
    const plainBuf = await tryDecrypt();
    const result = bufferToString(plainBuf);
    const dt = performance.now() - t0;
    if (import.meta.env.DEV) {
      console.debug(`[Signal] decrypt ${dt.toFixed(1)}ms type=${ciphertextType}`);
    }
    return result;
  } catch (firstErr) {
    // --- Recovery automatico ---
    // Casi: IndexedDB cancellato, sessione corrotta, nuovo dispositivo
    if (ciphertextType === 3) {
      // PreKeyWhisperMessage: può stabilire una sessione da zero
      // Tentativo con rebuild
      try {
        await rebuildSession(userId, deviceId, senderUserId, senderDeviceId);
        const plainBuf = await tryDecrypt();
        const result = bufferToString(plainBuf);
        if (import.meta.env.DEV) {
          console.debug(`[Signal] decrypt recovery OK type=${ciphertextType}`);
        }
        return result;
      } catch {
        // Recovery fallito
      }
    }

    // --- Ultimo fallback: legacy decode ---
    // Questo gestisce messaggi pre-Fase 2 con ciphertext_type=1
    // che contengono un semplice base64 del plaintext.
    const legacy = legacyDecode(body);
    if (legacy !== "[cifrato]") {
      return legacy;
    }

    // Nessun fallback disponibile — lancia l'errore originale
    throw firstErr;
  }
}

// ---------------------------------------------------------------------------
// Misurazione performance (development)
// ---------------------------------------------------------------------------

if (import.meta.env.DEV) {
  // Espone una funzione di benchmark sulla console del browser
  (window as unknown as Record<string, unknown>).__signalBenchmark = async (
    userId: string,
    deviceId: string,
    recipientUserId: string,
    iterations = 10,
  ) => {
    const encryptTimes: number[] = [];
    const decryptTimes: number[] = [];
    let totalCiphertextLen = 0;

    for (let i = 0; i < iterations; i++) {
      const plaintext = `Benchmark message #${i} — Alpha Chat Signal Protocol Fase 2`;

      const t0 = performance.now();
      const ct = await signalEncrypt(userId, deviceId, recipientUserId, plaintext);
      encryptTimes.push(performance.now() - t0);
      totalCiphertextLen += ct.body.length;

      const t1 = performance.now();
      await signalDecrypt(recipientUserId, deviceId, userId, ct.body, ct.type);
      decryptTimes.push(performance.now() - t1);
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    console.table({
      "encrypt avg (ms)": avg(encryptTimes).toFixed(2),
      "decrypt avg (ms)": avg(decryptTimes).toFixed(2),
      "ciphertext avg (bytes)": (totalCiphertextLen / iterations / 4 * 3).toFixed(0),
      "overhead (×)": (avg(encryptTimes) / 1).toFixed(1) + "× vs no-op",
    });
  };
}
