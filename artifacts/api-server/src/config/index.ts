import { z } from "zod";
import { logger } from "../lib/logger";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z
    .string()
    .transform(Number)
    .pipe(z.number().min(1).max(65535)),
  MONGODB_URI: z.string().min(1).optional(),
  UPSTASH_REDIS_URL: z.string().url().optional(),
  UPSTASH_REDIS_TOKEN: z.string().min(1).optional(),
  ALLOWED_ORIGINS: z
    .string()
    .default("*")
    .transform((s) => (s === "*" ? ["*"] : s.split(",").map((o) => o.trim()))),
  MIN_CLIENT_VERSION: z.string().default("1.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // JWT — obbligatori in production, opzionali in development (chiavi effimere)
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  // Phone hashing — pepper server-side (HMAC-SHA256)
  PHONE_HMAC_PEPPER: z.string().min(32).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  logger.fatal(
    { errors: parsed.error.flatten().fieldErrors },
    "Invalid environment configuration — cannot start",
  );
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
  },
  auth: {
    phonePepper: parsed.data.PHONE_HMAC_PEPPER ?? null,
  },
} as const;
