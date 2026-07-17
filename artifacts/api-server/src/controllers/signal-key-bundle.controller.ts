/**
 * Signal Key Bundle Controller — gestori HTTP.
 *
 * Tutti i dati crittografici ricevuti e restituiti sono chiavi PUBBLICHE (base64).
 * Il server non vede mai chiavi private.
 */

import type { RequestHandler } from "express";
import * as service from "../services/signal-key-bundle.service";
import type {
  UploadKeyBundleInput,
  ReplenishOneTimePreKeysInput,
  RotateSignedPreKeyInput,
} from "../validation/signal-key.schemas";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// POST /api/v1/keys/bundle — upload bundle completo
// ---------------------------------------------------------------------------

export const uploadBundle: RequestHandler = async (req, res) => {
  const input = req.body as UploadKeyBundleInput;
  await service.uploadKeyBundle(req.user!.userId, input);
  res.status(201).json({ success: true });
};

// ---------------------------------------------------------------------------
// GET /api/v1/keys/bundle/:userId — fetch bundle per X3DH
// ---------------------------------------------------------------------------

export const fetchBundle: RequestHandler = async (req, res) => {
  const targetUserId = Array.isArray(req.params["userId"])
    ? req.params["userId"][0]
    : req.params["userId"];

  if (!targetUserId) {
    res.status(400).json({ error: "userId mancante" });
    return;
  }

  const bundle = await service.fetchKeyBundle(req.user!.userId, targetUserId);

  // AUDIT-1: quale bundle è stato restituito e se ha una OTPK disponibile
  logger.info({
    requesterId: req.user!.userId,
    targetUserId,
    bundleDeviceId: bundle.deviceId,
    signedPreKeyId: bundle.signedPreKeyId,
    hasOtpk: bundle.oneTimePreKey !== null,
    otpkKeyId: bundle.oneTimePreKey?.keyId ?? null,
  }, "[SIGNAL-AUDIT] fetchBundle → bundle consegnato");

  res.json({ success: true, data: bundle });
};

// ---------------------------------------------------------------------------
// GET /api/v1/keys/count — livello OTPK corrente
// ---------------------------------------------------------------------------

export const getKeyCount: RequestHandler = async (req, res) => {
  const count = await service.getKeyCount(req.user!.userId);
  res.json({ success: true, data: count });
};

// ---------------------------------------------------------------------------
// POST /api/v1/keys/one-time-pre-keys — rifornimento OTPK
// ---------------------------------------------------------------------------

export const replenishOneTimePreKeys: RequestHandler = async (req, res) => {
  const input = req.body as ReplenishOneTimePreKeysInput;
  await service.replenishOneTimePreKeys(req.user!.userId, input);
  res.status(201).json({ success: true });
};

// ---------------------------------------------------------------------------
// PUT /api/v1/keys/signed-pre-key — rotazione SPK
// ---------------------------------------------------------------------------

export const rotateSignedPreKey: RequestHandler = async (req, res) => {
  const input = req.body as RotateSignedPreKeyInput;
  await service.rotateSPK(req.user!.userId, input);
  res.json({ success: true });
};

// ---------------------------------------------------------------------------
// Fase 4: multi-device
// ---------------------------------------------------------------------------

/** GET /api/v1/keys/bundle/:userId/all — tutti i bundle del destinatario */
export const fetchAllBundles: RequestHandler = async (req, res) => {
  const targetUserId = Array.isArray(req.params["userId"])
    ? req.params["userId"][0]
    : req.params["userId"];

  if (!targetUserId) {
    res.status(400).json({ error: "userId mancante" });
    return;
  }

  const bundles = await service.fetchAllKeyBundles(req.user!.userId, targetUserId);

  // AUDIT-1b: tutti i bundle multi-device restituiti (usato per 1:1, non gruppi)
  logger.info({
    requesterId: req.user!.userId,
    targetUserId,
    bundleCount: bundles.length,
    bundles: bundles.map((b) => ({
      deviceId: b.deviceId,
      signedPreKeyId: b.signedPreKeyId,
      hasOtpk: b.oneTimePreKey !== null,
      otpkKeyId: b.oneTimePreKey?.keyId ?? null,
    })),
  }, "[SIGNAL-AUDIT] fetchAllBundles → bundle consegnati");

  res.json({ success: true, data: bundles });
};

/** GET /api/v1/keys/devices — elenco device corrente */
export const listDevices: RequestHandler = async (req, res) => {
  const devices = await service.listDevices(req.user!.userId);
  res.json({ success: true, data: devices });
};

/** DELETE /api/v1/keys/devices/:deviceId — revoca un device */
export const revokeDevice: RequestHandler = async (req, res) => {
  const deviceId = Array.isArray(req.params["deviceId"])
    ? req.params["deviceId"][0]
    : req.params["deviceId"];

  if (!deviceId) {
    res.status(400).json({ error: "deviceId mancante" });
    return;
  }

  await service.revokeDevice(req.user!.userId, deviceId);
  res.json({ success: true });
};
