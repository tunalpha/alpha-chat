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
  // campi aggiunti Sprint 15
  burn_after_read?: boolean;
  expires_at?: string | null;
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
): Promise<void> {
  await request<unknown>("POST", "/auth/change-temporary-password", {
    current_password: currentPassword,
    new_password:     newPassword,
    confirm_password: confirmPassword,
  });
}

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
  } = {},
): Promise<MessageItem> {
  const ciphertext = options.signal?.body ?? encodeMessage(text);
  const ciphertextType = options.signal?.type ?? 1;
  return request<MessageItem>("POST", `/conversations/${conversationId}/messages`, {
    client_message_id: options.clientMessageId ?? crypto.randomUUID(),
    ciphertext,
    ciphertext_type: ciphertextType,
    sender_key_id: 1,
    message_type: options.replyToMessageId ? "reply" : "text",
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

/**
 * Fase 3: Upload di un blob già cifrato con AES-256-GCM.
 * Il server riceve solo byte opachi — mai il file originale in chiaro.
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

  // Usa FileReader.readAsDataURL — gestione nativa (C++) di file grandi.
  // Il loop manuale con string += era O(n²) e causava freeze/crash su Safari iOS
  // con foto > 1 MB (3M concatenazioni per una foto da 3 MB).
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // dataUrl = "data:application/octet-stream;base64,<base64>"
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(encryptedBlob);
  });

  onProgress?.(70);

  const result = await request<MediaUploadResult>("POST", "/media", {
    data:            base64,
    mime_type:       originalMimeType,
    conversation_id: conversationId,
    encrypted:       true,
    ...(durationMs         != null  ? { duration_ms: Math.round(durationMs) } : {}),
    ...(waveform                    ? { waveform }                            : {}),
    ...(originalFilename            ? { original_filename: originalFilename } : {}),
    ...(encryptedThumbnail          ? { thumbnail: encryptedThumbnail }       : {}),
  });

  onProgress?.(100);
  return result;
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
): Promise<MessageItem> {
  const ciphertext = signal?.body
    ?? (plaintextMetaFallback ? btoa(plaintextMetaFallback) : "");
  return request<MessageItem>("POST", `/conversations/${conversationId}/messages`, {
    client_message_id: clientMessageId ?? crypto.randomUUID(),
    ciphertext,
    ciphertext_type: signal?.type ?? 1,
    sender_key_id:   1,
    message_type:    "media",
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

  const res = await fetch(`${BASE}/media/${mediaId}`, { headers });
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

/** Controlla se esiste già un invite attivo lato server (non espone il codice) */
export async function apiCheckActiveInvite(): Promise<{ has_active: boolean; expires_at: string | null }> {
  return request<{ has_active: boolean; expires_at: string | null }>("GET", "/invites/active");
}

/** Revoca tutti i codici invito attivi */
export async function apiMarkRead(convId: string): Promise<void> {
  await request<void>("PATCH", `/conversations/${convId}/read`);
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
  const res = await request<{ data: ApiReceivedKeyBundle }>("GET", `/keys/bundle/${userId}`);
  return res.data;
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
  group_id:     string;
  name:         string;
  description:  string;
  member_count: number;
  max_members:  number;
  created_by:   string;
  created_at:   string;
  my_role:      "admin" | "member";
  members:      GroupMemberInfo[];
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
  fields: { name?: string; description?: string },
): Promise<GroupDetail> {
  return request<GroupDetail>("PATCH", `/groups/${groupId}`, fields);
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
