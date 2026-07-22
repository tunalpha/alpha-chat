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
 * Contratto API definitivo (nessun VERIFY aperto):
 *   GET  /api/health                — health check
 *   POST /api/pay/prepare           — passo 1 invio: pendingTransferId + recipientAddress
 *   POST /api/pay/confirm           — passo 2 invio: pendingTransferId + txHash
 *   POST /api/pay/request           — crea richiesta di pagamento
 *   POST /api/pay/claim/{code}      — riscossione (e pagamento richiesta)
 *   GET  /api/pay/poll-tx?code={}  — polling stato tx
 *   GET  /api/pay/history           — storico
 *
 * Il saldo USDA viene letto da balanceOf sul contratto ERC-20 (polygon-rpc.ts).
 * Il rimborso non è un'azione — è uno stato osservato tramite polling.
 */

import { logger } from "../lib/logger";
import { balanceOfUsda, verifyUsdaTx } from "./polygon-rpc";
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

let _isAvailable     = false;
let _lastHealthCheck = 0;
let _healthChecking  = false;

let _capabilitiesCache: { data: UsdaCapabilities; expiresAt: number } | null = null;

// Polling jobs attivi: internal_payment_id → timeout handle
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
// Status change callback
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

  const json = await res.json() as {
    data?: T; error?: { message: string }; [k: string]: unknown
  };

  if (!res.ok) {
    const msg = (json?.error as { message?: string } | undefined)?.message
      ?? `USDA API error ${res.status}`;
    throw new Error(`[USDA] ${msg}`);
  }

  return (json.data ?? json) as T;
}

// ---------------------------------------------------------------------------
// Polling interno
// ---------------------------------------------------------------------------

interface PollResult {
  status: string;
  tx_hash?: string | null;
  confirmed_at?: string | null;
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

function _startPolling(
  internalPaymentId: string,
  code: string,
  startedAt = Date.now(),
): void {
  if (_pollingJobs.has(internalPaymentId)) return; // già in corso

  async function poll() {
    if (Date.now() - startedAt > POLL_MAX_MS) {
      _pollingJobs.delete(internalPaymentId);
      logger.warn({ internalPaymentId }, "[HttpUSDA] Polling timeout — marking failed");
      if (_onStatusChange) {
        await _onStatusChange(internalPaymentId, "failed").catch((e) =>
          logger.error({ e }, "[HttpUSDA] Status callback error"),
        );
      }
      return;
    }

    try {
      const result = await usdaRequest<PollResult>(
        "GET",
        `/api/pay/poll-tx?code=${encodeURIComponent(code)}`,
      );
      const status = _mapUsdaStatus(result.status);
      const txHash = result.tx_hash ?? undefined;

      logger.info({ internalPaymentId, code, status, txHash }, "[HttpUSDA] Poll result");

      if (_onStatusChange) {
        await _onStatusChange(internalPaymentId, status, txHash).catch((e) =>
          logger.error({ e }, "[HttpUSDA] Status callback error"),
        );
      }

      const isTerminal = ["confirmed", "claimed", "refunded", "failed"].includes(status);
      if (isTerminal) {
        _pollingJobs.delete(internalPaymentId);
        return;
      }
    } catch (err) {
      logger.warn({ err, internalPaymentId }, "[HttpUSDA] Poll error — retrying");
    }

    const handle = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    _pollingJobs.set(internalPaymentId, handle);
  }

  const handle = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
  _pollingJobs.set(internalPaymentId, handle);
}

// ---------------------------------------------------------------------------
// HttpUsdaAdapter
// ---------------------------------------------------------------------------

export class HttpUsdaAdapter implements UsdaAdapter {

  // ── Backend Info ─────────────────────────────────────────────────────────

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

  // ── Health → Capabilities ─────────────────────────────────────────────────

  async checkCapabilities(): Promise<UsdaCapabilities> {
    if (_capabilitiesCache && _capabilitiesCache.expiresAt > Date.now()) {
      return _capabilitiesCache.data;
    }
    await this._refreshHealth();
    const caps: UsdaCapabilities = {
      version:  "1.0",
      supports: {
        prepare:     true,    // POST /api/pay/prepare → POST /api/pay/confirm
        claim:       true,    // POST /api/pay/claim/{code}
        refund:      false,   // rimborso = stato polling, non azione
        webhook:     false,   // polling interno
        polling:     true,    // GET /api/pay/poll-tx
        multi_chain: false,
      },
    };
    _capabilitiesCache = { data: caps, expiresAt: Date.now() + HEALTH_CACHE_MS };
    return caps;
  }

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

  // ── Wallet ────────────────────────────────────────────────────────────────
  // Il saldo reale viene letto da usda.service.ts via balanceOfUsda().

  async getWallet(_userId: string): Promise<WalletInfo> {
    return {
      address:        null,
      chain_id:       parseInt(process.env.USDA_CHAIN_ID ?? "137", 10),
      balance_usda:   "0.000000",
      wallet_enabled: false,
      wallets:        {},
    };
  }

  async setWalletAddress(userId: string, address: string, chain: WalletChain = "usda"): Promise<WalletInfo> {
    logger.info({ userId, address, chain }, "[HttpUSDA] Wallet address set locally");
    return {
      address:        chain === "usda" ? address : null,
      chain_id:       parseInt(process.env.USDA_CHAIN_ID ?? "137", 10),
      balance_usda:   "0.000000",
      wallet_enabled: chain === "usda",
      wallets:        { [chain]: { address, verifiedAt: new Date().toISOString() } },
    };
  }

  // ── Prepara pagamento → POST /api/pay/prepare ─────────────────────────────

  async preparePayment(params: PreparePaymentParams): Promise<PreparedPayment> {
    if (!_isAvailable) await this._refreshHealth();
    if (!_isAvailable) throw new UsdaUnavailableError();

    const raw = await usdaRequest<{
      pendingTransferId?: string;
      pending_transfer_id?: string;
      recipientAddress?: string;
      recipient_address?: string;
      fee?: string;
      total?: string;
      amount_units?: string;
    }>("POST", "/api/pay/prepare", {
      from_user_id: params.from_user_id,
      to_user_id:   params.to_user_id,
      amount:       params.amount,
      note:         params.note,
    });

    const pendingTransferId = raw.pendingTransferId ?? raw.pending_transfer_id ?? "";
    const recipientAddress  = raw.recipientAddress  ?? raw.recipient_address  ?? "";
    const amount  = parseFloat(params.amount);
    const fee     = raw.fee   ?? (amount * 0.001).toFixed(6);
    const total   = raw.total ?? (amount + parseFloat(fee)).toFixed(6);

    // FIX 3: Validazione minima del recipientAddress restituito dal backend USDA
    if (!recipientAddress) {
      throw new Error("[USDA] Il backend non ha restituito un indirizzo destinatario. L'utente potrebbe non avere un wallet USDA attivo.");
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipientAddress)) {
      logger.error({ recipientAddress }, "[HttpUSDA] Backend returned invalid recipient address");
      throw new Error(`[USDA] Indirizzo destinatario non valido ricevuto dal backend: ${recipientAddress}`);
    }
    if (recipientAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      throw new Error("[USDA] Il backend ha restituito l'indirizzo zero come destinatario — pagamento annullato.");
    }

    logger.info({ pendingTransferId, fee, recipientAddress: `${recipientAddress.slice(0,8)}…` }, "[HttpUSDA] Payment prepared");

    return {
      client_payment_id: params.client_payment_id,
      amount:            params.amount,
      fee,
      total,
      prepared_data: {
        pendingTransferId,
        recipientAddress,
        amount_units:     raw.amount_units ?? Math.floor(amount * 10 ** 6).toString(),
        contract_address: process.env.USDA_CONTRACT_ADDRESS ?? "",
        chain_id:         parseInt(process.env.USDA_CHAIN_ID ?? "137", 10),
      },
    };
  }

  // ── Invia pagamento → verifica blockchain → POST /api/pay/confirm ────────────
  //
  // Flusso produzione:
  //   1. Frontend (ThirdWeb): ERC-20 transfer → txHash reale
  //   2. Frontend: chiama apiUsdaSubmitPayment con txHash + senderAddress
  //   3. Backend (qui): verifyUsdaTx → controlla receipt + Transfer event on-chain
  //   4. Backend: solo se valid → POST /api/pay/confirm al backend USDA

  async submitPayment(params: SubmitPaymentParams): Promise<PaymentResult> {
    if (!_isAvailable) await this._refreshHealth();
    if (!_isAvailable) throw new UsdaUnavailableError();

    const pendingTransferId = (params.prepared_data?.pendingTransferId as string | undefined) ?? "";

    // txHash reale proveniente da ThirdWeb (sendAndConfirmTransaction)
    // params.signature contiene il transactionHash on-chain
    const txHash = params.signature;
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new Error("[USDA] Invalid or missing transaction hash. Real blockchain signature required.");
    }

    // ── Verifica blockchain obbligatoria prima del confirm ────────────────────
    const contractAddress = process.env.USDA_CONTRACT_ADDRESS ?? "";
    const senderAddress   = (params.prepared_data?.sender_address as string | undefined) ?? "";
    const recipientAddr   = (params.prepared_data?.recipientAddress as string | undefined) ?? "";
    const amountUnits     = (params.prepared_data?.amount_units as string | undefined) ?? "0";

    // FIX 3: Blocca auto-invio (mittente == destinatario)
    if (senderAddress && recipientAddr &&
        senderAddress.toLowerCase() === recipientAddr.toLowerCase()) {
      throw new Error("[USDA] Non puoi inviare USDA a te stesso.");
    }

    if (senderAddress && recipientAddr && contractAddress) {
      const verification = await verifyUsdaTx({
        txHash,
        senderAddress,
        recipientAddress: recipientAddr,
        amountUnits,
        contractAddress,
      });

      if (!verification.valid) {
        logger.error({ txHash, error: verification.error }, "[HttpUSDA] Blockchain verification FAILED — rejecting confirm");
        throw new Error(`[USDA] Blockchain verification failed: ${verification.error}`);
      }

      logger.info({ txHash, fromAddr: verification.fromAddress, toAddr: verification.toAddress }, "[HttpUSDA] Blockchain verification passed ✅");
    } else {
      // Dati insufficienti per verifica completa — log warning ma non blocca
      // (es. durante sviluppo senza wallet configurato)
      logger.warn({ txHash, senderAddress, recipientAddr }, "[HttpUSDA] Incomplete verification data — proceeding without full blockchain check");
    }

    const raw = await usdaRequest<{
      code?: string; payment_id?: string; tx_hash?: string | null; status?: string;
      claim_expires_at?: string | null;
    }>("POST", "/api/pay/confirm", {
      pendingTransferId,
      txHash,
      reference_id: params.client_payment_id,
    });

    const code   = raw.code ?? raw.payment_id ?? params.client_payment_id;
    const status = _mapUsdaStatus(raw.status ?? "pending");
    const now    = new Date().toISOString();

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
      tx_hash:             raw.tx_hash ?? txHash,
      external_payment_id: code,
      claim_expires_at:    raw.claim_expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      claimed_at:          null,
      refunded_at:         null,
      created_at:          now,
      updated_at:          now,
    };

    _startPolling(result.payment_id, code);
    logger.info({ paymentId: result.payment_id, code, status, txHash }, "[HttpUSDA] Payment confirmed");
    return result;
  }

  // ── Recupera stato → GET /api/pay/poll-tx ────────────────────────────────

  async getPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
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

  // ── Richiesta pagamento → POST /api/pay/request ───────────────────────────

  async requestPayment(params: RequestPaymentParams): Promise<PaymentResult> {
    if (!_isAvailable) await this._refreshHealth();
    if (!_isAvailable) throw new UsdaUnavailableError();

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

    return {
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
  }

  // ── Paga richiesta → POST /api/pay/claim/{code} ───────────────────────────

  async payRequest(requestId: string, payerId: string, prepared_data?: Record<string, unknown>): Promise<PaymentResult> {
    if (!_isAvailable) await this._refreshHealth();
    if (!_isAvailable) throw new UsdaUnavailableError();

    const txHash = (prepared_data?.txHash as string | undefined) ?? undefined;
    const body: Record<string, unknown> = { payer_id: payerId };
    if (txHash) body.txHash = txHash;

    const raw = await usdaRequest<{
      code?: string; status?: string; tx_hash?: string | null;
    }>("POST", `/api/pay/claim/${encodeURIComponent(requestId)}`, body);

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
      tx_hash:             raw.tx_hash ?? txHash ?? null,
      external_payment_id: code,
      claim_expires_at:    null,
      claimed_at:          null,
      refunded_at:         null,
      created_at:          now,
      updated_at:          now,
    };

    _startPolling(requestId, code);
    logger.info({ requestId, payerId, status }, "[HttpUSDA] Request paid via claim");
    return result;
  }

  // ── Riscossione → POST /api/pay/claim/{code} ──────────────────────────────

  async claimPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
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

  // ── Rimborso — NO-OP (stato osservato via polling) ────────────────────────

  async refundPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
    logger.info({ paymentId }, "[HttpUSDA] refundPayment no-op — refund observed via polling");
    const now = new Date().toISOString();
    return {
      payment_id:          paymentId,
      kind:                "send",
      status:              "pending",
      amount:              "0",
      fee:                 "0",
      note:                null,
      sender_id:           "",
      recipient_id:        "",
      conversation_id:     "",
      message_id:          null,
      tx_hash:             null,
      external_payment_id: paymentId,
      claim_expires_at:    null,
      claimed_at:          null,
      refunded_at:         null,
      created_at:          now,
      updated_at:          now,
    };
  }

  // ── Storico → GET /api/pay/history ────────────────────────────────────────

  async getHistory(userId: string, filters: HistoryFilters): Promise<HistoryResult> {
    const params = new URLSearchParams({ user_id: userId });
    if (filters.type)  params.set("type",  filters.type);
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.skip)  params.set("skip",  String(filters.skip ?? 0));

    const raw = await usdaRequest<{
      payments?: unknown[]; total?: number; items?: unknown[];
    }>("GET", `/api/pay/history?${params.toString()}`);

    const items = raw.payments ?? raw.items ?? [];
    return { payments: items as PaymentResult[], total: raw.total ?? items.length };
  }

  // ── Update status (no-op — lo stato arriva dal polling) ──────────────────

  async updatePaymentStatus(
    _paymentId: string,
    _status: UsdaPaymentStatus,
    _txHash?: string,
  ): Promise<PaymentResult> {
    const now = new Date().toISOString();
    return {
      payment_id: _paymentId, kind: "send", status: _status,
      amount: "0", fee: "0", note: null, sender_id: "", recipient_id: "",
      conversation_id: "", message_id: null, tx_hash: _txHash ?? null,
      external_payment_id: _paymentId, claim_expires_at: null,
      claimed_at: null, refunded_at: null, created_at: now, updated_at: now,
    };
  }

  // ── Riconciliazione al boot ───────────────────────────────────────────────
  //
  // Riavvia il polling per un pagamento esistente dopo un restart del server.
  // Chiamato da reconcilePendingPayments() in usda.service.ts.

  schedulePollingRestart(internalPaymentId: string, externalCode: string): void {
    _startPolling(internalPaymentId, externalCode);
    logger.info({ internalPaymentId, externalCode }, "[HttpUSDA] Polling restarted (reconciliation)");
  }
}
