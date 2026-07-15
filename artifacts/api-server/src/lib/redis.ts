/**
 * Redis client — Upstash (opzionale).
 *
 * In development senza UPSTASH_REDIS_URL: restituisce null.
 * In production senza UPSTASH_REDIS_URL: emette un warning (non blocca il server,
 *   ma funzioni come rate limiting e jti blocklist saranno degradate).
 *
 * Uso: const redis = await getRedis(); if (redis) { ... }
 */

import { logger } from "./logger";

// Tipo minimo compatibile con @upstash/redis e ioredis
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number; nx?: boolean }): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  exists(...keys: string[]): Promise<number>;
}

let _client: RedisClient | null = null;
let _initialized = false;

/**
 * Restituisce il client Redis se configurato, altrimenti null.
 * Inizializza la connessione solo al primo accesso (lazy).
 */
export async function getRedis(): Promise<RedisClient | null> {
  if (_initialized) return _client;
  _initialized = true;

  const url = process.env["UPSTASH_REDIS_URL"];
  const token = process.env["UPSTASH_REDIS_TOKEN"];

  if (!url) {
    if (process.env["NODE_ENV"] === "production") {
      logger.warn(
        "UPSTASH_REDIS_URL not set in production — " +
        "rate limiting, jti blocklist, and session caching will be degraded",
      );
    }
    return null;
  }

  try {
    // Import dinamico per non caricare il package se non necessario
    const { Redis } = await import("@upstash/redis");
    const upstash = new Redis({ url, token: token ?? "" });
    // Verifica connessione
    await upstash.set("ping", "pong", { ex: 5 });
    _client = upstash as unknown as RedisClient;
    logger.info("Redis (Upstash) connected");
  } catch (err) {
    logger.error({ err }, "Redis connection failed — degraded mode");
    _client = null;
  }

  return _client;
}

/** Fallback in-memory per development (non adatto a multi-processo). */
export class InMemoryRedis implements RedisClient {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private isExpired(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return true;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) return null;
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, options?: { ex?: number; nx?: boolean }): Promise<string | null> {
    if (options?.nx && !this.isExpired(key) && this.store.has(key)) return null;
    const expiresAt = options?.ex ? Date.now() + options.ex * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) { if (this.store.delete(k)) count++; }
    return count;
  }

  async incr(key: string): Promise<number> {
    const current = parseInt((await this.get(key)) ?? "0", 10);
    const next = current + 1;
    const existing = this.store.get(key);
    this.store.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async exists(...keys: string[]): Promise<number> {
    return keys.filter((k) => !this.isExpired(k) && this.store.has(k)).length;
  }
}

// Singleton in-memory per dev (reset tra i test)
let _inMemory: InMemoryRedis | null = null;

/**
 * Restituisce sempre un client Redis funzionante:
 * - Upstash se configurato
 * - InMemoryRedis altrimenti (dev/test)
 */
export async function getRedisOrFallback(): Promise<RedisClient> {
  const redis = await getRedis();
  if (redis) return redis;
  if (!_inMemory) _inMemory = new InMemoryRedis();
  return _inMemory;
}

/** Resetta il client — usato nei test. */
export function _resetRedisClient(): void {
  _client = null;
  _initialized = false;
  _inMemory = null;
}
