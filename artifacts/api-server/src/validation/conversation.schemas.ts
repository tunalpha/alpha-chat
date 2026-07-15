/**
 * Schemi di validazione Zod per le API Conversation.
 * Conformi a 06_API.md Sprint 5B.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// POST /api/v1/conversations
// ---------------------------------------------------------------------------

export const CreateConversationSchema = z.object({
  /**
   * Username dell'utente con cui aprire la chat diretta.
   * Il sistema cerca/crea la conversazione tra il chiamante e questo utente.
   */
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Username minimo 3 caratteri")
    .max(30, "Username massimo 30 caratteri")
    .regex(/^[a-z0-9_.]+$/, "Username non valido"),
});

export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/conversations (query params)
// ---------------------------------------------------------------------------

export const ListConversationsSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 30))
    .pipe(z.number().int().min(1).max(50)),
  cursor: z.string().optional(),
});

export type ListConversationsInput = z.infer<typeof ListConversationsSchema>;
