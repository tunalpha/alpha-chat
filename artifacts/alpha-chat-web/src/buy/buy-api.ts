/**
 * Buy Crypto — client API frontend.
 *
 * SICUREZZA:
 *   • Nessuna API key nel frontend.
 *   • destinationAddress NON viene mai inviato dal client —
 *     il backend lo recupera dal wallet Alpha verificato in DB.
 *   • paymentUrl viene ricevuto dal backend e aperto in una nuova tab.
 */

import { API_BASE_URL } from "../lib/platform-config";
import type { BuyAsset, BuyQuote, BuyPaymentMethod, BuyOrder } from "./types";

const BASE = `${API_BASE_URL}/api/v1/buy`;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("ac_access_token");
  const res   = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message ?? "Buy API error") as any;
    err.code      = data.code;
    err.httpStatus = res.status;
    throw err;
  }
  return data as T;
}

// ── Assets & fiats supportati ────────────────────────────────────────────────

export async function apiBuyGetAssets(): Promise<{ assets: BuyAsset[]; fiats: string[] }> {
  return apiFetch("/assets");
}

// ── Metodi di pagamento ──────────────────────────────────────────────────────

export async function apiBuyGetMethods(fiatCurrency: string): Promise<{ methods: BuyPaymentMethod[] }> {
  return apiFetch(`/methods?currency=${encodeURIComponent(fiatCurrency)}`);
}

// ── Quote ────────────────────────────────────────────────────────────────────

export interface QuoteParams {
  fiatCurrency:  string;
  fiatAmount:    number;
  cryptoAsset:   string;
  cryptoNetwork: string;
}

export async function apiBuyGetQuote(params: QuoteParams): Promise<{ quote: BuyQuote; destinationAddress: string }> {
  const qs = new URLSearchParams({
    fiatCurrency:  params.fiatCurrency,
    fiatAmount:    String(params.fiatAmount),
    cryptoAsset:   params.cryptoAsset,
    cryptoNetwork: params.cryptoNetwork,
  });
  return apiFetch(`/quote?${qs}`);
}

// ── Order ────────────────────────────────────────────────────────────────────

export interface CreateOrderParams {
  fiatCurrency:    string;
  fiatAmount:      number;
  cryptoAsset:     string;
  cryptoNetwork:   string;
  destinationChain: string;
  paymentMethod:   string;
  quoteId?:        string;
}

export async function apiBuyCreateOrder(params: CreateOrderParams): Promise<{ order: BuyOrder }> {
  // destinationAddress NON inviato — il backend lo legge dal wallet Alpha verificato
  return apiFetch("/order", {
    method: "POST",
    body:   JSON.stringify(params),
  });
}

export async function apiBuyGetOrder(orderId: string): Promise<{ order: BuyOrder }> {
  return apiFetch(`/order/${encodeURIComponent(orderId)}`);
}

export async function apiBuyGetActiveOrder(): Promise<{ order: BuyOrder | null }> {
  return apiFetch("/order/active");
}

export async function apiBuyGetHistory(): Promise<{ orders: BuyOrder[] }> {
  return apiFetch("/history");
}
