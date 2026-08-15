/**
 * Spark API — chiamate al backend Alpha per configurazione e fee collection Spark.
 * Nessuna chiamata diretta al Breez SDK o agli operatori Spark.
 *
 * ARCHITETTURA C2+A:
 *   apiGetSparkUserFeeConfig()       — legge fee config + fee_address per il client
 *   apiSparkRecordFee()              — registra fee come pending_collection
 *   apiSparkMarkFeeCollected()       — Tier 1: marca singola fee come raccolta
 *   apiSparkMarkFeesBulkCollected()  — Tier 2: marca N fee raccolte in bulk
 *   apiSparkGetPendingFees()         — legge fee pendenti per il Tier-2 retry
 */

import type { SparkFeeConfig, SparkFeePendingRecord } from "./spark-types";

// ─── Defaults ─────────────────────────────────────────────────────────────────

const SPARK_FEE_DEFAULTS: SparkFeeConfig = {
  fee_bps:            10,
  min_fee_sat:        1,
  quote_validity_sec: 30,
  fee_address:        null,
};

// ─── Config per utente autenticato (non admin) ────────────────────────────────

/**
 * Legge la platform fee Spark dal backend (endpoint utente, non admin).
 * Include fee_address per Tier-1 e Tier-2 fee collection.
 * Fail-safe: in caso di errore restituisce i default (fee_address=null → fee non raccolta).
 */
export async function apiGetSparkUserFeeConfig(): Promise<SparkFeeConfig> {
  try {
    const res = await fetch("/api/v1/spark/user-fee-config", {
      credentials: "include",
      headers:     { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`spark/user-fee-config → ${res.status}`);
    const { data } = await res.json() as { data: SparkFeeConfig };
    return {
      fee_bps:            data.fee_bps            ?? SPARK_FEE_DEFAULTS.fee_bps,
      min_fee_sat:        data.min_fee_sat        ?? SPARK_FEE_DEFAULTS.min_fee_sat,
      quote_validity_sec: data.quote_validity_sec ?? SPARK_FEE_DEFAULTS.quote_validity_sec,
      fee_address:        data.fee_address        ?? null,
    };
  } catch {
    return SPARK_FEE_DEFAULTS;
  }
}

/**
 * @deprecated Usa apiGetSparkUserFeeConfig() per avere fee_address.
 * Mantenuta per retrocompatibilità con SparkWalletContext (viene rimpiazzata).
 */
export async function apiGetSparkFeeConfig(): Promise<SparkFeeConfig> {
  return apiGetSparkUserFeeConfig();
}

// ─── Fee record: registrazione (Tier 1 — post main payment) ──────────────────

/**
 * Registra la fee come pending_collection nel ledger backend.
 * Chiamato immediatamente dopo ogni main payment Lightning riuscito.
 * Fire-and-forget lato client — errori non bloccano il flusso UI.
 *
 * SCOPE LOCK: non chiama né modifica il main payment flow.
 */
export async function apiSparkRecordFee(payload: {
  paymentId:           string;
  alphaPlatformFeeSat: number;
}): Promise<{ ok: boolean; duplicate: boolean }> {
  const res = await fetch("/api/v1/spark/fee-record", {
    method:      "POST",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`spark/fee-record → ${res.status}`);
  const { data } = await res.json() as { data: { ok: boolean; duplicate: boolean } };
  return data;
}

// ─── Fee record: marcatura Tier 1 (singola) ───────────────────────────────────

/**
 * Tier 1: notifica al backend che la fee è stata fisicamente inviata ad Alpha Spark.
 * Aggiorna status: pending_collection → success.
 * Idempotente: stesso feePaymentId → ok=true, duplicate=true.
 */
export async function apiSparkMarkFeeCollected(payload: {
  mainPaymentId: string;
  feePaymentId:  string;
}): Promise<{ ok: boolean; duplicate: boolean }> {
  const res = await fetch("/api/v1/spark/fee-record/collected", {
    method:      "PATCH",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`spark/fee-record/collected → ${res.status}`);
  const { data } = await res.json() as { data: { ok: boolean; duplicate: boolean } };
  return data;
}

// ─── Fee record: marcatura Tier 2 (bulk) ─────────────────────────────────────

/**
 * Tier 2: notifica al backend che N fee pendenti sono state raccolte
 * in un unico pagamento Spark aggregato.
 * Idempotente: record già success vengono ignorati.
 */
export async function apiSparkMarkFeesBulkCollected(payload: {
  mainPaymentIds: string[];
  feePaymentId:   string;
}): Promise<{ ok: boolean; updated: number }> {
  const res = await fetch("/api/v1/spark/fee-record/bulk-collected", {
    method:      "PATCH",
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`spark/fee-record/bulk-collected → ${res.status}`);
  const { data } = await res.json() as { data: { ok: boolean; updated: number } };
  return data;
}

// ─── Fee pendenti (Tier 2 — on connect) ──────────────────────────────────────

/**
 * Tier 2: legge le fee pendenti dell'utente + fee_address attuale.
 * Il client chiama questa funzione al connect/login e — se fee_address è non-null
 * e totalSat > 0 — aggrega e invia un unico pagamento Spark verso Alpha.
 */
export async function apiSparkGetPendingFees(): Promise<{
  feeAddress:  string | null;
  pendingFees: SparkFeePendingRecord[];
  totalSat:    number;
}> {
  const res = await fetch("/api/v1/spark/fee-record/pending", {
    credentials: "include",
    headers:     { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`spark/fee-record/pending → ${res.status}`);
  const { data } = await res.json() as {
    data: {
      feeAddress:  string | null;
      pendingFees: SparkFeePendingRecord[];
      totalSat:    number;
    };
  };
  return data;
}
