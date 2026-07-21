/**
 * StorageService — Cloudflare R2 via AWS SDK v3 compatibile S3.
 *
 * Principi:
 *   - R2 gestisce tutti i file binari; MongoDB conserva solo i metadata.
 *   - Nessun file binario nel database.
 *   - Tutti i download avvengono tramite Signed URL (scadenza configurabile).
 *   - HEAD prima di ogni DELETE (evita errori su oggetti già assenti).
 *   - Upload R2 prima, MongoDB dopo; rollback delete su R2 se MongoDB fallisce.
 *   - Virus scan hook (disabilitato — punto di estensione futuro).
 *
 * Struttura bucket (prefissi logici):
 *   avatars/         — avatar utente/gruppo (plaintext)
 *   images/          — immagini E2E cifrate
 *   videos/          — video E2E cifrati
 *   audio/           — audio E2E cifrati
 *   documents/       — documenti E2E cifrati
 *   thumbnails/      — thumbnail E2E cifrate
 *   temp/            — upload interrotti (cleanup scheduler TTL 24h)
 */

import {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, randomUUID } from "crypto";
import { r2 } from "../lib/r2-client";
import { config } from "../config";
import { logger } from "../lib/logger";
import { R2EventModel, type R2EventType } from "../models/r2-event.model";
import { AppError } from "../errors/AppError";

// ---------------------------------------------------------------------------
// MIME → cartella prefisso
// ---------------------------------------------------------------------------

function folderForMime(mimeType: string): string {
  if (mimeType.startsWith("image/"))  return "images";
  if (mimeType.startsWith("video/"))  return "videos";
  if (mimeType.startsWith("audio/"))  return "audio";
  return "documents";
}

// ---------------------------------------------------------------------------
// Limite dimensione per tipo MIME (bytes, include GCM tag 16 B)
// ---------------------------------------------------------------------------

const GCM_TAG_BYTES = 16;

function sizeLimit(mimeType: string): number {
  if (mimeType.startsWith("image/"))  return config.upload.maxImageMb    * 1024 * 1024 + GCM_TAG_BYTES;
  if (mimeType.startsWith("video/"))  return config.upload.maxVideoMb    * 1024 * 1024 + GCM_TAG_BYTES;
  if (mimeType.startsWith("audio/"))  return config.upload.maxAudioMb    * 1024 * 1024 + GCM_TAG_BYTES;
  return config.upload.maxDocumentMb * 1024 * 1024 + GCM_TAG_BYTES;
}

// ---------------------------------------------------------------------------
// MIME whitelist (Modifica spec — include audio/webm per compatibilità voci)
// ---------------------------------------------------------------------------

const ALLOWED_MIMES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/gif",
  // audio — include tutti i formati iOS/Android/browser
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm",
  "audio/wav", "audio/x-wav", "audio/wave",  // iOS Safari registra come wav
  "audio/aac", "audio/x-aac",                // iOS AAC
  "audio/mp4;codecs=mp4a.40.2",
  "video/mp4",  "video/quicktime",
  "application/pdf",
]);

function isMimeAllowed(mimeType: string, forAvatar = false): boolean {
  if (forAvatar) return mimeType.startsWith("image/");
  // Accetta anche sotto-tipi con parametri (es. audio/webm;codecs=opus)
  const base = mimeType.split(";")[0]?.trim() ?? mimeType;
  return ALLOWED_MIMES.has(base) || ALLOWED_MIMES.has(mimeType);
}

// ---------------------------------------------------------------------------
// Event logging — fire-and-forget, mai bloccante
// ---------------------------------------------------------------------------

function logR2Event(params: {
  event_type:       R2EventType;
  status:           "success" | "error";
  uploader_id?:     string;
  conversation_id?: string;
  storage_key?:     string;
  file_size?:       number;
  mime_type?:       string;
  filename?:        string;
  duration_ms?:     number;
  error_message?:   string;
  error_code?:      string;
}): void {
  R2EventModel.create(params).catch((e) =>
    logger.warn({ e }, "R2EventModel.create failed (non-fatale)"),
  );
}

// ---------------------------------------------------------------------------
// Virus scan hook — disabilitato, punto di estensione futuro
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function virusScanHook(_buffer: Buffer, _mimeType: string): Promise<void> {
  // TODO: integrare ClamAV o servizio esterno
  // Se virus rilevato: throw new AppError("VIRUS_DETECTED", 422)
}

// ---------------------------------------------------------------------------
// uploadFile
// ---------------------------------------------------------------------------

export interface UploadFileResult {
  storageKey:     string;
  thumbnailKey:   string | null;
  bucket:         string;
  sha256:         string;
  ciphertextSize: number;
}

export async function uploadFile(params: {
  buffer:          Buffer;
  thumbnailBuffer: Buffer | null;
  mimeType:        string;
  /** true per avatar utente/gruppo (prefisso avatars/, nessuna scadenza data) */
  isAvatar?:       boolean;
  /** Contesto logging (opzionale) */
  uploaderId?:     string;
  conversationId?: string;
  filename?:       string;
}): Promise<UploadFileResult> {
  const { buffer, thumbnailBuffer, mimeType, isAvatar = false, uploaderId, conversationId, filename } = params;
  const t0 = Date.now();

  // Validazione MIME
  if (!isMimeAllowed(mimeType, isAvatar)) {
    logR2Event({ event_type: "UPLOAD", status: "error", uploader_id: uploaderId, conversation_id: conversationId, mime_type: mimeType, file_size: buffer.length, filename, error_message: `MIME_NOT_ALLOWED: ${mimeType}`, error_code: "MIME_NOT_ALLOWED" });
    throw new AppError("MIME_NOT_ALLOWED", 415, mimeType);
  }

  // Validazione dimensione
  const limit = sizeLimit(mimeType);
  if (buffer.length > limit) {
    const err = new Error("FILE_TOO_LARGE");
    logR2Event({ event_type: "UPLOAD", status: "error", uploader_id: uploaderId, conversation_id: conversationId, mime_type: mimeType, file_size: buffer.length, filename, error_message: "FILE_TOO_LARGE", error_code: "FILE_TOO_LARGE" });
    throw Object.assign(err, { statusCode: 413 });
  }

  // Virus scan hook
  await virusScanHook(buffer, mimeType);

  // Genera storageKey con prefisso temporale (organizzazione logica)
  const folder = isAvatar ? "avatars" : folderForMime(mimeType);
  const now     = new Date();
  const datePath = isAvatar
    ? ""
    : `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}/`;
  const storageKey = `${folder}/${datePath}${randomUUID()}`;

  // SHA-256 del ciphertext
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const bucket = config.r2.bucket;

  // PutObject: file principale
  await r2.send(new PutObjectCommand({
    Bucket:        bucket,
    Key:           storageKey,
    Body:          buffer,
    ContentType:   mimeType,
    ContentLength: buffer.length,
    CacheControl:  "private, no-cache, no-store",
    Metadata:      { sha256, source: "alphachat" },
  }));

  logger.info({ storageKey, size: buffer.length, mimeType }, "R2 upload ok");
  logR2Event({ event_type: "UPLOAD", status: "success", uploader_id: uploaderId, conversation_id: conversationId, storage_key: storageKey, file_size: buffer.length, mime_type: mimeType, filename, duration_ms: Date.now() - t0 });

  // Thumbnail (opzionale — piccola, diverso prefisso)
  let thumbnailKey: string | null = null;
  if (thumbnailBuffer && thumbnailBuffer.length > 0) {
    thumbnailKey = `thumbnails/${datePath}${randomUUID()}`;
    await r2.send(new PutObjectCommand({
      Bucket:        bucket,
      Key:           thumbnailKey,
      Body:          thumbnailBuffer,
      ContentType:   "image/jpeg",
      ContentLength: thumbnailBuffer.length,
      CacheControl:  "private, max-age=604800",
    }));
    logger.info({ thumbnailKey, size: thumbnailBuffer.length }, "R2 thumbnail upload ok");
  }

  return { storageKey, thumbnailKey, bucket, sha256, ciphertextSize: buffer.length };
}

// ---------------------------------------------------------------------------
// fileExists (HEAD)
// ---------------------------------------------------------------------------

export async function fileExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: config.r2.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// deleteFile — HEAD prima di DELETE
// ---------------------------------------------------------------------------

export async function deleteFile(key: string): Promise<void> {
  const t0 = Date.now();
  const exists = await fileExists(key);
  if (!exists) {
    logger.warn({ key }, "R2 deleteFile: oggetto non trovato, skip");
    return;
  }
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }));
    logger.info({ key }, "R2 delete ok");
    logR2Event({ event_type: "DELETE", status: "success", storage_key: key, duration_ms: Date.now() - t0 });
  } catch (err) {
    logger.error({ key, err }, "R2 delete fallito");
    logR2Event({ event_type: "DELETE", status: "error", storage_key: key, duration_ms: Date.now() - t0, error_message: (err as Error).message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getSignedDownloadUrl
// ---------------------------------------------------------------------------

export async function getSignedDownloadUrl(
  key: string,
  ttlSeconds: number = config.r2.signedUrlTtl,
): Promise<string> {
  const t0 = Date.now();
  try {
    const cmd = new GetObjectCommand({ Bucket: config.r2.bucket, Key: key });
    const url = await getSignedUrl(r2, cmd, { expiresIn: ttlSeconds });
    logR2Event({ event_type: "SIGNED_URL", status: "success", storage_key: key, duration_ms: Date.now() - t0 });
    return url;
  } catch (err) {
    logR2Event({ event_type: "SIGNED_URL", status: "error", storage_key: key, duration_ms: Date.now() - t0, error_message: (err as Error).message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// cleanupTempObjects — usato dallo scheduler
// ---------------------------------------------------------------------------

export async function cleanupTempObjects(maxAgeMs = 24 * 60 * 60 * 1_000): Promise<number> {
  const t0 = Date.now();
  const cutoff = new Date(Date.now() - maxAgeMs);
  let deleted = 0;
  let continuationToken: string | undefined;

  try {
    do {
      const resp = await r2.send(new ListObjectsV2Command({
        Bucket:            config.r2.bucket,
        Prefix:            "temp/",
        ContinuationToken: continuationToken,
      }));

      for (const obj of (resp.Contents ?? [])) {
        if (obj.Key && obj.LastModified && obj.LastModified < cutoff) {
          await r2.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: obj.Key }));
          logger.info({ key: obj.Key }, "R2 temp/ cleanup: oggetto eliminato");
          deleted++;
        }
      }

      continuationToken = resp.IsTruncated ? (resp.NextContinuationToken ?? undefined) : undefined;
    } while (continuationToken);

    logR2Event({ event_type: "CLEANUP", status: "success", duration_ms: Date.now() - t0, file_size: deleted });
    return deleted;
  } catch (err) {
    logR2Event({ event_type: "CLEANUP", status: "error", duration_ms: Date.now() - t0, error_message: (err as Error).message });
    throw err;
  }
}
