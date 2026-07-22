/**
 * payment-api.ts — Client REST per il Chat Payment Engine (Sprint 4)
 *
 * Consuma /api/v1/payments/*.
 * Pattern identico a usda-api.ts: stesso token, stessa base URL.
 */

import { getAccessToken } from "./auth";

const BASE = "/api/v1/payments";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type ChatTransferStatus =
  | "awaiting_deposit"
  | "pending"
  | "accepting"
  | "accepted"
  | "rejecting"
  | "rejected"
  | "cancelling"
  | "cancelled"
  | "refunding"
  | "expired"
  | "failed";

/** Shape di system_metadata per message_type: "payment" */
export interface ChatPaymentData {
  transfer_id:     string;
  status:          ChatTransferStatus;
  amount:          string;
  asset_symbol:    string;
  sender_id:       string;
  recipient_id:    string;
  expires_at:      string | null;
  tx_hash_release: string | null;
  // Nomi display (opzionali — precompilati dal backend se disponibili)
  sender_name?:    string;
  recipient_name?: string;
  note?:           string | null;
}

export interface ChatTransferResponse {
  transfer_id:     string;
  status:          ChatTransferStatus;
  amount:          string;
  asset_symbol:    string;
  sender_id:       string;
  recipient_id:    string;
  expires_at:      string | null;
  tx_hash_release: string | null;
  message_id:      string | null;
  conversation_id: string;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function paymentFetch<T>(
  method: string,
  path:   string,
  body?:  unknown,
): Promise<T> {
  const token   = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res  = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json() as { data?: T; error?: { code: string; message: string } };
  if (!res.ok) {
    const err: Error & { code?: string } = new Error(json.error?.message ?? `Payment API error ${res.status}`);
    err.code = json.error?.code;
    throw err;
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// API pubbliche
// ---------------------------------------------------------------------------

/** Destinatario accetta il pagamento. */
export async function apiPaymentAccept(transferId: string): Promise<ChatTransferResponse> {
  return paymentFetch<ChatTransferResponse>("POST", `/${transferId}/accept`);
}

/** Destinatario rifiuta il pagamento. */
export async function apiPaymentReject(transferId: string): Promise<ChatTransferResponse> {
  return paymentFetch<ChatTransferResponse>("POST", `/${transferId}/reject`);
}

/** Mittente annulla il pagamento. */
export async function apiPaymentCancel(transferId: string): Promise<ChatTransferResponse> {
  return paymentFetch<ChatTransferResponse>("POST", `/${transferId}/cancel`);
}

/** Recupera lo stato corrente di un transfer. */
export async function apiPaymentGet(transferId: string): Promise<ChatTransferResponse> {
  return paymentFetch<ChatTransferResponse>("GET", `/${transferId}`);
}

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

/** True se il transfer è in uno stato terminale (nessuna azione possibile). */
export function isTerminalTransferStatus(status: ChatTransferStatus): boolean {
  return ["accepted", "rejected", "cancelled", "expired", "failed"].includes(status);
}

/** True se il transfer è bloccato in un lock state (operazione blockchain in corso). */
export function isLockTransferStatus(status: ChatTransferStatus): boolean {
  return ["accepting", "rejecting", "cancelling", "refunding"].includes(status);
}
