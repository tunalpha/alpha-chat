/**
 * Signal Key Bundle Service — logica di business.
 *
 * Fase 1: gestione distribuzione chiavi pubbliche.
 * Fase 2 (X3DH): questo servizio fornirà i bundle ai client che instaurano sessioni.
 *
 * ZERO PLAINTEXT RULE: nessuna chiave privata passa per questo servizio.
 * Il server funge da Key Distribution Center (KDC) per il materiale pubblico.
 */

import mongoose from "mongoose";
import { UserModel } from "../models/user.model";
import * as repo from "../repositories/signal-key-bundle.repository";
import { AppError } from "../errors/AppError";
import type {
  UploadKeyBundleInput,
  ReplenishOneTimePreKeysInput,
  RotateSignedPreKeyInput,
} from "../validation/signal-key.schemas";

// ---------------------------------------------------------------------------
// Tipi di risposta
// ---------------------------------------------------------------------------

export interface KeyBundleResponse {
  userId: string;
  deviceId: string;
  registrationId: number;
  identityKey: string;             // base64
  signedPreKeyId: number;
  signedPreKey: string;            // base64
  signedPreKeySignature: string;   // base64
  oneTimePreKey: { keyId: number; publicKey: string } | null;
  hasOneTimePreKey: boolean;
}

export interface KeyCountResponse {
  userId: string;
  otpkCount: number;
  needsReplenishment: boolean;
  bundleExists: boolean;
}

// ---------------------------------------------------------------------------
// Upload bundle (post-registrazione / reset)
// ---------------------------------------------------------------------------

/**
 * Feature flag — Sprint 28.
 * Quando attivo, rifiuta upload di bundle con IK diversa da quella già registrata.
 * Disattivo durante la migrazione per non bloccare i client legacy.
 * Attivare dopo che tutti gli utenti hanno completato la migrazione.
 */
const IK_CONSISTENCY_CHECK = process.env["SIGNAL_IK_CONSISTENCY_CHECK"] === "true";

export async function uploadKeyBundle(
  userId: string,
  input: UploadKeyBundleInput,
): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);

  // Sprint 28: fetch bundle esistenti una sola volta — usati sia per consistency
  // check sia per auto-cleanup (evita doppia query al DB).
  const existing = await repo.listAllBundlesForUser(uid);

  if (IK_CONSISTENCY_CHECK) {
    // Fase post-migrazione: rifiuta upload con IK diversa da quella già registrata.
    const differentIk = existing.find((b) => b.identity_key !== input.identity_key);
    if (differentIk) {
      throw new AppError("IDENTITY_KEY_MISMATCH", 409);
    }
  } else {
    // Fase di migrazione (flag OFF): auto-cleanup bundle stale.
    //
    // Se l'utente ha già un blob IK (migrazione avvenuta o Sprint28 nativo),
    // il device che esegue l'upload usa la IK canonica del blob (garantito da
    // Fix 2 — convergenza in initSignalKeys). I bundle con IK diversa sono
    // quindi stale (device non ancora converguti o pre-migrazione) e vengono
    // rimossi automaticamente.
    //
    // Questo consente a Marco e Alpha di auto-pulirsi al prossimo login
    // senza intervento manuale, e prepara il DB per l'attivazione del flag.
    const stale = existing.filter((b) => b.identity_key !== input.identity_key);
    if (stale.length > 0) {
      const user = await UserModel.findById(uid)
        .select("encrypted_identity_key")
        .lean()
        .exec();
      if (user?.encrypted_identity_key) {
        const deleted = await repo.deleteBundlesByDeviceIds(
          uid,
          stale.map((b) => b.device_id),
        );
        if (deleted > 0) {
          // Log temporaneo di migrazione — rimuovere dopo la convergenza di Marco e Alpha.
          // Utile per verificare la migrazione senza interrogare il DB.
          console.info("[Sprint28] IK convergence executed", {
            userId,
            deviceId: input.device_id,
            event: "IK convergence executed",
            staleBundlesRemoved: deleted,
            staleBundleDeviceIds: stale.map((b) => b.device_id),
            canonicalIdentityKey: input.identity_key.slice(0, 16) + "…",
          });
        }
      }
    }
  }

  await repo.upsertKeyBundle(uid, {
    deviceId: input.device_id,
    registrationId: input.registration_id,
    identityKey: input.identity_key,
    signedPreKeyId: input.signed_pre_key_id,
    signedPreKey: input.signed_pre_key,
    signedPreKeySignature: input.signed_pre_key_signature,
    oneTimePreKeys: input.one_time_pre_keys.map((k) => ({
      keyId: k.key_id,
      publicKey: k.public_key,
    })),
  });
}

// ---------------------------------------------------------------------------
// Fetch bundle per X3DH (client che inizia sessione con targetUserId)
// ---------------------------------------------------------------------------

export async function fetchKeyBundle(
  requestingUserId: string,
  targetUserId: string,
): Promise<KeyBundleResponse> {
  // Verifica che il target esista e sia attivo
  const targetUser = await UserModel.findById(targetUserId)
    .select("_id status")
    .lean()
    .exec();

  if (!targetUser || targetUser.status !== "active") {
    throw new AppError("USER_NOT_FOUND", 404);
  }

  const uid = new mongoose.Types.ObjectId(targetUserId);
  const result = await repo.fetchBundleForX3DH(uid);

  if (!result) {
    throw new AppError("SIGNAL_BUNDLE_NOT_FOUND", 404);
  }

  const { bundle, poppedOtpk } = result;

  return {
    userId: targetUserId,
    deviceId: bundle.device_id,
    registrationId: bundle.registration_id,
    identityKey: bundle.identity_key,
    signedPreKeyId: bundle.signed_pre_key_id,
    signedPreKey: bundle.signed_pre_key,
    signedPreKeySignature: bundle.signed_pre_key_signature,
    oneTimePreKey: poppedOtpk
      ? { keyId: poppedOtpk.key_id, publicKey: poppedOtpk.public_key }
      : null,
    hasOneTimePreKey: poppedOtpk !== null,
  };
}

// ---------------------------------------------------------------------------
// Rifornimento One-Time PreKeys
// ---------------------------------------------------------------------------

export async function replenishOneTimePreKeys(
  userId: string,
  input: ReplenishOneTimePreKeysInput,
): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);
  const matched = await repo.appendOneTimePreKeys(uid, input.device_id, input.one_time_pre_keys.map((k) => ({
    keyId: k.key_id,
    publicKey: k.public_key,
  })));
  if (!matched) {
    throw new AppError("SIGNAL_BUNDLE_NOT_FOUND", 404);
  }
}

// ---------------------------------------------------------------------------
// Rotazione Signed PreKey
// ---------------------------------------------------------------------------

export async function rotateSPK(
  userId: string,
  input: RotateSignedPreKeyInput,
): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);
  await repo.rotateSignedPreKey(
    uid,
    input.device_id,
    input.signed_pre_key_id,
    input.signed_pre_key,
    input.signed_pre_key_signature,
  );
}

// ---------------------------------------------------------------------------
// Stato chiavi
// ---------------------------------------------------------------------------

export async function getKeyCount(userId: string, deviceId: string): Promise<KeyCountResponse> {
  const uid = new mongoose.Types.ObjectId(userId);
  const { otpkCount, bundleExists } = await repo.getOtpkCount(uid, deviceId);
  return {
    userId,
    otpkCount,
    needsReplenishment: otpkCount < 20,
    bundleExists,
  };
}

// ---------------------------------------------------------------------------
// Fase 4: multi-device
// ---------------------------------------------------------------------------

export interface DeviceInfo {
  deviceId: string;
  registrationId: number;
  /** Data ultima rotazione SPK (proxy per "ultimo login") */
  lastActiveAt: string;
  otpkCount: number;
}

/**
 * Elenca tutti i device registrati per l'utente corrente.
 */
export async function listDevices(userId: string): Promise<DeviceInfo[]> {
  const uid = new mongoose.Types.ObjectId(userId);
  const bundles = await repo.listAllBundlesForUser(uid);
  return bundles.map((b) => ({
    deviceId: b.device_id,
    registrationId: b.registration_id,
    lastActiveAt: b.signed_pre_key_rotated_at?.toISOString() ?? new Date(0).toISOString(),
    otpkCount: b.otpk_count ?? 0,
  }));
}

/**
 * Revoca un device: cancella il suo key bundle dal server.
 * Dopo la revoca il device non può più stabilire nuove sessioni né ricevere messaggi.
 *
 * ⚠ Solo l'owner (userId) può revocare i propri device.
 *    Non si può revocare l'unico device rimasto (protezione lock-out).
 */
export async function revokeDevice(
  userId: string,
  targetDeviceId: string,
): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);
  const allBundles = await repo.listAllBundlesForUser(uid);

  if (allBundles.length <= 1) {
    throw new AppError("LAST_DEVICE_REVOKE", 400);
  }

  const ok = await repo.deleteBundleForDevice(uid, targetDeviceId);
  if (!ok) {
    throw new AppError("DEVICE_NOT_FOUND", 404);
  }
}

/**
 * Fetch di TUTTI i bundle del destinatario per X3DH multi-device.
 * Ogni bundle include il pop atomico di una OTPK.
 */
export async function fetchAllKeyBundles(
  requestingUserId: string,
  targetUserId: string,
): Promise<KeyBundleResponse[]> {
  const targetUser = await UserModel.findById(targetUserId)
    .select("_id status").lean().exec();

  if (!targetUser || targetUser.status !== "active") {
    throw new AppError("USER_NOT_FOUND", 404);
  }

  const uid = new mongoose.Types.ObjectId(targetUserId);
  const results = await repo.fetchAllBundlesForX3DH(uid);

  if (results.length === 0) {
    throw new AppError("SIGNAL_BUNDLE_NOT_FOUND", 404);
  }

  return results.map(({ bundle, poppedOtpk }) => ({
    userId: targetUserId,
    deviceId: bundle.device_id,
    registrationId: bundle.registration_id,
    identityKey: bundle.identity_key,
    signedPreKeyId: bundle.signed_pre_key_id,
    signedPreKey: bundle.signed_pre_key,
    signedPreKeySignature: bundle.signed_pre_key_signature,
    oneTimePreKey: poppedOtpk
      ? { keyId: poppedOtpk.key_id, publicKey: poppedOtpk.public_key }
      : null,
    hasOneTimePreKey: poppedOtpk !== null,
  }));
}
