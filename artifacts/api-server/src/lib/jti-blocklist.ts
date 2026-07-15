/**
 * JTI Blocklist — revoca immediata degli access token.
 *
 * Quando un utente fa logout, il JTI del suo AT viene messo in blocklist
 * con TTL = secondi rimanenti prima della scadenza naturale dell'AT.
 * Il middleware authenticate() controlla la blocklist ad ogni request.
 *
 * Backend: Redis (Upstash) in prod, InMemoryRedis in dev/test.
 *
 * Chiave Redis: `jti:blocked:{jti}` → "1"
 * TTL: automatico alla scadenza naturale del token.
 */

import { getRedisOrFallback } from "./redis";

const KEY_PREFIX = "jti:blocked:";

/**
 * Aggiunge un JTI alla blocklist.
 * @param jti         — JWT ID da bloccare
 * @param expiresAt   — data di scadenza naturale del token
 */
export async function blockJti(jti: string, expiresAt: Date): Promise<void> {
  const redis = await getRedisOrFallback();
  const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  await redis.set(`${KEY_PREFIX}${jti}`, "1", { ex: ttlSeconds });
}

/**
 * Controlla se un JTI è in blocklist.
 * Restituisce true se il token è stato revocato.
 */
export async function isJtiBlocked(jti: string): Promise<boolean> {
  const redis = await getRedisOrFallback();
  const result = await redis.get(`${KEY_PREFIX}${jti}`);
  return result !== null;
}
