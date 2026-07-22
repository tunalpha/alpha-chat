/**
 * USDA API client — consume /api/v1/usda/*.
 * Pattern identico a api.ts: usa lo stesso auth token e la stessa base URL.
 */

import { getAccessToken } from "./auth";
import type { WalletInfo, PreparedPayment, UsdaPaymentData, UsdaBackendInfo, UsdaCapabilities, WalletChain } from "./usda-types";

const BASE = "/api/v1/usda";

async function usdaFetch<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json() as {
    data?: T;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
  if (!res.ok) {
    // details.upstream contiene il messaggio reale dal backend USDA esterno (getusda.xyz).
    // json.error.message è spesso solo il codice ("USDA_API_ERROR") — non utile.
    const upstream = json.error?.details?.upstream as string | undefined;
    const msg = upstream ?? json.error?.message ?? `USDA API error ${res.status}`;
    console.error("[USDA] API error", res.status, JSON.stringify(json));
    throw new Error(msg);
  }
  return json.data as T;
}

// ── Wallet ──────────────────────────────────────────────────────────────────

/**
 * Recupera saldo e info wallet.
 * FIX 2: passa liveAddress (account.address ThirdWeb) per ottenere il saldo
 * del wallet effettivamente connesso, non di quello salvato in MongoDB.
 */
export async function apiUsdaGetWallet(liveAddress?: string): Promise<WalletInfo> {
  const qs = liveAddress ? `?address=${encodeURIComponent(liveAddress)}` : "";
  return usdaFetch<WalletInfo>("GET", `/wallet${qs}`);
}

export async function apiUsdaSetWalletAddress(address: string, chain: WalletChain = "usda"): Promise<WalletInfo> {
  return usdaFetch<WalletInfo>("PUT", "/wallet/address", { address, chain });
}

export async function apiUsdaGetCapabilities(): Promise<UsdaCapabilities> {
  return usdaFetch<UsdaCapabilities>("GET", "/capabilities");
}

export async function apiUsdaGetInfo(): Promise<UsdaBackendInfo> {
  return usdaFetch<UsdaBackendInfo>("GET", "/info");
}

/**
 * Verifica se esiste un pagamento con il dato client_payment_id.
 * Usato dalla recovery al mount di WalletCenter per gestire crash
 * avvenuti tra sessionStorage.setItem e la risposta di /confirm.
 * Ritorna null se il pagamento non esiste o non appartiene all'utente.
 */
export async function apiUsdaCheckByClientId(
  clientPaymentId: string,
): Promise<import("./usda-types").UsdaPaymentData | null> {
  try {
    return await usdaFetch<import("./usda-types").UsdaPaymentData>(
      "GET",
      `/payments/check/${encodeURIComponent(clientPaymentId)}`,
    );
  } catch {
    return null; // 404 o errore → pagamento non registrato
  }
}

// ── Payments ────────────────────────────────────────────────────────────────

export async function apiUsdaPreparePayment(params: {
  to_user_id: string;
  conversation_id: string;
  amount: string;
  note?: string;
}): Promise<PreparedPayment> {
  return usdaFetch<PreparedPayment>("POST", "/payments/prepare", params);
}

export async function apiUsdaSubmitPayment(params: {
  to_user_id: string;
  conversation_id: string;
  amount: string;
  fee: string;
  note?: string;
  client_payment_id: string;
  prepared_data: Record<string, unknown>;
  signature?: string;
}): Promise<UsdaPaymentData & { message_id: string }> {
  return usdaFetch<UsdaPaymentData & { message_id: string }>("POST", "/payments", params);
}

export async function apiUsdaGetPayment(paymentId: string): Promise<UsdaPaymentData> {
  return usdaFetch<UsdaPaymentData>("GET", `/payments/${paymentId}`);
}

// ── Requests ────────────────────────────────────────────────────────────────

export async function apiUsdaRequestPayment(params: {
  to_user_id: string;
  conversation_id: string;
  amount: string;
  note?: string;
  client_payment_id: string;
}): Promise<UsdaPaymentData & { message_id: string }> {
  return usdaFetch<UsdaPaymentData & { message_id: string }>("POST", "/requests", params);
}

export async function apiUsdaPayRequest(
  requestId: string,
  signature?: string,
): Promise<UsdaPaymentData> {
  return usdaFetch<UsdaPaymentData>("POST", `/requests/${requestId}/pay`, { signature });
}

// ── History ─────────────────────────────────────────────────────────────────

export async function apiUsdaGetHistory(filters?: {
  type?: "sent" | "received" | "pending" | "claimed" | "refunded";
  limit?: number;
  skip?: number;
}): Promise<{ payments: UsdaPaymentData[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.type)  params.set("type",  filters.type);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.skip)  params.set("skip",  String(filters.skip));
  const qs = params.toString();
  return usdaFetch<{ payments: UsdaPaymentData[]; total: number }>(
    "GET",
    `/history${qs ? `?${qs}` : ""}`,
  );
}
