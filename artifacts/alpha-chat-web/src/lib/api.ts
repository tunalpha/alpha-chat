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

import { getAccessToken, getRefreshToken, updateAccessToken, saveAuth, clearAuth, getDeviceId } from "./auth";

const BASE = "/api/v1";

// ---------------------------------------------------------------------------
// Tipi backend — corrispondono esattamente alle shape restituite dal server
// ---------------------------------------------------------------------------

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
}

export interface AuthUserProfile {
  id: string;
  username: string;
  display_name: string;
  email: string;
  is_verified: boolean;
}

/** Shape completa restituita da /auth/register, /auth/login, /auth/refresh */
export interface AuthResult {
  user: AuthUserProfile;
  tokens: AuthTokens;
  is_new_device: boolean;
  requires_2fa: false;
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
export interface ConversationItem {
  conversation_id: string;  // ← backend usa conversation_id, non id
  type: "direct" | "group";
  name: string | null;
  other_user: ConversationPartner | null;
  last_activity_at: string;
  last_message_at: string | null;
  unread_count: number;
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

/** Estrae il messaggio leggibile da una risposta di errore del backend */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    // Formato standard Alpha Chat: { error: { message, code } }
    if (b.error && typeof b.error === "object") {
      const e = b.error as Record<string, unknown>;
      if (typeof e.message === "string" && e.message) return e.message;
      if (typeof e.code === "string" && e.code) return e.code;
    }
    // Fallback generico
    if (typeof b.message === "string" && b.message) return b.message;
    if (typeof b.error === "string" && b.error) return b.error;
  }
  return fallback;
}

async function attemptRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken, device_id: getDeviceId() }),
    });
    if (!res.ok) { clearAuth(); return null; }

    const json = (await res.json()) as { data: AuthResult };
    const result = json.data;

    updateAccessToken(result.tokens.access_token);
    saveAuth({
      accessToken: result.tokens.access_token,
      refreshToken: result.tokens.refresh_token,
      userId: result.user.id,
      username: result.user.username,
      displayName: result.user.display_name,
    });
    return result.tokens.access_token;
  } catch {
    clearAuth();
    return null;
  }
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

  // 401 → prova a rinnovare il token
  if (res.status === 401 && retry) {
    if (isRefreshing) {
      const newToken = await new Promise<string | null>((resolve) => {
        refreshQueue.push(resolve);
      });
      if (!newToken) { window.dispatchEvent(new CustomEvent("auth:expired")); throw new Error("Sessione scaduta"); }
      return request<T>(method, path, body, false);
    }

    isRefreshing = true;
    const newToken = await attemptRefresh();
    isRefreshing = false;
    refreshQueue.forEach((cb) => cb(newToken));
    refreshQueue = [];

    if (!newToken) {
      window.dispatchEvent(new CustomEvent("auth:expired"));
      throw new Error("Sessione scaduta. Accedi di nuovo.");
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
// Auth
// ---------------------------------------------------------------------------

export async function apiRegister(input: RegisterInput): Promise<AuthResult> {
  return request<AuthResult>("POST", "/auth/register", input);
}

export async function apiLogin(input: LoginInput): Promise<AuthResult> {
  return request<AuthResult>("POST", "/auth/login", {
    identifier: input.identifier,
    password: input.password,
    device_id: getDeviceId(),
    device_name: navigator.userAgent.slice(0, 80),
  });
}

export async function apiLogout(): Promise<void> {
  // /auth/logout usa authenticate middleware (Bearer token nell'header) — nessun body necessario
  await request<void>("POST", "/auth/logout").catch(() => {});
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

/** Codifica testo → base64 UTF-8 safe (test client: simula ciphertext) */
export function encodeMessage(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binStr);
}

/** Decodifica base64 → testo */
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
): Promise<MessageItem> {
  return request<MessageItem>("POST", `/conversations/${conversationId}/messages`, {
    client_message_id: crypto.randomUUID(),
    ciphertext: encodeMessage(text),
    ciphertext_type: 1,
    sender_key_id: null,
    message_type: "text",
    sent_at: new Date().toISOString(),
  });
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
