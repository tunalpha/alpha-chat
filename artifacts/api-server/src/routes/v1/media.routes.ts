/**
 * Media routes — /api/v1/media
 * Sprint 11: upload e download di file audio per messaggi vocali.
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { UploadMediaSchema, MediaIdParamSchema } from "../../validation/media.schemas";
import { uploadMedia, getMedia } from "../../controllers/media.controller";

const router = Router();

router.use(authenticate);

/**
 * POST /api/v1/media
 * Carica un file audio. Body: { data: base64, mime_type, conversation_id, duration_ms, waveform }.
 */
router.post("/", validate("body", UploadMediaSchema), uploadMedia);

/**
 * GET /api/v1/media/:mediaId
 * Scarica il file audio (raw binary, Content-Type appropriato).
 */
router.get("/:mediaId", validate("params", MediaIdParamSchema), getMedia);

export default router;
