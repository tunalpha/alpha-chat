/**
 * HttpUsdaAdapter — integrazione con il backend USDA reale (getusda.xyz).
 *
 * Configurazione richiesta (env vars):
 *   USDA_API_BASE_URL       = https://getusda.xyz   (attiva questo adapter)
 *   USDA_CHAIN_ID           = 137                   (Polygon Mainnet)
 *   USDA_CONTRACT_ADDRESS   = 0xe714655...           (ERC-20 USDA)
 *
 * Nessuna API key, nessun Bearer token — il backend USDA non richiede auth.
 *
 * Endpoint verificati dalla documentazione USDA:
 *   GET  /api/health             — health check (sostituisce /capabilities)
 *   GET  /api/pay/poll-tx        — polling stato transazione
 *   POST /api/pay/claim/{code}   — riscossione pagamento
 *
 * Endpoint con path da verificare (marcati VERIFY):
 *   POST /api/pay/send           — invio pagamento
 *   POST /api/pay/request        — richiesta pagamento
 *   POST /api/pay/pay            — pagamento di una richiesta
 *   POST /api/pay/refund/{code}  — rimborso
 *   GET  /api/pay/history        — storico
 *
 * Il saldo USDA viene letto da balanceOf sul contratto ERC-20 (polygon-rpc.ts).
 * La firma della transazione è simulata (ThirdWeb SDK da integrare in produzione).
 */

import { logger } from "../lib/logger";
import { balanceOfUsda } from "./polygon-rpc";
import type {
  UsdaAdapter,
  WalletInfo,
  WalletChain,
  UsdaBackendInfo,
  UsdaCapabilities,
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
// Costanti
// ---------------------------------------------------------------------------

const TIMEOUT_MS        = 10_000;
const RETRY_COUNT       = 3;
const RETRY_BASE_MS     = 500;
const POLL_INTERVAL_MS  = 6_000;   // polling ogni 6s
const POLL_MAX_MS       = 5 * 60 * 1000; // massimo 5 minuti
const HEALTH_CACHE_MS   = 60_000;  // ri-controlla health ogni 1 min

// ---------------------------------------------------------------------------
// Stato interno
// ---------------------------------------------------------------------------

let _isAvailable     = false;          // true dopo il primo health check OK
let _lastHealthCheck = 0;              // timestamp ultimo check
let _healthChecking  = false;          // evita check concorrenti

// Cache info/capabilities (derivate dalla health — nessun endpoint dedicato)
let _capabilitiesCache: { data: UsdaCapabilities; expiresAt: number } | null = null;

// Polling jobs attivi: external_payment_id → timeout handle
const _pollingJobs = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Errori
// ---------------------------------------------------------------------------

export class UsdaNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = "USDA_NOT_CONFIGURED";
  constructor() {
    super("USDA backend not configured. Set USDA_API_BASE_URL to enable real USDA payments.");
    this.name = "UsdaNotConfiguredError";
  }
}

export class UsdaUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = "USDA_UNAVAILABLE";
  constructor() {
    super("USDA backend temporarily unavailable. Payments are disabled.");
    this.name = "UsdaUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Status change callback (propagato al service → WS usda.payment.update)
// ---------------------------------------------------------------------------

type StatusCallback = (
  externalPaymentId: string,
  status: UsdaPaymentStatus,
  txHash?: string,
) => Promise<void>;

let _onStatusChange: StatusCallback | null = null;

export function setHttpStatusChangeCallback(cb: StatusCallback): void {
  _onStatusChange = cb;
}

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  const url = process.env.USDA_API_BASE_URL;
  if (!url) throw new UsdaNotConfiguredError();
  return url.replace(/\/$/, "");
}

/** fetch con timeout e retry esponenziale */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = RETRY_COUNT,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
    }
  }
  throw new Error("unreachable");
}

/** Chiamata al backend USDA — nessun auth header */
async function usdaRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = getBaseUrl();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
  };

  logger.debug({ method, path }, "[HttpUSDA] request");

  const res = await fetchWithRetry(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Il backend USDA non necessariamente avvolge in { data: ... }
  const json = await res.json() as { data?: T; error?: { message: string }; [k: string]: unknown };

  if (!res.ok) {
    const msg = (json?.error as { message?: string } | undefined)?.message
      ?? `USDA API error ${res.status}`;
    throw new Error(`[USDA] ${msg}`);
  }

  return (json.data ?? json) as T;
}

// ---------------------------------------------------------------------------
// Polling interno (sostituisce webhook — il backend USDA non supporta webhook)
// ---------------------------------------------------------------------------

interface PollResult {
  status: string;
  tx_hash?: string | null;
  confirmed_at?: string | null;
}

function _startPolling(
  externalPaymentId: string,
  code: string,
  startedAt = Date.now(),
): void {
  if (_pollingJobs.has(externalPaymentId)) return; // già in corso

  async function poll() {
    // Timeout massimo raggiunto
    if (Date.now() - startedAt > POLL_MAX_MS) {
      _pollingJobs.delete(externalPaymentId);
      logger.warn({ externalPaymentId }, "[HttpUSDA] Polling timeout — marking failed");
      if (_onStatusChange) {
        await _onStatusChange(externalPaymentId, "failed").catch((e) =>
          logger.error({ e }, "[HttpUSDA] Status callback error"),
        );
      }
      return;
    }

    try {
      // VERIFY: path e query param corretti per il backend USDA
      const result = await usdaRequest<PollResult>("GET", `/api/pay/poll-tx?code=${encodeURIComponent(code)}`);
      const status  = _mapUsdaStatus(result.status);
      const txHash  = result.tx_hash ?? undefined;

      logger.info({ externalPaymentId, code, status, txHash }, "[HttpUSDA] Poll result");

      if (_onStatusChange) {
        await _onStatusChange(externalPaymentId, status, txHash).catch((e) =>
          logger.error({ e }, "[HttpUSDA] Status callback error"),
        );
      }

      // Ferma il polling su stati terminali
      const isTerminal = ["confirmed", "claimed", "refunded", "failed"].includes(status);
      if (isTerminal) {
        _pollingJobs.delete(externalPaymentId);
        return;
      }
    } catch (err) {
      logger.warn({ err, externalPaymentId }, "[HttpUSDA] Poll error — retrying");
    }

    // Prossimo poll
    const handle = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    _pollingJobs.set(externalPaymentId, handle);
  }

  // Prima chiamata
  const handle = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
  _pollingJobs.set(externalPaymentId, handle);
}

/** Mappa stati USDA backend → stati AlphaChat */
function _mapUsdaStatus(raw: string): UsdaPaymentStatus {
  switch (raw?.toLowerCase()) {
    case "pending":       return "pending";
    case "confirmed":     return "confirmed";
    case "claimed":       return "claimed";
    case "refunded":      return "refunded";
    case "failed":        return "failed";
    case "pending_claim": return "pending_claim";
    default:
      logger.warn({ raw }, "[HttpUSDA] Unknown status — defaulting to pending");
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// HttpUsdaAdapter
// ---------------------------------------------------------------------------

export class HttpUsdaAdapter implements UsdaAdapter {

  // ── Backend Info (costruito da env var — nessun /info sul backend USDA) ──

  async getInfo(): Promise<UsdaBackendInfo> {
    return {
      name:        "USDA Backend",
      version:     "1.0",
      environment: "production",
      network:     "Polygon Mainnet",
      chainId:     parseInt(process.env.USDA_CHAIN_ID ?? "137", 10),
      explorer:    "https://polygonscan.com",
      apiVersion:  "api",
    };
  }

  // ── Health → Capabilities ────────────────────────────────────────────────
  //
  // Il backend USDA espone GET /api/health — non /capabilities.
  // checkCapabilities() chiama /api/health e ne deriva le funzionalità.

  async checkCapabilities(): Promise<UsdaCapabilities> {
    if (_capabilitiesCache && _capabilitiesCache.expiresAt > Date.now()) {
      return _capabilitiesCache.data;
    }

    await this._refreshHealth();

    const caps: UsdaCapabilities = {
      version:  "1.0",
      supports: {
        prepare:     false,   // nessun endpoint prepare — fee calcolata localmente
        claim:       true,    // POST /api/pay/claim/{code}
        refund:      true,    // VERIFY: POST /api/pay/refund/{code}
        webhook:     false,   // backend USDA non supporta webhook → polling interno
        polling:     true,    // GET /api/pay/poll-tx
        multi_chain: false,   // solo Polygon per ora
      },
    };

    _capabilitiesCache = { data: caps, expiresAt: Date.now() + HEALTH_CACHE_MS };
    return caps;
  }

  /** Controlla GET /api/health e aggiorna _isAvailable */
  async _refreshHealth(): Promise<boolean> {
    if (_healthChecking) return _isAvailable;
    if (Date.now() - _lastHealthCheck < HEALTH_CACHE_MS) return _isAvailable;

    _healthChecking = true;
    try {
      const base = getBaseUrl();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${base}/api/health`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        _isAvailable = res.ok;
        logger.info({ status: res.status, available: _isAvailable }, "[HttpUSDA] Health check");
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      _isAvailable = false;
      logger.warn({ err }, "[HttpUSDA] Health check failed — backend unavailable");
    } finally {
      _lastHealthCheck = Date.now();
      _healthChecking  = false;
    }
    return _isAvailable;
  }

  // ── Wallet (saldo ERC-20 via Polygon RPC — non via HTTP endpoint) ─────────
  // Nota: il balance reale viene letto dal service tramite balanceOfUsda(address).
  // Questo metodo restituisce un placeholder; il service lo sostituisce.

  async getWallet(userId: string): Promise<WalletInfo> {
    // Il saldo reale è letto da usda.service.ts via balanceOfUsda()
    // userId non corrisponde a un indirizzo on-chain — l'address è nel DB
    return {
      address:        null,
      chain_id:       parseInt(process.env.USDA_CHAIN_ID ?? "137", 10),
      balance_usda:   "0.000000",
      wallet_enabled: false,
      wallets:        {},
    };
  }

  async setWalletAddress(userId: string, address: string, chain: WalletChain = "usda"): Promise<WalletInfo> {
    // L'indirizzo è salvato in MongoDB dal service — nessuna API USDA da chiamare
    logger.info({ userId, address, chain }, "[HttpUSDA] Wallet address set locally");
    return {
      address:        chain === "usda" ? address : null,
      chain_id:       parseInt(process.env.USDA_CHAIN_ID ?? "137", 10),
      balance_usda:   "0.000000",
      wallet_enabled: chain === "usda",
      wallets:        { [chain]: { address, verifiedAt: new Date().toISOString() } },
    };
  }

  // ── Prepara pagamento (calcolato localmente — nessun endpoint /prepare) ───

  async preparePayment(params: PreparePaymentParams): Promise<PreparedPayment> {
    if (!_isAvailable) await this._refreshHealth();
    if (!_isAvailable) throw new UsdaUnavailableError();

    const amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) throw new Error("Invalid amount");

    // Fee USDA: 0.1% (verificare con contratto/backend reale)
    const fee   = (amount * 0.001).toFixed(6);
    const total = (amount + parseFloat(fee)).toFixed(6);

    return {
      client_payment_id: params.client_payment_id,
      amount:            params.amount,
      fee,
      total,
      prepared_data: {
        from_user_id:      params.from_user_id,
        to_user_id:        params.to_user_id,
        amount_units:      Math.floor(amount * 10 ** 6).toString(), // 6 decimali
        contract_address:  process.env.USDA_CONTRACT_ADDRESS ?? "",
        chain_id:          parseInt(process.env.USDA_CHAIN_ID ?? "137", 10),
      },
    };
  }

  // ── Invia pagamento → POST /api/pay/send ──────────────────────────────────

  async submitPayment(params: SubmitPaymentParams): Promise<PaymentResult> {
    if (!_isAvailable) await this._refreshHealth();
    if (!_isAvailable) throw new UsdaUnavailableError();

    // VERIFY: path e corpo richiesta del backend USDA
    const raw = await usdaRequest<{
      code?: string; payment_id?: string; tx_hash?: string | null; status?: string;
      claim_expires_at?: string | null;
    }>("POST", "/api/pay/send", {
      from_user_id:  params.from_user_id,
      to_user_id:    params.to_user_id,
      amount:        params.amount,
      fee:           params.fee,
      note:          params.note,
      reference_id:  params.client_payment_id,
      // signature non necessaria — il backend gestisce la firma server-side
    });

    const code      = raw.code ?? raw.payment_id ?? params.client_payment_id;
    const status    = _mapUsdaStatus(raw.status ?? "pending");
    const now       = new Date().toISOString();

    const result: PaymentResult = {
      payment_id:          params.client_payment_id,
      kind:                "send",
      status,
      amount:              params.amount,
      fee:                 params.fee,
      note:                params.note ?? null,
      sender_id:           params.from_user_id,
      recipient_id:        params.to_user_id,
      conversation_id:     params.conversation_id,
      message_id:          null,
      tx_hash:             raw.tx_hash ?? null,
      external_payment_id: code,
      claim_expires_at:    raw.claim_expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      claimed_at:          null,
      refunded_at:         null,
      created_at:          now,
      updated_at:          now,
    };

    // Avvia polling interno (il backend non supporta webhook)
    _startPolling(result.payment_id, code);

    logger.info({ paymentId: result.payment_id, code, status }, "[HttpUSDA] Payment submitted");
    return result;
  }

  // ── Recupera stato pagamento → GET /api/pay/poll-tx ──────────────────────

  async getPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
    // VERIFY: query param corretto
    const raw = await usdaRequest<{
      code?: string; status?: string; tx_hash?: string | null;
      amount?: string; created_at?: string;
    }>("GET", `/api/pay/poll-tx?code=${encodeURIComponent(paymentId)}`);

    const now = new Date().toISOString();
    return {
      payment_id:          paymentId,
      kind:                "send",
      status:              _mapUsdaStatus(raw.status ?? "pending"),
      amount:              raw.amount ?? "0",
      fee:                 "0",
      note:                null,
      sender_id:           "",
      recipient_id:        "",
      conversation_id:     "",
      message_id:          null,
      tx_hash:             raw.tx_hash ?? null,
      external_payment_id: raw.code ?? paymentId,
      claim_expires_at:    null,
      claimed_at:          null,
      refunded_at:         null,
      created_at:          raw.created_at ?? now,
      updated_at:          now,
    };
  }

  // ── Richiesta pagamento → POST /api/pay/request ──────────────────────────

  async requestPayment(params: RequestPaymentParams): Promise<PaymentResult> {
    if (!_isAvailable) await this._refreshHealth();
    if (!_isAvailable) throw new UsdaUnavailableError();

    // VERIFY: path e corpo richiesta
    const raw = await usdaRequest<{
      code?: string; payment_id?: string; status?: string;
      claim_expires_at?: string | null;
    }>("POST", "/api/pay/request", {
      from_user_id: params.from_user_id,
      to_user_id:   params.to_user_id,
      amount:       params.amount,
      note:         params.note,
      reference_id: params.client_payment_id,
    });

    const code = raw.code ?? raw.payment_id ?? params.client_payment_id;
    const now  = new Date().toISOString();

    const result: PaymentResult = {
      payment_id:          params.client_payment_id,
      kind:                "request",
      status:              "pending_claim",
      amount:              params.amount,
      fee:                 "0",
      note:                params.note ?? null,
      sender_id:           params.from_user_id,
      recipient_id:        params.to_user_id,
      conversation_id:     params.conversation_id,
      message_id:          null,
      tx_hash:             null,
      external_payment_id: code,
      claim_expires_at:    raw.claim_expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      claimed_at:          null,
      refunded_at:         null,
      created_at:          now,
      updated_at:          now,
    };

    logger.info({ paymentId: result.payment_id, code }, "[HttpUSDA] Payment requested");
    return result;
  }

  // ── Paga richiesta → POST /api/pay/pay ───────────────────────────────────

  async payRequest(requestId: string, payerId: string): Promise<PaymentResult> {
    if (!_isAvailable) await this._refreshHealth();
    if (!_isAvailable) throw new UsdaUnavailableError();

    // VERIFY: path e corpo
    const raw = await usdaRequest<{
      code?: string; status?: string; tx_hash?: string | null;
    }>("POST", "/api/pay/pay", {
      code:     requestId,
      payer_id: payerId,
    });

    const code   = raw.code ?? requestId;
    const status = _mapUsdaStatus(raw.status ?? "pending");
    const now    = new Date().toISOString();

    const result: PaymentResult = {
      payment_id:          requestId,
      kind:                "request",
      status,
      amount:              "0",
      fee:                 "0",
      note:                null,
      sender_id:           "",
      recipient_id:        payerId,
      conversation_id:     "",
      message_id:          null,
      tx_hash:             raw.tx_hash ?? null,
      external_payment_id: code,
      claim_expires_at:    null,
      claimed_at:          null,
      refunded_at:         null,
      created_at:          now,
      updated_at:          now,
    };

    // Avvia polling dopo il pagamento
    _startPolling(requestId, code);
    return result;
  }

  // ── Riscossione → POST /api/pay/claim/{code} ─────────────────────────────

  async claimPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
    // paymentId qui è l'external_payment_id (il code USDA)
    const raw = await usdaRequest<{
      status?: string; tx_hash?: string | null; claimed_at?: string;
    }>("POST", `/api/pay/claim/${encodeURIComponent(paymentId)}`);

    const now = new Date().toISOString();
    const result: PaymentResult = {
      payment_id:          paymentId,
      kind:                "request",
      status:              _mapUsdaStatus(raw.status ?? "claimed"),
      amount:              "0",
      fee:                 "0",
      note:                null,
      sender_id:           "",
      recipient_id:        "",
      conversation_id:     "",
      message_id:          null,
      tx_hash:             raw.tx_hash ?? null,
      external_payment_id: paymentId,
      claim_expires_at:    null,
      claimed_at:          raw.claimed_at ?? now,
      refunded_at:         null,
      created_at:          now,
      updated_at:          now,
    };

    logger.info({ paymentId, status: result.status }, "[HttpUSDA] Payment claimed");

    if (_onStatusChange) {
      void _onStatusChange(paymentId, result.status, result.tx_hash ?? undefined)
        .catch((e) => logger.error({ e }, "[HttpUSDA] Status callback error"));
    }

    return result;
  }

  // ── Rimborso → POST /api/pay/refund/{code} ───────────────────────────────

  async refundPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
    // VERIFY: path confermato dal backend USDA
    const raw = await usdaRequest<{
      status?: string; tx_hash?: string | null; refunded_at?: string;
    }>("POST", `/api/pay/refund/${encodeURIComponent(paymentId)}`);

    const now = new Date().toISOString();
    const result: PaymentResult = {
      payment_id:          paymentId,
      kind:                "send",
      status:              _mapUsdaStatus(raw.status ?? "refunded"),
      amount:              "0",
      fee:                 "0",
      note:                null,
      sender_id:           "",
      recipient_id:        "",
      conversation_id:     "",
      message_id:          null,
      tx_hash:             raw.tx_hash ?? null,
      external_payment_id: paymentId,
      claim_expires_at:    null,
      claimed_at:          null,
      refunded_at:         raw.refunded_at ?? now,
      created_at:          now,
      updated_at:          now,
    };

    logger.info({ paymentId, status: result.status }, "[HttpUSDA] Payment refunded");

    if (_onStatusChange) {
      void _onStatusChange(paymentId, "refunded", result.tx_hash ?? undefined)
        .catch((e) => logger.error({ e }, "[HttpUSDA] Status callback error"));
    }

    return result;
  }

  // ── Storico → GET /api/pay/history ───────────────────────────────────────

  async getHistory(userId: string, filters: HistoryFilters): Promise<HistoryResult> {
    // VERIFY: path, query params e struttura risposta
    const params = new URLSearchParams({ user_id: userId });
    if (filters.type)  params.set("type",  filters.type);
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.skip)  params.set("skip",  String(filters.skip ?? 0));

    const raw = await usdaRequest<{
      payments?: unknown[]; total?: number; items?: unknown[];
    }>("GET", `/api/pay/history?${params.toString()}`);

    const items = raw.payments ?? raw.items ?? [];
    return {
      payments: (items as PaymentResult[]),
      total:    raw.total ?? items.length,
    };
  }

  // ── Update status (no-op — lo stato arriva dal polling) ──────────────────

  async updatePaymentStatus(
    _paymentId: string,
    _status: UsdaPaymentStatus,
    _txHash?: string,
  ): Promise<PaymentResult> {
    // Non chiamato dal service per l'HttpAdapter — il polling gestisce gli aggiornamenti
    const now = new Date().toISOString();
    return {
      payment_id: _paymentId, kind: "send", status: _status,
      amount: "0", fee: "0", note: null, sender_id: "", recipient_id: "",
      conversation_id: "", message_id: null, tx_hash: _txHash ?? null,
      external_payment_id: _paymentId, claim_expires_at: null,
      claimed_at: null, refunded_at: null, created_at: now, updated_at: now,
    };
  }
}
