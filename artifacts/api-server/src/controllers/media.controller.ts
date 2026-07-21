/**
 * MediaController — strato HTTP per upload e download media.
 *
 * Sprint 11: audio. Sprint 13: foto, video, documenti, thumbnail.
 * Sprint 29: migrazione R2 — upload via multer multipart, download via Signed URL.
 */

import type { RequestHandler } from "express";
import * as mediaService from "../services/media.service";
import { successResponse } from "../utils/response";
import type { UploadMediaMeta, MediaIdParam } from "../validation/media.schemas";

// ---------------------------------------------------------------------------
// POST /api/v1/media — Upload file (multipart/form-data)
// ---------------------------------------------------------------------------

export const uploadMedia: RequestHandler = async (req, res, next) => {
  try {
    // req.file è popolato da multer (memorystorage)
    if (!req.file) {
      res.status(400).json({ error: { code: "FILE_MISSING", message: "Campo 'file' obbligatorio nel multipart" } });
      return;
    }

    const meta       = req.body as UploadMediaMeta;
    const uploaderId = req.user!.userId;

    const result = await mediaService.uploadMedia(uploaderId, meta, req.file, {
      requestId: req.requestId,
    });

    // HTTP 200 se il documento esisteva già (retry idempotente), 201 se appena creato.
    const status = result.already_existed ? 200 : 201;
    res.status(status).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/media/:mediaId — Restituisce Signed URL per download diretto da R2
// ---------------------------------------------------------------------------

export const getMedia: RequestHandler = async (req, res, next) => {
  try {
    const { mediaId } = req.params as unknown as MediaIdParam;
    const userId      = req.user!.userId;

    const result = await mediaService.getMediaSignedUrl(userId, mediaId);

    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/media/:mediaId/thumbnail — Signed URL per la thumbnail
// ---------------------------------------------------------------------------

export const getMediaThumbnail: RequestHandler = async (req, res, next) => {
  try {
    const { mediaId } = req.params as unknown as MediaIdParam;
    const userId      = req.user!.userId;

    const result = await mediaService.getThumbnailSignedUrl(userId, mediaId);

    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};
