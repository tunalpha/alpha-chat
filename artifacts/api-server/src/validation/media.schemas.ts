/**
 * Schemi di validazione Zod per le API Media.
 *
 * Upload: multipart/form-data — il file arriva via req.file (multer).
 * I campi metadata arrivano come text fields nel FormData (req.body).
 *
 * Sprint 11: audio vocale. Sprint 13: foto, video, documenti.
 * Sprint 29: migrazione R2 — rimozione campo data base64.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// UploadMediaMetaSchema — metadata non-file dal FormData (req.body)
// ---------------------------------------------------------------------------

export const UploadMediaMetaSchema = z.object({
  /**
   * Chiave di idempotenza client (UUID v4).
   * Il server restituisce il documento esistente (HTTP 200) se già presente.
   */
  client_upload_id: z
    .string()
    .uuid("client_upload_id deve essere un UUID v4 valido")
    .optional(),

  /** MIME type dichiarato dal client */
  mime_type: z
    .string()
    .min(1)
    .max(128),

  /** ID conversazione (ObjectId MongoDB) */
  conversation_id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "conversation_id deve essere ObjectId"),

  /** Nome file originale */
  original_filename: z
    .string()
    .max(255)
    .optional()
    .default(""),

  /**
   * Thumbnail cifrata (base64 AES-256-GCM) — generata dal client.
   * Dimensione piccola (max 240×240 JPEG), trasmessa come text field.
   */
  thumbnail: z
    .string()
    .optional()
    .default(""),

  /**
   * Durata in ms (audio/video).
   * FormData invia stringhe — z.coerce converte automaticamente.
   */
  duration_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .nullable()
    .optional()
    .default(null),

  /**
   * Waveform: 50 valori 0-1.
   * FormData invia JSON string — preprocessata con JSON.parse.
   */
  waveform: z.preprocess(
    (v) => {
      if (typeof v === "string" && v.length > 0) {
        try { return JSON.parse(v); } catch { return []; }
      }
      return Array.isArray(v) ? v : [];
    },
    z.array(z.number().min(0).max(1)).max(100).optional().default([]),
  ),
});

export type UploadMediaMeta = z.infer<typeof UploadMediaMetaSchema>;

// ---------------------------------------------------------------------------
// MediaIdParamSchema — param :mediaId nelle route GET
// ---------------------------------------------------------------------------

export const MediaIdParamSchema = z.object({
  mediaId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "mediaId deve essere ObjectId"),
});

export type MediaIdParam = z.infer<typeof MediaIdParamSchema>;
