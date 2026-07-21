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
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "audio/ogg",  "audio/mpeg", "audio/mp4", "audio/webm", "audio/mp4;codecs=mp4a.40.2",
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
}): Promise<UploadFileResult> {
  const { buffer, thumbnailBuffer, mimeType, isAvatar = false } = params;

  // Validazione MIME
  if (!isMimeAllowed(mimeType, isAvatar)) {
    const err = new Error(`MIME_NOT_ALLOWED: ${mimeType}`);
    (err as NodeJS.ErrnoException).code = "MIME_NOT_ALLOWED";
    throw Object.assign(err, { statusCode: 415 });
  }

  // Validazione dimensione
  const limit = sizeLimit(mimeType);
  if (buffer.length > limit) {
    const err = new Error("FILE_TOO_LARGE");
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
  // Modifica 6: HEAD prima del DELETE
  const exists = await fileExists(key);
  if (!exists) {
    logger.warn({ key }, "R2 deleteFile: oggetto non trovato, skip");
    return;
  }
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }));
    logger.info({ key }, "R2 delete ok");
  } catch (err) {
    logger.error({ key, err }, "R2 delete fallito");
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
  const cmd = new GetObjectCommand({ Bucket: config.r2.bucket, Key: key });
  return getSignedUrl(r2, cmd, { expiresIn: ttlSeconds });
}

// ---------------------------------------------------------------------------
// cleanupTempObjects — usato dallo scheduler
// ---------------------------------------------------------------------------

export async function cleanupTempObjects(maxAgeMs = 24 * 60 * 60 * 1_000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  let deleted = 0;
  let continuationToken: string | undefined;

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

  return deleted;
}
