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

  // Il backend /api/v1/payments risponde senza wrapper { data: ... } — gestisci entrambi.
  const json = await res.json() as { data?: T; error?: { code: string; message: string } } | T;
  const typed = json as { data?: T; error?: { code: string; message: string } };
  if (!res.ok) {
    const err: Error & { code?: string } = new Error(typed.error?.message ?? `Payment API error ${res.status}`);
    err.code = typed.error?.code;
    throw err;
  }
  // Se la risposta ha un campo data usa quello, altrimenti usa l'oggetto direttamente.
  return (typed.data !== undefined ? typed.data : json) as T;
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

/** Risposta di createTransfer — include dati escrow visibili al mittente. */
export interface CreateTransferResult {
  transfer_id:     string;
  status:          ChatTransferStatus;
  amount:          string;
  asset_symbol:    string;
  asset_address:   string | null;
  sender_id:       string;
  recipient_id:    string;
  conversation_id: string;
  message_id:      string | null;
  escrow_wallet:   string | null;
  sender_wallet:   string | null;
  fee:             string;
  note:            string | null;
  expires_at:      string | null;
  tx_hash_release: string | null;
}

/** Crea un nuovo trasferimento P2P (nuovo Payment Engine). */
export async function apiPaymentCreate(params: {
  recipient_id:    string;
  conversation_id: string;
  amount:          string;
  note?:           string;
  asset_symbol?:   string;
}): Promise<CreateTransferResult> {
  return paymentFetch<CreateTransferResult>("POST", "/", params);
}

/** Mittente conferma il deposito on-chain fornendo il tx_hash. */
export async function apiPaymentDeposit(
  transferId: string,
  txHash:     string,
): Promise<ChatTransferResponse> {
  return paymentFetch<ChatTransferResponse>(
    "POST",
    `/${transferId}/deposit`,
    { tx_hash: txHash },
  );
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
