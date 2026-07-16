/**
 * Tipi locali per Signal Protocol — Fase 1 (Key Management).
 *
 * ⚠ Zero Plaintext Rule: le chiavi private (Uint8Array) rimangono
 *    esclusivamente in IndexedDB sul dispositivo. Non vengono mai
 *    inviate al server né incluse in log o analytics.
 */

/** Coppia di chiavi crittografiche — privata locale, pubblica distribuita */
export interface KeyPair {
  privateKey: Uint8Array;   // 32 byte — Mai lasciano il dispositivo
  publicKey: Uint8Array;    // 32 byte — Caricata sul server (base64)
}

/** Identity Key Pair — chiave a lungo termine del dispositivo */
export interface IdentityKeyPair {
  keyType: "identity";
  privateKey: Uint8Array;   // Ed25519 — 32 byte seed
  publicKey: Uint8Array;    // Ed25519 — 32 byte
}

/** Signed PreKey — chiave DH a medio termine, firmata con Identity Key */
export interface SignedPreKeyPair {
  keyType: "signed-pre-key";
  keyId: number;
  privateKey: Uint8Array;   // X25519 — 32 byte
  publicKey: Uint8Array;    // X25519 — 32 byte
  signature: Uint8Array;    // Ed25519 signature — 64 byte
  createdAt: number;        // timestamp Unix ms
}

/** One-Time PreKey — chiave DH monouso (pool) */
export interface OneTimePreKeyPair {
  keyType: "one-time-pre-key";
  keyId: number;
  privateKey: Uint8Array;   // X25519 — 32 byte
  publicKey: Uint8Array;    // X25519 — 32 byte
}

/** Materiale locale completo del dispositivo Signal */
export interface LocalSignalIdentity {
  userId: string;
  deviceId: string;
  registrationId: number;
  identityKey: IdentityKeyPair;
  signedPreKey: SignedPreKeyPair;
  /** Lista key_id ancora locali (non consumati da X3DH) */
  oneTimePreKeyIds: number[];
}

/** Bundle pubblico caricato sul server (nessuna chiave privata) */
export interface PublicKeyBundle {
  deviceId: string;
  registrationId: number;
  identityKey: string;             // base64
  signedPreKeyId: number;
  signedPreKey: string;            // base64
  signedPreKeySignature: string;   // base64
  oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
}

/** Bundle ricevuto dal server per iniziare sessione X3DH con un utente */
export interface ReceivedKeyBundle {
  userId: string;
  deviceId: string;
  registrationId: number;
  identityKey: string;           // base64
  signedPreKeyId: number;
  signedPreKey: string;          // base64
  signedPreKeySignature: string; // base64
  oneTimePreKey: { keyId: number; publicKey: string } | null;
}
