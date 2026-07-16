/**
 * Zod schemas — Account Recovery — Sprint 22
 */

import { z } from "zod";

/** Recupero tramite Recovery Card */
export const RecoverByCardSchema = z.object({
  username:         z.string().min(3).max(30).toLowerCase().trim(),
  emergency_id:     z.string().min(1).trim().toUpperCase(),
  recovery_secret:  z.string().min(10).max(100).trim(),
});

/** Richiesta link via email */
export const RecoverByEmailRequestSchema = z.object({
  username: z.string().min(3).max(30).toLowerCase().trim(),
  email:    z.string().email().toLowerCase().trim(),
});

/** Verifica token email */
export const RecoverByEmailVerifySchema = z.object({
  token: z.string().min(32).max(128).trim(),
});

/** Imposta email di recupero */
export const SetRecoveryEmailSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});

/** Cambio password post-recovery */
export const ChangeTempPasswordSchema = z.object({
  temp_password: z.string().min(1),
  new_password:  z.string().min(8).max(128),
});

export type RecoverByCardInput     = z.infer<typeof RecoverByCardSchema>;
export type RecoverByEmailReqInput = z.infer<typeof RecoverByEmailRequestSchema>;
export type RecoverByEmailVerInput = z.infer<typeof RecoverByEmailVerifySchema>;
export type SetRecoveryEmailInput  = z.infer<typeof SetRecoveryEmailSchema>;
export type ChangeTempPasswordInput = z.infer<typeof ChangeTempPasswordSchema>;
