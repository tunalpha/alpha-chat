/**
 * Signal Protocol — Generazione chiavi crittografiche.
 *
 * LIBRERIA: @workspace/libsignal-ts (fork interno di @privacyresearch/libsignal-protocol-typescript v0.0.16)
 * Vedere docs/adr/ADR-001-signal-browser-crypto.md per il razionale.
 *
 * ⚠ Zero Plaintext Rule:
 *   Tutte le chiavi private generate qui vengono immediatamente salvate in
 *   IndexedDB e poi scartate dalla memoria. Solo le chiavi pubbliche vengono
 *   trasmesse al server (in formato base64).
 *
 * ⚠ Nessun crypto custom: KeyHelper usa internamente @privacyresearch/curve25519-typescript
 *   (WASM/asm.js di Curve25519 — stesse primitive della spec Signal).
 */

import {
  KeyHelper,
  type KeyPairType,
  type SignedPreKeyPairType,
  type PreKeyPairType,
  arrayBufferToBase64,
} from "@workspace/libsignal-ts";
import type { SignalSignedPreKeyPair, SignalOneTimePreKeyPair, SignalPublicBundle } from "./types";
import type { SignalProtocolStore } from "./key-store";

// ---------------------------------------------------------------------------
// Identity Key Pair
// ---------------------------------------------------------------------------

/**
 * Genera un Identity Key Pair Curve25519.
 * La chiave pubblica è 33 byte (prefisso 0x05 + 32 byte raw) — formato Signal.
 * La chiave privata è 32 byte e NON deve mai lasciare il dispositivo.
 */
export async function generateIdentityKeyPair(): Promise<KeyPairType> {
  return KeyHelper.generateIdentityKeyPair();
}

// ---------------------------------------------------------------------------
// Signed PreKey
// ---------------------------------------------------------------------------

/**
 * Genera una Signed PreKey Curve25519 firmata con l'Identity Key via XEdDSA.
 *
 * Signal spec: la firma attesta che la chiave DH appartiene allo stesso
 * dispositivo che controlla l'Identity Key.
 */
export async function generateSignedPreKey(
  identityKeyPair: KeyPairType,
  keyId: number,
): Promise<SignalSignedPreKeyPair> {
  const result: SignedPreKeyPairType = await KeyHelper.generateSignedPreKey(identityKeyPair, keyId);
  return {
    keyId: result.keyId,
    keyPair: result.keyPair,
    signature: result.signature,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// One-Time PreKeys (batch)
// ---------------------------------------------------------------------------

/**
 * Genera un batch di One-Time PreKeys Curve25519.
 *
 * Signal spec: ogni chiave viene usata una sola volta durante X3DH,
 * poi eliminata dal pool locale e remoto.
 *
 * @param startKeyId   Primo keyId del batch
 * @param count        Numero di chiavi (default 100 — Signal recommends 100+)
 */
export async function generateOneTimePreKeys(
  startKeyId: number,
  count = 100,
): Promise<SignalOneTimePreKeyPair[]> {
  const tasks: Promise<PreKeyPairType>[] = [];
  for (let i = 0; i < count; i++) {
    tasks.push(KeyHelper.generatePreKey(startKeyId + i));
  }
  const results = await Promise.all(tasks);
  return results.map((r) => ({ keyId: r.keyId, keyPair: r.keyPair }));
}

// ---------------------------------------------------------------------------
// Bundle pubblico per l'upload al server
// ---------------------------------------------------------------------------

/**
 * Costruisce il bundle pubblico da caricare sul server.
 * Converte tutte le chiavi da ArrayBuffer a base64.
 * ⚠ Include SOLO chiavi pubbliche — le private restano in IndexedDB.
 */
export async function buildPublicBundle(
  store: SignalProtocolStore,
  deviceId: string,
  identityKeyPair: KeyPairType,
  signedPreKey: SignalSignedPreKeyPair,
  oneTimePreKeys: SignalOneTimePreKeyPair[],
): Promise<SignalPublicBundle> {
  const registrationId = await store.getLocalRegistrationId() ?? 0;

  return {
    deviceId,
    registrationId,
    identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
    signedPreKeyId: signedPreKey.keyId,
    signedPreKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
    signedPreKeySignature: arrayBufferToBase64(signedPreKey.signature),
    oneTimePreKeys: oneTimePreKeys.map((k) => ({
      keyId: k.keyId,
      publicKey: arrayBufferToBase64(k.keyPair.pubKey),
    })),
  };
}
