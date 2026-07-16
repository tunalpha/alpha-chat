/**
 * Tipi locali per Signal Protocol — layer alpha-chat-web.
 *
 * Le chiavi usano ArrayBuffer (formato nativo di @privacyresearch/libsignal-protocol-typescript).
 * IndexedDB supporta ArrayBuffer nativamente — nessuna conversione in storage.
 *
 * ⚠ Zero Plaintext Rule: le chiavi private (privKey: ArrayBuffer) rimangono
 *    esclusivamente in IndexedDB sul dispositivo. Non vengono mai trasmesse
 *    al server né incluse in log, debug o analytics.
 */

/** Coppia di chiavi Curve25519 (formato @privacyresearch) */
export interface SignalKeyPair {
  pubKey: ArrayBuffer;   // 33 byte per Identity Key (0x05 prefix), 32 byte per DH keys
  privKey: ArrayBuffer;  // 32 byte — Mai lasciano il dispositivo
}

/** Identity Key Pair — chiave a lungo termine del dispositivo */
export interface SignalIdentityKeyPair extends SignalKeyPair {
  /** registrationId associato (1–16383) */
  registrationId: number;
}

/** Signed PreKey — chiave DH a medio termine, firmata con Identity Key */
export interface SignalSignedPreKeyPair {
  keyId: number;
  keyPair: SignalKeyPair;
  signature: ArrayBuffer;  // XEdDSA — 64 byte
  createdAt: number;       // timestamp Unix ms
}

/** One-Time PreKey — chiave DH monouso (pool, Signal spec: min 20) */
export interface SignalOneTimePreKeyPair {
  keyId: number;
  keyPair: SignalKeyPair;
}

/** Bundle pubblico da caricare sul server (nessuna chiave privata) */
export interface SignalPublicBundle {
  deviceId: string;
  registrationId: number;
  identityKey: string;             // base64 (33 byte con prefisso)
  signedPreKeyId: number;
  signedPreKey: string;            // base64
  signedPreKeySignature: string;   // base64 (XEdDSA, 64 byte)
  oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
}
