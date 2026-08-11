/**
 * Alpha Wallet — Price Service (Phase C)
 *
 * Fetches fiat prices for wallet assets via backend proxy.
 * Isolated from the Payment Engine price provider.
 *
 * Stablecoins (USDT, USDC, USDA): always $1 USD / €0.91 EUR.
 */

import { apiWalletGetPrices } from "../../lib/alpha-wallet-api";

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface AssetPrices {
  eth:  { usd: number; eur: number };
  pol:  { usd: number; eur: number };
  bnb:  { usd: number; eur: number };
  btc:  { usd: number; eur: number };
  usdt: { usd: number; eur: number };
  usdc: { usd: number; eur: number };
  usda: { usd: number; eur: number };
}

// ─── Fetch prices ──────────────────────────────────────────────────────────

let _cachedPrices: AssetPrices | null = null;
let _pricesCachedAt = 0;
const PRICE_CACHE_MS = 5 * 60_000; // 5 min client-side cache

export async function fetchPrices(): Promise<AssetPrices> {
  const now = Date.now();
  if (_cachedPrices && now - _pricesCachedAt < PRICE_CACHE_MS) {
    return _cachedPrices;
  }
  const prices = await apiWalletGetPrices();
  _cachedPrices = prices;
  _pricesCachedAt = now;
  return prices;
}

/** Returns the price for a given symbol (case-insensitive). */
export function getSymbolPrice(
  prices: AssetPrices,
  symbol: string,
): { usd: number; eur: number } | null {
  const key = symbol.toLowerCase() as keyof AssetPrices;
  return prices[key] ?? null;
}

// ─── Formatting helpers ────────────────────────────────────────────────────

/**
 * Formats a raw on-chain amount to human-readable crypto string.
 * e.g. formatCrypto(1_500_000n, 6, "USDT") → "1.5 USDT"
 */
export function formatCrypto(
  rawAmount: bigint,
  decimals:  number,
  symbol:    string,
  maxDecimalPlaces = 8,
): string {
  if (rawAmount === 0n) return `0 ${symbol}`;
  const divisor    = 10n ** BigInt(decimals);
  const whole      = rawAmount / divisor;
  const fractional = rawAmount % divisor;

  if (fractional === 0n) return `${whole} ${symbol}`;

  const fracStr = fractional.toString().padStart(decimals, "0");
  // Remove trailing zeros, keep maxDecimalPlaces
  const trimmed = fracStr.slice(0, maxDecimalPlaces).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed} ${symbol}` : `${whole} ${symbol}`;
}

/**
 * Formats a raw crypto amount as fiat currency.
 * Returns "—" if price is unavailable (0).
 */
export function formatFiat(
  rawAmount: bigint,
  decimals:  number,
  price:     { usd: number; eur: number } | null,
  currency:  "USD" | "EUR" = "EUR",
): string {
  if (!price || price[currency.toLowerCase() as "usd" | "eur"] === 0) return "—";
  const cryptoFloat = Number(rawAmount) / 10 ** decimals;
  const fiatValue   = cryptoFloat * price[currency.toLowerCase() as "usd" | "eur"];
  const locale      = currency === "EUR" ? "it-IT" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(fiatValue);
}

/**
 * Formats a BTC satoshi amount as fiat.
 */
export function formatBtcFiat(
  satoshi:  bigint,
  btcPrice: { usd: number; eur: number } | null,
  currency: "USD" | "EUR" = "EUR",
): string {
  return formatFiat(satoshi, 8, btcPrice, currency);
}

/**
 * Formats a raw amount for display in the send form (without symbol).
 * e.g. "1.500000" for 1.5 USDT
 */
export function formatInputAmount(rawAmount: bigint, decimals: number): string {
  if (rawAmount === 0n) return "0";
  const divisor = 10n ** BigInt(decimals);
  const whole   = rawAmount / divisor;
  const frac    = rawAmount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/**
 * Parses a user input amount string into raw bigint.
 * e.g. parseAmount("1.5", 6) → 1_500_000n
 * Returns null if invalid.
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  if (!input.trim()) return null;
  const cleaned = input.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded);
  } catch {
    return null;
  }
}
