/**
 * Signal Key Bundle Repository — accesso diretto a MongoDB.
 *
 * ZERO PLAINTEXT RULE: questo repository gestisce SOLO chiavi pubbliche.
 * Mai chiavi private, mai plaintext.
 */

import mongoose from "mongoose";
import {
  SignalKeyBundleModel,
  type ISignalKeyBundle,
  type IOneTimePreKey,
} from "../models/signal-key-bundle.model";

// ---------------------------------------------------------------------------
// Upsert bundle completo
// ---------------------------------------------------------------------------

/**
 * Crea o sostituisce il bundle completo per (userId, deviceId).
 * Chiamato dopo registrazione o reset chiavi.
 */
export async function upsertKeyBundle(
  userId: mongoose.Types.ObjectId,
  data: {
    deviceId: string;
    registrationId: number;
    identityKey: string;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySignature: string;
    oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
  },
): Promise<ISignalKeyBundle> {
  const otpks: IOneTimePreKey[] = data.oneTimePreKeys.map((k) => ({
    key_id: k.keyId,
    public_key: k.publicKey,
    consumed: false,
    consumed_at: null,
  }));

  const doc = await SignalKeyBundleModel.findOneAndUpdate(
    { user_id: userId, device_id: data.deviceId },
    {
      $set: {
        user_id: userId,
        device_id: data.deviceId,
        registration_id: data.registrationId,
        identity_key: data.identityKey,
        signed_pre_key_id: data.signedPreKeyId,
        signed_pre_key: data.signedPreKey,
        signed_pre_key_signature: data.signedPreKeySignature,
        signed_pre_key_rotated_at: new Date(),
        one_time_pre_keys: otpks,
        otpk_count: otpks.length,
      },
    },
    { upsert: true, new: true },
  );

  return doc!.toObject() as ISignalKeyBundle;
}

// ---------------------------------------------------------------------------
// Fetch bundle per X3DH (pop atomico di una OTPK)
// ---------------------------------------------------------------------------

/**
 * Restituisce il bundle pubblico di un utente per iniziare una sessione X3DH.
 * Esegue un pop atomico di una One-Time PreKey (se disponibile).
 *
 * Ordine di preferenza:
 *   1. Bundle del dispositivo principale (primo registrato)
 *   2. Prima OTPK non consumata (atomicamente marcata come consumata)
 */
export async function fetchBundleForX3DH(
  targetUserId: mongoose.Types.ObjectId,
): Promise<{
  bundle: ISignalKeyBundle;
  poppedOtpk: IOneTimePreKey | null;
} | null> {
  // Pop atomico: trova il primo OTPK non consumato e lo marca
  const updated = await SignalKeyBundleModel.findOneAndUpdate(
    {
      user_id: targetUserId,
      "one_time_pre_keys": {
        $elemMatch: { consumed: false },
      },
    },
    {
      $set: {
        "one_time_pre_keys.$[elem].consumed": true,
        "one_time_pre_keys.$[elem].consumed_at": new Date(),
      },
      $inc: { otpk_count: -1 },
    },
    {
      arrayFilters: [{ "elem.consumed": false }],
      new: true,
      // Ritorna il documento PRIMA del pop per recuperare la OTPK poppata
      // Usiamo returnDocument: "before" tramite opzione legacy
    },
  );

  if (updated) {
    // Trova la OTPK appena consumata (quella con consumed_at più recente)
    const poppedOtpk = updated.one_time_pre_keys
      .filter((k) => k.consumed)
      .sort((a, b) =>
        (b.consumed_at?.getTime() ?? 0) - (a.consumed_at?.getTime() ?? 0),
      )[0] ?? null;

    return { bundle: updated.toObject() as ISignalKeyBundle, poppedOtpk };
  }

  // Nessuna OTPK disponibile — restituisci bundle senza OTPK
  const bundle = await SignalKeyBundleModel.findOne({ user_id: targetUserId })
    .lean<ISignalKeyBundle>()
    .exec();

  if (!bundle) return null;
  return { bundle, poppedOtpk: null };
}

// ---------------------------------------------------------------------------
// Rifornimento One-Time PreKeys
// ---------------------------------------------------------------------------

/**
 * Aggiunge nuove One-Time PreKeys al pool di un dispositivo.
 * Usa $push per appendere senza sovrascrivere le esistenti.
 */
export async function appendOneTimePreKeys(
  userId: mongoose.Types.ObjectId,
  deviceId: string,
  keys: Array<{ keyId: number; publicKey: string }>,
): Promise<void> {
  const otpks: IOneTimePreKey[] = keys.map((k) => ({
    key_id: k.keyId,
    public_key: k.publicKey,
    consumed: false,
    consumed_at: null,
  }));

  await SignalKeyBundleModel.updateOne(
    { user_id: userId, device_id: deviceId },
    {
      $push: { one_time_pre_keys: { $each: otpks } },
      $inc: { otpk_count: otpks.length },
    },
  );
}

// ---------------------------------------------------------------------------
// Rotazione Signed PreKey
// ---------------------------------------------------------------------------

export async function rotateSignedPreKey(
  userId: mongoose.Types.ObjectId,
  deviceId: string,
  spkId: number,
  spkPublic: string,
  spkSignature: string,
): Promise<void> {
  await SignalKeyBundleModel.updateOne(
    { user_id: userId, device_id: deviceId },
    {
      $set: {
        signed_pre_key_id: spkId,
        signed_pre_key: spkPublic,
        signed_pre_key_signature: spkSignature,
        signed_pre_key_rotated_at: new Date(),
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export async function getOtpkCount(
  userId: mongoose.Types.ObjectId,
): Promise<number> {
  const doc = await SignalKeyBundleModel
    .findOne({ user_id: userId })
    .select("otpk_count")
    .lean<{ otpk_count: number }>()
    .exec();
  return doc?.otpk_count ?? 0;
}

export async function hasBundleForUser(
  userId: mongoose.Types.ObjectId,
): Promise<boolean> {
  const count = await SignalKeyBundleModel.countDocuments({ user_id: userId });
  return count > 0;
}

// ---------------------------------------------------------------------------
// Fase 4: multi-device
// ---------------------------------------------------------------------------

/**
 * Restituisce TUTTI i bundle di un utente (un bundle per device).
 * Non consuma OTPKs — usato per elenco device e multi-device fetch.
 */
export async function listAllBundlesForUser(
  userId: mongoose.Types.ObjectId,
): Promise<ISignalKeyBundle[]> {
  return SignalKeyBundleModel
    .find({ user_id: userId })
    .lean<ISignalKeyBundle[]>()
    .exec();
}

/**
 * Fetch multi-device per X3DH: restituisce tutti i bundle del destinatario,
 * ognuno con pop atomico di una OTPK (se disponibile).
 */
export async function fetchAllBundlesForX3DH(
  targetUserId: mongoose.Types.ObjectId,
): Promise<Array<{ bundle: ISignalKeyBundle; poppedOtpk: IOneTimePreKey | null }>> {
  const bundles = await SignalKeyBundleModel
    .find({ user_id: targetUserId })
    .lean<ISignalKeyBundle[]>()
    .exec();

  const results: Array<{ bundle: ISignalKeyBundle; poppedOtpk: IOneTimePreKey | null }> = [];

  for (const b of bundles) {
    // Pop atomico OTPK per questo device
    const updated = await SignalKeyBundleModel.findOneAndUpdate(
      {
        user_id: targetUserId,
        device_id: b.device_id,
        "one_time_pre_keys": { $elemMatch: { consumed: false } },
      },
      {
        $set: {
          "one_time_pre_keys.$[elem].consumed": true,
          "one_time_pre_keys.$[elem].consumed_at": new Date(),
        },
        $inc: { otpk_count: -1 },
      },
      { arrayFilters: [{ "elem.consumed": false }], new: true },
    );

    if (updated) {
      const poppedOtpk = updated.one_time_pre_keys
        .filter((k) => k.consumed)
        .sort((a, b) => (b.consumed_at?.getTime() ?? 0) - (a.consumed_at?.getTime() ?? 0))[0] ?? null;
      results.push({ bundle: updated.toObject() as ISignalKeyBundle, poppedOtpk });
    } else {
      results.push({ bundle: b, poppedOtpk: null });
    }
  }

  return results;
}

/**
 * Revoca (cancella) il bundle di un device specifico.
 * Dopo la revoca il device non può più ricevere nuovi messaggi.
 */
export async function deleteBundleForDevice(
  userId: mongoose.Types.ObjectId,
  deviceId: string,
): Promise<boolean> {
  const result = await SignalKeyBundleModel.deleteOne({ user_id: userId, device_id: deviceId });
  return result.deletedCount > 0;
}
