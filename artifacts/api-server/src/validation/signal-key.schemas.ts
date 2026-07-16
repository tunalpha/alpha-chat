import { z } from "zod";

/** Base64 standard (con padding) — non vuota */
const b64 = z.string().min(1).regex(/^[A-Za-z0-9+/]+=*$/, "deve essere base64 valido");

/** Singola One-Time PreKey */
export const OneTimePreKeySchema = z.object({
  key_id: z.number().int().min(1).max(0x7fffffff),
  public_key: b64,
});

/**
 * Upload del bundle completo — chiamato dal client dopo registrazione o reset chiavi.
 * Tutti i valori crittografici sono base64 (chiavi pubbliche, firma).
 * ⚠ Il server non riceve mai chiavi private.
 */
export const UploadKeyBundleSchema = z.object({
  device_id: z.string().min(1).max(128),
  registration_id: z.number().int().min(1).max(16383),
  identity_key: b64,
  signed_pre_key_id: z.number().int().min(1).max(0x7fffffff),
  signed_pre_key: b64,
  signed_pre_key_signature: b64,
  one_time_pre_keys: z
    .array(OneTimePreKeySchema)
    .min(1, "almeno 1 one-time prekey richiesta")
    .max(200, "max 200 one-time prekeys per upload"),
});

export type UploadKeyBundleInput = z.infer<typeof UploadKeyBundleSchema>;

/** Aggiunta di nuove One-Time PreKeys (rifornimento pool) */
export const ReplenishOneTimePreKeysSchema = z.object({
  device_id: z.string().min(1).max(128),
  one_time_pre_keys: z
    .array(OneTimePreKeySchema)
    .min(1)
    .max(200),
});

export type ReplenishOneTimePreKeysInput = z.infer<typeof ReplenishOneTimePreKeysSchema>;

/** Rotazione della Signed PreKey */
export const RotateSignedPreKeySchema = z.object({
  device_id: z.string().min(1).max(128),
  signed_pre_key_id: z.number().int().min(1).max(0x7fffffff),
  signed_pre_key: b64,
  signed_pre_key_signature: b64,
});

export type RotateSignedPreKeyInput = z.infer<typeof RotateSignedPreKeySchema>;

/** Param per fetch bundle di un utente — UUID o ObjectId */
export const FetchBundleParamSchema = z.object({
  userId: z.string().min(1),
});
