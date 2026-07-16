/**
 * Schemi di validazione Zod per le API Media.
 * Sprint 11: upload audio per messaggi vocali.
 * Sprint 13: foto, video, documenti — limiti per tipo.
 */

import { z } from "zod";

// AES-256-GCM aggiunge 16 byte di authentication tag al ciphertext.
// I limiti vengono applicati al ciphertext (non al plaintext originale),
// quindi dobbiamo aggiungere 16 B per permettere file esattamente al limite dichiarato.
const GCM_TAG_BYTES = 16;

// Limiti per tipo MIME (plaintext max + GCM tag)
const LIMITS: Record<string, number> = {
  audio:    5  * 1024 * 1024 + GCM_TAG_BYTES,  // 5 MB plaintext
  image:    10 * 1024 * 1024 + GCM_TAG_BYTES,  // 10 MB plaintext
  video:    15 * 1024 * 1024 + GCM_TAG_BYTES,  // 15 MB plaintext
  document: 10 * 1024 * 1024 + GCM_TAG_BYTES,  // 10 MB plaintext (application/*, text/*)
};

const ALLOWED_MIME_PREFIXES = ["audio/", "image/", "video/", "application/", "text/plain"];

function mimeCategory(mime: string): keyof typeof LIMITS | "document" {
  if (mime.startsWith("audio/"))  return "audio";
  if (mime.startsWith("image/"))  return "image";
  if (mime.startsWith("video/"))  return "video";
  return "document";
}

export const UploadMediaSchema = z.object({
  /** Base64 del file */
  data: z
    .string()
    .min(1, "data obbligatorio"),

  /** MIME type del file */
  mime_type: z
    .string()
    .min(1)
    .max(128)
    .refine(
      (s) => ALLOWED_MIME_PREFIXES.some((p) => s.startsWith(p)),
      "Tipo file non supportato",
    ),

  /** ID conversazione */
  conversation_id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "conversation_id deve essere ObjectId"),

  /** Nome file originale */
  original_filename: z
    .string()
    .max(255)
    .optional()
    .default(""),

  /** Thumbnail JPEG (base64) — generata dal client per image/video */
  thumbnail: z
    .string()
    .optional()
    .default(""),

  /** Durata in millisecondi (per audio/video) */
  duration_ms: z
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .nullable()
    .optional()
    .default(null),

  /** 50 valori 0-1 per la waveform (solo audio) */
  waveform: z
    .array(z.number().min(0).max(1))
    .max(100)
    .optional()
    .default([]),
}).superRefine((val, ctx) => {
  try {
    const bytes = Buffer.from(val.data, "base64").length;
    const cat   = mimeCategory(val.mime_type);
    const limit = LIMITS[cat] ?? LIMITS.document;
    if (bytes > limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `File troppo grande per tipo ${cat} (max ${limit / 1024 / 1024}MB)`,
        path: ["data"],
      });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "data non è base64 valido", path: ["data"] });
  }
});

export type UploadMediaInput = z.infer<typeof UploadMediaSchema>;

export const MediaIdParamSchema = z.object({
  mediaId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "mediaId deve essere ObjectId"),
});

export type MediaIdParam = z.infer<typeof MediaIdParamSchema>;
