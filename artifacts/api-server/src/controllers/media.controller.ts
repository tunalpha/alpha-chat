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
// GET /api/v1/media/:mediaId — Signed URL per download diretto da R2 (legacy)
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
// GET /api/v1/media/:mediaId/download — Proxy R2 → client (no CORS needed)
// Scarica i byte cifrati da R2 server-side e li restituisce al browser.
// ---------------------------------------------------------------------------

export const downloadMedia: RequestHandler = async (req, res, next) => {
  try {
    const { mediaId } = req.params as unknown as MediaIdParam;
    const userId      = req.user!.userId;

    const { buffer, mimeType } = await mediaService.downloadMediaBuffer(userId, mediaId);

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, max-age=300, immutable");
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/media/:mediaId/thumbnail — Signed URL per la thumbnail (legacy)
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

// ---------------------------------------------------------------------------
// GET /api/v1/media/:mediaId/thumbnail/download — Proxy thumbnail R2 → client
// ---------------------------------------------------------------------------

export const downloadMediaThumbnail: RequestHandler = async (req, res, next) => {
  try {
    const { mediaId } = req.params as unknown as MediaIdParam;
    const userId      = req.user!.userId;

    const { buffer, mimeType } = await mediaService.downloadThumbnailBuffer(userId, mediaId);

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, max-age=300, immutable");
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
};
