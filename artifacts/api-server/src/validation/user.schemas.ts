/**
 * Schemi di validazione Zod per i moduli User.
 * Conformi a 06_API.md.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// GET /api/v1/users/search
// ---------------------------------------------------------------------------

export const UserSearchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Ricerca minimo 2 caratteri")
    .max(30, "Ricerca massimo 30 caratteri"),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(50)),
  cursor: z.string().optional(), // ObjectId dell'ultimo risultato (paginazione)
});

export type UserSearchInput = z.infer<typeof UserSearchSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/users/:username — params
// ---------------------------------------------------------------------------

export const UsernameParamSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_.]+$/),
});

export type UsernameParamInput = z.infer<typeof UsernameParamSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/me
// ---------------------------------------------------------------------------
export const UpdateMeSchema = z.object({
  display_name: z.string().min(1).max(60).optional(),
  /** Data URL base64 JPEG — max 200 KB (client li comprime prima di inviare). */
  avatar_url: z.string().max(300_000).nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;
