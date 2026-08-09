/**
 * native-price-provider.ts — Prezzo live del token nativo per ogni EVM network
 *
 * Fonte: CoinGecko public API (no key required) — stessa fonte usata dal frontend
 * per il prezzo BTC (useBtcPrice.ts, ids=bitcoin).
 *
 * Supporta: BNB (BSC), ETH (Ethereum), POL (Polygon).
 * BTC: non supportato qui — ha un provider separato lato frontend.
 *
 * Cache:
 *   - TTL 5 minuti per risposta OK
 *   - Dopo 10 minuti senza refresh OK: FAIL-CLOSED (lancia PriceUnavailableError)
 *   - In caso di errore durante il refresh: usa cache stale se < 10 min
 *
 * FAIL-CLOSED:
 *   Se il prezzo non è disponibile (cache scaduta, API down):
 *   lancia PriceUnavailableError → il quote/create fallisce con HTTP 503.
 *   MAI utilizzare un prezzo arbitrario o ENV come fallback.
 *
 * Precisione:
 *   Il prezzo viene restituito come float (USD) e convertito in BigInt
 *   con 6 decimali di precisione da chi lo usa (vedere NATIVE_PRICE_PRECISION
 *   in dynamic-fee-estimator.ts).
 *   NON usare il float direttamente in calcoli monetari BigInt.
 */

import { logger } from "../lib/logger";
import type { MCNetworkId } from "../models/multichain-transfer.model";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export class PriceUnavailableError extends Error {
  readonly code = "PRICE_UNAVAILABLE" as const;
  readonly httpStatus = 503;

  constructor(network: string, reason: string) {
    super(`[NativePriceProvider] Prezzo non disponibile per ${network}: ${reason}`);
    this.name = "PriceUnavailableError";
    Object.setPrototypeOf(this, PriceUnavailableError.prototype);
  }
}

interface PriceEntry {
  usd:       number;  // prezzo float in USD
  fetchedAt: number;  // timestamp ms
}

// ─── Costanti ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS  = 5 * 60_000;   // 5 minuti — refresh automatico al prossimo get
const CACHE_HARD_MS = 10 * 60_000;  // 10 minuti — oltre: fail-closed

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price" +
  "?ids=binancecoin,ethereum,matic-network" +
  "&vs_currencies=usd";

// CoinGecko id → MCNetworkId
const NETWORK_TO_ID: Partial<Record<MCNetworkId, string>> = {
  bsc:      "binancecoin",
  ethereum: "ethereum",
  polygon:  "matic-network",
};

// MCNetworkId → CoinGecko response key
const COINGECKO_KEY: Partial<Record<MCNetworkId, string>> = {
  bsc:      "binancecoin",
  ethereum: "ethereum",
  polygon:  "matic-network",
};

// ─── Cache in-memory ──────────────────────────────────────────────────────────

const _cache: Partial<Record<MCNetworkId, PriceEntry>> = {};
let _lastFetchAt   = 0;
let _fetchInFlight = false;

// ─── Fetch interno ────────────────────────────────────────────────────────────

interface CoinGeckoResponse {
  binancecoin?:   { usd?: number };
  ethereum?:      { usd?: number };
  "matic-network"?: { usd?: number };
}

async function _fetchAll(): Promise<void> {
  if (_fetchInFlight) return;          // deduplica fetch concorrenti
  _fetchInFlight = true;

  const now = Date.now();
  logger.debug("[NativePrice] Fetching live prices from CoinGecko…");

  try {
    const res = await fetch(COINGECKO_URL, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const json = (await res.json()) as CoinGeckoResponse;

    for (const [network, cgKey] of Object.entries(COINGECKO_KEY) as [MCNetworkId, string][]) {
      const entry = json[cgKey as keyof CoinGeckoResponse];
      const usd   = entry?.usd;
      if (typeof usd === "number" && usd > 0) {
        _cache[network] = { usd, fetchedAt: now };
      }
    }

    _lastFetchAt = now;
    logger.debug(
      {
        bnb: _cache.bsc?.usd,
        eth: _cache.ethereum?.usd,
        pol: _cache.polygon?.usd,
      },
      "[NativePrice] Prezzi aggiornati ✓",
    );
  } catch (err) {
    logger.warn({ err: String(err) }, "[NativePrice] Fetch CoinGecko fallito — cache mantenuta");
  } finally {
    _fetchInFlight = false;
  }
}

// ─── API pubblica ─────────────────────────────────────────────────────────────

/**
 * Restituisce il prezzo USD del token nativo per la rete specificata.
 *
 * @throws PriceUnavailableError se il prezzo non è disponibile (cache scaduta + fetch fallito)
 */
export async function getNativePriceUsd(network: MCNetworkId): Promise<number> {
  // Bitcoin non supportato (gestito separatamente)
  if (network === "bitcoin") {
    throw new PriceUnavailableError("bitcoin", "BTC non supportato da questo provider");
  }

  const cgKey = COINGECKO_KEY[network];
  if (!cgKey) {
    throw new PriceUnavailableError(network, "Network non mappato su CoinGecko");
  }

  const now     = Date.now();
  const cached  = _cache[network];

  // Se la cache è fresca (< 5 min): usa subito senza aspettare il refresh
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    // Avvia refresh in background se la cache ha tra 4 e 5 minuti
    if (now - cached.fetchedAt > CACHE_TTL_MS - 60_000) {
      void _fetchAll();
    }
    return cached.usd;
  }

  // Cache stale o mancante: fetch sincrono (attendi il risultato)
  await _fetchAll();

  const fresh = _cache[network];

  // Fail-closed: se anche dopo il fetch la cache è assente o troppo vecchia
  if (!fresh) {
    throw new PriceUnavailableError(network, "Nessun dato disponibile dopo il fetch");
  }

  const age = now - fresh.fetchedAt;
  if (age > CACHE_HARD_MS) {
    throw new PriceUnavailableError(
      network,
      `Cache troppo vecchia (${Math.round(age / 60_000)} min) — fail-closed`,
    );
  }

  return fresh.usd;
}

/**
 * Forza il refresh di tutti i prezzi. Usato da health check o warm-up.
 * Non lancia eccezioni — il fallimento è loggato internamente.
 */
export async function warmupNativePrices(): Promise<void> {
  await _fetchAll();
}

/**
 * Restituisce lo stato della cache (per diagnostica admin).
 */
export function getNativePriceCacheStatus(): Record<string, { usd: number; ageSeconds: number } | null> {
  const now = Date.now();
  const result: Record<string, { usd: number; ageSeconds: number } | null> = {};

  for (const network of Object.keys(NETWORK_TO_ID) as MCNetworkId[]) {
    const cached = _cache[network];
    result[network] = cached
      ? { usd: cached.usd, ageSeconds: Math.round((now - cached.fetchedAt) / 1_000) }
      : null;
  }

  return result;
}
