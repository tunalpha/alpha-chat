/**
 * Signal Protocol — Key Manager (Fase 1).
 *
 * Orchestra:
 *   1. Verifica se le chiavi locali esistono già (IndexedDB)
 *   2. Se no: genera Identity Key + Signed PreKey + 100 One-Time PreKeys
 *   3. Carica il bundle pubblico sul server
 *   4. Periodicamente controlla il livello OTPK e rifornisce se < soglia
 *
 * ZERO PLAINTEXT RULE:
 *   Solo le chiavi pubbliche (e la firma) vengono inviate al server.
 *   Le chiavi private rimangono esclusivamente in IndexedDB.
 */

import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
  generateRegistrationId,
  toBase64,
} from "./key-generator";
import {
  hasIdentityKey,
  saveIdentityKey,
  saveSignedPreKey,
  saveOneTimePreKeys,
  loadMetadata,
  saveMetadata,
  countLocalOneTimePreKeys,
  getNextOtpkStartId,
  clearSignalStore,
} from "./key-store";
import {
  apiUploadKeyBundle,
  apiReplenishOneTimePreKeys,
} from "../api";
import type { PublicKeyBundle } from "./types";

/** Soglia minima OTPK locali prima di generarne di nuove */
const OTPK_REFILL_THRESHOLD = 20;
/** Numero di OTPK da generare per rifornimento */
const OTPK_REFILL_BATCH = 100;

// ---------------------------------------------------------------------------
// Inizializzazione chiavi (chiamata post-login)
// ---------------------------------------------------------------------------

/**
 * Inizializza le chiavi Signal per l'utente/dispositivo.
 * Idempotente: se le chiavi esistono già non fa nulla.
 *
 * @param userId    ID utente (da AuthContext)
 * @param deviceId  ID dispositivo (da localStorage o SessionModel)
 */
export async function initSignalKeys(
  userId: string,
  deviceId: string,
): Promise<void> {
  const alreadyInitialized = await hasIdentityKey(userId);
  if (alreadyInitialized) {
    // Controlla solo se serve rifornire le OTPK
    await maybeReplenishOtpks(userId, deviceId);
    return;
  }

  // --- Generazione ---
  const identityKey = generateIdentityKeyPair();
  const registrationId = generateRegistrationId();

  const spkId = 1;
  const signedPreKey = generateSignedPreKey(spkId, identityKey.privateKey);

  const startOtpkId = await getNextOtpkStartId(userId);
  const oneTimePreKeys = generateOneTimePreKeys(startOtpkId, 100);

  // --- Storage locale (PRIVATE keys — mai al server) ---
  await saveIdentityKey(userId, deviceId, identityKey);
  await saveSignedPreKey(userId, signedPreKey);
  await saveOneTimePreKeys(userId, oneTimePreKeys);

  // Salva registrationId e deviceId in metadata
  await saveMetadata(`${userId}:registrationId`, registrationId);
  await saveMetadata(`${userId}:deviceId`, deviceId);

  // --- Upload bundle PUBBLICO al server ---
  const bundle: PublicKeyBundle = {
    deviceId,
    registrationId,
    identityKey: toBase64(identityKey.publicKey),
    signedPreKeyId: spkId,
    signedPreKey: toBase64(signedPreKey.publicKey),
    signedPreKeySignature: toBase64(signedPreKey.signature),
    oneTimePreKeys: oneTimePreKeys.map((k) => ({
      keyId: k.keyId,
      publicKey: toBase64(k.publicKey),
    })),
  };

  await apiUploadKeyBundle(bundle);
}

// ---------------------------------------------------------------------------
// Rifornimento One-Time PreKeys
// ---------------------------------------------------------------------------

/**
 * Controlla il livello OTPK locale e rifornisce se sotto soglia.
 * Chiamato silenziosamente in background (non blocca l'UI).
 */
export async function maybeReplenishOtpks(
  userId: string,
  deviceId: string,
): Promise<void> {
  try {
    const count = await countLocalOneTimePreKeys(userId);
    if (count >= OTPK_REFILL_THRESHOLD) return;

    const startId = await getNextOtpkStartId(userId);
    const newKeys = generateOneTimePreKeys(startId, OTPK_REFILL_BATCH);

    await saveOneTimePreKeys(userId, newKeys);
    await apiReplenishOneTimePreKeys({
      deviceId,
      oneTimePreKeys: newKeys.map((k) => ({
        keyId: k.keyId,
        publicKey: toBase64(k.publicKey),
      })),
    });
  } catch {
    // Errore non critico — il rifornimento verrà ritentato al prossimo login
  }
}

// ---------------------------------------------------------------------------
// Cleanup (logout / reset account)
// ---------------------------------------------------------------------------

/**
 * Elimina TUTTE le chiavi Signal locali per l'utente.
 * Chiamato durante logout o reset account.
 */
export async function clearSignalKeys(userId: string): Promise<void> {
  await clearSignalStore(userId);
}

// ---------------------------------------------------------------------------
// Utilità status
// ---------------------------------------------------------------------------

export async function getSignalStatus(userId: string): Promise<{
  initialized: boolean;
  registrationId: number | null;
  localOtpkCount: number;
}> {
  const initialized = await hasIdentityKey(userId);
  const registrationId = initialized
    ? ((await loadMetadata(`${userId}:registrationId`)) as number | null)
    : null;
  const localOtpkCount = initialized ? await countLocalOneTimePreKeys(userId) : 0;
  return { initialized, registrationId, localOtpkCount };
}
