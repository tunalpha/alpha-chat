/**
 * Rate Limiter — sliding window su Redis (o in-memory per dev).
 *
 * Usato per:
 *   - Login falliti per utente: chiave `login_fail:{user_id}`
 *   - Soglie per IP: chiave `login_ip:{ip_hash}` (Sprint 4)
 *
 * Soglie login (08_Authentication_Flow.md):
 *   > 5 tentativi  → warning silenzioso
 *   > 10 tentativi → blocco 15 minuti + aggiorna users.locked_until
 *   > 20 tentativi → blocco 1 ora + email di avviso
 *   > 30 tentativi → blocco 24 ore + email urgente
 */

import { getRedisOrFallback } from "./redis";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Soglie
// ---------------------------------------------------------------------------

export const LOGIN_THRESHOLDS = [
  { attempts: 10, lockMinutes: 15 },
  { attempts: 20, lockMinutes: 60 },
  { attempts: 30, lockMinutes: 60 * 24 },
] as const;

const TTL_WINDOW_SECONDS = 60 * 60; // 1 ora (sliding window reset)

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------

/**
 * Incrementa il contatore di tentativi falliti per una chiave.
 * Restituisce il contatore aggiornato e se l'account va bloccato.
 */
export async function recordFailedAttempt(key: string): Promise<{
  count: number;
  shouldLock: boolean;
  lockMinutes: number;
}> {
  const redis = await getRedisOrFallback();

  const count = await redis.incr(key);
  if (count === 1) {
    // Primo fallimento: imposta TTL (sliding window)
    await redis.expire(key, TTL_WINDOW_SECONDS);
  }

  const threshold = LOGIN_THRESHOLDS.slice().reverse().find((t) => count >= t.attempts);

  if (threshold) {
    logger.warn({ key, count }, "Login threshold reached — locking account");
  }

  return {
    count,
    shouldLock: threshold !== undefined,
    lockMinutes: threshold?.lockMinutes ?? 0,
  };
}

/**
 * Azzera il contatore (login riuscito).
 */
export async function clearFailedAttempts(key: string): Promise<void> {
  const redis = await getRedisOrFallback();
  await redis.del(key);
}

/**
 * Legge il contatore corrente senza modificarlo.
 */
export async function getFailedAttemptCount(key: string): Promise<number> {
  const redis = await getRedisOrFallback();
  const val = await redis.get(key);
  return val ? parseInt(val, 10) : 0;
}

/**
 * Chiave Redis per login falliti per utente.
 */
export function loginFailKey(userId: string): string {
  return `login_fail:${userId}`;
}
