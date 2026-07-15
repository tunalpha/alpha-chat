/**
 * Schemi di validazione Zod per i moduli Auth.
 * Conformi a 06_API.md e 08_Authentication_Flow.md.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers riutilizzabili
// ---------------------------------------------------------------------------

/**
 * Username: 3-30 chars, solo [a-z0-9_.], non può iniziare o finire con '.'
 * Il modello DB forza lowercase — qui lo normalizziamo.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Minimo 3 caratteri")
  .max(30, "Massimo 30 caratteri")
  .regex(/^[a-z0-9_.]+$/, "Solo lettere minuscole, numeri, punto e underscore")
  .refine((v) => !v.startsWith(".") && !v.endsWith("."), {
    message: "Non può iniziare o finire con un punto",
  });

/**
 * Password: min 8 chars, almeno 1 maiuscola, 1 numero.
 * Conforme a 06_API.md.
 */
export const passwordSchema = z
  .string()
  .min(8, "Minimo 8 caratteri")
  .max(128, "Massimo 128 caratteri")
  .refine((v) => /[A-Z]/.test(v), { message: "Almeno una lettera maiuscola" })
  .refine((v) => /[0-9]/.test(v), { message: "Almeno un numero" });

/** Device type ammessi. */
export const deviceTypeSchema = z.enum(["ios", "android", "web", "desktop"]);

/** Schema chiavi Signal opzionale (Sprint 2: accettate ma non ancora verificate crittograficamente). */
const SignalKeysSchema = z.object({
  identity_key: z.string().min(1),
  signed_prekey: z.object({
    key_id: z.number().int().positive(),
    public_key: z.string().min(1),
    signature: z.string().min(1),
  }),
  one_time_prekeys: z
    .array(
      z.object({
        key_id: z.number().int().positive(),
        public_key: z.string().min(1),
      }),
    )
    .min(1)
    .max(100),
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/register
// ---------------------------------------------------------------------------

export const RegisterSchema = z.object({
  username: usernameSchema,
  display_name: z
    .string()
    .trim()
    .min(1, "Obbligatorio")
    .max(60, "Massimo 60 caratteri"),
  password: passwordSchema,
  email: z.string().trim().toLowerCase().email("Email non valida").optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "Formato E.164 richiesto (es. +393351234567)")
    .optional(),
  device_id: z.string().uuid("device_id deve essere UUID v4"),
  device_name: z.string().trim().max(100).optional().nullable(),
  device_type: deviceTypeSchema,
  signal_keys: SignalKeysSchema.optional(),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// ---------------------------------------------------------------------------

export const LoginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Username o email obbligatori"),
  password: z.string().min(1, "Password obbligatoria"),
  device_id: z.string().uuid("device_id deve essere UUID v4"),
  device_name: z.string().trim().max(100).optional().nullable(),
  device_type: deviceTypeSchema,
});

export type LoginInput = z.infer<typeof LoginSchema>;

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ---------------------------------------------------------------------------

export const RefreshSchema = z.object({
  refresh_token: z
    .string()
    .startsWith("rt_", "Formato refresh token non valido"),
});

export type RefreshInput = z.infer<typeof RefreshSchema>;
