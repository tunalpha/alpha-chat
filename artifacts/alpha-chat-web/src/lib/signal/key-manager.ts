/**
 * Signal Protocol — Key Manager.
 *
 * Orchestra il ciclo di vita delle chiavi Signal per un dispositivo:
 *   1. Inizializzazione al primo login (genera + carica bundle)
 *   2. Rifornimento OTPKs (quando il server ne ha < 20)
 *   3. Rotazione Signed PreKey (pianificata in Phase 2)
 *   4. Cleanup al logout
 *
 * PUNTO DI ACCESSO PRINCIPALE: `initSignalKeys(userId, deviceId)`
 *
 * ⚠ Zero Plaintext Rule: questo manager non trasmette mai chiavi private.
 *    Le private restano in IndexedDB; al server vanno solo chiavi pubbliche.
 */

import { initSignalLibrary, type KeyPairType } from "@workspace/libsignal-ts";
import { getSignalStore } from "./key-store";
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
  buildPublicBundle,
} from "./key-generator";
import {
  apiUploadKeyBundle,
  apiGetKeyCount,
  apiReplenishOneTimePreKeys,
} from "../api";

// ---------------------------------------------------------------------------
// Soglie
// ---------------------------------------------------------------------------

const OTPK_MIN = 20;   // Rifornimento quando il server ha < 20 OTPK
const OTPK_BATCH = 100; // Quante OTPK generare per rifornimento

// ---------------------------------------------------------------------------
// initSignalKeys — punto di ingresso principale
// ---------------------------------------------------------------------------

/**
 * Inizializza le chiavi Signal per (userId, deviceId).
 *
 * Idempotente: se le chiavi esistono già, verifica solo il livello OTPK.
 * Chiamato dopo login e registrazione (non blocca il flusso — fire-and-forget).
 *
 * Flusso:
 *   1. Carica WASM curve25519 (singleton)
 *   2. Se non inizializzato: usa ikKeyPair se fornita, altrimenti genera nuova IK
 *   3. Genera Signed PreKey e 100 OTPKs per questo device
 *   4. Carica bundle pubblico sul server (identityKey = ikKeyPair.pubKey)
 *   5. Controlla se il server ha abbastanza OTPKs; rifornisce se necessario
 *
 * @param ikKeyPair Sprint 28: IK decifrata dal blob lato client.
 *   - Presente → usa questa IK (stessa per tutti i device dello stesso utente).
 *   - Assente  → genera nuova IK locale (legacy pre-migrazione o recovery).
 */
export async function initSignalKeys(
  userId: string,
  deviceId: string,
  ikKeyPair?: KeyPairType,
): Promise<void> {
  // 1. Inizializza WASM (no-op se già fatto)
  await initSignalLibrary();

  const store = getSignalStore(userId, deviceId);

  if (!(await store.isInitialized())) {
    // Prima inizializzazione: genera tutto e carica sul server
    await _firstTimeSetup(store, userId, deviceId, ikKeyPair);
  } else {
    // Già inizializzato: controlla solo il livello OTPK
    await maybeReplenishOtpks(userId, deviceId);
  }
}

// ---------------------------------------------------------------------------
// Setup iniziale (prima volta)
// ---------------------------------------------------------------------------

async function _firstTimeSetup(
  store: ReturnType<typeof getSignalStore>,
  userId: string,
  deviceId: string,
  /**
   * Sprint 28: IK decifrata dal blob lato client.
   * Se presente, viene usata al posto di generare una nuova IK.
   * Questo garantisce che tutti i device dello stesso utente abbiano la stessa IK.
   */
  ikKeyPair?: KeyPairType,
): Promise<void> {
  // Genera o riusa l'Identity Key Pair
  // Sprint 28: se ikKeyPair è presente (blob decifrato), usala direttamente.
  // Questo è il percorso normale post-migrazione: tutti i device usano la stessa IK.
  // Il percorso legacy (assenza di ikKeyPair) genera una nuova IK locale —
  // usato solo per utenti pre-migrazione che non hanno ancora il blob sul server.
  const identityKeyPair = ikKeyPair ?? await generateIdentityKeyPair();

  // Registration ID (1–16383)
  const { generateRegistrationId } = await import("@workspace/libsignal-ts");
  const registrationId = generateRegistrationId();

  // Salva identità locale
  await store.storeIdentityKeyPair(identityKeyPair, registrationId);

  // Genera Signed PreKey (keyId = 1)
  const signedPreKey = await generateSignedPreKey(identityKeyPair, 1);
  await store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);
  await store.setCurrentSpkId(signedPreKey.keyId);

  // Genera 100 One-Time PreKeys
  const startId = await store.getNextOtpkId();
  const oneTimePreKeys = await generateOneTimePreKeys(startId, OTPK_BATCH);
  await Promise.all(
    oneTimePreKeys.map((k) => store.storePreKey(k.keyId, k.keyPair)),
  );
  await store.setNextOtpkId(startId + OTPK_BATCH);

  // Costruisce e carica il bundle pubblico
  const bundle = await buildPublicBundle(
    store,
    deviceId,
    identityKeyPair,
    signedPreKey,
    oneTimePreKeys,
  );

  await apiUploadKeyBundle({
    deviceId: bundle.deviceId,
    registrationId: bundle.registrationId,
    identityKey: bundle.identityKey,
    signedPreKeyId: bundle.signedPreKeyId,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    oneTimePreKeys: bundle.oneTimePreKeys,
  });
}

// ---------------------------------------------------------------------------
// Rifornimento OTPKs
// ---------------------------------------------------------------------------

/**
 * Controlla il livello OTPK sul server e rifornisce se < OTPK_MIN.
 * Chiamato automaticamente da `initSignalKeys` e può essere chiamato
 * periodicamente (es. ogni N minuti o a ogni avvio).
 */
export async function maybeReplenishOtpks(
  userId: string,
  deviceId: string,
): Promise<void> {
  try {
    await initSignalLibrary(); // Assicura WASM caricato

    const { otpkCount, needsReplenishment } = await apiGetKeyCount();
    if (!needsReplenishment) return;

    const store = getSignalStore(userId, deviceId);
    const identityKeyPair = await store.getIdentityKeyPair();
    if (!identityKeyPair) return; // Non inizializzato

    // Genera nuove OTPKs partendo dall'ID successivo
    const startId = await store.getNextOtpkId();
    const needed = Math.max(OTPK_MIN - otpkCount, 0) + OTPK_BATCH;
    const newKeys = await generateOneTimePreKeys(startId, needed);

    // Salva localmente
    await Promise.all(newKeys.map((k) => store.storePreKey(k.keyId, k.keyPair)));
    await store.setNextOtpkId(startId + needed);

    // Carica sul server
    await apiReplenishOneTimePreKeys({
      deviceId,
      oneTimePreKeys: newKeys.map((k) => ({
        keyId: k.keyId,
        publicKey: _ab2b64(k.keyPair.pubKey),
      })),
    });
  } catch {
    // Errore non critico — verrà ritentato alla prossima occasione
  }
}

// ---------------------------------------------------------------------------
// Cleanup al logout
// ---------------------------------------------------------------------------

/**
 * Cancella tutte le chiavi Signal locali per (userId, deviceId).
 * Chiamato al logout. Non reversibile: richiede re-inizializzazione al login.
 */
export async function clearSignalKeys(
  userId: string,
  deviceId: string,
): Promise<void> {
  const store = getSignalStore(userId, deviceId);
  await store.clear();
}

// ---------------------------------------------------------------------------
// Helper locale
// ---------------------------------------------------------------------------

function _ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
