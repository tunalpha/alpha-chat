/**
 * Signal Protocol — Public exports (Fase 1: Key Management).
 *
 * Punto di accesso unico al modulo signal/.
 * Il resto dell'app non importa da sotto-moduli direttamente.
 */

export { initSignalKeys, clearSignalKeys, maybeReplenishOtpks, getSignalStatus } from "./key-manager";
export { toBase64, fromBase64, verifySignedPreKey } from "./key-generator";
export type {
  KeyPair,
  IdentityKeyPair,
  SignedPreKeyPair,
  OneTimePreKeyPair,
  LocalSignalIdentity,
  PublicKeyBundle,
  ReceivedKeyBundle,
} from "./types";
