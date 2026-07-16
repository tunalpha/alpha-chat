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
  encryptBlobWithKey,
  decryptAndCreateObjectUrl,
  rawToBase64,
  base64ToRaw,
  base64ToUint8Array,
} from "./media-crypto";

// ── Fase 4: multi-device ─────────────────────────────────────────────────────
export {
  signalEncryptMulti,
  signalDecryptFromDeviceCiphertexts,
  ensureSessionForBundle,
  rebuildSessionForBundle,
  hashDeviceId,
  type DeviceCiphertext,
} from "./multi-device";

// ── Fase 5: Safety Number + TOFU trust management ────────────────────────────
export {
  generateSafetyNumber,
  formatSafetyNumber,
  safetyNumberToQRPayload,
} from "./safety-number";

export {
  getTrustRecord,
  checkAndUpdateTrust,
  markVerified,
  acceptKeyChange,
  updateTrustFromBundle,
  type TrustStatus,
  type TrustRecord,
} from "./trust-manager";
