/**
 * HttpUsdaAdapter — implementazione HTTP reale dell'interfaccia UsdaAdapter.
 *
 * Tutte le chiamate passano attraverso USDA_API_BASE_URL (env var).
 * Se la variabile non è configurata, ogni metodo lancia UsdaNotConfiguredError
 * con un messaggio chiaro — l'interfaccia rimane funzionante e i controlli di
 * health non crashano.
 *
 * Da usare in produzione una volta che il backend USDA è raggiungibile.
 * Nessuna logica blockchain, RPC o wallet custodiale qui — tutto è delegato
 * al backend USDA esterno tramite HTTP.
 *
 * ── Remaining Integration ──
 * Quando il backend USDA è disponibile:
 *   1. Impostare USDA_API_BASE_URL nel secret Replit (es. https://api.getusda.xyz/v1)
 *   2. Impostare USDA_API_KEY se il backend richiede autenticazione server-to-server
 *   3. Verificare la compatibilità degli endpoint con i metodi qui implementati
 *      (nomi dei campi, struttura della risposta, codici di errore)
 *   4. Rimuovere i commenti "TODO: verify" dopo ogni chiamata verificata
 */

import { logger } from "../lib/logger";
import type {
  UsdaAdapter,
  WalletInfo,
  PreparePaymentParams,
  PreparedPayment,
  SubmitPaymentParams,
  PaymentResult,
  RequestPaymentParams,
  HistoryFilters,
  HistoryResult,
  UsdaPaymentStatus,
} from "./usda-adapter.interface";

// ---------------------------------------------------------------------------
// Errore specifico per adapter non configurato
// ---------------------------------------------------------------------------

export class UsdaNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = "USDA_NOT_CONFIGURED";

  constructor() {
    super(
      "USDA backend not configured. " +
      "Set USDA_API_BASE_URL in environment variables to enable real USDA payments.",
    );
    this.name = "UsdaNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  const url = process.env.USDA_API_BASE_URL;
  if (!url) throw new UsdaNotConfiguredError();
  return url.replace(/\/$/, "");
}

function getApiKey(): string | undefined {
  return process.env.USDA_API_KEY;
}

async function usdaRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base   = getBaseUrl(); // lancia UsdaNotConfiguredError se mancante
  const apiKey = getApiKey();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
  };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  logger.debug({ method, path }, "[HttpUSDA] request");

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json() as { data?: T; error?: { code: string; message: string }; [k: string]: unknown };

  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message
      ?? `USDA API error ${res.status}`;
    throw new Error(`[USDA] ${msg}`);
  }

  // TODO: verify — il backend USDA restituisce { data: ... } o l'oggetto direttamente?
  return (json.data ?? json) as T;
}

// ---------------------------------------------------------------------------
// HttpUsdaAdapter
// ---------------------------------------------------------------------------

export class HttpUsdaAdapter implements UsdaAdapter {
  // ── Wallet ──────────────────────────────────────────────────────────────

  async getWallet(userId: string): Promise<WalletInfo> {
    // TODO: verify endpoint path and response shape with USDA backend
    return usdaRequest<WalletInfo>("GET", `/wallets/${userId}`);
  }

  async setWalletAddress(userId: string, address: string): Promise<WalletInfo> {
    // TODO: verify endpoint path and request/response shape
    return usdaRequest<WalletInfo>("PUT", `/wallets/${userId}/address`, { address });
  }

  // ── Payment preparation ─────────────────────────────────────────────────

  async preparePayment(params: PreparePaymentParams): Promise<PreparedPayment> {
    // TODO: verify endpoint path and request/response shape
    return usdaRequest<PreparedPayment>("POST", "/payments/prepare", params);
  }

  // ── Submit payment ──────────────────────────────────────────────────────

  async submitPayment(params: SubmitPaymentParams): Promise<PaymentResult> {
    // TODO: verify endpoint path and request/response shape
    return usdaRequest<PaymentResult>("POST", "/payments", params);
  }

  // ── Get payment ─────────────────────────────────────────────────────────

  async getPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
    // TODO: verify endpoint path
    return usdaRequest<PaymentResult>("GET", `/payments/${paymentId}`);
  }

  // ── Payment request ─────────────────────────────────────────────────────

  async requestPayment(params: RequestPaymentParams): Promise<PaymentResult> {
    // TODO: verify endpoint path and request/response shape
    return usdaRequest<PaymentResult>("POST", "/payment-requests", params);
  }

  // ── Pay request ─────────────────────────────────────────────────────────

  async payRequest(requestId: string, payerId: string, prepared_data?: Record<string, unknown>): Promise<PaymentResult> {
    // TODO: verify endpoint path and request body structure
    return usdaRequest<PaymentResult>("POST", `/payment-requests/${requestId}/pay`, {
      payer_id: payerId,
      prepared_data,
    });
  }

  // ── Claim ────────────────────────────────────────────────────────────────

  async claimPayment(paymentId: string, userId: string): Promise<PaymentResult> {
    // TODO: verify endpoint path
    return usdaRequest<PaymentResult>("POST", `/payments/${paymentId}/claim`, { user_id: userId });
  }

  // ── Refund ───────────────────────────────────────────────────────────────

  async refundPayment(paymentId: string, userId: string): Promise<PaymentResult> {
    // TODO: verify endpoint path
    return usdaRequest<PaymentResult>("POST", `/payments/${paymentId}/refund`, { user_id: userId });
  }

  // ── History ──────────────────────────────────────────────────────────────

  async getHistory(userId: string, filters: HistoryFilters): Promise<HistoryResult> {
    const params = new URLSearchParams({ user_id: userId });
    if (filters.type)  params.set("type",  filters.type);
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.skip)  params.set("skip",  String(filters.skip));
    // TODO: verify endpoint path and query param names
    return usdaRequest<HistoryResult>("GET", `/payments/history?${params.toString()}`);
  }

  // ── Update status ────────────────────────────────────────────────────────

  async updatePaymentStatus(
    paymentId: string,
    status: UsdaPaymentStatus,
    txHash?: string,
  ): Promise<PaymentResult> {
    // TODO: verify endpoint path (may not be needed if backend handles status internally)
    return usdaRequest<PaymentResult>("PATCH", `/payments/${paymentId}/status`, { status, tx_hash: txHash });
  }
}
