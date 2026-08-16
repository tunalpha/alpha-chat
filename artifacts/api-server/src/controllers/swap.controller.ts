/**
 * SwapController — handlers HTTP per il modulo Alpha Swap
 *
 * ISOLAMENTO: zero import da payment, USDA, MultiChain, Spark fee, treasury.
 * Tutti i business logic sono in swap.service.ts.
 *
 * HARDENING:
 *   - createBtcLnSwap: accetta idempotency_key; NON richiede refund_public_key (server-side)
 *   - GET /active: ritorna swap BTC→LN attivo per recovery frontend
 *   - Tutti i campi sensibili (refund private key) ESCLUSI dalle risposte
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import {
  getPublicSwapConfig,
  getBtcLnQuote,
  createBtcLnSwap,
  recordLnBtcSwap,
  getBtcLnSwapStatus,
  getActiveBtcLnSwap,
  getUserSwapHistory,
  adminGetSwaps,
  adminGetRevenue,
  adminPatchSwapConfig,
} from "../services/swap/swap.service.js";
import { AppError } from "../errors/AppError.js";

const logger = pino({ name: "swap-controller" });

// ── Helper: formatta swap per response (esclude campi interni/sensibili) ───────

function _formatSwapResponse(swap: {
  _id: string; state: string; boltz_lockup_address?: string; boltz_expected_amount?: number;
  from_amount_sat: number; to_amount_sat_estimated: number; to_amount_sat_actual?: number;
  alpha_fee_sat: number; alpha_fee_bps: number; provider_fee_sat: number; miner_fee_sat: number;
  boltz_timeout_block_height?: number; tx_hash_deposit?: string; tx_hash_claim?: string;
  error_code?: string; error_message?: string; completed_at?: Date;
  // ESCLUSI: refund_public_key (non serve al frontend), idempotency_key
}) {
  return {
    swap_id:              swap._id,
    state:                swap.state,
    boltz_lockup_address: swap.boltz_lockup_address,
    expected_amount_sat:  swap.boltz_expected_amount ?? swap.from_amount_sat,
    from_amount_sat:      swap.from_amount_sat,
    to_amount_sat:        swap.to_amount_sat_actual ?? swap.to_amount_sat_estimated,
    alpha_fee_sat:        swap.alpha_fee_sat,
    alpha_fee_bps:        swap.alpha_fee_bps,
    provider_fee_sat:     swap.provider_fee_sat,
    miner_fee_sat:        swap.miner_fee_sat,
    timeout_block_height: swap.boltz_timeout_block_height,
    tx_hash_deposit:      swap.tx_hash_deposit,
    tx_hash_claim:        swap.tx_hash_claim,
    error_code:           swap.error_code,
    error_message:        swap.error_message,
    completed_at:         swap.completed_at,
  };
}

// ── Public ────────────────────────────────────────────────────────────────────

/** GET /api/v1/swap/config */
export async function getSwapConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const config = await getPublicSwapConfig();
    res.json({ config });
  } catch (err) { next(err); }
}

// ── Auth required ─────────────────────────────────────────────────────────────

/** GET /api/v1/swap/quote/btcln?amount=<sat> */
export async function getBtcLnQuoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const amount = parseInt(String(req.query.amount ?? ""), 10);
    if (!amount || amount <= 0) throw new AppError("INVALID_AMOUNT", 400);
    const quote = await getBtcLnQuote(amount);
    res.json({ quote });
  } catch (err) { next(err); }
}

/**
 * POST /api/v1/swap/create/btcln
 *
 * Crea uno swap BTC→Lightning.
 *
 * Body: { from_amount_sat, lightning_invoice, idempotency_key }
 *
 * HARDENING:
 *   - refund_public_key: derivata SERVER-SIDE (non richiesta dal client)
 *   - idempotency_key: garantisce no-duplicate su retry
 *   - write-before-submit: swap salvato in DB prima di chiamare Boltz
 */
export async function createBtcLnSwapHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const { from_amount_sat, lightning_invoice, idempotency_key } = req.body ?? {};

    if (!from_amount_sat || !lightning_invoice || !idempotency_key) {
      throw new AppError("MISSING_FIELDS", 400);
    }
    if (typeof from_amount_sat !== "number" || from_amount_sat <= 0) {
      throw new AppError("INVALID_AMOUNT", 400);
    }
    if (typeof idempotency_key !== "string" || idempotency_key.length < 8) {
      throw new AppError("INVALID_IDEMPOTENCY_KEY", 400);
    }

    const swap = await createBtcLnSwap({
      user_id:           userId,
      from_amount_sat,
      lightning_invoice,
      idempotency_key,
      // refund_public_key: derivata server-side in swap.service
    });

    const status = swap.state === "submitted" || swap.state === "failed_recoverable" ? 202 : 201;
    res.status(status).json(_formatSwapResponse(swap));
  } catch (err) { next(err); }
}

/** POST /api/v1/swap/record/lnbtc */
export async function recordLnBtcSwapHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const { from_amount_sat, btc_destination_address, provider_fee_sat, spark_payment_id, tx_hash_claim } = req.body ?? {};
    if (!from_amount_sat || !btc_destination_address || !spark_payment_id) {
      throw new AppError("MISSING_FIELDS", 400);
    }

    const swap = await recordLnBtcSwap({
      user_id:                userId,
      from_amount_sat:        Number(from_amount_sat),
      btc_destination_address,
      provider_fee_sat:       Number(provider_fee_sat ?? 0),
      spark_payment_id,
      tx_hash_claim,
    });

    res.status(201).json({ swap_id: swap._id, state: swap.state, alpha_fee_bps: 0 });
  } catch (err) { next(err); }
}

/** GET /api/v1/swap/status/:swapId */
export async function getSwapStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);
    const swapId = String(req.params.swapId);
    const swap = await getBtcLnSwapStatus(swapId, userId);
    res.json(_formatSwapResponse(swap));
  } catch (err) { next(err); }
}

/**
 * GET /api/v1/swap/active
 *
 * Ritorna lo swap BTC→LN attivo più recente per il frontend.
 * Usato per recovery dopo crash/restart frontend.
 * Ritorna 204 se nessuno swap attivo.
 */
export async function getActiveBtcLnSwapHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const swap = await getActiveBtcLnSwap(userId);
    if (!swap) {
      res.status(204).end();
      return;
    }
    res.json(_formatSwapResponse(swap));
  } catch (err) { next(err); }
}

/** GET /api/v1/swap/history */
export async function getSwapHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);
    const limit  = Math.min(50, parseInt(String(req.query.limit  ?? "20"), 10));
    const offset = Math.max(0,  parseInt(String(req.query.offset ?? "0"),  10));
    const result = await getUserSwapHistory(userId, limit, offset);
    res.json(result);
  } catch (err) { next(err); }
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/** GET /api/v1/swap/admin/swaps */
export async function adminGetSwapsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await adminGetSwaps({
      page:     parseInt(String(req.query.page     ?? "1"),  10),
      limit:    parseInt(String(req.query.limit    ?? "50"), 10),
      state:    req.query.state    ? String(req.query.state)    : undefined,
      route:    req.query.route    ? String(req.query.route)    : undefined,
      provider: req.query.provider ? String(req.query.provider) : undefined,
      user_id:  req.query.user_id  ? String(req.query.user_id)  : undefined,
      since:    req.query.since    ? String(req.query.since)    : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
}

/** GET /api/v1/swap/admin/revenue */
export async function adminGetRevenueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await adminGetRevenue({
      since: req.query.since ? String(req.query.since) : undefined,
      until: req.query.until ? String(req.query.until) : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
}

/** PATCH /api/v1/swap/admin/config */
export async function adminPatchSwapConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId    = req.adminUser?.userId ?? "unknown";
    const adminEmail = "admin";
    const doc = await adminPatchSwapConfig(req.body ?? {}, adminId, adminEmail);
    logger.info({ adminId, patch: Object.keys(req.body ?? {}) }, "SWAP:ADMIN:CONFIG_PATCH");
    res.json({ config: doc });
  } catch (err) { next(err); }
}

/** GET /api/v1/swap/admin/config */
export async function adminGetSwapConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const config = await getPublicSwapConfig();
    res.json({ config });
  } catch (err) { next(err); }
}
