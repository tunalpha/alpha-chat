/**
 * MockUsdaAdapter — implementazione simulata dell'interfaccia UsdaAdapter.
 *
 * NON contiene logica blockchain, RPC, wallet custodiali o fee reali.
 * Mantiene stato in-memory e simula la conferma blockchain dopo 3 secondi.
 *
 * Quando il backend USDA sarà disponibile:
 *   1. Creare RealUsdaAdapter che implementa UsdaAdapter
 *   2. Sostituire `new MockUsdaAdapter()` in usda.service.ts
 *   3. Nessuna altra modifica necessaria
 */

import { randomUUID } from "crypto";
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
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const _wallets = new Map<string, { address: string | null; chain_id: number; balance: number }>();
const _payments = new Map<string, PaymentResult>();

// ---------------------------------------------------------------------------
// Status change callback — registrato dal servizio per sincronizzare DB + WS
// ---------------------------------------------------------------------------

type StatusCallback = (
  externalPaymentId: string,
  status: UsdaPaymentStatus,
  txHash?: string,
) => Promise<void>;

let _onStatusChange: StatusCallback | null = null;

export function setMockStatusChangeCallback(cb: StatusCallback): void {
  _onStatusChange = cb;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function _getOrCreateWallet(userId: string) {
  if (!_wallets.has(userId)) {
    _wallets.set(userId, { address: null, chain_id: 137, balance: 4_582.34 });
  }
  return _wallets.get(userId)!;
}

function _scheduleConfirmation(paymentId: string, delayMs = 3000): void {
  setTimeout(async () => {
    const p = _payments.get(paymentId);
    if (!p || (p.status !== "pending" && p.status !== "submitting")) return;

    const txHash = `0x${randomUUID().replace(/-/g, "")}`;
    const confirmed: PaymentResult = {
      ...p,
      status: "confirmed",
      tx_hash: txHash,
      updated_at: new Date().toISOString(),
    };
    _payments.set(paymentId, confirmed);
    logger.info({ paymentId, txHash }, "[Mock USDA] Payment auto-confirmed");

    if (_onStatusChange) {
      await _onStatusChange(paymentId, "confirmed", txHash).catch((err) =>
        logger.error({ err }, "[Mock USDA] Status callback error"),
      );
    }
  }, delayMs);
}

// ---------------------------------------------------------------------------
// MockUsdaAdapter
// ---------------------------------------------------------------------------

export class MockUsdaAdapter implements UsdaAdapter {
  // ── Wallet ──────────────────────────────────────────────────────────────

  async getWallet(userId: string): Promise<WalletInfo> {
    const w = _getOrCreateWallet(userId);
    return {
      address: w.address,
      chain_id: w.chain_id,
      balance_usda: w.balance.toFixed(2),
      wallet_enabled: w.address !== null,
    };
  }

  async setWalletAddress(userId: string, address: string): Promise<WalletInfo> {
    const w = _getOrCreateWallet(userId);
    w.address = address;
    _wallets.set(userId, w);
    return {
      address,
      chain_id: w.chain_id,
      balance_usda: w.balance.toFixed(2),
      wallet_enabled: true,
    };
  }

  // ── Payment preparation ─────────────────────────────────────────────────

  async preparePayment(params: PreparePaymentParams): Promise<PreparedPayment> {
    const amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) throw new Error("Invalid amount");

    const fee = (amount * 0.001).toFixed(4);  // 0.1% fee simulata
    const total = (amount + parseFloat(fee)).toFixed(4);

    return {
      client_payment_id: params.client_payment_id,
      amount: params.amount,
      fee,
      total,
      prepared_data: {
        simulated: true,
        to_address: `0x${"a".repeat(40)}`, // placeholder
        amount_wei: String(Math.floor(amount * 1e18)),
        chain_id: 137,
      },
    };
  }

  // ── Submit payment ──────────────────────────────────────────────────────

  async submitPayment(params: SubmitPaymentParams): Promise<PaymentResult> {
    const now = new Date().toISOString();
    const paymentId = params.client_payment_id; // usiamo client_payment_id come ID mock

    const result: PaymentResult = {
      payment_id: paymentId,
      kind: "send",
      status: "pending",
      amount: params.amount,
      fee: params.fee,
      note: params.note ?? null,
      sender_id: params.from_user_id,
      recipient_id: params.to_user_id,
      conversation_id: params.conversation_id,
      message_id: null,
      tx_hash: null,
      external_payment_id: paymentId,
      claim_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      claimed_at: null,
      refunded_at: null,
      created_at: now,
      updated_at: now,
    };

    _payments.set(paymentId, result);
    _scheduleConfirmation(paymentId);

    return result;
  }

  // ── Get payment ─────────────────────────────────────────────────────────

  async getPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
    const p = _payments.get(paymentId);
    if (!p) throw new Error(`Payment ${paymentId} not found`);
    return p;
  }

  // ── Payment request ─────────────────────────────────────────────────────

  async requestPayment(params: RequestPaymentParams): Promise<PaymentResult> {
    const now = new Date().toISOString();
    const paymentId = params.client_payment_id;

    const result: PaymentResult = {
      payment_id: paymentId,
      kind: "request",
      status: "pending_claim",
      amount: params.amount,
      fee: "0",
      note: params.note ?? null,
      sender_id: params.from_user_id,
      recipient_id: params.to_user_id,
      conversation_id: params.conversation_id,
      message_id: null,
      tx_hash: null,
      external_payment_id: paymentId,
      claim_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      claimed_at: null,
      refunded_at: null,
      created_at: now,
      updated_at: now,
    };

    _payments.set(paymentId, result);
    return result;
  }

  // ── Pay request ─────────────────────────────────────────────────────────

  async payRequest(requestId: string, _payerId: string): Promise<PaymentResult> {
    const p = _payments.get(requestId);
    if (!p) throw new Error(`Payment request ${requestId} not found`);

    const updated: PaymentResult = {
      ...p,
      status: "pending",
      updated_at: new Date().toISOString(),
    };
    _payments.set(requestId, updated);
    _scheduleConfirmation(requestId);

    return updated;
  }

  // ── Claim ────────────────────────────────────────────────────────────────

  async claimPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
    const p = _payments.get(paymentId);
    if (!p) throw new Error(`Payment ${paymentId} not found`);

    const updated: PaymentResult = {
      ...p,
      status: "claimed",
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    _payments.set(paymentId, updated);

    if (_onStatusChange) {
      void _onStatusChange(paymentId, "claimed").catch((err) =>
        logger.error({ err }, "[Mock USDA] Claim callback error"),
      );
    }

    return updated;
  }

  // ── Refund ───────────────────────────────────────────────────────────────

  async refundPayment(paymentId: string, _userId: string): Promise<PaymentResult> {
    const p = _payments.get(paymentId);
    if (!p) throw new Error(`Payment ${paymentId} not found`);

    const updated: PaymentResult = {
      ...p,
      status: "refunded",
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    _payments.set(paymentId, updated);

    if (_onStatusChange) {
      void _onStatusChange(paymentId, "refunded").catch((err) =>
        logger.error({ err }, "[Mock USDA] Refund callback error"),
      );
    }

    return updated;
  }

  // ── History ──────────────────────────────────────────────────────────────

  async getHistory(userId: string, filters: HistoryFilters): Promise<HistoryResult> {
    let all = Array.from(_payments.values());

    if (filters.type === "sent") {
      all = all.filter((p) => p.sender_id === userId && p.kind === "send");
    } else if (filters.type === "received") {
      all = all.filter((p) => p.recipient_id === userId);
    } else if (filters.type === "pending") {
      all = all.filter(
        (p) =>
          (p.sender_id === userId || p.recipient_id === userId) &&
          (p.status === "pending" || p.status === "pending_claim"),
      );
    } else if (filters.type === "claimed") {
      all = all.filter((p) => p.recipient_id === userId && p.status === "claimed");
    } else if (filters.type === "refunded") {
      all = all.filter((p) => p.sender_id === userId && p.status === "refunded");
    } else {
      all = all.filter((p) => p.sender_id === userId || p.recipient_id === userId);
    }

    all.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const limit = filters.limit ?? 20;
    const skip = filters.skip ?? 0;
    const page = all.slice(skip, skip + limit);

    return { payments: page, total: all.length };
  }

  // ── Update status (usato internamente) ─────────────────────────────────

  async updatePaymentStatus(
    paymentId: string,
    status: UsdaPaymentStatus,
    txHash?: string,
  ): Promise<PaymentResult> {
    const p = _payments.get(paymentId);
    if (!p) throw new Error(`Payment ${paymentId} not found`);

    const updated: PaymentResult = {
      ...p,
      status,
      tx_hash: txHash ?? p.tx_hash,
      updated_at: new Date().toISOString(),
    };
    _payments.set(paymentId, updated);
    return updated;
  }
}
