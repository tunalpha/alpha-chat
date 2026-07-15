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
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // In test, Vitest intercetta process.exit — logghiamo comunque l'errore
  const errors = parsed.error.flatten().fieldErrors;
  logger.fatal({ errors }, "Invalid environment configuration — cannot start");
  process.exit(1);
}

export const config = {
  app: {
    env: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    allowedOrigins: parsed.data.ALLOWED_ORIGINS,
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
} as const;
