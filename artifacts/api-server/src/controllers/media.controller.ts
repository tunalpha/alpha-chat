/**
 * MediaController — strato HTTP per upload e download media.
 * Sprint 11: audio. Sprint 13: foto, video, documenti, thumbnail.
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
    const input      = req.body as UploadMediaInput;
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
    const userId      = req.user!.userId;

    const result = await mediaService.getMedia(userId, mediaId);

    const filename = result.original_filename
      ? encodeURIComponent(result.original_filename)
      : "file";

    res
      .status(200)
      .setHeader("Content-Type",   result.mime_type)
      .setHeader("Content-Length", result.size)
      .setHeader("Cache-Control",  "private, max-age=86400")
      .setHeader("Content-Disposition", `inline; filename="${filename}"`)
      .send(result.data);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/media/:mediaId/thumbnail
// ---------------------------------------------------------------------------

export const getMediaThumbnail: RequestHandler = async (req, res, next) => {
  try {
    const { mediaId } = req.params as unknown as MediaIdParam;
    const userId      = req.user!.userId;

    const result = await mediaService.getThumbnail(userId, mediaId);

    res
      .status(200)
      .setHeader("Content-Type",   result.mime_type)
      .setHeader("Content-Length", result.data.length)
      .setHeader("Cache-Control",  "private, max-age=604800") // 7 giorni — thumbnail stabile
      .send(result.data);
  } catch (err) {
    next(err);
  }
};
