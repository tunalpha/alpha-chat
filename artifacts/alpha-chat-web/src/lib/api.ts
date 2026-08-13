/**
 * API client — fetch verso /api/v1/*.
 *
 * Il backend avvolge TUTTE le risposte:
 *   Successo:   { data: T, meta: { request_id, timestamp } }
 *   Paginato:   { data: T[], pagination: { cursor, has_more }, meta }
 *   Errore:     { error: { code, message, field, details, docs }, meta }
 *
 * Questo client estrae automaticamente i dati e normalizza gli errori.
 */

import { getAccessToken, getRefreshToken, updateAccessToken, updateAccessTokenExpiry, saveAuth, clearAuth, getDeviceId, isAccessTokenExpired } from "./auth";
import { API_BASE_URL } from "./platform-config";

// Web: API_BASE_URL="" → "/api/v1" (relativo, comportamento invariato)
// Capacitor: API_BASE_URL="https://alphachat.sbs" → "https://alphachat.sbs/api/v1"
const BASE = `${API_BASE_URL}/api/v1`;

// ---------------------------------------------------------------------------
// Tipi backend — corrispondono esattamente alle shape restituite dal server
// ---------------------------------------------------------------------------

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AuthUserProfile {
  id: string;
  username: string;
  display_name: string;
  email: string;
  is_verified: boolean;
  avatar_url?: string | null;
}

/** Shape completa restituita da /auth/register, /auth/login, /auth/refresh */
export interface AuthResult {
  user: AuthUserProfile & { require_password_change?: boolean };
  tokens: AuthTokens;
  is_new_device: boolean;
  requires_2fa: false;
  /** Sprint 22: presente solo alla prima registrazione, poi mai più */
  recovery_card?: RecoveryCardPayload;
  /** Sprint 22 completion: true se l'utente ha fatto login con password temporanea */
  require_password_change?: boolean;
  /**
   * Sprint 28: blob IK cifrata (opaco per il client finché non decifera con la password).
   * null → utente legacy pre-migrazione (il client genera nuova IK e chiama PATCH /auth/identity-key).
   */
  encrypted_identity_key?: string | null;
  ik_salt?: string | null;
}

/** Utente nella lista conversazioni (other_user) */
export interface ConversationPartner {
  user_id: string;   // ← backend usa user_id, non id
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
}

/** Conversazione nella lista conversazioni */
export interface LastMessagePreview {
  message_id: string;
  sender_id: string;
  ciphertext: string | null;
  sent_at: string;
  message_type?: string;
  system_metadata?: Record<string, unknown> | null;
}

export interface ConversationItem {
  conversation_id: string;
  type: "direct" | "group";
  name: string | null;
  other_user: ConversationPartner | null;
  last_activity_at: string;
  last_message_at: string | null;
  unread_count: number;
  last_message_preview: LastMessagePreview | null;
  /** ISO timestamp di quando l'ALTRO utente ha letto per l'ultima volta (per ✓✓) */
  other_user_last_read_at: string | null;
}

/** Conversazione appena creata (POST /conversations) */
export interface ConversationCreated {
  conversation_id: string;
  type: "direct" | "group";
  is_new: boolean;
  last_activity_at: string;
}

/** Profilo utente (ricerca utenti) */
export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_verified: boolean;
}

/** Messaggio */
export interface MessageItem {
  // campi aggiunti Sprint 10
  edited_at?: string | null;
  reply_to_message_id?: string | null;
  // campi aggiunti Sprint 11
  media_id?: string | null;
  // campi aggiunti Sprint 15
  burn_after_read?: boolean;
  expires_at?: string | null;
  // USDA Payments — system_metadata contiene i dati del pagamento (ciphertext è null)
  system_metadata?: Record<string, unknown> | null;
  id: string;
  client_message_id: string;
  conversation_id: string;
  sender_id: string;
  message_type: string;
  ciphertext: string | null;
  ciphertext_type: number | null;
  sequence_number: number;
  sent_at: string;
  server_received_at: string;
  status: string;
  deleted_for_everyone: boolean;
  /** Fase 4: un ciphertext per device del destinatario (null per messaggi legacy) */
  device_ciphertexts?: Array<{ device_id: string; body: string; type: number }> | null;
  /** Emoji reactions — emoji → userId[] */
  reactions?: Record<string, string[]>;
}

/** Informazioni dispositivo (Device Manager) */
export interface DeviceInfo {
  deviceId: string;
  registrationId: number;
  lastActiveAt: string;
  otpkCount: number;
}

/** Sprint 22 — Recovery Card data (restituita UNA SOLA VOLTA alla registrazione) */
export interface RecoveryCardPayload {
  emergency_id:    string;
  recovery_secret: string;
  version:         number;
  generated_at:    string;
  checksum:        string;
}

/** Sprint 22 — Stato recovery dell'account */
export interface RecoveryStatus {
  has_recovery_card:     boolean;
  has_recovery_email:    boolean;
  has_phoenix_code:      boolean;
  card_version:          number | null;
  card_generated_at:     string | null;
  last_recovery_at:      string | null;
  recovery_email_masked: string | null;
}

/** Campi E2E aggiuntivi presenti nei media meta di Fase 3 */
export interface MediaE2EFields {
  e2e?: true;
  key?: string;      // base64 AES-256 key (Fase 3)
  iv?: string;       // base64 GCM IV (Fase 3)
  thumb_iv?: string; // base64 IV thumbnail (Fase 4)
}

/** Metadati media estratti dal ciphertext di un media message */
export interface VoiceMeta extends MediaE2EFields {
  type: "voice";
  media_id: string;
  duration_ms: number;
  waveform: number[];
  /** MIME type del blob audio originale (es. "audio/mp4" su iOS, "audio/webm" su Android) */
  mime_type?: string;
}

export type MediaMeta =
  | VoiceMeta
  | ({ type: "image";    media_id: string; mime_type: string; filename: string; size: number } & MediaE2EFields)
  | ({ type: "video";    media_id: string; mime_type: string; filename: string; size: number; duration_ms?: number } & MediaE2EFields)
  | ({ type: "document"; media_id: string; mime_type: string; filename: string; size: number } & MediaE2EFields);

/**
 * Decifra i metadati vocali dal testo del messaggio.
 * Fase 3: testo già Signal-decifrato → JSON diretto.
 * Legacy: testo in base64 (pre-Fase 3).
 */
// ── Location (E2E) ──────────────────────────────────────────────────────────

export interface LocationMeta {
  e2e:       boolean;
  type:      "location";
  latitude:  number;
  longitude: number;
  accuracy:  number;
  timestamp: number;
}

export function decodeLocationMeta(text: string | null): LocationMeta | null {
  if (!text) return null;
  try {
    const p = JSON.parse(text) as LocationMeta;
    if (p.type === "location" && typeof p.latitude === "number" && typeof p.longitude === "number")
      return p;
  } catch {}
  return null;
}

// ────────────────────────────────────────────────────────────────────────────

export function decodeVoiceMeta(text: string | null): VoiceMeta | null {
  if (!text) return null;
  // Fase 3: testo già decodificato da Signal → JSON diretto
  try {
    const parsed = JSON.parse(text) as VoiceMeta;
    if (parsed.type === "voice" && parsed.media_id) return parsed;
  } catch {}
  // Legacy: base64-encoded JSON (pre-Fase 3)
  try {
    const json = atob(text);
    const parsed = JSON.parse(json) as VoiceMeta;
    if (parsed.type !== "voice") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Decifra i metadati media dal testo del messaggio.
 * Fase 3: testo già Signal-decifrato → JSON diretto (contiene key e iv AES).
 * Legacy: testo in base64 (pre-Fase 3, no key).
 */
export function decodeMediaMeta(text: string | null): MediaMeta | null {
  if (!text) return null;
  // Fase 3: testo già decodificato da Signal → JSON diretto
  try {
    const parsed = JSON.parse(text) as MediaMeta;
    if (parsed.type && parsed.media_id) return parsed;
  } catch {}
  // Legacy: base64-encoded JSON (pre-Fase 3)
  try {
    const json   = atob(text);
    const parsed = JSON.parse(json) as MediaMeta;
    if (!parsed.type || !parsed.media_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface RegisterInput { username: string; password: string; display_name: string; }
export interface LoginInput { identifier: string; password: string; }

// ---------------------------------------------------------------------------
// Paginated result — shape usata internamente nel client
// ---------------------------------------------------------------------------
export interface PaginatedResult<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Core fetch — estrae automaticamente body.data, normalizza errori
// ---------------------------------------------------------------------------

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];
/** Timestamp dell'ultimo refresh fallito — evita loop di retry */
let refreshFailedAt = 0;
const REFRESH_COOLDOWN_MS = 10_000; // 10s cooldown dopo fallimento

// ── BroadcastChannel — coordinamento refresh multi-tab ─────────────────────
//
// Previene REFRESH_TOKEN_REUSED quando più tab si svegliano contemporaneamente
// (es. ritorno dallo sfondo dopo >1h) e tentano il refresh in parallelo.
//
// Flusso:
//   Tab A inizia il refresh → broadcast "refreshing"
//   Tab B riceve "refreshing" → _bcRefreshInProgress = true
//   Tab B chiama ensureValidToken → vede il flag → attende in coda BC
//   Tab A completa → broadcast "token_refreshed" o "token_refresh_failed"
//   Tab B legge il token fresco da localStorage (già aggiornato da Tab A)
//
// Graceful degradation: se BroadcastChannel non è supportato (iframe, Safari
// privato) il sistema continua a funzionare con il solo mutex intra-tab.
let _bcRefreshInProgress = false;
let _bcWaiters: Array<(token: string | null) => void> = [];
let _refreshBC: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== "undefined") {
    _refreshBC = new BroadcastChannel("alpha-chat:token-refresh");
    _refreshBC.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string };
      if (msg.type === "token_refreshed") {
        // Un'altra tab ha già aggiornato localStorage — rileggiamo da lì.
        _bcRefreshInProgress = false;
        const freshToken = getAccessToken();
        _bcWaiters.forEach((r) => r(freshToken));
        _bcWaiters = [];
      } else if (msg.type === "token_refresh_failed") {
        _bcRefreshInProgress = false;
        _bcWaiters.forEach((r) => r(null));
        _bcWaiters = [];
      } else if (msg.type === "refreshing") {
        // Un'altra tab ha appena iniziato il refresh.
        _bcRefreshInProgress = true;
      }
    };
  }
} catch { /* no-op: BroadcastChannel non disponibile */ }

/** Retry del refresh: max tentativi e delay tra un tentativo e l'altro. */
const REFRESH_MAX_RETRIES   = 3;
const REFRESH_RETRY_DELAYS  = [500, 1500, 4500] as const;

/** Estrae il messaggio leggibile da una risposta di errore del backend.
 *  Priorità: 1) details.issues[0].message (specifico al campo)
 *             2) error.message (generico)
 *             3) error.code
 *             4) fallback
 */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.error && typeof b.error === "object") {
      const e = b.error as Record<string, unknown>;

      // 1. Messaggio specifico dal primo issue di validazione
      if (e.details && typeof e.details === "object") {
        const d = e.details as Record<string, unknown>;
        if (Array.isArray(d.issues) && d.issues.length > 0) {
          const first = d.issues[0] as { path?: string; message?: string };
          if (first.message) {
            return first.path ? `${first.path}: ${first.message}` : first.message;
          }
        }
      }

      // 2. Messaggio generico
      if (typeof e.message === "string" && e.message) return e.message;
      if (typeof e.code === "string") return e.code;
    }
    if (typeof b.message === "string" && b.message) return b.message;
  }
  return fallback;
}

/**
 * Tenta di rinnovare l'access token usando il refresh token.
 *
 * Semantica di clearAuth():
 *  - clearAuth() viene chiamato SOLO se il server risponde 401/403
 *    (sessione genuinamente invalida/revocata).
 *  - Errori di rete (fetch fallito, timeout, 5xx) NON chiamano clearAuth():
 *    il refresh token viene conservato e il retry avviene alla prossima occasione.
 *
 * Retry: fino a REFRESH_MAX_RETRIES tentativi con backoff su errori di rete/5xx.
 * Se tutti falliscono per motivi di rete, ritorna null SENZA cancellare la sessione.
 */
async function attemptRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  for (let attempt = 0; attempt < REFRESH_MAX_RETRIES; attempt++) {
    // Backoff tra i tentativi (non prima del primo)
    if (attempt > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, REFRESH_RETRY_DELAYS[attempt - 1] ?? 4500),
      );
    }

    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ refresh_token: refreshToken, device_id: getDeviceId() }),
      });

      // 401 / 403: il server conferma che il refresh token è invalido o revocato.
      // Unico caso in cui è corretto cancellare la sessione locale.
      if (res.status === 401 || res.status === 403) {
        clearAuth();
        return null;
      }

      // 5xx o altro errore server: non invalida la sessione — ritenta se possibile.
      if (!res.ok) {
        if (attempt < REFRESH_MAX_RETRIES - 1) continue;
        return null; // tutti i tentativi esauriti per errore server → mantieni sessione
      }

      // Successo: aggiorna token in localStorage e ritorna il nuovo access token.
      const json   = (await res.json()) as { data: AuthResult };
      const result = json.data;

      updateAccessToken(result.tokens.access_token);
      updateAccessTokenExpiry(result.tokens.access_token_expires_at);
      saveAuth({
        accessToken:          result.tokens.access_token,
        accessTokenExpiresAt: result.tokens.access_token_expires_at,
        refreshToken:         result.tokens.refresh_token,
        userId:               result.user.id,
        username:             result.user.username,
        displayName:          result.user.display_name,
        avatarUrl:            result.user.avatar_url ?? undefined,
      });
      return result.tokens.access_token;

    } catch {
      // Errore di rete (fetch fallito, DNS, timeout iOS, ecc.) — ritenta.
      if (attempt < REFRESH_MAX_RETRIES - 1) continue;
      // Tutti i tentativi esauriti per problemi di rete.
      // NON clearAuth(): il refresh token è ancora valido, la sessione è preservata.
      // Il prossimo 401 o il prossimo visibilitychange ci riproverà.
      return null;
    }
  }

  return null;
}

/**
 * Coordinamento refresh — unico punto di controllo del mutex isRefreshing.
 *
 * Garantisce:
 *  - Un solo HTTP refresh in volo alla volta (isRefreshing guard).
 *  - Tutte le chiamate concorrenti che ricevono 401 attendono in coda
 *    e riutilizzano il nuovo token senza fare un secondo refresh HTTP.
 *  - Coordinamento multi-tab via BroadcastChannel: se un'altra tab sta
 *    già rinfrescando, questa attende il suo risultato invece di fare una
 *    seconda richiesta HTTP (che causerebbe REFRESH_TOKEN_REUSED).
 *  - clearAuth() + auth:expired SOLO se il server conferma 401/403
 *    (refresh token genuinamente invalido).
 *  - Nessuna azione se il refresh è fallito di recente (cooldown 10s).
 *
 * Usata da: request(), requestPaginated(), apiRefreshSession().
 */
async function ensureValidToken(): Promise<string | null> {
  // Cooldown: refresh fallito di recente → non riprovare
  if (Date.now() - refreshFailedAt < REFRESH_COOLDOWN_MS) return null;

  // Un'altra tab sta già rinfrescando → attendi il suo risultato via BC.
  // Quando completa, tutti i waiter leggono il token fresco da localStorage.
  if (_bcRefreshInProgress) {
    return new Promise<string | null>((resolve) => _bcWaiters.push(resolve));
  }

  // Un refresh è già in corso in questa tab → attendi il suo risultato in coda.
  // Quando completa, tutti i waiter ricevono lo stesso nuovo token.
  if (isRefreshing) {
    return new Promise<string | null>((resolve) => refreshQueue.push(resolve));
  }

  // Controlla se un'altra tab ha già aggiornato il token in localStorage.
  // Coprire il caso: due tab registrano visibilitychange con <50ms di scarto,
  // la prima aggiorna localStorage prima che la seconda entri qui.
  if (!isAccessTokenExpired()) {
    const freshToken = getAccessToken();
    if (freshToken) return freshToken;
  }

  // Segnala alle altre tab che questa sta iniziando il refresh.
  _refreshBC?.postMessage({ type: "refreshing" });
  isRefreshing = true;
  const newToken = await attemptRefresh();
  isRefreshing = false;

  if (!newToken) {
    refreshFailedAt = Date.now();
    refreshQueue.forEach((cb) => cb(null));
    refreshQueue = [];
    _refreshBC?.postMessage({ type: "token_refresh_failed" });
    // Dispatch auth:expired solo se clearAuth() è già stato chiamato
    // da attemptRefresh() (401/403 dal server → refresh token rimosso).
    // Se il fallimento era di rete, getRefreshToken() è ancora presente.
    if (!getRefreshToken()) {
      window.dispatchEvent(new CustomEvent("auth:expired"));
    }
  } else {
    refreshFailedAt = 0;
    refreshQueue.forEach((cb) => cb(newToken));
    refreshQueue = [];
    _refreshBC?.postMessage({ type: "token_refreshed" });
  }

  return newToken;
}

/**
 * Refresh proattivo — esposto per AuthContext (avvio PWA, visibilitychange).
 *
 * Usa lo stesso mutex di request(): due chiamate concorrenti producono
 * un solo HTTP request verso /auth/refresh; la seconda attende il risultato
 * della prima e riutilizza il nuovo access token.
 */
export async function apiRefreshSession(): Promise<string | null> {
  return ensureValidToken();
}

/**
 * Fa una request e restituisce body.data (unwrapped da successResponse).
 * Riprova una volta se riceve 401 (token scaduto → refresh).
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 401 → prova a rinnovare il token tramite ensureValidToken() (una volta sola)
  if (res.status === 401 && retry) {
    const newToken = await ensureValidToken();
    if (!newToken) {
      throw new Error(
        !getRefreshToken()
          ? "Sessione scaduta. Accedi di nuovo."
          : "Connessione non disponibile. Riprova tra poco.",
      );
    }
    return request<T>(method, path, body, false);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  let jsonBody: unknown;
  try { jsonBody = await res.json(); } catch { jsonBody = null; }

  if (!res.ok) {
    throw new Error(extractErrorMessage(jsonBody, `Errore ${res.status}`));
  }

  // Scartola il wrapper { data: T, meta: {...} }
  if (jsonBody && typeof jsonBody === "object" && "data" in (jsonBody as object)) {
    return (jsonBody as { data: T }).data;
  }
  return jsonBody as T;
}

/**
 * Fa una request paginata e restituisce { items, cursor, hasMore }.
 * La risposta dal backend è { data: T[], pagination: { cursor, has_more }, meta }.
 */
async function requestPaginated<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<PaginatedResult<T>> {
  const token = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let jsonBody: unknown;
  try { jsonBody = await res.json(); } catch { jsonBody = null; }

  // 401 → stessa logica di request(): tenta il refresh tramite ensureValidToken(),
  // poi riprova. Due 401 concorrenti producono un solo HTTP refresh (mutex condiviso).
  if (res.status === 401 && retry) {
    const newToken = await ensureValidToken();
    if (!newToken) {
      if (!getRefreshToken()) throw new AuthExpiredError();
      throw new Error("Connessione non disponibile. Riprova tra poco.");
    }
    return requestPaginated<T>(method, path, body, false);
  }
  if (res.status === 401) {
    // retry=false: secondo tentativo fallito dopo refresh → sessione invalida
    throw new AuthExpiredError();
  }
  if (!res.ok) {
    throw new Error(extractErrorMessage(jsonBody, `Errore ${res.status}`));
  }

  const wrapper = jsonBody as {
    data: T[];
    pagination: { cursor: string | null; has_more: boolean };
  };
  return {
    items: wrapper.data ?? [],
    cursor: wrapper.pagination?.cursor ?? null,
    hasMore: wrapper.pagination?.has_more ?? false,
  };
}

// ---------------------------------------------------------------------------
// Errori tipizzati
// ---------------------------------------------------------------------------

/** Lanciato quando il server risponde 401 (token scaduto o invalido). */
export class AuthExpiredError extends Error {
  constructor() {
    super("Sessione scaduta. Effettua di nuovo il login.");
    this.name = "AuthExpiredError";
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// ─────────────────────────────────────────────────────────────────────────────
// Account Recovery — Sprint 22
// ─────────────────────────────────────────────────────────────────────────────

export async function apiRecoverByCard(
  username: string,
  emergencyId: string,
  recoverySecret: string,
): Promise<{ temp_password: string; expires_at: string }> {
  return request<{ temp_password: string; expires_at: string }>(
    "POST", "/auth/recover/card",
    { username, emergency_id: emergencyId, recovery_secret: recoverySecret },
  );
}

export async function apiRequestEmailRecovery(username: string, email: string): Promise<void> {
  await request<unknown>("POST", "/auth/recover/email/request", { username, email });
}

export async function apiVerifyEmailToken(
  token: string,
): Promise<{ temp_password: string; expires_at: string }> {
  return request<{ temp_password: string; expires_at: string }>(
    "POST", "/auth/recover/email/verify", { token },
  );
}

export async function apiGetRecoveryStatus(): Promise<RecoveryStatus> {
  return request<RecoveryStatus>("GET", "/account/recovery/status");
}

export async function apiSetRecoveryEmail(email: string): Promise<void> {
  await request<unknown>("POST", "/account/recovery/email", { email });
}

export async function apiRegenerateRecoveryCard(): Promise<RecoveryCardPayload> {
  const res = await request<{ card: RecoveryCardPayload }>("POST", "/account/recovery/card/regenerate");
  return res.card;
}

export async function apiChangeTempPassword(tempPassword: string, newPassword: string): Promise<void> {
  await request<unknown>("POST", "/account/recovery/password", {
    temp_password: tempPassword,
    new_password:  newPassword,
  });
}

/** Sprint 22 completion: cambio password obbligatorio via /auth/change-temporary-password */
export async function apiChangeTempPasswordAuth(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
  /** Sprint 28: IK re-wrappata con il nuovo wrap_key. Assente → scenario recovery. */
  newEncryptedIdentityKey?: string,
): Promise<void> {
  await request<unknown>("POST", "/auth/change-temporary-password", {
    current_password: currentPassword,
    new_password:     newPassword,
    confirm_password: confirmPassword,
    ...(newEncryptedIdentityKey ? { new_encrypted_identity_key: newEncryptedIdentityKey } : {}),
  });
}

export async function apiRegister(input: RegisterInput & {
  /** Sprint 28: blob IK cifrata da inviare con la registrazione */
  encrypted_identity_key?: string;
  ik_salt?: string;
}): Promise<AuthResult> {
  return request<AuthResult>("POST", "/auth/register", {
    username: input.username,
    display_name: input.display_name,
    password: input.password,
    device_id: getDeviceId(),
    device_name: navigator.userAgent.slice(0, 80),
    device_type: "web" as const,
    ...(input.encrypted_identity_key ? {
      encrypted_identity_key: input.encrypted_identity_key,
      ik_salt: input.ik_salt,
    } : {}),
  });
}

/**
 * Sprint 28: aggiorna il blob IK cifrata sul server.
 * Usato in due scenari:
 *   1. Migrazione utenti legacy (prima volta che generano la IK condivisa).
 *   2. Recovery: il client ha generato una nuova IK dopo recovery card.
 */
export async function apiUpdateIdentityKey(blob: string, salt: string): Promise<void> {
  await request<unknown>("PATCH", "/auth/identity-key", {
    encrypted_identity_key: blob,
    ik_salt: salt,
  });
}

export async function apiLogin(input: LoginInput): Promise<AuthResult> {
  // Usa fetch() diretto — NON request() — per evitare che la logica di refresh
  // intercetti il 401 e lanci "Sessione scaduta" al posto dell'errore reale del server.
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: input.identifier,
      password:   input.password,
      device_id:  getDeviceId(),
      device_name: navigator.userAgent.slice(0, 80),
      device_type: "web" as const,
    }),
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) throw new Error(extractErrorMessage(body, `Errore ${res.status}`));
  const b = body as { data?: AuthResult };
  return (b?.data ?? body) as AuthResult;
}

export async function apiLogout(): Promise<void> {
  // /auth/logout usa authenticate middleware (Bearer token nell'header) — nessun body necessario
  await request<void>("POST", "/auth/logout").catch(() => {});
}

export async function apiLogoutAll(): Promise<void> {
  await request<void>("POST", "/auth/logout-all").catch(() => {});
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function apiSearchUsers(q: string): Promise<PaginatedResult<UserProfile>> {
  return requestPaginated<UserProfile>("GET", `/users/search?q=${encodeURIComponent(q)}&limit=20`);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function apiCreateConversation(username: string): Promise<ConversationCreated> {
  return request<ConversationCreated>("POST", "/conversations", { username });
}

export async function apiListConversations(): Promise<PaginatedResult<ConversationItem>> {
  return requestPaginated<ConversationItem>("GET", "/conversations");
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Codifica testo → base64 UTF-8 safe.
 * Usato come fallback legacy quando Signal non è disponibile.
 * Non esportato: usare signalEncrypt() dal modulo signal/.
 */
function encodeMessage(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binStr);
}

/**
 * Decodifica base64 → testo (messaggi pre-Fase 2).
 * Mantenuto per compatibilità legacy.
 * Per messaggi Signal usare signalDecrypt() dal modulo signal/.
 */
export function decodeMessage(ciphertext: string): string {
  try {
    const binStr = atob(ciphertext);
    const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "[cifrato]";
  }
}

export async function apiSendMessage(
  conversationId: string,
  text: string,
  options: {
    replyToMessageId?: string;
    burnAfterRead?: boolean;
    /** Fase 2: body e tipo già cifrati con Signal — se forniti, usati al posto di encodeMessage */
    signal?: { body: string; type: number };
    /** Fase 2: client_message_id generato dal chiamante (per sentCache) */
    clientMessageId?: string;
    /** Fase 4: array multi-device ciphertexts */
    deviceCiphertexts?: Array<{ device_id: string; body: string; type: number }>;
    /** Inoltro: usa message_type "forward" */
    forward?: boolean;
    /** Override esplicito del message_type (es. "sticker") */
    messageType?: string;
  } = {},
): Promise<MessageItem> {
  const ciphertext = options.signal?.body ?? encodeMessage(text);
  const ciphertextType = options.signal?.type ?? 1;
  const messageType = options.messageType
    ?? (options.replyToMessageId ? "reply" : options.forward ? "forward" : "text");
  return request<MessageItem>("POST", `/conversations/${conversationId}/messages`, {
    client_message_id: options.clientMessageId ?? crypto.randomUUID(),
    ciphertext,
    ciphertext_type: ciphertextType,
    sender_key_id: 1,
    message_type: messageType,
    sent_at: new Date().toISOString(),
    reply_to_message_id: options.replyToMessageId ?? null,
    burn_after_read: options.burnAfterRead ?? false,
    device_ciphertexts: options.deviceCiphertexts ?? [],
  });
}

export async function apiEditMessage(
  conversationId: string,
  messageId: string,
  text: string,
  /** Fase 2: se fornito, usa il body Signal invece di encodeMessage */
  signal?: { body: string; type: number },
): Promise<MessageItem> {
  const ciphertext = signal?.body ?? encodeMessage(text);
  const ciphertextType = signal?.type ?? 1;
  return request<MessageItem>("PATCH", `/conversations/${conversationId}/messages/${messageId}`, {
    ciphertext,
    ciphertext_type: ciphertextType,
  });
}

export interface MediaUploadResult {
  media_id:          string;
  mime_type:         string;
  original_filename: string | null;
  has_thumbnail:     boolean;
  duration_ms:       number | null;
  waveform:          number[];
  ciphertext_size?:  number;
}

/** Upload audio blob via multipart/form-data */
export async function apiUploadMedia(
  conversationId: string,
  blob: Blob,
  durationMs: number,
  waveform: number[],
): Promise<MediaUploadResult> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const form = new FormData();
  form.append("file", blob, "audio.webm");
  form.append("mime_type", blob.type || "audio/webm");
  form.append("conversation_id", conversationId);
  form.append("duration_ms", String(Math.round(durationMs)));
  if (waveform.length > 0) form.append("waveform", JSON.stringify(waveform));

  const res = await fetch(`${BASE}/media`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string } };
    throw new Error(body.error?.code ?? `HTTP ${res.status}`);
  }
  const json = await res.json() as { data: MediaUploadResult };
  return json.data;
}

/**
 * Fase 3: Upload di un blob già cifrato con AES-256-GCM.
 * Il server riceve solo byte opachi — mai il file originale in chiaro.
 * Sprint 29: multipart/form-data al posto del JSON base64 (meno CPU, stream nativo).
 */
export async function apiUploadEncryptedMedia(
  conversationId: string,
  encryptedBlob: Blob,
  originalMimeType: string,
  options: {
    durationMs?: number;
    waveform?: number[];
    originalFilename?: string;
    onProgress?: (pct: number) => void;
    /** Fase 4: thumbnail cifrata (base64) — mai in chiaro al server */
    encryptedThumbnail?: string;
  } = {},
): Promise<MediaUploadResult> {
  const { onProgress, durationMs, waveform, originalFilename, encryptedThumbnail } = options;
  onProgress?.(5);

  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const form = new FormData();
  form.append("file", encryptedBlob, "media.enc");
  form.append("mime_type", originalMimeType);
  form.append("conversation_id", conversationId);
  if (durationMs      != null)  form.append("duration_ms", String(Math.round(durationMs)));
  if (waveform?.length)         form.append("waveform", JSON.stringify(waveform));
  if (originalFilename)         form.append("original_filename", originalFilename);
  if (encryptedThumbnail)       form.append("thumbnail", encryptedThumbnail);

  onProgress?.(70);

  const res = await fetch(`${BASE}/media`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string } };
    throw new Error(body.error?.code ?? `HTTP ${res.status}`);
  }
  const json = await res.json() as { data: MediaUploadResult };
  onProgress?.(100);
  return json.data;
}

/**
 * Fase 3: Invia un messaggio media già caricato sul server.
 * Il ciphertext Signal contiene i metadata (inclusa la chiave AES) cifrati E2E.
 */
export async function apiSendMediaMessage(
  conversationId: string,
  mediaId: string,
  signal?: { body: string; type: number },
  clientMessageId?: string,
  plaintextMetaFallback?: string,
  deviceCiphertexts?: Array<{ device_id: string; body: string; type: number }>,
  forward?: boolean,
): Promise<MessageItem> {
  const ciphertext = signal?.body
    ?? (plaintextMetaFallback ? btoa(plaintextMetaFallback) : "");
  return request<MessageItem>("POST", `/conversations/${conversationId}/messages`, {
    client_message_id: clientMessageId ?? crypto.randomUUID(),
    ciphertext,
    ciphertext_type: signal?.type ?? 1,
    sender_key_id:   1,
    // Inoltro media: "forward" per mostrare indicatore "Inoltrato" nel bubble.
    // Il backend accetta "forward" + media_id (schema Zod già compatibile).
    message_type:    forward ? "forward" : "media",
    media_id:        mediaId,
    sent_at:         new Date().toISOString(),
    device_ciphertexts: deviceCiphertexts ?? [],
  });
}

/** Invia un messaggio vocale: prima fa upload, poi crea il messaggio */
export async function apiSendVoiceMessage(
  conversationId: string,
  blob: Blob,
  durationMs: number,
  waveform: number[],
): Promise<MessageItem> {
  const media = await apiUploadMedia(conversationId, blob, durationMs, waveform);

  // Il ciphertext contiene i metadati vocali come base64-JSON (M1, non ancora cifrato)
  const meta = JSON.stringify({
    type: "voice",
    media_id: media.media_id,
    duration_ms: media.duration_ms ?? durationMs,
    waveform: media.waveform.length > 0 ? media.waveform : waveform,
  });
  const ciphertext = btoa(meta);

  return request<MessageItem>("POST", `/conversations/${conversationId}/messages`, {
    client_message_id: crypto.randomUUID(),
    ciphertext,
    ciphertext_type: 1,
    sender_key_id: 1,
    message_type: "media",
    media_id: media.media_id,
    sent_at: new Date().toISOString(),
  });
}

// ── Genera thumbnail JPEG lato client (max 240×240) ─────────────────────────

async function generateImageThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const MAX = 240;
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(""); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      URL.revokeObjectURL(url);
      // Strip data:image/jpeg;base64, prefix
      resolve(dataUrl.split(",")[1] ?? "");
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
    img.src = url;
  });
}

async function generateVideoThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url   = URL.createObjectURL(file);
    video.preload  = "metadata";
    video.muted    = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      const canvas = document.createElement("canvas");
      const MAX = 240;
      const scale = Math.min(MAX / video.videoWidth, MAX / video.videoHeight, 1);
      canvas.width  = Math.round(video.videoWidth  * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); resolve(""); return; }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      URL.revokeObjectURL(url);
      resolve(dataUrl.split(",")[1] ?? "");
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
    video.src = url;
  });
}

/**
 * Upload generico di un File (foto, video, documento).
 * Genera thumbnail client-side per immagini e video.
 * Onprogress: simulato a 0→100 (il fetch non espone progress su body piccoli).
 */
export async function apiUploadFile(
  conversationId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<MediaUploadResult> {
  onProgress?.(10);

  let thumbnailBase64 = "";
  if (file.type.startsWith("image/")) {
    thumbnailBase64 = await generateImageThumbnail(file);
  } else if (file.type.startsWith("video/")) {
    thumbnailBase64 = await generateVideoThumbnail(file);
  }

  onProgress?.(40);

  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("mime_type", file.type || "application/octet-stream");
  form.append("conversation_id", conversationId);
  form.append("original_filename", file.name);
  if (thumbnailBase64) form.append("thumbnail", thumbnailBase64);

  onProgress?.(60);

  const res = await fetch(`${BASE}/media`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string } };
    throw new Error(body.error?.code ?? `HTTP ${res.status}`);
  }
  const json = await res.json() as { data: MediaUploadResult };
  onProgress?.(100);
  return json.data;
}

/**
 * Invia un messaggio file (foto/video/documento): upload + crea messaggio.
 * Encoding metadata nel ciphertext come base64-JSON (M1).
 */
export async function apiSendFileMessage(
  conversationId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<MessageItem> {
  const media = await apiUploadFile(conversationId, file, onProgress);

  const mtype = file.type.startsWith("image/")  ? "image"
              : file.type.startsWith("video/")   ? "video"
              : file.type.startsWith("audio/")   ? "voice"
              : "document";

  const meta = JSON.stringify({
    type:      mtype,
    media_id:  media.media_id,
    mime_type: file.type,
    filename:  file.name,
    size:      file.size,
    ...(media.duration_ms != null ? { duration_ms: media.duration_ms } : {}),
    ...(media.waveform.length > 0 ? { waveform: media.waveform }       : {}),
  });
  const ciphertext = btoa(meta);

  return request<MessageItem>("POST", `/conversations/${conversationId}/messages`, {
    client_message_id: crypto.randomUUID(),
    ciphertext,
    ciphertext_type:   1,
    sender_key_id:     1,
    message_type:      "media",
    media_id:          media.media_id,
    sent_at:           new Date().toISOString(),
  });
}

/**
 * Scarica un file media come blob URL.
 * Sprint 29: il backend restituisce un Signed URL R2 (5 min).
 * Il fetch del blob avviene direttamente da R2, senza proxy server.
 */
export async function apiFetchMediaBlob(mediaId: string): Promise<string> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Proxy server-side: il server scarica da R2 e restituisce i byte direttamente.
  // Evita CORS cross-origin verso R2 signed URL (non configurabile via S3 API su Cloudflare R2).
  const res = await fetch(`${BASE}/media/${mediaId}/download`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string } };
    throw new Error(body.error?.code ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Fase 3: Scarica un blob cifrato e lo decifra localmente con AES-256-GCM.
 * Il server non partecipa alla decifratura — zero-knowledge completo.
 */
// ---------------------------------------------------------------------------
// Fase 4: Device Manager + Multi-device key bundles
// ---------------------------------------------------------------------------

/** Tutti i bundle Signal del destinatario (uno per device attivo) */
export async function apiGetAllKeyBundles(userId: string): Promise<ApiReceivedKeyBundle[]> {
  return request<ApiReceivedKeyBundle[]>("GET", `/keys/bundle/${userId}/all`);
}

/** Elenco device dell'utente corrente */
export async function apiListDevices(): Promise<DeviceInfo[]> {
  return request<DeviceInfo[]>("GET", "/keys/devices");
}

/** Revoca un device (cancella il suo bundle Signal dal server) */
export async function apiRevokeDevice(deviceId: string): Promise<void> {
  return request<void>("DELETE", `/keys/devices/${deviceId}`);
}

/**
 * Rileva il MIME type audio dai magic bytes del buffer decifrato.
 * Non si fida del mime_type dichiarato (che potrebbe mancare per messaggi vecchi).
 * - WebM:  0x1A 0x45 0xDF 0xA3 (EBML header)
 * - MP4/M4A: 'ftyp' box a offset 4
 * - OGG:   0x4F 0x67 0x67 0x53
 */
function detectAudioMimeType(buffer: ArrayBuffer, hint?: string): string {
  const b = new Uint8Array(buffer.slice(0, 12));
  // WebM
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  // MP4/M4A (ftyp box)
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "audio/mp4";
  // OGG
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "audio/ogg";
  // Fallback: usa hint se disponibile (es. da VoiceMeta.mime_type), altrimenti webm
  return hint || "audio/webm";
}

export async function apiFetchAndDecryptMediaBlob(
  mediaId: string,
  keyBase64: string,
  ivBase64: string,
  /** Hint MIME type (da VoiceMeta.mime_type). Viene usato solo se i magic bytes non riconoscono il formato. */
  mimeTypeHint?: string,
): Promise<string> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Proxy server-side: evita fetch cross-origin verso R2 (CORS non configurabile via S3 API).
  // Il server scarica i byte cifrati da R2 e li restituisce direttamente.
  const res = await fetch(`${BASE}/media/${mediaId}/download`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string } };
    throw new Error(body.error?.code ?? `HTTP ${res.status}`);
  }
  const encrypted = await res.arrayBuffer();

  // AES-256-GCM decrypt — chiave estratta dal metadata Signal-decifrato
  const binKey = atob(keyBase64);
  const keyBytes = new Uint8Array(binKey.length);
  for (let i = 0; i < binKey.length; i++) keyBytes[i] = binKey.charCodeAt(i);

  const binIv = atob(ivBase64);
  const iv = new Uint8Array(binIv.length);
  for (let i = 0; i < binIv.length; i++) iv[i] = binIv.charCodeAt(i);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, encrypted);

  // Auto-rileva il tipo dai magic bytes — funziona per messaggi vecchi (senza mime_type)
  // e nuovi (dove mime_type è già nel metadata), ignorando eventuali hint errati
  const detectedMime = detectAudioMimeType(decrypted, mimeTypeHint);
  const blob = new Blob([decrypted], { type: detectedMime });
  return URL.createObjectURL(blob);
}

export async function apiDeleteMessage(
  conversationId: string,
  messageId: string,
  forEveryone: boolean,
): Promise<void> {
  await request<void>("DELETE", `/conversations/${conversationId}/messages/${messageId}`, {
    for_everyone: forEveryone,
  });
}

export async function apiSecureDestroy(
  conversationId: string,
  messageId: string,
): Promise<void> {
  await request<void>("DELETE", `/conversations/${conversationId}/messages/${messageId}/destroy`);
}

export async function apiToggleReaction(
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<{ message_id: string; conversation_id: string; reactions: Record<string, string[]> }> {
  return request<{ message_id: string; conversation_id: string; reactions: Record<string, string[]> }>(
    "POST",
    `/conversations/${conversationId}/messages/${messageId}/reactions`,
    { emoji },
  );
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export interface InviteData {
  code: string;
  expires_at: string;
  invite_id: string;
  qr_payload: string;
}

export interface RedeemResult {
  conversation_id: string;
  is_new: boolean;
}

/** Genera un nuovo codice invito (invalida i precedenti) */
export async function apiGenerateInvite(
  expiresInSeconds = 300,
): Promise<InviteData> {
  return request<InviteData>("POST", "/invites/generate", { expires_in_seconds: expiresInSeconds });
}

/** Riscatta un codice invito ricevuto */
/** Errore speciale per 429 — include il tempo di attesa esatto */
export class RateLimitError extends Error {
  constructor(message: string, public readonly retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitError";
  }
}

export async function apiRedeemInvite(code: string): Promise<RedeemResult> {
  const token = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/invites/redeem`, {
    method: "POST",
    headers,
    body: JSON.stringify({ code }),
  });

  let jsonBody: unknown;
  try { jsonBody = await res.json(); } catch { jsonBody = null; }

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get("Retry-After");
    const seconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
    const msg = extractErrorMessage(jsonBody, "Troppe richieste. Riprova tra qualche momento.");
    throw new RateLimitError(msg, isNaN(seconds) ? 60 : seconds);
  }

  if (!res.ok) {
    throw new Error(extractErrorMessage(jsonBody, `Errore ${res.status}`));
  }

  if (jsonBody && typeof jsonBody === "object" && "data" in (jsonBody as object)) {
    return (jsonBody as { data: RedeemResult }).data;
  }
  return jsonBody as RedeemResult;
}

/** Controlla se esiste già un invite attivo lato server (non espone il codice) */
export async function apiCheckActiveInvite(): Promise<{ has_active: boolean; expires_at: string | null }> {
  return request<{ has_active: boolean; expires_at: string | null }>("GET", "/invites/active");
}

/** Revoca tutti i codici invito attivi */
export async function apiMarkRead(convId: string): Promise<void> {
  await request<void>("PATCH", `/conversations/${convId}/read`);
}

/** Elimina la conversazione per l'utente corrente (soft-delete membership). */
export async function apiDeleteConversation(convId: string): Promise<void> {
  await request<void>("DELETE", `/conversations/${convId}`);
}

export async function apiRevokeInvites(): Promise<{ revoked: number }> {
  return request<{ revoked: number }>("DELETE", "/invites/mine");
}

// ---------------------------------------------------------------------------
// Privacy (Sprint 15)
// ---------------------------------------------------------------------------

export interface PrivacySettings {
  show_last_seen: "everyone" | "contacts" | "nobody";
  show_online_status: "everyone" | "contacts" | "nobody";
  show_read_receipts: boolean;
  allow_adding_to_groups: "everyone" | "contacts" | "nobody";
  allow_calls_from: "everyone" | "contacts" | "nobody";
  ghost_mode: boolean;
}

export interface DisappearingSettings {
  enabled: boolean;
  duration_ms: number | null;
}

export interface BlockedUserEntry {
  user_id: string;
  username: string;
  display_name: string;
  blocked_at: string;
}

export async function apiGetPrivacySettings(): Promise<PrivacySettings> {
  return request<PrivacySettings>("GET", "/users/me/privacy");
}

export async function apiUpdatePrivacySettings(
  patch: Partial<PrivacySettings & { ghost_mode: boolean }>,
): Promise<PrivacySettings> {
  return request<PrivacySettings>("PATCH", "/users/me/privacy", patch);
}

export async function apiListBlocked(): Promise<BlockedUserEntry[]> {
  return request<BlockedUserEntry[]>("GET", "/users/me/blocked");
}

// ── Impostazioni notifiche — Sprint 27 ───────────────────────────────────────

export interface BackendNotificationSettings {
  messages:     boolean;
  calls:        boolean;
  groups:       boolean;
  preview_text: boolean;
}

export async function apiGetNotificationSettings(): Promise<BackendNotificationSettings> {
  return request<BackendNotificationSettings>("GET", "/users/me/notifications");
}

export async function apiUpdateNotificationSettings(
  patch: Partial<BackendNotificationSettings>,
): Promise<BackendNotificationSettings> {
  return request<BackendNotificationSettings>("PATCH", "/users/me/notifications", patch);
}

// ── Cronologia chiamate — Sprint 25 ──────────────────────────────────────────

export interface CallLogEntry {
  _id: string;
  caller_id: string;
  callee_id: string;
  call_type: "audio" | "video";
  status: "missed" | "declined" | "completed" | "failed" | "cancelled";
  started_at: string;
  answered_at?: string;
  ended_at?: string;
  duration_sec?: number;
}

export async function apiLogCall(data: {
  peer_id: string;
  call_type: "audio" | "video";
  status: string;
  started_at: string;
  answered_at?: string;
  ended_at?: string;
  duration_sec?: number;
  role: "caller" | "callee";
}): Promise<void> {
  await request<unknown>("POST", "/calls/log", data);
}

export async function apiGetCallHistory(limit = 50): Promise<CallLogEntry[]> {
  const data = await request<{ calls: CallLogEntry[] }>("GET", `/calls/history?limit=${limit}`);
  return data.calls;
}

/** Aggiorna il profilo dell'utente autenticato (display_name, avatar_url). */
export async function apiUpdateMe(patch: {
  display_name?: string;
  avatar_url?: string | null;
}): Promise<{ display_name: string; avatar_url: string | null }> {
  return request<{ display_name: string; avatar_url: string | null }>("PATCH", "/users/me", patch);
}

/** Cancella definitivamente tutti i messaggi di una conversazione sul server. */
export async function apiClearConversationMessages(conversationId: string): Promise<void> {
  await request<void>("DELETE", `/conversations/${conversationId}/messages`);
}

export async function apiBlockUser(userId: string): Promise<void> {
  await request<void>("POST", `/users/${userId}/block`);
}

export async function apiUnblockUser(userId: string): Promise<void> {
  await request<void>("DELETE", `/users/${userId}/block`);
}

// ---------------------------------------------------------------------------
// Signal Protocol — Key Distribution (Sprint 16, Fase 1)
// ---------------------------------------------------------------------------

export interface ApiKeyBundleUpload {
  deviceId: string;
  registrationId: number;
  identityKey: string;           // base64
  signedPreKeyId: number;
  signedPreKey: string;          // base64
  signedPreKeySignature: string; // base64
  oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
}

export interface ApiReceivedKeyBundle {
  userId: string;
  deviceId: string;
  registrationId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKey: { keyId: number; publicKey: string } | null;
  hasOneTimePreKey: boolean;
}

export interface ApiKeyCountResponse {
  userId: string;
  otpkCount: number;
  needsReplenishment: boolean;
  bundleExists: boolean;
}

/** Carica il bundle di chiavi pubbliche sul server (chiamato dopo login/registrazione) */
export async function apiUploadKeyBundle(bundle: ApiKeyBundleUpload): Promise<void> {
  await request<void>("POST", "/keys/bundle", {
    device_id: bundle.deviceId,
    registration_id: bundle.registrationId,
    identity_key: bundle.identityKey,
    signed_pre_key_id: bundle.signedPreKeyId,
    signed_pre_key: bundle.signedPreKey,
    signed_pre_key_signature: bundle.signedPreKeySignature,
    one_time_pre_keys: bundle.oneTimePreKeys.map((k) => ({
      key_id: k.keyId,
      public_key: k.publicKey,
    })),
  });
}

/** Recupera il bundle Signal di un utente per iniziare una sessione X3DH */
export async function apiGetKeyBundle(userId: string): Promise<ApiReceivedKeyBundle> {
  return request<ApiReceivedKeyBundle>("GET", `/keys/bundle/${userId}`);
}

/** Controlla il livello OTPK locali rimaste sul server */
export async function apiGetKeyCount(): Promise<ApiKeyCountResponse> {
  const res = await request<{ data: ApiKeyCountResponse }>("GET", "/keys/count");
  return res.data;
}

/** Rifornisce il pool di One-Time PreKeys sul server */
export async function apiReplenishOneTimePreKeys(payload: {
  deviceId: string;
  oneTimePreKeys: Array<{ keyId: number; publicKey: string }>;
}): Promise<void> {
  await request<void>("POST", "/keys/one-time-pre-keys", {
    device_id: payload.deviceId,
    one_time_pre_keys: payload.oneTimePreKeys.map((k) => ({
      key_id: k.keyId,
      public_key: k.publicKey,
    })),
  });
}

/** Ruota la Signed PreKey (ogni ~settimana) */
export async function apiRotateSignedPreKey(payload: {
  deviceId: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
}): Promise<void> {
  await request<void>("PUT", "/keys/signed-pre-key", {
    device_id: payload.deviceId,
    signed_pre_key_id: payload.signedPreKeyId,
    signed_pre_key: payload.signedPreKey,
    signed_pre_key_signature: payload.signedPreKeySignature,
  });
}

export async function apiSetDisappearing(
  conversationId: string,
  enabled: boolean,
  duration_ms?: number | null,
): Promise<DisappearingSettings> {
  return request<DisappearingSettings>(
    "PATCH",
    `/conversations/${conversationId}/disappearing`,
    { enabled, duration_ms: enabled ? duration_ms : null },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gruppi E2E — Sprint 21
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupMemberInfo {
  user_id:      string;
  username:     string;
  display_name: string;
  role:         "admin" | "member";
  joined_at:    string;
}

export interface GroupDetail {
  group_id:        string;
  name:            string;
  description:     string;
  member_count:    number;
  max_members:     number;
  created_by:      string;
  created_at:      string;
  my_role:         "admin" | "member";
  members:         GroupMemberInfo[];
  avatar_url:      string | null;
  avatar_media_id: string | null;
}

export async function apiCreateGroup(
  name: string,
  description: string,
  memberUsernames: string[],
): Promise<GroupDetail> {
  return request<GroupDetail>("POST", "/groups", { name, description, member_usernames: memberUsernames });
}

export async function apiGetGroup(groupId: string): Promise<GroupDetail> {
  return request<GroupDetail>("GET", `/groups/${groupId}`);
}

export async function apiUpdateGroup(
  groupId: string,
  fields: { name?: string; description?: string; avatar_media_id?: string | null },
): Promise<GroupDetail> {
  return request<GroupDetail>("PATCH", `/groups/${groupId}`, fields);
}

/** Carica un blob come avatar del gruppo. Ritorna il media_id assegnato dal server. */
export async function apiUploadGroupAvatar(groupId: string, blob: Blob): Promise<string> {
  const token = getAccessToken() ?? "";  // fix: usa getAccessToken() (chiave "ac_access_token")
  const form  = new FormData();
  form.append("file", blob, "avatar.jpg");
  form.append("conversation_id", groupId);
  form.append("mime_type", blob.type || "image/jpeg");
  const res = await fetch(`${BASE}/media`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}` },
    body:    form,
  });
  if (!res.ok) throw new Error(`Upload avatar fallito: ${res.status}`);
  const body = await res.json() as { data?: { media_id?: string } };
  const mediaId = body.data?.media_id;
  if (!mediaId) throw new Error("media_id mancante nella risposta");
  return mediaId;
}

export async function apiDeleteGroup(groupId: string): Promise<void> {
  await request<unknown>("DELETE", `/groups/${groupId}`);
}

export async function apiAddGroupMember(groupId: string, username: string): Promise<GroupMemberInfo> {
  return request<GroupMemberInfo>("POST", `/groups/${groupId}/members`, { username });
}

export async function apiRemoveGroupMember(groupId: string, userId: string): Promise<void> {
  await request<unknown>("DELETE", `/groups/${groupId}/members/${userId}`);
}

export async function apiLeaveGroup(groupId: string): Promise<void> {
  await request<unknown>("POST", `/groups/${groupId}/leave`);
}

export async function apiChangeGroupMemberRole(
  groupId: string,
  userId: string,
  role: "admin" | "member",
): Promise<void> {
  await request<unknown>("PATCH", `/groups/${groupId}/members/${userId}/role`, { role });
}

// ---------------------------------------------------------------------------
// Language preference
// ---------------------------------------------------------------------------

/** Salva la lingua preferita dell'utente sul backend (usata per le email). */
export async function apiUpdateUserLanguage(language: string): Promise<void> {
  await request<unknown>("PATCH", "/users/me/language", { language });
}

export async function apiListMessages(
  conversationId: string,
  options: { limit?: number; beforeSequence?: number } = {},
): Promise<PaginatedResult<MessageItem>> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.beforeSequence) params.set("before_sequence", String(options.beforeSequence));
  const qs = params.toString();
  return requestPaginated<MessageItem>(
    "GET",
    `/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`,
  );
}

/**
 * Invia un evento di audit Signal al server (fire-and-forget).
 * Sostituisce console.debug/error per eventi crittografici visibili
 * solo lato client, rendendoli disponibili nei log strutturati del server.
 */
export async function apiSignalAudit(
  tag: string,
  data: Record<string, unknown>,
): Promise<void> {
  await request<void>("POST", "/signal/audit", { tag, data });
}

// ── Web Push Notifications ──────────────────────────────────────────────────

export async function apiGetVapidPublicKey(): Promise<string | null> {
  try {
    const data = await request<{ publicKey: string }>("GET", "/push/vapid-public-key");
    return data.publicKey ?? null;
  } catch { return null; }
}

export interface PushSubscribeInput {
  endpoint: string;
  p256dh:   string;
  auth:     string;
  platform?: string;
  browser?:  string;
  device?:   string;
}

export async function apiSubscribePush(sub: PushSubscribeInput): Promise<void> {
  await request<unknown>("POST", "/push/subscribe", sub);
}

export async function apiUnsubscribePush(endpoint?: string): Promise<void> {
  await request<unknown>("DELETE", "/push/subscribe", endpoint ? { endpoint } : {});
}

// ── Phoenix Protocol ──────────────────────────────────────────────────────────

export interface PhoenixRecoveryData {
  username:      string;
  emergencyId:   string;
  hasPhoenixCode: boolean;
  portalUrl:     string;
}

export async function apiGetPhoenixRecoveryCard(): Promise<PhoenixRecoveryData> {
  return request<PhoenixRecoveryData>("GET", "/phoenix/recovery-card");
}

export async function apiSetupPhoenixCode(
  phoenixCode: string,
): Promise<{ success: boolean; emergency_id: string }> {
  return request<{ success: boolean; emergency_id: string }>(
    "POST", "/phoenix/setup", { phoenix_code: phoenixCode },
  );
}

/**
 * GET /users/me/presence/contacts
 * Ritorna gli user_id dei contatti attualmente online.
 * Chiamato al (ri)connessione WS per ottenere lo stato iniziale senza dipendere
 * dal timing degli eventi presence.online (race condition auth.ok vs ChatPage mount).
 */
export async function apiGetContactsPresence(): Promise<{ online_user_ids: string[] }> {
  return request<{ online_user_ids: string[] }>("GET", "/users/me/presence/contacts");
}

export async function apiDestroyAccountDirect(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("POST", "/phoenix/destroy-direct");
}

// ── App Feature Flags ─────────────────────────────────────────────────────────

export interface AppFeatureFlags {
  /** Quando false: USDT e BTC nascosti nella chat, rimane solo USDA nativo */
  multichain_payments_enabled: boolean;
  /**
   * Quando false: Lightning/Spark nascosti nella chat.
   * ISOLAMENTO: indipendente da multichain_payments_enabled.
   * Default: false — disabilitato fino a go-live esplicito (admin lo abilita).
   */
  spark_lightning_enabled: boolean;
}

// ── Lightning Invoice Links — deep link per condivisione invoice ──────────────

/**
 * Crea un link opaque per una invoice BOLT11 specifica.
 * Nessun dato personale associato: privacy by design.
 * @returns invoiceId — ID a 12 caratteri da usare in alphachat.sbs/pay/lightning/:id
 */
export async function apiCreateLightningInvoiceLink(payload: {
  bolt11:           string;
  amountSat:        number | null;
  expiresAt:        number; // Unix seconds
  originalAmount:   number | null;
  originalCurrency: "BTC" | "EUR" | "USD";
}): Promise<{ invoiceId: string }> {
  return request<{ invoiceId: string }>("POST", "/lightning/invoice-links", payload);
}

/**
 * Legge i feature flag dall'admin (endpoint senza auth, fail-open).
 * In caso di errore restituisce il default sicuro.
 * spark_lightning_enabled: fail-safe = false (non mostra Lightning se API non raggiungibile).
 */
export async function apiGetAppFeatureFlags(): Promise<AppFeatureFlags> {
  try {
    return await request<AppFeatureFlags>("GET", "/admin/app-feature-flags");
  } catch {
    // Fail-safe: multichain abilitato (comportamento precedente), Spark disabilitato
    return { multichain_payments_enabled: true, spark_lightning_enabled: false };
  }
}
