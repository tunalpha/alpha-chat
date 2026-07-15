/**
 * Schemi di validazione Zod per le API Media.
 * Sprint 11: upload audio per messaggi vocali.
 */

import { z } from "zod";

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const UploadMediaSchema = z.object({
  /** Base64 del file audio */
  data: z
    .string()
    .min(1, "data obbligatorio")
    .refine(
      (s) => {
        try { return Buffer.from(s, "base64").length <= MAX_SIZE_BYTES; }
        catch { return false; }
      },
      "File troppo grande (max 5MB)",
    ),

  /** MIME type, es. "audio/webm;codecs=opus", "audio/mp4" */
  mime_type: z
    .string()
    .min(1)
    .max(128)
    .refine((s) => s.startsWith("audio/"), "Solo file audio supportati in Sprint 11"),

  /** ID conversazione a cui appartiene il media */
  conversation_id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "conversation_id deve essere ObjectId"),

  /** Durata in millisecondi */
  duration_ms: z
    .number()
    .int()
    .min(0)
    .max(600_000) // max 10 minuti
    .nullable()
    .optional()
    .default(null),

  /** 50 valori 0-1 per la waveform */
  waveform: z
    .array(z.number().min(0).max(1))
    .max(100)
    .optional()
    .default([]),
});

export type UploadMediaInput = z.infer<typeof UploadMediaSchema>;

export const MediaIdParamSchema = z.object({
  mediaId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "mediaId deve essere ObjectId"),
});

export type MediaIdParam = z.infer<typeof MediaIdParamSchema>;
