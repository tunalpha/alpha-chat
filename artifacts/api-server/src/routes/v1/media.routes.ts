/**
 * Media routes — montate su /api/v1/media
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { UploadMediaSchema, MediaIdParamSchema } from "../../validation/media.schemas";
import { uploadMedia, getMedia, getMediaThumbnail } from "../../controllers/media.controller";

const router = Router();

router.use(authenticate);

/** POST /api/v1/media — Upload file (audio/image/video/document) */
router.post("/", validate("body", UploadMediaSchema), uploadMedia);

/** GET /api/v1/media/:mediaId — Download file completo */
router.get("/:mediaId", validate("params", MediaIdParamSchema), getMedia);

/** GET /api/v1/media/:mediaId/thumbnail — Thumbnail JPEG (image/video) */
router.get("/:mediaId/thumbnail", validate("params", MediaIdParamSchema), getMediaThumbnail);

export default router;
