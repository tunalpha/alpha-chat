/**
 * useBtcPrice — prezzo BTC in EUR e USD via CoinGecko public API.
 *
 * - Cache in-memory 60s
 * - Refresh automatico ogni 60s mentre il componente è montato
 * - Nessuna API key richiesta
 */

import { useState, useEffect, useRef } from "react";

export type FiatCurrency = "eur" | "usd";

interface BtcPrice { eur: number; usd: number }

const FIAT_SYMBOLS: Record<FiatCurrency, string> = { eur: "€", usd: "$" };
const FIAT_LABELS:  Record<FiatCurrency, string> = { eur: "EUR", usd: "USD" };

export { FIAT_SYMBOLS, FIAT_LABELS };

const CACHE_TTL_MS = 60_000;
let _cache: { data: BtcPrice; at: number } | null = null;

async function fetchBtcPrice(): Promise<BtcPrice> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.data;
  const res  = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur,usd",
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) throw new Error("price fetch failed");
  const json = await res.json() as { bitcoin: { eur: number; usd: number } };
  const data: BtcPrice = { eur: json.bitcoin.eur, usd: json.bitcoin.usd };
  _cache = { data, at: Date.now() };
  return data;
}

/** Preferenza valuta fiat — persiste in localStorage */
const LS_KEY = "ac_btc_fiat_currency";

export function loadFiatPreference(): FiatCurrency {
  try { const v = localStorage.getItem(LS_KEY); return (v === "usd" ? "usd" : "eur"); }
  catch { return "eur"; }
}
export function saveFiatPreference(c: FiatCurrency) {
  try { localStorage.setItem(LS_KEY, c); } catch { /* ignore */ }
}

/** Converte importo fiat in satoshi (floor) */
export function fiatToSatoshi(fiatStr: string, currency: FiatCurrency, price: BtcPrice | null): bigint | null {
  if (!price) return null;
  const fiat = parseFloat(fiatStr.replace(",", "."));
  if (isNaN(fiat) || fiat <= 0) return null;
  const btc  = fiat / price[currency];
  const sat  = Math.round(btc * 1e8);
  if (sat <= 0) return null;
  return BigInt(sat);
}

/** Formatta satoshi come stringa BTC (8 decimali) */
export function satoshiToBtcStr(sat: bigint): string {
  const n = Number(sat) / 1e8;
  return n.toFixed(8);
}

interface UseBtcPriceResult {
  price:     BtcPrice | null;
  loading:   boolean;
  error:     boolean;
  currency:  FiatCurrency;
  setCurrency: (c: FiatCurrency) => void;
}

export function useBtcPrice(): UseBtcPriceResult {
  const [price,    setPrice]    = useState<BtcPrice | null>(_cache?.data ?? null);
  const [loading,  setLoading]  = useState(!_cache);
  const [error,    setError]    = useState(false);
  const [currency, setCurrencyState] = useState<FiatCurrency>(loadFiatPreference);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    setLoading(true);
    setError(false);
    fetchBtcPrice()
      .then(p => { setPrice(p); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  };

  useEffect(() => {
    if (!_cache) load();
    else setLoading(false);
    intervalRef.current = setInterval(load, CACHE_TTL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const setCurrency = (c: FiatCurrency) => {
    setCurrencyState(c);
    saveFiatPreference(c);
  };

  return { price, loading, error, currency, setCurrency };
}
