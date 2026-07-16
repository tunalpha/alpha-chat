/**
 * MediaService — logica di business per upload e download di file multimediali.
 * Sprint 11: messaggi vocali.
 * Sprint 13: foto, video, documenti — thumbnail, filename, Secure Destroy.
 */

import mongoose from "mongoose";
import { AppError } from "../errors/AppError";
import { MediaRepository } from "../repositories/media.repository";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { logAuditEvent } from "../lib/audit";
import type { UploadMediaInput } from "../validation/media.schemas";

export interface MediaUploadResult {
  media_id:          string;
  size:              number;
  mime_type:         string;
  original_filename: string | null;
  has_thumbnail:     boolean;
  duration_ms:       number | null;
  waveform:          number[];
}

const mediaRepo  = new MediaRepository();
const memberRepo = new ConversationMemberRepository();

// ---------------------------------------------------------------------------
// uploadMedia
// ---------------------------------------------------------------------------

/**
 * Carica un file media verificando che l'uploader sia membro attivo
 * della conversazione. Supporta audio, immagini, video, documenti.
 */
export async function uploadMedia(
  uploaderId: string,
  input: UploadMediaInput,
  context?: { requestId?: string },
): Promise<MediaUploadResult> {
  const uploaderObjectId = new mongoose.Types.ObjectId(uploaderId);
  const convObjectId     = new mongoose.Types.ObjectId(input.conversation_id);

  // 1. Verifica membership
  const membership = await memberRepo.findMembership(convObjectId, uploaderObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  // 2. Decodifica base64 → Buffer
  const buffer = Buffer.from(input.data, "base64");

  // 3. Decodifica thumbnail se presente
  const thumbnailBuf = input.thumbnail
    ? Buffer.from(input.thumbnail, "base64")
    : null;

  // 4. Salva
  const media = await mediaRepo.create({
    uploaderId:       uploaderObjectId,
    conversationId:   convObjectId,
    mimeType:         input.mime_type,
    data:             buffer,
    size:             buffer.length,
    originalFilename: input.original_filename || null,
    thumbnail:        thumbnailBuf,
    durationMs:       input.duration_ms ?? null,
    waveform:         input.waveform ?? [],
  });

  logAuditEvent({
    event:      "MEDIA_UPLOADED",
    user_id:    uploaderId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata:   {
      mediaId:        media._id.toString(),
      conversationId: input.conversation_id,
      mime_type:      input.mime_type,
      size:           buffer.length,
      has_thumbnail:  !!thumbnailBuf,
    },
  });

  return {
    media_id:          media._id.toString(),
    size:              media.size,
    mime_type:         media.mime_type,
    original_filename: media.original_filename,
    has_thumbnail:     !!media.thumbnail,
    duration_ms:       media.duration_ms,
    waveform:          media.waveform,
  };
}

// ---------------------------------------------------------------------------
// getMedia
// ---------------------------------------------------------------------------

export interface MediaDownloadResult {
  data:              Buffer;
  mime_type:         string;
  size:              number;
  original_filename: string | null;
}

/**
 * Scarica il file completo verificando membership.
 */
export async function getMedia(
  userId: string,
  mediaId: string,
): Promise<MediaDownloadResult> {
  const userObjectId  = new mongoose.Types.ObjectId(userId);
  const mediaObjectId = new mongoose.Types.ObjectId(mediaId);

  const media = await mediaRepo.findById(mediaObjectId);
  if (!media) throw new AppError("MEDIA_NOT_FOUND", 404);

  const membership = await memberRepo.findMembership(media.conversation_id, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  return {
    data:              media.data,
    mime_type:         media.mime_type,
    size:              media.size,
    original_filename: media.original_filename,
  };
}

// ---------------------------------------------------------------------------
// getThumbnail
// ---------------------------------------------------------------------------

export interface ThumbnailResult {
  data:      Buffer;
  mime_type: string;
}

/**
 * Restituisce la thumbnail JPEG del media (solo image/video).
 * Se non disponibile risponde 404.
 */
export async function getThumbnail(
  userId: string,
  mediaId: string,
): Promise<ThumbnailResult> {
  const userObjectId  = new mongoose.Types.ObjectId(userId);
  const mediaObjectId = new mongoose.Types.ObjectId(mediaId);

  const media = await mediaRepo.findById(mediaObjectId);
  if (!media) throw new AppError("MEDIA_NOT_FOUND", 404);
  if (!media.thumbnail) throw new AppError("THUMBNAIL_NOT_FOUND", 404);

  const membership = await memberRepo.findMembership(media.conversation_id, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  return { data: media.thumbnail, mime_type: "image/jpeg" };
}
