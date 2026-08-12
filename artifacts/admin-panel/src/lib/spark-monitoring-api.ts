/**
 * spark-monitoring-api.ts — Admin Panel API per Spark/Lightning Monitoring
 *
 * ISOLAMENTO: nessun import da alpha-wallet-api, multichain-api, usda.
 * Usa apiFetch dalla lib API comune per autenticazione admin.
 * PRIVACY: nessun secret, mnemonic, private key nei payload.
 */

import { apiFetch } from "./api";

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
  return apiFetch<{ data: SparkDashboardData }>("/spark/monitoring/dashboard")
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
  return apiFetch<{ data: SparkMovementsData }>(`/spark/monitoring/movements${query}`)
    .then(r => r.data);
}

export function apiGetSparkHealth(): Promise<SparkHealthData> {
  return apiFetch<{ data: SparkHealthData }>("/spark/monitoring/health")
    .then(r => r.data);
}

export function apiGetSparkReconciliation(): Promise<SparkReconciliationData> {
  return apiFetch<{ data: SparkReconciliationData }>("/spark/monitoring/reconciliation")
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
