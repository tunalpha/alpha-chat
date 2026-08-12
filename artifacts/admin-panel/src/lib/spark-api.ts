/**
 * Spark / Lightning Admin API Client — Phase 4
 *
 * Wrapper per /api/v1/spark/* usando il token admin.
 * COMPLETAMENTE SEPARATO da alpha-wallet-api.ts e BTC fee config.
 *
 * ENDPOINT:
 *   GET  /api/v1/spark/fee-config   — richiede read_only
 *   PATCH /api/v1/spark/fee-config  — richiede super_admin
 */

import { getToken, apiFetch } from "./api";

const SPARK_BASE = "/api/v1/spark";

async function sparkFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12_000);

  let res: Response;
  try {
    res = await fetch(`${SPARK_BASE}${path}`, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      msg = (b as { error?: { message?: string }; message?: string })?.error?.message
        ?? (b as { message?: string })?.message
        ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Configurazione fee Spark/Lightning Alpha Platform.
 *
 * ISOLAMENTO:
 * - Completamente separata da AlphaWalletFeeConfig (BTC on-chain)
 * - Modificare spark_fee_bps NON modifica btc fee_bps
 * - Visualizzata in una UI dedicata "Spark / Lightning Fee"
 */
export interface SparkFeeConfig {
  /** Alpha Platform Fee in basis points. 10 = 0.10% */
  fee_bps:           number;
  /** Fee minima Alpha in satoshi (0 = nessun minimo) */
  min_fee_sat:       number;
  /** Validità quote in secondi (5–300) */
  quote_validity_sec: number;
  /** Timestamp ultima modifica (ISO) */
  updated_at?:       string | null;
  /** User ID admin che ha effettuato l'ultima modifica */
  updated_by?:       string | null;
}

// ─── Pure utilities (usate anche nei test) ─────────────────────────────────

/** Converte fee_bps in stringa percentuale: 10 → "0,10%" */
export function sparkBpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2).replace(".", ",") + "%";
}

/** Calcola esempio fee su un importo in satoshi */
export function computeSparkExampleFee(amountSat: number, feeBps: number, minFeeSat: number): string {
  const computed = Math.floor((amountSat * feeBps) / 10000);
  const actual   = Math.max(computed, minFeeSat);
  return `${actual} sat`;
}

/** Valida fee_bps Spark: intero 0–500 */
export function validateSparkFeeBps(val: number): string | null {
  if (!Number.isInteger(val)) return "Deve essere un numero intero";
  if (val < 0)   return "Non può essere negativo";
  if (val > 500) return "Massimo 500 bps (5,00%)";
  return null;
}

/** Valida min_fee_sat: intero non negativo */
export function validateSparkMinFeeSat(val: number): string | null {
  if (!Number.isInteger(val) || val < 0) return "Deve essere un intero non negativo (satoshi)";
  return null;
}

/** Valida quote_validity_sec: intero 5–300 */
export function validateSparkQuoteValiditySec(val: number): string | null {
  if (!Number.isInteger(val)) return "Deve essere un numero intero";
  if (val < 5)   return "Minimo 5 secondi";
  if (val > 300) return "Massimo 300 secondi";
  return null;
}

// ─── API functions ─────────────────────────────────────────────────────────

export function apiGetSparkFeeConfig(): Promise<SparkFeeConfig> {
  return sparkFetch<SparkFeeConfig>("/fee-config");
}

// ── Admin Settings — spark_lightning_enabled kill switch ──────────────────
// Path corretto: /admin/notification-settings (GET + PATCH)
// NON /admin/settings — quello non esiste come endpoint PATCH.

interface AdminNotifSettingsResponse {
  spark_lightning_enabled: boolean;
  [key: string]: unknown;
}

export function apiGetSparkEnabled(): Promise<boolean> {
  return apiFetch<AdminNotifSettingsResponse>("/admin/notification-settings").then(
    (s) => s.spark_lightning_enabled ?? false,
  );
}

export function apiSetSparkEnabled(enabled: boolean): Promise<void> {
  return apiFetch<void>("/admin/notification-settings", {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ spark_lightning_enabled: enabled }),
  });
}

export function apiUpdateSparkFeeConfig(payload: {
  fee_bps?:           number;
  min_fee_sat?:       number;
  quote_validity_sec?: number;
}): Promise<{ ok: boolean; config: SparkFeeConfig }> {
  return sparkFetch<{ ok: boolean; config: SparkFeeConfig }>("/fee-config", {
    method: "PATCH",
    body:   JSON.stringify(payload),
  });
}
