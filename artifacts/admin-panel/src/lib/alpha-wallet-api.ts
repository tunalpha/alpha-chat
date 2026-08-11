/**
 * Alpha Wallet Admin API Client
 *
 * Wrapper per /api/v1/alpha-wallet/* usando il token admin.
 * Base diversa da /api/v1/admin — richiede awFetch separato.
 */

import { getToken } from "./api";

const AW_BASE = "/api/v1/alpha-wallet";

export async function awFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12_000);

  let res: Response;
  try {
    res = await fetch(`${AW_BASE}${path}`, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      msg = b?.error?.message ?? b?.message ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AlphaWalletFeeConfig {
  fee_bps:            number;
  quote_validity_sec: number;
  min_fee_usdt:       number;
  min_fee_btc_sat:    number;
  fee_wallet_evm:     string | null;
  fee_wallet_btc:     string | null;
  updated_at?:        string | null;
  updated_by_email?:  string | null;
}

export interface AlphaWalletFeeRecordsSummary {
  data: {
    records: unknown[];
    summary: {
      total:            number;
      success:          number;
      failed_transient: number;
      failed_permanent: number;
    };
  };
}

// ─── Pure utility functions (also used in tests) ───────────────────────────

/** Converte fee_bps in stringa percentuale: 10 → "0,10%" */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2).replace(".", ",") + "%";
}

/** Calcola esempio fee su un importo USDT dato i bps correnti */
export function computeExampleFee(amountUsdt: number, feeBps: number): string {
  return ((amountUsdt * feeBps) / 10000).toFixed(2);
}

/** Valida fee_bps: deve essere intero 0–500 */
export function validateFeeBps(val: number): string | null {
  if (!Number.isInteger(val)) return "Deve essere un numero intero";
  if (val < 0)   return "Non può essere negativo";
  if (val > 500) return "Massimo 500 bps (5,00%)";
  return null;
}

/** Valida quote_validity_sec: intero 5–300 */
export function validateQuoteValiditySec(val: number): string | null {
  if (!Number.isInteger(val) || val <= 0) return "Deve essere un intero positivo";
  if (val < 5)   return "Minimo 5 secondi";
  if (val > 300) return "Massimo 300 secondi";
  return null;
}

/** Valida min_fee_usdt: numero non negativo */
export function validateMinFeeUsdt(val: number): string | null {
  if (isNaN(val) || val < 0) return "Deve essere un valore non negativo";
  return null;
}

/** Valida min_fee_btc_sat: intero non negativo */
export function validateMinFeeBtcSat(val: number): string | null {
  if (!Number.isInteger(val) || val < 0) return "Deve essere un intero non negativo (satoshi)";
  return null;
}

// ─── API functions ─────────────────────────────────────────────────────────

export function apiGetAlphaWalletFeeConfig(): Promise<AlphaWalletFeeConfig> {
  return awFetch<AlphaWalletFeeConfig>("/fee-config");
}

export function apiUpdateAlphaWalletFeeConfig(payload: {
  fee_bps?:            number;
  quote_validity_sec?: number;
  min_fee_usdt?:       number;
  min_fee_btc_sat?:    number;
}): Promise<{ data: { ok: boolean } }> {
  return awFetch<{ data: { ok: boolean } }>("/fee-config", {
    method: "PATCH",
    body:   JSON.stringify(payload),
  });
}

export function apiGetAlphaWalletFeeRecords(): Promise<AlphaWalletFeeRecordsSummary> {
  return awFetch<AlphaWalletFeeRecordsSummary>("/fee-records");
}
