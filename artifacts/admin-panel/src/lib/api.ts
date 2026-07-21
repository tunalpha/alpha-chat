/**
 * Admin Panel API Client
 *
 * Tutte le chiamate al backend /api/v1/admin/*.
 * Il token JWT admin è conservato in localStorage.
 *
 * Pattern:
 *   - apiFetch() gestisce auth header, 401 redirect al login, e parsing errori
 *   - ogni funzione esportata è tipata e restituisce Promise<T>
 */

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

const TOKEN_KEY = "alpha_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

const BASE = "/api/v1/admin";

async function apiFetch<T>(
  path: string,
  options?: RequestInit & { skipAuth?: boolean },
): Promise<T> {
  const { skipAuth = false, ...init } = options ?? {};

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  if (!skipAuth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  // Timeout 12s — evita spinner infinito su autoscale cold start
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.href = "/admin/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? body?.message ?? message;
    } catch {
      // ignore parse error
    }
    throw new Error(message);
  }

  // Handle file download (JSON export)
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }

  return res.blob() as unknown as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  status: "active" | "suspended" | "deleted" | "pending_deletion";
  admin_role: "super_admin" | "security_admin" | "support" | "read_only" | null;
  totp_enabled: boolean;
  is_verified: boolean;
  avatar_url: string | null;
  last_login_at: string | null;
  created_at: string;
  has_phoenix: boolean;
  has_recovery_card: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  suspension_reason: string | null;
}

export interface AdminDevice {
  id: string;
  user_id: string;
  username: string | null;
  device_id: string;
  device_name: string | null;
  user_agent: string | null;
  is_trusted: boolean;
  last_used_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface AdminStats {
  total_users: number;
  active_users_24h: number;
  online_now: number;
  new_users_today: number;
  suspended_users: number;
  total_conversations: number;
  total_groups: number;
  messages_today: number;
  total_media: number;
  active_sessions: number;
  phoenix_configured: number;
  totp_enabled: number;
  recovery_cards: number;
  security_events_today: number;
}

export interface GrowthPoint {
  date: string;
  users: number;
  messages: number;
  media: number;
}

export interface GrowthResponse {
  range: string;
  days: number;
  series: GrowthPoint[];
}

export interface SecurityFeature {
  key: string;
  label: string;
  count: number;
  pct: number;
}

export interface SecurityFeaturesResponse {
  total_users: number;
  features: SecurityFeature[];
}

export interface SystemHealth {
  uptime_seconds: number;
  node_version: string;
  memory: {
    heap_used_mb: number;
    heap_total_mb: number;
    rss_mb: number;
    system_used_mb: number;
    system_total_mb: number;
    system_pct: number;
  };
  cpu: {
    load_1m: number;
    load_5m: number;
    load_15m: number;
    cores: number;
    load_pct: number;
  };
  mongodb: {
    status: "ok" | "error";
    latency_ms: number;
    state: string;
  };
  websockets: {
    connections: number;
  };
}

export interface CollectionStat {
  name: string;
  size_mb: number;
  storage_mb: number;
  index_mb: number;
  count: number;
}

export interface StorageResponse {
  database: {
    size_mb: number;
    storage_mb: number;
    index_mb: number;
    collections_count: number;
    objects_count: number;
  };
  collections: CollectionStat[];
  r2?: {
    file_count: number; total_bytes: number; total_mb: number; total_gb: number;
    top_uploaders: Array<{ username: string; bytes: number; count: number }>;
    top_conversations: Array<{ conversation_id: string; bytes: number; count: number }>;
  };
}

export interface SecurityEvent {
  id: string;
  event: string;
  user_id: string | null;
  device_id: string | null;
  ip_hash: string | null;
  country_code: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PaginatedResponse<T> {
  page: number;
  limit: number;
  total: number;
  pages: number;
  items: T[];
}

export interface LoginResponse {
  token: string;
  expires_at: string;
  admin: {
    id: string;
    username: string;
    display_name: string;
    admin_role: string;
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function adminLogin(username: string, password: string): Promise<LoginResponse> {
  const data = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    skipAuth: true,
  });
  setToken(data.token);
  return data;
}

export async function adminLogout(): Promise<void> {
  clearToken();
  window.location.href = "/admin/login";
}

export async function getAdminMe(): Promise<{ id: string; username: string; display_name: string; admin_role: string; avatar_url: string | null }> {
  return apiFetch("/me");
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getStats(): Promise<AdminStats> {
  return apiFetch("/stats");
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

export async function getGrowth(range: "7d" | "30d" | "90d" = "30d"): Promise<GrowthResponse> {
  return apiFetch(`/growth?range=${range}`);
}

// ---------------------------------------------------------------------------
// Security features
// ---------------------------------------------------------------------------

export async function getSecurityFeatures(): Promise<SecurityFeaturesResponse> {
  return apiFetch("/security-features");
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

export async function getSystemHealth(): Promise<SystemHealth> {
  return apiFetch("/system-health");
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function getStorage(): Promise<StorageResponse> {
  return apiFetch("/storage");
}

// ---------------------------------------------------------------------------
// R2 Monitor
// ---------------------------------------------------------------------------

export interface R2TypeBreakdown { type: string; count: number; bytes: number }
export interface R2GrowthPoint    { date: string; uploads: number; bytes: number }
export interface R2Analytics24h   { type: string; count: number; bytes: number }
export interface R2CostEstimate {
  storage_gb: number; billable_gb: number; storage_usd: number;
  class_a_ops: number; class_a_usd: number;
  class_b_ops_estimated: number; class_b_usd: number;
  egress_usd: number; total_usd: number; note: string;
}
export interface R2PricingConfig {
  free_storage_gb:           number;
  storage_price_per_gb:      number;
  free_class_a:              number;
  class_a_price_per_million: number;
  free_class_b:              number;
  class_b_price_per_million: number;
  egress_price_per_gb:       number;
  updated_at?:               string;
  updated_by?:               string;
}

export interface R2CostForecast {
  pricing:               R2PricingConfig;
  storage_gb:            number;
  free_storage_gb:       number;
  free_tier_pct:         number;
  is_free_tier:          boolean;
  storage_cost:          number;
  class_a_cost:          number;
  class_b_cost:          number;
  egress_cost:           number;
  total_cost:            number;
  billable_storage_gb:   number;
  billable_class_a:      number;
  billable_class_b:      number;
  class_a_ops:           number;
  class_b_ops:           number;
  class_b_from_log:      boolean;
  egress_gb:             number;
  free_tier_remaining_gb: number;
  avg_daily_gb:          number;
  days_to_free_limit:    number | null;
  forecast_30d_gb:       number;
  forecast_90d_gb:       number;
  forecast_365d_gb:      number;
  forecast_30d_cost:     number;
  forecast_90d_cost:     number;
  forecast_365d_cost:    number;
}

export interface R2DashboardData {
  totals:         { count: number; bytes: number; gb: number };
  type_breakdown: R2TypeBreakdown[];
  growth_30d:     R2GrowthPoint[];
  analytics_24h:  R2Analytics24h[];
  cost_forecast:  R2CostForecast;
}
export interface R2HealthData {
  connected: boolean; status: "healthy" | "warning" | "offline";
  latency_ms: number; bucket: string; endpoint: string;
  checked_at: string; last_auto_check: string | null;
  consecutive_errors: number; error?: string;
}
export interface R2FileResult {
  media_id: string; uploader: string; conversation_id: string;
  mime_type: string; original_filename: string;
  storage_key: string; sha256: string; ciphertext_size: number;
  encryption_ver: number; has_thumbnail: boolean; uploaded_at: string;
}
export interface R2SearchData {
  files: R2FileResult[]; total: number; page: number; limit: number; pages: number;
}
export interface R2MissingMedia {
  media_id: string; storage_key: string; mime_type: string; uploaded_at: string;
}
export interface R2ConsistencyData {
  checked_at: string; duration_ms: number; r2_truncated: boolean;
  total_mongodb_docs: number; total_r2_objects: number;
  orphans_in_r2_count: number; missing_in_r2_count: number; missing_thumbs_count: number;
  orphan_keys: string[]; missing_media: R2MissingMedia[];
  verdict: "CONSISTENT" | "INCONSISTENCIES_FOUND";
}

export async function getR2Dashboard(): Promise<R2DashboardData> {
  return apiFetch("/r2/dashboard");
}

export async function getR2Health(): Promise<R2HealthData> {
  return apiFetch("/r2/health");
}

export async function getR2Search(params: {
  media_id?: string; username?: string; conversation_id?: string;
  type?: string; since?: string; until?: string; page?: number; limit?: number;
}): Promise<R2SearchData> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  return apiFetch(`/r2/search?${qs.toString()}`);
}

export async function runR2Cleanup(): Promise<{ deleted: number; duration_ms: number; ran_at: string }> {
  return apiFetch("/r2/cleanup", { method: "POST" });
}

export async function runR2Consistency(): Promise<R2ConsistencyData> {
  return apiFetch("/r2/consistency", { method: "POST" });
}

export interface R2EncryptionData {
  total_files: number; encryption_algo: string;
  version_breakdown: Array<{ version: number; count: number }>;
  v1_count: number; v1_pct: number;
  unversioned_count: number; missing_hash_count: number;
  all_encrypted: boolean; verdict: "ALL_ENCRYPTED" | "ISSUES_FOUND";
}

export interface R2TopUser {
  username: string; bytes: number; gb: number;
  total: number; images: number; videos: number; audio: number;
}

export interface R2ActivityEvent {
  id: string; event_type: string; status: "success" | "error";
  uploader: string | null; storage_key?: string;
  file_size?: number; mime_type?: string; filename?: string;
  duration_ms?: number; error_message?: string; created_at: string;
}

export interface R2ErrorEvent {
  id: string; event_type: string;
  uploader: string | null; storage_key?: string;
  file_size?: number; mime_type?: string; filename?: string;
  duration_ms?: number; error_message?: string; error_code?: string; created_at: string;
}

export async function getR2Encryption(): Promise<R2EncryptionData> {
  return apiFetch("/r2/encryption");
}

export async function getR2TopUsers(): Promise<{ users: R2TopUser[]; total: number }> {
  return apiFetch("/r2/top-users");
}

export async function getR2Activity(): Promise<{ events: R2ActivityEvent[]; total: number }> {
  return apiFetch("/r2/activity");
}

export async function getR2Errors(): Promise<{ errors: R2ErrorEvent[]; total: number }> {
  return apiFetch("/r2/errors");
}

export async function getR2Pricing(): Promise<R2PricingConfig> {
  return apiFetch("/r2/pricing");
}

export async function updateR2Pricing(data: Partial<Omit<R2PricingConfig, "updated_at" | "updated_by">>): Promise<R2PricingConfig> {
  return apiFetch("/r2/pricing", { method: "PUT", body: JSON.stringify(data) });
}

// ---------------------------------------------------------------------------
// Security events (SOC)
// ---------------------------------------------------------------------------

export async function getSecurityEvents(params?: {
  page?: number;
  limit?: number;
  event?: string;
  user_id?: string;
  since?: string;
}): Promise<{ page: number; limit: number; total: number; pages: number; events: SecurityEvent[] }> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.event) qs.set("event", params.event);
  if (params?.user_id) qs.set("user_id", params.user_id);
  if (params?.since) qs.set("since", params.since);
  return apiFetch(`/security-events?${qs}`);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUsers(params?: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}): Promise<{ page: number; limit: number; total: number; pages: number; users: AdminUser[] }> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.search) qs.set("search", params.search);
  if (params?.status) qs.set("status", params.status);
  return apiFetch(`/users?${qs}`);
}

export async function updateUserStatus(
  id: string,
  status: "active" | "suspended",
  reason?: string,
): Promise<{ id: string; username: string; status: string; suspension_reason: string | null }> {
  return apiFetch(`/users/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason }),
  });
}

export async function updateUserRole(
  id: string,
  admin_role: "super_admin" | "security_admin" | "support" | "read_only" | null,
): Promise<{ id: string; username: string; admin_role: string | null }> {
  return apiFetch(`/users/${id}/role`, {
    method: "PATCH",
    body: JSON.stringify({ admin_role }),
  });
}

export async function deleteUser(
  id: string,
): Promise<{ id: string; username: string; status: string }> {
  return apiFetch(`/users/${id}`, { method: "DELETE" });
}

export async function revokeUserSessions(
  id: string,
): Promise<{ revoked: number }> {
  return apiFetch(`/users/${id}/sessions`, { method: "DELETE" });
}

export async function adminSetTempPassword(
  id: string,
): Promise<{ username: string; temp_password: string }> {
  return apiFetch(`/users/${id}/temp-password`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Devices / Sessions
// ---------------------------------------------------------------------------

export async function getDevices(params?: {
  page?: number;
  limit?: number;
  user_id?: string;
  trusted?: boolean;
  active?: boolean;
}): Promise<{ page: number; limit: number; total: number; pages: number; devices: AdminDevice[] }> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.user_id) qs.set("user_id", params.user_id);
  if (params?.trusted !== undefined) qs.set("trusted", String(params.trusted));
  if (params?.active !== undefined) qs.set("active", String(params.active));
  return apiFetch(`/devices?${qs}`);
}

export async function revokeDevice(
  sessionId: string,
): Promise<{ revoked: boolean; session_id: string }> {
  return apiFetch(`/devices/${sessionId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Audit export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Call Diagnostics Center
// ---------------------------------------------------------------------------

export interface DiagEvent {
  id: string;
  user_id: string;
  username: string;
  session_id: string;
  call_id: string | null;
  event: string;
  payload: Record<string, unknown>;
  elapsed_ms: number | null;
  device: { user_agent: string; platform: string; network_type: string | null; app_version: string };
  created_at: string;
}

export interface DiagCall {
  call_id: string;
  participants: string[];
  event_count: number;
  first_event_at: string;
  last_event_at: string;
  last_event: string | null;
  duration_ms: number | null;
  ws_state: string | null;
  ice_state: string | null;
  pc_state: string | null;
  has_cleanup: boolean;
}

export interface DiagMetrics {
  range: string;
  total_events: number;
  ws_errors: number;
  ws_closes: number;
  call_offers: number;
  call_retries: number;
  call_cleanups: number;
  accept_timeouts: number;
  accept_errors: number;
  accept_complete: number;
  spinner_safety: number;
  gum_errors: number;
  top_events: Array<{ event: string; count: number }>;
  by_day: Array<{ date: string; events: number; calls: number; errors: number }>;
}

export interface DiagCalleeInfo {
  user_id: string | null;
  has_any_events: boolean;
  total_events_ever: number;
  last_event_at: string | null;
  last_event_age_seconds: number | null;
  has_events_this_call: boolean;
}

export interface DiagTimeline {
  call_id: string;
  event_count: number;
  callee_info: DiagCalleeInfo | null;
  events: Array<DiagEvent & { gap_ms: number }>;
}

export interface DiagHealth {
  status: "ok" | "error";
  total_events: number;
  events_last_hour: number;
  last_event: { username: string; event: string; created_at: string; age_seconds: number } | null;
  collection: string;
}

export async function getDiagHealth(): Promise<DiagHealth> {
  return apiFetch("/diagnostics/health");
}

export async function getDiagEvents(params?: {
  call_id?: string; username?: string; user_id?: string; event_type?: string;
  q?: string; since?: string; page?: number; limit?: number;
}): Promise<{ total: number; page: number; limit: number; pages: number; events: DiagEvent[] }> {
  const qs = new URLSearchParams();
  if (params?.call_id)    qs.set("call_id",    params.call_id);
  if (params?.username)   qs.set("username",   params.username);
  if (params?.user_id)    qs.set("user_id",    params.user_id);
  if (params?.event_type) qs.set("event_type", params.event_type);
  if (params?.q)          qs.set("q",          params.q);
  if (params?.since)      qs.set("since",      params.since);
  if (params?.page)       qs.set("page",       String(params.page));
  if (params?.limit)      qs.set("limit",      String(params.limit));
  return apiFetch(`/diagnostics/events?${qs}`);
}

export async function getDiagCalls(since?: string): Promise<{ since: string; calls: DiagCall[] }> {
  return apiFetch(`/diagnostics/calls${since ? `?since=${since}` : ""}`);
}

export async function getDiagTimeline(callId: string): Promise<DiagTimeline> {
  return apiFetch(`/diagnostics/timeline/${encodeURIComponent(callId)}`);
}

export async function getDiagMetrics(range?: "24h" | "7d" | "30d"): Promise<DiagMetrics> {
  return apiFetch(`/diagnostics/metrics${range ? `?range=${range}` : ""}`);
}

export async function downloadDiagExport(params?: {
  call_id?: string; username?: string; since?: string;
}): Promise<void> {
  const token = getToken();
  const qs = new URLSearchParams();
  if (params?.call_id)  qs.set("call_id",  params.call_id);
  if (params?.username) qs.set("username", params.username);
  qs.set("since", params?.since ?? "24h");
  const res = await fetch(`${BASE}/diagnostics/export?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `diag-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadAuditExport(days: number = 7): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE}/audit/export?days=${days}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
