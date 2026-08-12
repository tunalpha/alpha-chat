/**
 * spark-monitoring-api.ts — Admin Panel API per Spark/Lightning Monitoring
 *
 * ISOLAMENTO: nessun import da alpha-wallet-api, multichain-api, usda.
 * Usa apiFetch dalla lib API comune per autenticazione admin.
 * PRIVACY: nessun secret, mnemonic, private key nei payload.
 */

import { getToken } from "./api";

// Le route /spark/monitoring/* sono montate sotto /api/v1/spark/ (NON /api/v1/admin/).
// Non possiamo usare apiFetch (che usa BASE="/api/v1/admin"), altrimenti
// apiFetch("/spark/monitoring/dashboard") → /api/v1/admin/spark/monitoring/dashboard → 404.
// Usiamo sparkMonitorFetch con la base corretta.

const SPARK_MONITOR_BASE = "/api/v1/spark";

async function sparkMonitorFetch<T>(path: string): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(`${SPARK_MONITOR_BASE}${path}`, { headers, signal: controller.signal });
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

// ─── Tipi risposta ─────────────────────────────────────────────────────────

export interface SparkDashboardData {
  spark_enabled:             boolean;
  breez_api_key_configured:  boolean;
  movements_total:           number;
  movements_completed:       number;
  movements_failed:          number;
  movements_pending_note:    string;
  alpha_fees_success:        string;  // string float: "0.00001234"
  alpha_fees_failed:         string;
  error_rate_percent:        number;
  last_movement_at:          string | null;
}

export interface SparkMovementRecord {
  _id:         string;
  network:     string;
  assetSymbol: string;
  feeAmount:   string;
  status:      "success" | "failed_transient" | "failed_permanent";
  feeTxHash:   string | null;
  lastError:   string | null;
  attempts:    number;
  createdAt:   string;
  updatedAt:   string;
}

export interface SparkMovementsData {
  total:   number;
  page:    number;
  limit:   number;
  pages:   number;
  records: SparkMovementRecord[];
}

export interface SparkHealthData {
  overall_status:              "healthy" | "warning" | "critical";
  spark_enabled:               boolean;
  breez_api_key_configured:    boolean;
  operator_reachability_note:  string;
  error_rate_24h_percent:      number;
  failed_count_24h:            number;
  total_count_24h:             number;
  failed_permanent_total:      number;
  alerts:                      string[];
  checked_at:                  string;
}

export interface SparkReconciliationData {
  status:               "ok" | "mismatch";
  total_records:        number;
  success_records:      number;
  failed_records:       number;
  alpha_fees_success:   string;
  alpha_fees_failed:    string;
  difference:           string;
  reconciliation_note:  string;
  alert:                boolean;
  checked_at:           string;
}

// ─── API functions ──────────────────────────────────────────────────────────

export function apiGetSparkDashboard(): Promise<SparkDashboardData> {
  return sparkMonitorFetch<{ data: SparkDashboardData }>("/monitoring/dashboard")
    .then(r => r.data);
}

export interface MovementsParams {
  range?:  "24h" | "7d" | "30d" | "all";
  status?: "success" | "failed_transient" | "failed_permanent" | "";
  limit?:  number;
  page?:   number;
}

export function apiGetSparkMovements(params: MovementsParams = {}): Promise<SparkMovementsData> {
  const qs = new URLSearchParams();
  if (params.range)  qs.set("range",  params.range);
  if (params.status) qs.set("status", params.status);
  if (params.limit)  qs.set("limit",  String(params.limit));
  if (params.page)   qs.set("page",   String(params.page));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return sparkMonitorFetch<{ data: SparkMovementsData }>(`/monitoring/movements${query}`)
    .then(r => r.data);
}

export function apiGetSparkHealth(): Promise<SparkHealthData> {
  return sparkMonitorFetch<{ data: SparkHealthData }>("/monitoring/health")
    .then(r => r.data);
}

export function apiGetSparkReconciliation(): Promise<SparkReconciliationData> {
  return sparkMonitorFetch<{ data: SparkReconciliationData }>("/monitoring/reconciliation")
    .then(r => r.data);
}

// ─── Formatters ────────────────────────────────────────────────────────────

/** Formatta un importo float string (es. "0.00001234") come "0.00001234 BTC" */
export function formatSparkFeeAmount(amount: string, symbol = "BTC"): string {
  const n = parseFloat(amount);
  if (isNaN(n)) return "—";
  if (n === 0)  return `0 ${symbol}`;
  // Show up to 8 decimals, trim trailing zeros
  return `${n.toFixed(8).replace(/\.?0+$/, "")} ${symbol}`;
}

/** Formatta una data ISO o Date in formato locale breve */
export function formatSparkDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return dateStr; }
}

/** Ritorna label human-readable dello status */
export function sparkStatusLabel(status: SparkMovementRecord["status"]): string {
  switch (status) {
    case "success":          return "Completato";
    case "failed_transient": return "Fallito (transient)";
    case "failed_permanent": return "Fallito (permanente)";
    default:                 return status;
  }
}

/** Ritorna classe colore per lo status */
export function sparkStatusColor(status: SparkMovementRecord["status"]): string {
  switch (status) {
    case "success":          return "text-green-400";
    case "failed_transient": return "text-yellow-400";
    case "failed_permanent": return "text-red-400";
    default:                 return "text-white/60";
  }
}

/** Ritorna emoji + label per health status */
export function healthStatusBadge(s: SparkHealthData["overall_status"]): string {
  switch (s) {
    case "healthy":  return "🟢 Healthy";
    case "warning":  return "🟡 Warning";
    case "critical": return "🔴 Critical";
    default:         return s;
  }
}
