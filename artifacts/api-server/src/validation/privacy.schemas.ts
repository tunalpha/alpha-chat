/**
 * Schemi di validazione Zod per le API Privacy (Sprint 15).
 *
 * Coprono:
 *   - Impostazioni privacy utente (show_last_seen, show_online_status, …)
 *   - Ghost Mode (toggle master)
 *   - Messaggi a scomparsa per conversazione
 *   - Blocco utenti
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/me/privacy
// ---------------------------------------------------------------------------

const visibilityEnum = z.enum(["everyone", "contacts", "nobody"]);

export const UpdatePrivacySchema = z.object({
  show_last_seen:          visibilityEnum.optional(),
  show_online_status:      visibilityEnum.optional(),
  show_read_receipts:      z.boolean().optional(),
  allow_adding_to_groups:  visibilityEnum.optional(),
  allow_calls_from:        visibilityEnum.optional(),
  /** Ghost Mode — imposta tutto al massimo della privacy in un colpo solo */
  ghost_mode:              z.boolean().optional(),
}).strict();

export type UpdatePrivacyInput = z.infer<typeof UpdatePrivacySchema>;

// ---------------------------------------------------------------------------
// PATCH /api/v1/conversations/:id/disappearing
// ---------------------------------------------------------------------------

/** Durate consentite in millisecondi (hardcoded lato server) */
const ALLOWED_DURATIONS_MS = [
  5 * 60 * 1_000,          // 5 minuti
  30 * 60 * 1_000,         // 30 minuti
  60 * 60 * 1_000,         // 1 ora
  24 * 60 * 60 * 1_000,    // 24 ore
  7 * 24 * 60 * 60 * 1_000, // 7 giorni
] as const;

export const SetDisappearingSchema = z.object({
  enabled:     z.boolean(),
  duration_ms: z
    .number()
    .int()
    .positive()
    .refine(
      (v) => (ALLOWED_DURATIONS_MS as readonly number[]).includes(v),
      {
        message: `duration_ms deve essere uno tra: ${ALLOWED_DURATIONS_MS.join(", ")} ms`,
      },
    )
    .nullable()
    .optional(),
}).superRefine((val, ctx) => {
  if (val.enabled && (val.duration_ms == null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "duration_ms è obbligatorio quando enabled è true",
      path: ["duration_ms"],
    });
  }
});

export type SetDisappearingInput = z.infer<typeof SetDisappearingSchema>;

// ---------------------------------------------------------------------------
// POST /api/v1/users/:userId/block  (params)
// ---------------------------------------------------------------------------

export const BlockUserParamSchema = z.object({
  userId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "userId deve essere ObjectId"),
});

export type BlockUserParam = z.infer<typeof BlockUserParamSchema>;
