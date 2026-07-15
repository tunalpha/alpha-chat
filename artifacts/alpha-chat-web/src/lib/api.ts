/**
 * API client — wrapper fetch verso /api/v1/*.
 * Gestisce refresh automatico del token su 401.
 */

import { getAccessToken, getRefreshToken, updateAccessToken, saveAuth, clearAuth, getDeviceId } from "./auth";

const BASE = "/api/v1";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface RegisterInput {
  username: string;
  password: string;
  display_name: string;
}

export interface LoginInput {
  username_or_email: string;
  password: string;
}

export interface AuthResult {
  access_token: string;
  refresh_token: string;
  user: { id: string; username: string; display_name: string };
}

export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online?: boolean;
}

export interface ConversationItem {
  id: string;
  type: "direct" | "group";
  last_activity_at: string | null;
  last_message_id: string | null;
  unread_count: number;
  other_user?: UserProfile;
}

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

export interface MessageListResult {
  messages: MessageItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

async function attemptRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken, device_id: getDeviceId() }),
    });
    if (!res.ok) {
      clearAuth();
      return null;
    }
    const data = (await res.json()) as AuthResult;
    updateAccessToken(data.access_token);
    saveAuth({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user.id,
      username: data.user.username,
      displayName: data.user.display_name,
    });
    return data.access_token;
  } catch {
    clearAuth();
    return null;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  const token = getAccessToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client-Version": "1.0.0",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Token scaduto → refresh e riprova una volta
  if (res.status === 401 && retry) {
    if (isRefreshing) {
      // Aspetta che il refresh corrente finisca
      const newToken = await new Promise<string | null>((resolve) => {
        refreshQueue.push((t) => resolve(t));
      });
      if (!newToken) throw new Error("SESSION_EXPIRED");
      return request<T>(method, path, body, false);
    }

    isRefreshing = true;
    const newToken = await attemptRefresh();
    isRefreshing = false;
    refreshQueue.forEach((cb) => cb(newToken ?? ""));
    refreshQueue = [];

    if (!newToken) {
      // Dispatch evento per far uscire l'utente
      window.dispatchEvent(new CustomEvent("auth:expired"));
      throw new Error("SESSION_EXPIRED");
    }
    return request<T>(method, path, body, false);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { message?: string; error?: string };
      msg = err.message ?? err.error ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function apiRegister(input: RegisterInput): Promise<AuthResult> {
  return request<AuthResult>("POST", "/auth/register", input);
}

export async function apiLogin(input: LoginInput): Promise<AuthResult> {
  return request<AuthResult>("POST", "/auth/login", {
    ...input,
    device_id: getDeviceId(),
    device_name: navigator.userAgent.slice(0, 80),
  });
}

export async function apiLogout(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await request<void>("POST", "/auth/logout", { refresh_token: refreshToken }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function apiSearchUsers(q: string): Promise<{ users: UserProfile[] }> {
  return request<{ users: UserProfile[] }>("GET", `/users/search?q=${encodeURIComponent(q)}&limit=20`);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function apiCreateConversation(username: string): Promise<{ id: string }> {
  return request<{ id: string }>("POST", "/conversations", { username });
}

export async function apiListConversations(): Promise<{ conversations: ConversationItem[] }> {
  return request<{ conversations: ConversationItem[] }>("GET", "/conversations");
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Codifica testo → base64 (UTF-8 safe) */
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
    return "[encrypted]";
  }
}

export async function apiSendMessage(
  conversationId: string,
  text: string,
): Promise<MessageItem & { is_new: boolean }> {
  return request("POST", `/conversations/${conversationId}/messages`, {
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
): Promise<MessageListResult> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.beforeSequence) params.set("before_sequence", String(options.beforeSequence));
  const qs = params.toString();
  return request<MessageListResult>(
    "GET",
    `/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`,
  );
}
