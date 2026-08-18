/**
 * ChangeNOW BTC→EVM Swap Routes — /api/v1/swap/changenow
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SICUREZZA                                                  ║
 * ║  • Tutti gli endpoint richiedono JWT via authenticate()     ║
 * ║  • La API key ChangeNOW NON appare MAI nelle risposte       ║
 * ║  • Il backend è l'unico layer che chiama l'API ChangeNOW    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Ticker validi (verificati 2026-08-18):
 *   usdterc20, usdtmatic, usdtbsc, usdcmatic, eth, pol, matic, bnbbsc
 *
 * Routes:
 *   GET  /pairs/:toTicker     — verifica disponibilità coppia BTC→{token}
 *   POST /quote               — stima importo ricevuto
 *   POST /create              — crea exchange (ottieni deposit address BTC)
 *   POST /:swapId/commit      — segna fundsCommitted=true + btcTxHash
 *   GET  /:swapId/status      — poll status corrente
 *   GET  /active              — swap attivo utente (per recovery post-reload)
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.middleware.js";
import {
  checkPairAvailability,
  getQuote,
  createExchange,
  commitFunds,
  getSwapStatus,
  getActiveSwapForUser,
} from "../../services/swap/changenow-swap.service.js";
import { CN_BTC_VALID_TICKERS } from "../../services/swap/changenow.service.js";

const router = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const VALID_TICKERS = Array.from(CN_BTC_VALID_TICKERS) as [string, ...string[]];

const ToTickerSchema = z.enum(VALID_TICKERS);

const QuoteSchema = z.object({
  fromAmountBtc: z.number().positive().max(10),
  toTicker:      ToTickerSchema,
});

const CreateSchema = z.object({
  fromAmountBtc:         z.number().positive().max(10),
  toTicker:              ToTickerSchema,
  destinationEvmAddress: z.string().min(10).max(100),
  btcRefundAddress:      z.string().min(10).max(100).optional(),
});

const CommitSchema = z.object({
  btcTxHash: z.string().min(10).max(100),
});

function getUserId(req: Request): string | null {
  return (req as any).user?.userId ?? null;
}

// ── GET /pairs/:toTicker ──────────────────────────────────────────────────────

router.get(
  "/pairs/:toTicker",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await checkPairAvailability(req.params.toTicker);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /active ───────────────────────────────────────────────────────────────

router.get(
  "/active",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ ok: false, code: "UNAUTHORIZED" }); return; }
      const swap = await getActiveSwapForUser(userId);
      res.json({ ok: true, swap });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /quote ───────────────────────────────────────────────────────────────

router.post(
  "/quote",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = QuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: parsed.error.errors });
        return;
      }
      const quote = await getQuote(parsed.data);
      res.json({ ok: true, quote });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /create ──────────────────────────────────────────────────────────────

router.post(
  "/create",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: parsed.error.errors });
        return;
      }
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ ok: false, code: "UNAUTHORIZED" }); return; }
      const result = await createExchange({ userId, ...parsed.data });
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /:swapId/commit ──────────────────────────────────────────────────────

router.post(
  "/:swapId/commit",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CommitSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: parsed.error.errors });
        return;
      }
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ ok: false, code: "UNAUTHORIZED" }); return; }
      const result = await commitFunds({
        swapId:    req.params.swapId,
        userId,
        btcTxHash: parsed.data.btcTxHash,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /:swapId/status ───────────────────────────────────────────────────────

router.get(
  "/:swapId/status",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ ok: false, code: "UNAUTHORIZED" }); return; }
      const status = await getSwapStatus({ swapId: req.params.swapId, userId });
      res.json({ ok: true, swap: status });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
