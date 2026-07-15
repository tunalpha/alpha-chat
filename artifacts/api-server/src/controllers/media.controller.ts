/**
 * MediaController — strato HTTP per upload/download media.
 */

import type { RequestHandler } from "express";
import * as mediaService from "../services/media.service";
import { successResponse } from "../utils/response";
import type { UploadMediaInput, MediaIdParam } from "../validation/media.schemas";

// ---------------------------------------------------------------------------
// POST /api/v1/media
// ---------------------------------------------------------------------------

export const uploadMedia: RequestHandler = async (req, res, next) => {
  try {
    const input    = req.body as UploadMediaInput;
    const uploaderId = req.user!.userId;

    const result = await mediaService.uploadMedia(uploaderId, input, { requestId: req.requestId });
    res.status(201).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/media/:mediaId
// ---------------------------------------------------------------------------

export const getMedia: RequestHandler = async (req, res, next) => {
  try {
    const { mediaId } = req.params as unknown as MediaIdParam;
    const userId = req.user!.userId;

    const result = await mediaService.getMedia(userId, mediaId);

    res
      .status(200)
      .set("Content-Type", result.mime_type)
      .set("Content-Length", String(result.size))
      .set("Cache-Control", "private, max-age=86400")
      .send(result.data);
  } catch (err) {
    next(err);
  }
};
