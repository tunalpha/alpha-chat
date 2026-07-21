/**
 * USDA API client — consume /api/v1/usda/*.
 * Pattern identico a api.ts: usa lo stesso auth token e la stessa base URL.
 */

import { getAccessToken } from "./auth";
import type { WalletInfo, PreparedPayment, UsdaPaymentData, UsdaCapabilities, WalletChain } from "./usda-types";

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

  const json = await res.json() as { data?: T; error?: { code: string; message: string } };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `USDA API error ${res.status}`);
  }
  return json.data as T;
}

// ── Wallet ──────────────────────────────────────────────────────────────────

export async function apiUsdaGetWallet(): Promise<WalletInfo> {
  return usdaFetch<WalletInfo>("GET", "/wallet");
}

export async function apiUsdaSetWalletAddress(address: string, chain: WalletChain = "usda"): Promise<WalletInfo> {
  return usdaFetch<WalletInfo>("PUT", "/wallet/address", { address, chain });
}

export async function apiUsdaGetCapabilities(): Promise<UsdaCapabilities> {
  return usdaFetch<UsdaCapabilities>("GET", "/capabilities");
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
