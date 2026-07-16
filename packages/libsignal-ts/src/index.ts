/**
 * @workspace/libsignal-ts — Fork interno (versione congelata)
 *
 * FORK DI: @privacyresearch/libsignal-protocol-typescript v0.0.16
 * MOTIVO: vedere docs/adr/ADR-001-signal-browser-crypto.md
 *
 * ⚠ VINCOLI PERMANENTI (da ADR-001):
 *   1. Nessun upgrade automatico — ogni aggiornamento richiede audit
 *   2. Nessuna modifica agli algoritmi crittografici sottostanti
 *   3. Tutte le deviazioni dalla spec Signal devono essere documentate
 *
 * ⚠ INIZIALIZZAZIONE — comportamento documentato:
 *   Non chiamare setCurve() dopo libsignal(). Vedere il commento in
 *   initSignalLibrary() per la spiegazione completa del bug.
 *
 * INIZIALIZZAZIONE: chiamare `initSignalLibrary()` una volta prima di
 * qualsiasi operazione crittografica (tipicamente al caricamento dell'app).
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — CJS package, Vite pre-bundled
import libsignal from "@privacyresearch/libsignal-protocol-typescript";

// Re-export tutto il necessario per i consumer
export {
  KeyHelper,
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
  FingerprintGenerator,
  type KeyPairType,
  type PreKeyPairType,
  type SignedPreKeyPairType,
  type PreKeyType,
  type SignedPublicPreKeyType,
  type StorageType,
  type SessionRecordType,
  type DeviceType,
  type SessionType,
  Direction,
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
} from "@privacyresearch/libsignal-protocol-typescript";

// ---------------------------------------------------------------------------
// Inizializzazione WASM (singleton)
// ---------------------------------------------------------------------------

let _initialized = false;
let _initPromise: Promise<void> | null = null;

/**
 * Carica il modulo WebAssembly/asm.js Curve25519 e lo rende pronto.
 * Idempotente: sicuro da chiamare più volte.
 *
 * DEVE essere chiamata prima di qualsiasi operazione crittografica.
 *
 * ⚠ Internamente: chiama libsignal() per garantire il caricamento del WASM,
 *   ma NON chiama setCurve(). Motivo: setCurve(Curve) sostituirebbe
 *   AsyncCurve._curve25519 (AsyncCurve25519Wrapper con metodo .keyPair())
 *   con il wrapper di alto livello Curve (che non ha .keyPair()).
 *   L'AsyncCurve25519Wrapper si auto-inizializza dalla stessa instancePromise.
 */
export async function initSignalLibrary(): Promise<void> {
  if (_initialized) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Garantisce caricamento WASM/asm.js. NON usiamo il ritorno né setCurve().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (libsignal as any)();
    _initialized = true;
  })();

  return _initPromise;
}

// ---------------------------------------------------------------------------
// Utilità base64 ↔ ArrayBuffer
//
// Queste funzioni gestiscono la conversione tra il formato interno
// della libreria (ArrayBuffer) e il formato di trasporto (base64)
// usato dal server per le chiavi pubbliche.
// ---------------------------------------------------------------------------

/** ArrayBuffer → base64 standard (con padding) */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

/** base64 → ArrayBuffer */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) {
    view[i] = bin.charCodeAt(i);
  }
  return buf;
}

/** Registration ID: random 14-bit integer (1–16383) */
export function generateRegistrationId(): number {
  const buf = new Uint16Array(1);
  crypto.getRandomValues(buf);
  return (buf[0]! & 0x3fff) || 1; // mai 0
}
