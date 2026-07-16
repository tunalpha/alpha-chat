/**
 * Signal Key Distribution Routes — /api/v1/keys
 *
 * Tutte le route richiedono autenticazione.
 * Il server gestisce solo materiale crittografico PUBBLICO.
 *
 * Routes:
 *   POST   /bundle                — carica bundle completo (post-registrazione)
 *   GET    /bundle/:userId        — recupera bundle per X3DH (inizia sessione con userId)
 *   GET    /count                 — controlla livello OTPK per rifornimento
 *   POST   /one-time-pre-keys     — rifornisce il pool di OTPKs
 *   PUT    /signed-pre-key        — ruota la Signed PreKey
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import {
  UploadKeyBundleSchema,
  ReplenishOneTimePreKeysSchema,
  RotateSignedPreKeySchema,
  FetchBundleParamSchema,
} from "../../validation/signal-key.schemas";
import {
  uploadBundle,
  fetchBundle,
  getKeyCount,
  replenishOneTimePreKeys,
  rotateSignedPreKey,
} from "../../controllers/signal-key-bundle.controller";

const router = Router();
router.use(authenticate);

/** Carica il bundle completo — chiamato una volta dopo registrazione */
router.post("/bundle", validate("body", UploadKeyBundleSchema), uploadBundle);

/** Recupera bundle di un utente per iniziare sessione X3DH */
router.get("/bundle/:userId", validate("params", FetchBundleParamSchema), fetchBundle);

/** Livello OTPK — usato dal client per decidere se rifornire */
router.get("/count", getKeyCount);

/** Rifornisce One-Time PreKeys */
router.post(
  "/one-time-pre-keys",
  validate("body", ReplenishOneTimePreKeysSchema),
  replenishOneTimePreKeys,
);

/** Ruota la Signed PreKey (ogni ~settimana) */
router.put(
  "/signed-pre-key",
  validate("body", RotateSignedPreKeySchema),
  rotateSignedPreKey,
);

export default router;
