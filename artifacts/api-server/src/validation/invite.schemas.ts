import { z } from "zod";

/** Genera un nuovo codice invito */
export const GenerateInviteSchema = z.object({
  /** Durata in secondi (default 300 = 5 min, max 3600 = 1 ora) */
  expires_in_seconds: z
    .number()
    .int()
    .min(60, "Minimo 60 secondi")
    .max(3600, "Massimo 3600 secondi (1 ora)")
    .optional()
    .default(300),
});

/** Riscatta un codice invito */
export const RedeemInviteSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, "Codice troppo corto")
    .max(32, "Codice troppo lungo")
    .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "")),
});

export type GenerateInviteInput = z.infer<typeof GenerateInviteSchema>;
export type RedeemInviteInput = z.infer<typeof RedeemInviteSchema>;
