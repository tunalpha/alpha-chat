/**
 * MediaService — logica di business per upload e download di file multimediali.
 *
 * Sprint 11: messaggi vocali.
 * Sprint 13: foto, video, documenti — thumbnail, filename, Secure Destroy.
 * Sprint 29: migrazione Cloudflare R2 — nessun binario in MongoDB.
 *
 * Flusso upload (Modifica 1):
 *   1. Upload su R2
 *   2. Scrittura metadata su MongoDB
 *   3. Se MongoDB fallisce → rollback delete R2
 *
 * Flusso download:
 *   Il server genera un Signed URL (TTL configurabile) per il download diretto da R2.
 *   Il server non proxy i byte — banda gestita da Cloudflare.
 */

import mongoose from "mongoose";
import { spawn, execSync } from "child_process";
import { AppError } from "../errors/AppError";
import { MediaRepository } from "../repositories/media.repository";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { logAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";
import * as storageService from "./storage.service";
import type { UploadMediaMeta } from "../validation/media.schemas";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Audio transcoding — webm/opus → mp4/aac via ffmpeg
// (Solo per blob NON cifrati — voce legacy. I blob E2E cifrati sono opachi.)
// ---------------------------------------------------------------------------

const FFMPEG_BIN: string = (() => {
  try { return execSync("which ffmpeg", { encoding: "utf8" }).trim(); }
  catch { return "ffmpeg"; }
})();

function transcodeWebmToMp4(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, [
      "-i", "pipe:0",
      "-c:a", "aac", "-b:a", "96k", "-ac", "1",
      "-movflags", "+frag_keyframe+empty_moov",
      "-f", "mp4", "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stdout.on("end", () => {
      const out = Buffer.concat(chunks);
      if (out.length === 0) reject(new Error("ffmpeg: empty output"));
      else resolve(out);
    });
    proc.stderr.on("data", () => { /* noop */ });
    proc.on("error", reject);
    const t = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("ffmpeg: timeout")); }, 30_000);
    proc.on("close", () => clearTimeout(t));
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

export interface MediaUploadResult {
  media_id:          string;
  ciphertext_size:   number;
  mime_type:         string;
  original_filename: string | null;
  has_thumbnail:     boolean;
  duration_ms:       number | null;
  waveform:          number[];
  already_existed?:  boolean;
}

export interface MediaDownloadInfo {
  url:               string;
  expires_at:        string;
  mime_type:         string;
  ciphertext_size:   number;
  original_filename: string | null;
}

export interface ThumbnailDownloadInfo {
  url:        string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Istanze repository (singleton per file)
// ---------------------------------------------------------------------------

const mediaRepo  = new MediaRepository();
const memberRepo = new ConversationMemberRepository();

// ---------------------------------------------------------------------------
// uploadMedia
// ---------------------------------------------------------------------------

export async function uploadMedia(
  uploaderId: string,
  meta: UploadMediaMeta,
  file: Express.Multer.File,
  context?: { requestId?: string },
): Promise<MediaUploadResult> {
  const uploaderObjectId = new mongoose.Types.ObjectId(uploaderId);
  const convObjectId     = new mongoose.Types.ObjectId(meta.conversation_id);

  // 1. Verifica membership
  const membership = await memberRepo.findMembership(convObjectId, uploaderObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  // 2. Idempotenza: se client_upload_id è già nel DB, ritorna subito
  if (meta.client_upload_id) {
    const existing = await mediaRepo.findByClientUploadId(meta.client_upload_id, uploaderObjectId);
    if (existing) {
      logAuditEvent({
        event:      "MEDIA_UPLOAD_IDEMPOTENT_HIT",
        user_id:    uploaderId,
        request_id: context?.requestId,
        created_at: new Date().toISOString(),
        metadata:   { mediaId: existing._id.toString(), client_upload_id: meta.client_upload_id },
      });
      return {
        media_id:          existing._id.toString(),
        ciphertext_size:   existing.ciphertextSize,
        mime_type:         existing.mime_type,
        original_filename: existing.original_filename,
        has_thumbnail:     !!existing.thumbnailKey,
        duration_ms:       existing.duration_ms,
        waveform:          existing.waveform,
        already_existed:   true,
      };
    }
  }

  // 3. Buffer del file (da multer memoryStorage)
  let buffer: Buffer = file.buffer;
  let effectiveMimeType = meta.mime_type;

  // 3b. Trascodifica webm/opus → mp4/aac per compatibilità iOS Safari.
  //     I blob E2E cifrati sono opachi — ffmpeg fallisce silenziosamente e il
  //     buffer originale viene mantenuto (comportamento invariato vs pre-R2).
  if (effectiveMimeType.startsWith("audio/webm") || effectiveMimeType.includes("opus")) {
    try {
      buffer = await transcodeWebmToMp4(buffer);
      effectiveMimeType = "audio/mp4";
    } catch (err) {
      logger.warn({ uploaderId, ffmpeg: FFMPEG_BIN, mime: effectiveMimeType, err }, "media.service: trascodifica fallita, uso buffer originale");
    }
  }

  // 4. Decodifica thumbnail (base64 text field → Buffer, o null se assente)
  const thumbnailBuf = meta.thumbnail && meta.thumbnail.length > 0
    ? Buffer.from(meta.thumbnail, "base64")
    : null;

  // 5. UPLOAD R2 — prima del MongoDB (Modifica 1)
  const uploadedAt = new Date();
  let r2Result: Awaited<ReturnType<typeof storageService.uploadFile>>;
  try {
    r2Result = await storageService.uploadFile({
      buffer:          buffer,
      thumbnailBuffer: thumbnailBuf,
      mimeType:        effectiveMimeType,
      uploaderId:      uploaderId,
      conversationId:  meta.conversation_id,
      filename:        meta.original_filename,
    });
  } catch (err) {
    logger.error({ err }, "MEDIA_UPLOAD R2 fallito");
    throw err;
  }

  // 6. Salva metadata su MongoDB — con gestione race condition
  let media;
  try {
    media = await mediaRepo.create({
      uploaderId:        uploaderObjectId,
      conversationId:    convObjectId,
      mimeType:          effectiveMimeType,
      storageKey:        r2Result.storageKey,
      thumbnailKey:      r2Result.thumbnailKey,
      bucket:            r2Result.bucket,
      sha256:            r2Result.sha256,
      ciphertextSize:    r2Result.ciphertextSize,
      encryptionVersion: 1,
      originalFilename:  meta.original_filename || null,
      durationMs:        meta.duration_ms ?? null,
      waveform:          meta.waveform ?? [],
      clientUploadId:    meta.client_upload_id ?? null,
      uploadedAt,
    });
  } catch (err: unknown) {
    // 6a. MongoDB fallito → rollback: elimina i file da R2 (Modifica 1)
    const isE11000 =
      typeof err === "object" && err !== null &&
      (err as { code?: number }).code === 11000;

    if (!isE11000) {
      // Errore MongoDB non idempotente → rollback R2
      logger.warn({ storageKey: r2Result.storageKey }, "MongoDB fallito dopo R2 upload — rollback R2");
      await storageService.deleteFile(r2Result.storageKey).catch(
        (delErr: unknown) => logger.error({ delErr }, "Rollback R2 fallito — file orfano su temp/"),
      );
      if (r2Result.thumbnailKey) {
        await storageService.deleteFile(r2Result.thumbnailKey).catch(
          (delErr: unknown) => logger.error({ delErr, key: r2Result.thumbnailKey }, "Rollback thumbnail R2 fallito"),
        );
      }
      throw err;
    }

    // E11000: race condition su client_upload_id → recupera doc esistente
    if (isE11000 && meta.client_upload_id) {
      const race = await mediaRepo.findByClientUploadId(meta.client_upload_id, uploaderObjectId);
      if (race) {
        // Cleanup del file R2 appena caricato (il doc esistente ha il suo storageKey)
        await storageService.deleteFile(r2Result.storageKey).catch(() => {});
        if (r2Result.thumbnailKey) {
          await storageService.deleteFile(r2Result.thumbnailKey).catch(() => {});
        }
        logAuditEvent({
          event:      "MEDIA_UPLOAD_RACE_RESOLVED",
          user_id:    uploaderId,
          request_id: context?.requestId,
          created_at: new Date().toISOString(),
          metadata:   { mediaId: race._id.toString(), client_upload_id: meta.client_upload_id },
        });
        return {
          media_id:          race._id.toString(),
          ciphertext_size:   race.ciphertextSize,
          mime_type:         race.mime_type,
          original_filename: race.original_filename,
          has_thumbnail:     !!race.thumbnailKey,
          duration_ms:       race.duration_ms,
          waveform:          race.waveform,
          already_existed:   true,
        };
      }
    }
    throw err;
  }

  logAuditEvent({
    event:      "MEDIA_UPLOADED",
    user_id:    uploaderId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata:   {
      mediaId:          media._id.toString(),
      conversationId:   meta.conversation_id,
      mime_type:        effectiveMimeType,
      ciphertextSize:   r2Result.ciphertextSize,
      has_thumbnail:    !!thumbnailBuf,
      storageKey:       r2Result.storageKey,
      client_upload_id: meta.client_upload_id ?? null,
    },
  });

  return {
    media_id:          media._id.toString(),
    ciphertext_size:   media.ciphertextSize,
    mime_type:         media.mime_type,
    original_filename: media.original_filename,
    has_thumbnail:     !!media.thumbnailKey,
    duration_ms:       media.duration_ms,
    waveform:          media.waveform,
    already_existed:   false,
  };
}

// ---------------------------------------------------------------------------
// getMediaSignedUrl — download tramite Signed URL R2
// ---------------------------------------------------------------------------

export async function getMediaSignedUrl(
  userId: string,
  mediaId: string,
): Promise<MediaDownloadInfo> {
  const userObjectId  = new mongoose.Types.ObjectId(userId);
  const mediaObjectId = new mongoose.Types.ObjectId(mediaId);

  const media = await mediaRepo.findById(mediaObjectId);
  if (!media) throw new AppError("MEDIA_NOT_FOUND", 404);

  const membership = await memberRepo.findMembership(media.conversation_id, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  const url = await storageService.getSignedDownloadUrl(media.storageKey);
  const expiresAt = new Date(Date.now() + 1000 * 300).toISOString(); // approssimato al TTL default

  return {
    url,
    expires_at:        expiresAt,
    mime_type:         media.mime_type,
    ciphertext_size:   media.ciphertextSize,
    original_filename: media.original_filename,
  };
}

// ---------------------------------------------------------------------------
// getThumbnailSignedUrl
// ---------------------------------------------------------------------------

export async function getThumbnailSignedUrl(
  userId: string,
  mediaId: string,
): Promise<ThumbnailDownloadInfo> {
  const userObjectId  = new mongoose.Types.ObjectId(userId);
  const mediaObjectId = new mongoose.Types.ObjectId(mediaId);

  const media = await mediaRepo.findById(mediaObjectId);
  if (!media) throw new AppError("MEDIA_NOT_FOUND", 404);
  if (!media.thumbnailKey) throw new AppError("THUMBNAIL_NOT_FOUND", 404);

  const membership = await memberRepo.findMembership(media.conversation_id, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  const url = await storageService.getSignedDownloadUrl(media.thumbnailKey);
  const expiresAt = new Date(Date.now() + 1000 * 300).toISOString();

  return { url, expires_at: expiresAt };
}

// ---------------------------------------------------------------------------
// downloadMediaBuffer — proxy server-side: scarica bytes cifrati da R2
// Richiesto perché Cloudflare R2 non ha CORS configurabile via S3 API —
// il browser non può fare fetch cross-origin verso signed URL direttamente.
// ---------------------------------------------------------------------------

export async function downloadMediaBuffer(
  userId: string,
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const userObjectId  = new mongoose.Types.ObjectId(userId);
  const mediaObjectId = new mongoose.Types.ObjectId(mediaId);

  const media = await mediaRepo.findById(mediaObjectId);
  if (!media) throw new AppError("MEDIA_NOT_FOUND", 404);

  const membership = await memberRepo.findMembership(media.conversation_id, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  const { buffer } = await storageService.downloadFileBuffer(media.storageKey);
  return { buffer, mimeType: "application/octet-stream" }; // sempre opaco (cifrato AES)
}

export async function downloadThumbnailBuffer(
  userId: string,
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const userObjectId  = new mongoose.Types.ObjectId(userId);
  const mediaObjectId = new mongoose.Types.ObjectId(mediaId);

  const media = await mediaRepo.findById(mediaObjectId);
  if (!media) throw new AppError("MEDIA_NOT_FOUND", 404);
  if (!media.thumbnailKey) throw new AppError("THUMBNAIL_NOT_FOUND", 404);

  const membership = await memberRepo.findMembership(media.conversation_id, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  const { buffer } = await storageService.downloadFileBuffer(media.thumbnailKey);
  return { buffer, mimeType: "application/octet-stream" };
}

// ---------------------------------------------------------------------------
// deleteMediaFiles — elimina file R2 + documento MongoDB per un mediaId
// (usato da message.service su Secure Destroy)
// ---------------------------------------------------------------------------

export async function deleteMediaFiles(mediaId: mongoose.Types.ObjectId): Promise<void> {
  const media = await mediaRepo.findById(mediaId);
  if (!media) return; // già eliminato

  const deletes: Promise<void>[] = [];

  deletes.push(
    storageService.deleteFile(media.storageKey).catch(
      (err: unknown) => logger.warn({ err, storageKey: media.storageKey }, "R2 delete fallito su Secure Destroy"),
    ),
  );

  if (media.thumbnailKey) {
    deletes.push(
      storageService.deleteFile(media.thumbnailKey).catch(
        (err: unknown) => logger.warn({ err, thumbnailKey: media.thumbnailKey }, "R2 thumbnail delete fallito"),
      ),
    );
  }

  await Promise.all(deletes);
  await mediaRepo.hardDeleteById(mediaId);
}
