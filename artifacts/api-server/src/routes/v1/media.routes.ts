/**
 * Media routes — montate su /api/v1/media
 *
 * Sprint 29: upload cambiato da JSON base64 a multipart/form-data (multer).
 * Il file binario arriva come req.file; i campi metadata come req.body (text fields).
 */

import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { UploadMediaMetaSchema, MediaIdParamSchema } from "../../validation/media.schemas";
import { uploadMedia, getMedia, getMediaThumbnail, downloadMedia, downloadMediaThumbnail } from "../../controllers/media.controller";

const router = Router();

// Multer: memoryStorage — il file Buffer è in req.file.buffer
// Limite: 100 MB + 16 B (GCM tag) — il massimo tra tutti i tipi (video).
// La validazione per tipo avviene nel service dopo aver letto il mime_type dal FormData.
const MAX_FILE_BYTES = 100 * 1024 * 1024 + 16;
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_BYTES },
});

router.use(authenticate);

/** POST /api/v1/media — Upload file (multipart/form-data, campo "file") */
router.post(
  "/",
  upload.single("file"),
  validate("body", UploadMediaMetaSchema),
  uploadMedia,
);

/** GET /api/v1/media/:mediaId — Signed URL per download diretto da R2 (legacy) */
router.get("/:mediaId", validate("params", MediaIdParamSchema), getMedia);

/** GET /api/v1/media/:mediaId/download — Proxy R2 → client (no CORS issues) */
router.get("/:mediaId/download", validate("params", MediaIdParamSchema), downloadMedia);

/** GET /api/v1/media/:mediaId/thumbnail — Signed URL per thumbnail (legacy) */
router.get("/:mediaId/thumbnail", validate("params", MediaIdParamSchema), getMediaThumbnail);

/** GET /api/v1/media/:mediaId/thumbnail/download — Proxy thumbnail R2 → client */
router.get("/:mediaId/thumbnail/download", validate("params", MediaIdParamSchema), downloadMediaThumbnail);

export default router;
