/**
 * Signal Protocol — Punto di accesso pubblico per alpha-chat-web.
 *
 * Importa SOLO da qui, non direttamente da @workspace/libsignal-ts o da
 * file interni del modulo signal/.
 */

export { initSignalKeys, clearSignalKeys, maybeReplenishOtpks } from "./key-manager";
export { getSignalStore, SignalProtocolStore } from "./key-store";
export { ensureSession, rebuildSession } from "./signal-session";
export {
  signalEncrypt,
  signalDecrypt,
  legacyDecode,
  safeDecodeForPreview,
  type SignalCiphertext,
} from "./signal-messenger";
export type {
  SignalKeyPair,
  SignalIdentityKeyPair,
  SignalSignedPreKeyPair,
  SignalOneTimePreKeyPair,
  SignalPublicBundle,
} from "./types";

// ── Fase 3: cifratura media E2E ──────────────────────────────────────────────
export {
  encryptMediaBlob,
  decryptAndCreateObjectUrl,
  rawToBase64,
  base64ToRaw,
  base64ToUint8Array,
} from "./media-crypto";
