/**
 * SwapController — handlers HTTP per il modulo Alpha Swap
 *
 * ISOLAMENTO: zero import da payment, USDA, MultiChain, Spark fee, treasury.
 * Tutti i business logic sono in swap.service.ts.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import {
  getPublicSwapConfig,
  getBtcLnQuote,
  createBtcLnSwap,
  recordLnBtcSwap,
  getBtcLnSwapStatus,
  getUserSwapHistory,
  adminGetSwaps,
  adminGetRevenue,
  adminPatchSwapConfig,
} from "../services/swap/swap.service.js";
import { AppError } from "../errors/AppError.js";

const logger = pino({ name: "swap-controller" });

// ── Public ────────────────────────────────────────────────────────────────────

/** GET /api/v1/swap/config — configurazione pubblica (enabled + assets esclusi) */
export async function getSwapConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const config = await getPublicSwapConfig();
    res.json({ config });
  } catch (err) {
    next(err);
  }
}

// ── Auth required ─────────────────────────────────────────────────────────────

/** GET /api/v1/swap/quote/btcln?amount=<sat> — quote BTC→Lightning */
export async function getBtcLnQuoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const amount = parseInt(String(req.query.amount ?? ""), 10);
    if (!amount || amount <= 0) throw new AppError("INVALID_AMOUNT", 400);
    const quote = await getBtcLnQuote(amount);
    res.json({ quote });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/swap/create/btcln — crea submarine swap Boltz */
export async function createBtcLnSwapHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const { from_amount_sat, lightning_invoice, refund_public_key } = req.body ?? {};
    if (!from_amount_sat || !lightning_invoice || !refund_public_key) {
      throw new AppError("MISSING_FIELDS", 400);
    }
    if (typeof from_amount_sat !== "number" || from_amount_sat <= 0) {
      throw new AppError("INVALID_AMOUNT", 400);
    }

    const swap = await createBtcLnSwap({
      user_id:          userId,
      from_amount_sat,
      lightning_invoice,
      refund_public_key,
    });

    res.status(201).json({
      swap_id:             swap._id,
      state:               swap.state,
      boltz_lockup_address: swap.boltz_lockup_address,
      expected_amount_sat: swap.from_amount_sat,
      alpha_fee_sat:       swap.alpha_fee_sat,
      provider_fee_sat:    swap.provider_fee_sat,
      miner_fee_sat:       swap.miner_fee_sat,
      timeout_block_height: swap.boltz_timeout_block_height,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/swap/record/lnbtc — registra uno swap LN→BTC eseguito client-side via Breez */
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
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/swap/status/:swapId — stato swap (poll Boltz per BTC→LN) */
export async function getSwapStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const swapId = String(req.params.swapId);
    const swap = await getBtcLnSwapStatus(swapId, userId);
    res.json({
      swap_id:          swap._id,
      state:            swap.state,
      route:            swap.route,
      provider:         swap.provider,
      from_amount_sat:  swap.from_amount_sat,
      to_amount_sat:    swap.to_amount_sat_actual ?? swap.to_amount_sat_estimated,
      alpha_fee_sat:    swap.alpha_fee_sat,
      alpha_fee_bps:    swap.alpha_fee_bps,
      provider_fee_sat: swap.provider_fee_sat,
      tx_hash_deposit:  swap.tx_hash_deposit,
      tx_hash_claim:    swap.tx_hash_claim,
      completed_at:     swap.completed_at,
      error_code:       swap.error_code,
      error_message:    swap.error_message,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/swap/history — storico swap utente */
export async function getSwapHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const limit  = Math.min(50, parseInt(String(req.query.limit  ?? "20"), 10));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"),  10));

    const result = await getUserSwapHistory(userId, limit, offset);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/** GET /api/v1/swap/admin/swaps */
export async function adminGetSwapsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await adminGetSwaps({
      page:     parseInt(String(req.query.page     ?? "1"),  10),
      limit:    parseInt(String(req.query.limit    ?? "50"), 10),
      state:    req.query.state    as string | undefined,
      route:    req.query.route    as string | undefined,
      provider: req.query.provider as string | undefined,
      user_id:  req.query.user_id  ? String(req.query.user_id)  : undefined,
      since:    req.query.since    ? String(req.query.since)    : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/swap/admin/revenue */
export async function adminGetRevenueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await adminGetRevenue({
      since: req.query.since as string | undefined,
      until: req.query.until as string | undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/swap/admin/config */
export async function adminPatchSwapConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId    = req.adminUser?.userId ?? "unknown";
    const adminEmail = "admin"; // admin panel non espone email nel token
    const doc = await adminPatchSwapConfig(req.body ?? {}, adminId, adminEmail);
    logger.info({ adminId, patch: Object.keys(req.body ?? {}) }, "SWAP:ADMIN:CONFIG_PATCH");
    res.json({ config: doc });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/swap/admin/config */
export async function adminGetSwapConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const config = await getPublicSwapConfig();
    res.json({ config });
  } catch (err) {
    next(err);
  }
}
