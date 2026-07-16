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
}

// ---------------------------------------------------------------------------
// Upload bundle (post-registrazione / reset)
// ---------------------------------------------------------------------------

export async function uploadKeyBundle(
  userId: string,
  input: UploadKeyBundleInput,
): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);
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
  await repo.appendOneTimePreKeys(uid, input.device_id, input.one_time_pre_keys.map((k) => ({
    keyId: k.key_id,
    publicKey: k.public_key,
  })));
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

export async function getKeyCount(userId: string): Promise<KeyCountResponse> {
  const uid = new mongoose.Types.ObjectId(userId);
  const count = await repo.getOtpkCount(uid);
  return {
    userId,
    otpkCount: count,
    needsReplenishment: count < 20,
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
