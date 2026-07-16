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
