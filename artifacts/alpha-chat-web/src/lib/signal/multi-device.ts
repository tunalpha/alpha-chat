/**
 * Signal Multi-Device — Fase 4.
 *
 * Fan-out cifratura/decifratura per tutti i device del destinatario.
 * Ogni device ha una sessione Signal indipendente; la chiave privata
 * rimane solo sul device corrispondente.
 *
 * ⚠ Zero Plaintext Rule:
 *   - Il plaintext non è mai loggato né inviato in rete.
 *   - Ogni device riceve un ciphertext diverso (nessuna correlazione via blob).
 */

import {
  SessionCipher,
  SessionBuilder,
  SignalProtocolAddress,
  type DeviceType,
} from "@workspace/libsignal-ts";
import { base64ToArrayBuffer } from "@workspace/libsignal-ts";
import { getSignalStore } from "./key-store";
import type { ApiReceivedKeyBundle } from "../api";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface DeviceCiphertext {
  device_id: string;
  body: string;   // base64
  type: number;   // 1 = WhisperMessage, 3 = PreKeyWhisperMessage
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringToBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

function bufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

function buffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
}

function toBundleDevice(b: ApiReceivedKeyBundle): DeviceType {
  const device: DeviceType = {
    registrationId: b.registrationId,
    identityKey: base64ToArrayBuffer(b.identityKey),
    signedPreKey: {
      keyId: b.signedPreKeyId,
      publicKey: base64ToArrayBuffer(b.signedPreKey),
      signature: base64ToArrayBuffer(b.signedPreKeySignature),
    },
  };
  if (b.oneTimePreKey) {
    device.preKey = {
      keyId: b.oneTimePreKey.keyId,
      publicKey: base64ToArrayBuffer(b.oneTimePreKey.publicKey),
    };
  }
  return device;
}

// ---------------------------------------------------------------------------
// ensureSessionForBundle — X3DH per un bundle pre-fetchato
// ---------------------------------------------------------------------------

/**
 * Garantisce che esista una sessione Signal per un device specifico del
 * destinatario, usando un bundle già scaricato.
 * Idempotente: no-op se la sessione è già in IndexedDB.
 *
 * Questo permette di fare una sola chiamata per fetchare tutti i bundle
 * e poi stabilire le sessioni senza ulteriori round-trip al server.
 */
export async function ensureSessionForBundle(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  recipientDeviceId: string | number,
  bundle: ApiReceivedKeyBundle,
): Promise<void> {
  const store = getSignalStore(userId, deviceId);
  // Converte deviceId stringa → intero per SignalProtocolAddress
  const devIdInt = typeof recipientDeviceId === "string"
    ? Math.abs(hashDeviceId(recipientDeviceId))
    : recipientDeviceId;
  const recipientAddr = new SignalProtocolAddress(recipientUserId, devIdInt);

  // Sessione già esistente → no-op
  const existing = await store.loadSession(recipientAddr.toString());
  if (existing) return;

  const deviceBundle = toBundleDevice(bundle);
  const builder = new SessionBuilder(store, recipientAddr);
  await builder.processPreKey(deviceBundle);
}

/**
 * Ricostruisce la sessione per un device specifico (recovery).
 */
export async function rebuildSessionForBundle(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  recipientDeviceId: string | number,
  bundle: ApiReceivedKeyBundle,
): Promise<void> {
  const store = getSignalStore(userId, deviceId);
  const devIdInt = typeof recipientDeviceId === "string"
    ? Math.abs(hashDeviceId(recipientDeviceId))
    : recipientDeviceId;
  const recipientAddr = new SignalProtocolAddress(recipientUserId, devIdInt);

  const deviceBundle = toBundleDevice(bundle);
  await store.saveIdentity(recipientAddr.toString(), deviceBundle.identityKey);
  const builder = new SessionBuilder(store, recipientAddr);
  await builder.processPreKey(deviceBundle);
}

// ---------------------------------------------------------------------------
// signalEncryptMulti — fan-out a tutti i device del destinatario
// ---------------------------------------------------------------------------

/**
 * Cifra un plaintext per TUTTI i device registrati del destinatario.
 *
 * Flusso:
 *   1. Scarica tutti i bundle del destinatario (GET /keys/bundle/:userId/all)
 *   2. Per ogni device: ensureSession (X3DH) + SessionCipher.encrypt
 *   3. Ritorna un array di DeviceCiphertext + il primary per il campo
 *      legacy ciphertext (primo device, backward compat.)
 *
 * @param allBundles  Tutti i bundle del destinatario (pre-fetchati)
 */
export async function signalEncryptMulti(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  plaintext: string,
  allBundles: ApiReceivedKeyBundle[],
  options?: {
    /**
     * Se true, elimina la sessione esistente prima di cifrare, forzando un
     * nuovo handshake X3DH (PreKeyWhisperMessage tipo-3).
     * Usato per i messaggi di gruppo dove il receiver potrebbe non avere la
     * sessione in IDB (cambio device, IDB pulito, primo scambio).
     */
    forceNewSession?: boolean;
  },
): Promise<{ deviceCiphertexts: DeviceCiphertext[]; primary: DeviceCiphertext }> {
  if (allBundles.length === 0) {
    throw new Error("Nessun bundle Signal disponibile per il destinatario");
  }

  const store = getSignalStore(userId, deviceId);
  const deviceCiphertexts: DeviceCiphertext[] = [];
  const plainBuf = stringToBuffer(plaintext);

  for (const bundle of allBundles) {
    const devIdInt = Math.abs(hashDeviceId(bundle.deviceId));
    const addr = new SignalProtocolAddress(recipientUserId, devIdInt);

    if (options?.forceNewSession) {
      // Forza un nuovo handshake X3DH eliminando la sessione esistente.
      // Questo garantisce che il messaggio sia un PreKeyWhisperMessage (tipo-3),
      // che il receiver può sempre decifrare senza una sessione preesistente.
      await store.deleteSession(addr.toString());
    }

    // Rileva cambio di identity key: se il destinatario ha rigenerato le chiavi
    // (es. IDB cancellato + page reload), la sessione esistente è con le vecchie chiavi.
    // A deve creare una nuova sessione X3DH con il nuovo bundle.
    let existing = await store.loadSession(addr.toString());
    if (existing) {
      const bundleIdentityBuf = base64ToArrayBuffer(bundle.identityKey);
      const storedIdentity = await store.getRemoteIdentityKey(recipientUserId);
      if (storedIdentity && !buffersEqual(storedIdentity, bundleIdentityBuf)) {
        // Identity key cambiata → resetta sessione per usare il nuovo bundle
        console.warn("[Signal] Identity key changed for", recipientUserId, "— reset session");
        await store.deleteSession(addr.toString());
        await store.saveIdentity(recipientUserId, bundleIdentityBuf);
        existing = undefined;
      }
    }
    if (!existing) {
      await ensureSessionForBundle(userId, deviceId, recipientUserId, devIdInt, bundle);
    }

    const cipher = new SessionCipher(store, addr);
    const result = await cipher.encrypt(plainBuf);
    const binaryBody = result.body as unknown as string;
    const body = btoa(binaryBody);

    deviceCiphertexts.push({ device_id: bundle.deviceId, body, type: result.type });
  }

  return { deviceCiphertexts, primary: deviceCiphertexts[0]! };
}

// ---------------------------------------------------------------------------
// signalDecryptFromDeviceCiphertexts — trova e decifra il ciphertext per il mio device
// ---------------------------------------------------------------------------

/**
 * Cerca l'entry per myDeviceId in device_ciphertexts e la decifra.
 * Se non trovata → null (il chiamante usa il fallback sul campo ciphertext).
 */
export async function signalDecryptFromDeviceCiphertexts(
  userId: string,
  deviceId: string,
  senderUserId: string,
  deviceCiphertexts: DeviceCiphertext[],
): Promise<string | null> {
  const entry = deviceCiphertexts.find((d) => d.device_id === deviceId);
  if (!entry) return null;

  const store = getSignalStore(userId, deviceId);
  // Il sender ha un singolo device nell'address — usiamo deviceId hash come intero
  const senderDevIdInt = Math.abs(hashDeviceId(deviceId)); // Per convenzione: sender addr usa lo stesso schema
  const addr = new SignalProtocolAddress(senderUserId, senderDevIdInt);

  let binaryBody: string;
  try {
    binaryBody = atob(entry.body);
  } catch {
    return null;
  }

  const tryDecrypt = async (): Promise<ArrayBuffer> => {
    const cipher = new SessionCipher(store, addr);
    if (entry.type === 3) {
      return cipher.decryptPreKeyWhisperMessage(binaryBody, "binary");
    } else {
      return cipher.decryptWhisperMessage(binaryBody, "binary");
    }
  };

  try {
    const plainBuf = await tryDecrypt();
    return bufferToString(plainBuf);
  } catch (err) {
    // Log real error for diagnostics — never swallow silently
    console.error("[Signal] decryptFromDeviceCiphertexts FAILED", {
      senderUserId,
      addr: addr.toString(),
      entryType: entry.type,
      bodyLen: entry.body.length,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converte un deviceId UUID in un intero ≥ 1 per SignalProtocolAddress.
 * Usa un hash deterministico stabile.
 * ⚠ Deve essere consistent cross-sessione: stesso deviceId → stesso int.
 */
export function hashDeviceId(deviceId: string): number {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    const c = deviceId.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash |= 0; // Forza int32
  }
  // Garantisce [1, 2^31 - 1]
  return (Math.abs(hash) % 0x7fff_ffff) + 1;
}
