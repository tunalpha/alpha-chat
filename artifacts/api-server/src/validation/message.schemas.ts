/**
 * Schemi di validazione Zod per le API Messages.
 * Conformi a 06_API.md Sprint 6.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// POST /api/v1/conversations/:conversationId/messages
// ---------------------------------------------------------------------------

export const SendMessageSchema = z.object({
  /** UUID v4 generato dal client — garantisce idempotenza */
  client_message_id: z
    .string()
    .uuid("client_message_id deve essere UUID v4"),

  message_type: z.enum(["text", "media", "reply", "forward"], {
    errorMap: () => ({ message: "message_type non valido" }),
  }),

  /**
   * Ciphertext base64 — opaco al server (Signal Protocol).
   * Il server non decodifica mai questo campo.
   */
  ciphertext: z
    .string()
    .min(1, "ciphertext obbligatorio")
    .max(65536, "ciphertext troppo lungo"),

  /** Signal Protocol message type: 1=PreKeyWhisperMessage, 2=WhisperMessage */
  ciphertext_type: z
    .number()
    .int()
    .min(1)
    .max(2),

  /**
   * ID della chiave SPK/OPK usata per la cifratura.
   * M1: null accettato (libsignal non ancora implementato).
   * M2: campo obbligatorio positivo quando Signal Protocol è attivo.
   */
  sender_key_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .default(null),

  /** Timestamp di invio dal client (ISO 8601) */
  sent_at: z
    .string()
    .datetime({ message: "sent_at deve essere ISO 8601" })
    .optional()
    .transform((v) => (v ? new Date(v) : new Date())),

  /** Solo per message_type: 'reply' */
  reply_to_message_id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "reply_to_message_id deve essere ObjectId")
    .optional()
    .nullable()
    .default(null),

  /** Solo per message_type: 'media' — riferimento al documento Media */
  media_id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "media_id deve essere ObjectId")
    .optional()
    .nullable()
    .default(null),

  /**
   * Burn After Read (Sprint 15) — se true il server hard-delete il messaggio
   * non appena il destinatario lo legge.
   */
  burn_after_read: z.boolean().optional().default(false),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/conversations/:conversationId/messages
// ---------------------------------------------------------------------------

export const ListMessagesSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(100)),

  before_sequence: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().positive().optional()),

  after_sequence: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().positive().optional()),
});

export type ListMessagesInput = z.infer<typeof ListMessagesSchema>;

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

export const ConversationIdParamSchema = z.object({
  conversationId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "conversationId deve essere ObjectId"),
});

export type ConversationIdParam = z.infer<typeof ConversationIdParamSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/v1/conversations/:conversationId/messages/:messageId
// ---------------------------------------------------------------------------

export const EditMessageSchema = z.object({
  ciphertext: z
    .string()
    .min(1, "ciphertext obbligatorio")
    .max(65536, "ciphertext troppo lungo"),

  ciphertext_type: z
    .number()
    .int()
    .min(1)
    .max(2),
});

export type EditMessageInput = z.infer<typeof EditMessageSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/v1/conversations/:conversationId/messages/:messageId
// ---------------------------------------------------------------------------

export const DeleteMessageSchema = z.object({
  for_everyone: z.boolean().default(false),
});

export type DeleteMessageInput = z.infer<typeof DeleteMessageSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/v1/conversations/:conversationId/messages/:messageId/destroy
// ---------------------------------------------------------------------------
// Nessun body richiesto — il Secure Destroy è sempre totale e irreversibile.
// Il route usa MessageIdParamSchema per i params.

// ---------------------------------------------------------------------------
// Params: :messageId
// ---------------------------------------------------------------------------

export const MessageIdParamSchema = z.object({
  conversationId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "conversationId deve essere ObjectId"),
  messageId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "messageId deve essere ObjectId"),
});

export type MessageIdParam = z.infer<typeof MessageIdParamSchema>;
