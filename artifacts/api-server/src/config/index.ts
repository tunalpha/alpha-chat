import { z } from "zod";
import { logger } from "../lib/logger";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z
    .string()
    .default("8080")
    .transform(Number)
    .pipe(z.number().min(1).max(65535)),
  MONGODB_URI: z.string().min(1).optional(),
  // .catch: se UPSTASH_REDIS_URL è presente ma malformata, fallback a undefined
  UPSTASH_REDIS_URL: z.string().url().optional().catch(undefined),
  UPSTASH_REDIS_TOKEN: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z
    .string()
    .default("*")
    .transform((s) => (s === "*" ? ["*"] : s.split(",").map((o) => o.trim()))),
  // Origini aggiuntive per Capacitor (futura integrazione iOS/Android).
  // Lasciare vuoto in produzione Web. Impostare nel build Capacitor:
  //   CAPACITOR_ORIGINS=capacitor://localhost,https://localhost
  // Non usare wildcard — vengono aggiunte alla lista esplicita di ALLOWED_ORIGINS.
  CAPACITOR_ORIGINS: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((o) => o.trim()).filter(Boolean) : [])),
  MIN_CLIENT_VERSION: z.string().default("1.0.0"),
  // "silent" aggiunto per supporto test (pino accetta "silent" come livello)
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // JWT — obbligatori in production, opzionali in development (chiavi effimere)
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_KEY_ID: z.string().optional(),
  JWT_PUBLIC_KEYS_LEGACY: z.string().optional(),
  // Phone hashing — pepper server-side (HMAC-SHA256)
  // .catch: in development/test può essere assente o corta
  PHONE_HMAC_PEPPER: z.string().min(32).optional().catch(undefined),
  // ── Cloudflare R2 Object Storage ─────────────────────────────────────────
  R2_ACCOUNT_ID:        z.string().min(1).optional(),
  R2_BUCKET:            z.string().min(1).default("alphachat"),
  R2_ENDPOINT:          z.string().url().optional().catch(undefined),
  R2_ACCESS_KEY_ID:     z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** Scadenza Signed URL in secondi (default 5 min) */
  R2_SIGNED_URL_TTL: z.coerce.number().min(60).max(3600).default(300),
  // ── Upload size limits (MB) ───────────────────────────────────────────────
  MAX_IMAGE_MB:    z.coerce.number().min(1).max(500).default(20),
  MAX_VIDEO_MB:    z.coerce.number().min(1).max(2000).default(100),
  MAX_AUDIO_MB:    z.coerce.number().min(1).max(500).default(25),
  MAX_DOCUMENT_MB: z.coerce.number().min(1).max(500).default(50),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // In test, Vitest intercetta process.exit — logghiamo comunque l'errore
  const errors = parsed.error.flatten().fieldErrors;
  logger.fatal({ errors }, "Invalid environment configuration — cannot start");
  process.exit(1);
}

// Merge ALLOWED_ORIGINS + CAPACITOR_ORIGINS.
// Se ALLOWED_ORIGINS è ["*"] il wildcard rimane e copre tutto;
// altrimenti le origini Capacitor vengono aggiunte esplicitamente.
const _baseOrigins = parsed.data.ALLOWED_ORIGINS;
const _capOrigins  = parsed.data.CAPACITOR_ORIGINS; // [] quando CAPACITOR_ORIGINS non è impostata
const _mergedOrigins: string[] = _baseOrigins.includes("*")
  ? ["*"]                              // wildcard già presente → non concatenare
  : [...new Set([..._baseOrigins, ..._capOrigins])];

export const config = {
  app: {
    env: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    allowedOrigins: _mergedOrigins,
    minClientVersion: parsed.data.MIN_CLIENT_VERSION,
  },
  db: {
    mongoUri: parsed.data.MONGODB_URI ?? null,
  },
  redis: {
    url: parsed.data.UPSTASH_REDIS_URL ?? null,
    token: parsed.data.UPSTASH_REDIS_TOKEN ?? null,
  },
  log: {
    level: parsed.data.LOG_LEVEL,
  },
  jwt: {
    privateKey: parsed.data.JWT_PRIVATE_KEY ?? null,
    publicKey: parsed.data.JWT_PUBLIC_KEY ?? null,
    keyId: parsed.data.JWT_KEY_ID ?? null,
    legacyPublicKeys: parsed.data.JWT_PUBLIC_KEYS_LEGACY ?? null,
  },
  auth: {
    phonePepper: parsed.data.PHONE_HMAC_PEPPER ?? null,
  },
  r2: {
    accountId:       parsed.data.R2_ACCOUNT_ID       ?? null,
    bucket:          parsed.data.R2_BUCKET,
    endpoint:        parsed.data.R2_ENDPOINT          ?? null,
    accessKeyId:     parsed.data.R2_ACCESS_KEY_ID     ?? null,
    secretAccessKey: parsed.data.R2_SECRET_ACCESS_KEY ?? null,
    signedUrlTtl:    parsed.data.R2_SIGNED_URL_TTL,
  },
  upload: {
    maxImageMb:    parsed.data.MAX_IMAGE_MB,
    maxVideoMb:    parsed.data.MAX_VIDEO_MB,
    maxAudioMb:    parsed.data.MAX_AUDIO_MB,
    maxDocumentMb: parsed.data.MAX_DOCUMENT_MB,
  },
} as const;
