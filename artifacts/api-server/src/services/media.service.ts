/**
 * MediaService — logica di business per upload e download di file multimediali.
 * Sprint 11: messaggi vocali.
 * Sprint 13: foto, video, documenti — thumbnail, filename, Secure Destroy.
 */

import mongoose from "mongoose";
import { spawn, execSync } from "child_process";
import { AppError } from "../errors/AppError";
import { MediaRepository } from "../repositories/media.repository";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { logAuditEvent } from "../lib/audit";
import type { UploadMediaInput } from "../validation/media.schemas";

// ---------------------------------------------------------------------------
// Audio transcoding — webm/opus → mp4/aac via ffmpeg
// ---------------------------------------------------------------------------

/**
 * Path assoluto di ffmpeg risolto all'avvio.
 * In produzione Replit il processo non eredita /nix/store nel PATH →
 * spawn("ffmpeg") fallisce con ENOENT. Usiamo il path assoluto da `which`.
 */
const FFMPEG_BIN: string = (() => {
  try { return execSync("which ffmpeg", { encoding: "utf8" }).trim(); }
  catch { return "ffmpeg"; }
})();

/**
 * Trascrive webm/opus → mp4/aac via ffmpeg (pipe I/O, nessun file temporaneo).
 * Risolve la non-compatibilità di iOS Safari con il codec opus.
 */
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

export interface MediaUploadResult {
  media_id:          string;
  size:              number;
  mime_type:         string;
  original_filename: string | null;
  has_thumbnail:     boolean;
  duration_ms:       number | null;
  waveform:          number[];
  /** true se il documento esisteva già (retry idempotente — nessuna scrittura su DB) */
  already_existed?:  boolean;
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

  // 2. Idempotenza: se il client ha fornito un client_upload_id, controlla se esiste già.
  //    Questo previene la creazione di documenti orfani duplicati quando il client fa
  //    retry dopo un timeout di rete (il server ha scritto su DB ma la risposta è andata persa).
  if (input.client_upload_id) {
    const existing = await mediaRepo.findByClientUploadId(input.client_upload_id, uploaderObjectId);
    if (existing) {
      logAuditEvent({
        event:      "MEDIA_UPLOAD_IDEMPOTENT_HIT",
        user_id:    uploaderId,
        request_id: context?.requestId,
        created_at: new Date().toISOString(),
        metadata:   { mediaId: existing._id.toString(), client_upload_id: input.client_upload_id },
      });
      return {
        media_id:          existing._id.toString(),
        size:              existing.size,
        mime_type:         existing.mime_type,
        original_filename: existing.original_filename,
        has_thumbnail:     !!existing.thumbnail,
        duration_ms:       existing.duration_ms,
        waveform:          existing.waveform,
        already_existed:   true,
      };
    }
  }

  // 3. Decodifica base64 → Buffer
  let buffer = Buffer.from(input.data, "base64");
  let effectiveMimeType = input.mime_type;

  // 3b. Trascodifica webm/opus → mp4/aac per compatibilità iOS Safari.
  //     Il blob ricevuto è cifrato AES-GCM; il mime_type è dichiarato dal client.
  //     Se il client dichiara webm/opus (Android) → trascriviamo lato server.
  //     Se ffmpeg fallisce → fall-through con buffer originale (audio non perso).
  if (effectiveMimeType.startsWith("audio/webm") || effectiveMimeType.includes("opus")) {
    try {
      buffer = await transcodeWebmToMp4(buffer);
      effectiveMimeType = "audio/mp4";
    } catch (err) {
      logAuditEvent({
        event: "MEDIA_TRANSCODE_FAILED", user_id: uploaderId,
        request_id: context?.requestId, created_at: new Date().toISOString(),
        metadata: { ffmpeg: FFMPEG_BIN, mime: effectiveMimeType, error: String(err) },
      });
    }
  }

  // 4. Decodifica thumbnail se presente
  const thumbnailBuf = input.thumbnail
    ? Buffer.from(input.thumbnail, "base64")
    : null;

  // 5. Salva — con gestione race condition
  //
  // Problema: la sequenza findByClientUploadId → create non è atomica.
  // Due richieste identiche in parallelo passano entrambe il check "existing == null"
  // e tentano entrambe di inserire il documento. MongoDB garantisce l'unicità
  // tramite l'indice su client_upload_id, quindi una delle due riceve E11000.
  //
  // Soluzione: catch dell'E11000 → recupera il documento già inserito dall'altra
  // richiesta e restituiscilo come se fosse un hit idempotente.
  // In questo modo il client riceve comunque un media_id valido e nessun orfano
  // viene creato, indipendentemente dal timing tra i due upload paralleli.
  let media;
  try {
    media = await mediaRepo.create({
      uploaderId:       uploaderObjectId,
      conversationId:   convObjectId,
      mimeType:         effectiveMimeType,
      data:             buffer,
      size:             buffer.length,
      originalFilename: input.original_filename || null,
      thumbnail:        thumbnailBuf,
      durationMs:       input.duration_ms ?? null,
      waveform:         input.waveform ?? [],
      clientUploadId:   input.client_upload_id ?? null,
    });
  } catch (err: unknown) {
    // E11000: duplicate key — race condition sulla client_upload_id
    const isE11000 =
      typeof err === "object" && err !== null &&
      (err as { code?: number }).code === 11000;

    if (isE11000 && input.client_upload_id) {
      const race = await mediaRepo.findByClientUploadId(input.client_upload_id, uploaderObjectId);
      if (race) {
        logAuditEvent({
          event:      "MEDIA_UPLOAD_RACE_RESOLVED",
          user_id:    uploaderId,
          request_id: context?.requestId,
          created_at: new Date().toISOString(),
          metadata:   { mediaId: race._id.toString(), client_upload_id: input.client_upload_id },
        });
        return {
          media_id:          race._id.toString(),
          size:              race.size,
          mime_type:         race.mime_type,
          original_filename: race.original_filename,
          has_thumbnail:     !!race.thumbnail,
          duration_ms:       race.duration_ms,
          waveform:          race.waveform,
          already_existed:   true,
        };
      }
    }
    throw err; // E11000 senza client_upload_id, o doc già cancellato: propaga
  }

  logAuditEvent({
    event:      "MEDIA_UPLOADED",
    user_id:    uploaderId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata:   {
      mediaId:          media._id.toString(),
      conversationId:   input.conversation_id,
      mime_type:        input.mime_type,
      size:             buffer.length,
      has_thumbnail:    !!thumbnailBuf,
      client_upload_id: input.client_upload_id ?? null,
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
    already_existed:   false,
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
