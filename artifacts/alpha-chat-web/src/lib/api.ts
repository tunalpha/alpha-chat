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
export interface LastMessagePreview {
  message_id: string;
  sender_id: string;
  ciphertext: string;
  sent_at: string;
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

/** Metadati media estratti dal ciphertext di un media message */
export interface VoiceMeta {
  type: "voice";
  media_id: string;
  duration_ms: number;
  waveform: number[];
}

export type MediaMeta =
  | VoiceMeta
  | { type: "image";    media_id: string; mime_type: string; filename: string; size: number }
  | { type: "video";    media_id: string; mime_type: string; filename: string; size: number; duration_ms?: number }
  | { type: "document"; media_id: string; mime_type: string; filename: string; size: number };

export function decodeVoiceMeta(ciphertext: string | null): VoiceMeta | null {
  if (!ciphertext) return null;
  try {
    const json = atob(ciphertext);
    const parsed = JSON.parse(json) as VoiceMeta;
    if (parsed.type !== "voice") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function decodeMediaMeta(ciphertext: string | null): MediaMeta | null {
  if (!ciphertext) return null;
  try {
    const json   = atob(ciphertext);
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

  // 401 → prova a rinnovare il token (una volta sola, con cooldown)
  if (res.status === 401 && retry) {
    // Se il refresh è fallito di recente, non riprovare
    if (Date.now() - refreshFailedAt < REFRESH_COOLDOWN_MS) {
      window.dispatchEvent(new CustomEvent("auth:expired"));
      throw new Error("Sessione scaduta. Accedi di nuovo.");
    }

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

    if (!newToken) {
      refreshFailedAt = Date.now(); // evita loop
      refreshQueue.forEach((cb) => cb(null));
      refreshQueue = [];
      window.dispatchEvent(new CustomEvent("auth:expired"));
      throw new Error("Sessione scaduta. Accedi di nuovo.");
    }

    refreshFailedAt = 0; // reset su successo
    refreshQueue.forEach((cb) => cb(newToken));
    refreshQueue = [];
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

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("auth:expired"));
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

export async function apiRegister(input: RegisterInput): Promise<AuthResult> {
  return request<AuthResult>("POST", "/auth/register", {
    username: input.username,
    display_name: input.display_name,
    password: input.password,
    device_id: getDeviceId(),
    device_name: navigator.userAgent.slice(0, 80),
    device_type: "web" as const,
  });
}

export async function apiLogin(input: LoginInput): Promise<AuthResult> {
  return request<AuthResult>("POST", "/auth/login", {
    identifier: input.identifier,
    password: input.password,
    device_id: getDeviceId(),
    device_name: navigator.userAgent.slice(0, 80),
    device_type: "web" as const,
  });
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
  options: { replyToMessageId?: string } = {},
): Promise<MessageItem> {
  return request<MessageItem>("POST", `/conversations/${conversationId}/messages`, {
    client_message_id: crypto.randomUUID(),
    ciphertext: encodeMessage(text),
    ciphertext_type: 1,
    sender_key_id: 1,
    message_type: options.replyToMessageId ? "reply" : "text",
    sent_at: new Date().toISOString(),
    reply_to_message_id: options.replyToMessageId ?? null,
  });
}

export async function apiEditMessage(
  conversationId: string,
  messageId: string,
  text: string,
): Promise<MessageItem> {
  return request<MessageItem>("PATCH", `/conversations/${conversationId}/messages/${messageId}`, {
    ciphertext: encodeMessage(text),
    ciphertext_type: 1,
  });
}

export interface MediaUploadResult {
  media_id:          string;
  mime_type:         string;
  original_filename: string | null;
  has_thumbnail:     boolean;
  duration_ms:       number | null;
  waveform:          number[];
}

/** Upload audio blob come base64 JSON */
export async function apiUploadMedia(
  conversationId: string,
  blob: Blob,
  durationMs: number,
  waveform: number[],
): Promise<MediaUploadResult> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);

  return request<MediaUploadResult>("POST", "/media", {
    data: base64,
    mime_type: blob.type || "audio/webm",
    conversation_id: conversationId,
    duration_ms: Math.round(durationMs),
    waveform,
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

  const arrayBuffer = await file.arrayBuffer();
  const bytes  = new Uint8Array(arrayBuffer);
  let binary   = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);

  onProgress?.(40);

  let thumbnailBase64 = "";
  if (file.type.startsWith("image/")) {
    thumbnailBase64 = await generateImageThumbnail(file);
  } else if (file.type.startsWith("video/")) {
    thumbnailBase64 = await generateVideoThumbnail(file);
  }

  onProgress?.(60);

  const result = await request<MediaUploadResult>("POST", "/media", {
    data:              base64,
    mime_type:         file.type || "application/octet-stream",
    conversation_id:   conversationId,
    original_filename: file.name,
    thumbnail:         thumbnailBase64,
  });

  onProgress?.(100);
  return result;
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
 * Scarica un file media come blob URL autenticato.
 * L'elemento <audio> non può passare il Bearer token — questa funzione
 * fa il fetch con l'header Authorization e crea un objectURL temporaneo.
 */
export async function apiFetchMediaBlob(mediaId: string): Promise<string> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/media/${mediaId}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { code?: string } };
    throw new Error(body.error?.code ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
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
export async function apiRedeemInvite(code: string): Promise<RedeemResult> {
  return request<RedeemResult>("POST", "/invites/redeem", { code });
}

/** Revoca tutti i codici invito attivi */
export async function apiMarkRead(convId: string): Promise<void> {
  await request<void>("PATCH", `/conversations/${convId}/read`);
}

export async function apiRevokeInvites(): Promise<{ revoked: number }> {
  return request<{ revoked: number }>("DELETE", "/invites/mine");
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
