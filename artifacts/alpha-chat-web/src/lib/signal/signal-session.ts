/**
 * Signal Session Manager — Fase 2.
 *
 * Gestisce l'instaurazione e il recovery della sessione X3DH.
 *
 * ⚠ Zero Plaintext Rule: questo modulo non trasmette mai plaintext al server.
 * ⚠ Le chiavi private rimangono esclusivamente in IndexedDB.
 */

import {
  SessionBuilder,
  SignalProtocolAddress,
  type DeviceType,
} from "@workspace/libsignal-ts";
import { base64ToArrayBuffer } from "@workspace/libsignal-ts";
import { getSignalStore } from "./key-store";
import { apiGetKeyBundle, type ApiReceivedKeyBundle } from "../api";

// ---------------------------------------------------------------------------
// Conversione bundle server → DeviceType (@privacyresearch)
// ---------------------------------------------------------------------------

/**
 * Converte il bundle ricevuto dal server (base64) nel formato DeviceType
 * richiesto da SessionBuilder.processPreKey().
 *
 * La One-Time PreKey è inclusa solo se presente nel bundle.
 * Se assente (pool esaurito), X3DH usa solo Signed PreKey — comportamento
 * previsto dalla spec Signal (verificato in test 04).
 */
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
// ensureSession — X3DH (idempotente)
// ---------------------------------------------------------------------------

/**
 * Garantisce che esista una sessione Signal con il destinatario.
 * Idempotente: no-op se la sessione esiste già.
 *
 * Flusso:
 *   1. Controlla se la sessione è in IndexedDB
 *   2. Se non esiste: scarica il bundle dal server
 *   3. Esegue X3DH tramite SessionBuilder.processPreKey()
 *   4. Salva la sessione in IndexedDB
 *
 * @param userId            userId locale (mittente)
 * @param deviceId          deviceId locale
 * @param recipientUserId   userId del destinatario
 * @param recipientDeviceId deviceId del destinatario (default 1)
 */
export async function ensureSession(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  recipientDeviceId = 1,
): Promise<void> {
  const store = getSignalStore(userId, deviceId);
  const recipientAddr = new SignalProtocolAddress(recipientUserId, recipientDeviceId);

  // Sessione già esistente → no-op
  const existing = await store.loadSession(recipientAddr.toString());
  if (existing) return;

  // Scarica bundle e instaurazione sessione X3DH
  const bundle = await apiGetKeyBundle(recipientUserId);
  const deviceBundle = toBundleDevice(bundle);
  const builder = new SessionBuilder(store, recipientAddr);
  await builder.processPreKey(deviceBundle);
}

// ---------------------------------------------------------------------------
// rebuildSession — recovery
// ---------------------------------------------------------------------------

/**
 * Ricostruisce una sessione corrotta o mancante (recovery automatico).
 *
 * Usa-casi:
 *   - IndexedDB cancellato / reinstallazione
 *   - Sessione corrotta
 *   - Signed PreKey ruotata
 *   - Nuovo dispositivo collegato
 *
 * ⚠ Reset TOFU: pulisce la trust identity per permettere il re-keying.
 *   Questo è sicuro solo se il server garantisce l'autenticità del bundle.
 */
export async function rebuildSession(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  recipientDeviceId = 1,
): Promise<void> {
  const store = getSignalStore(userId, deviceId);
  const recipientAddr = new SignalProtocolAddress(recipientUserId, recipientDeviceId);

  // Scarica un bundle fresco (garantisce SPK aggiornata)
  const bundle = await apiGetKeyBundle(recipientUserId);
  const deviceBundle = toBundleDevice(bundle);

  // Reset trust identity (TOFU) per il destinatario
  // Il server è la fonte di verità per il bundle aggiornato
  await store.saveIdentity(recipientAddr.toString(), deviceBundle.identityKey);

  const builder = new SessionBuilder(store, recipientAddr);
  await builder.processPreKey(deviceBundle);
}
