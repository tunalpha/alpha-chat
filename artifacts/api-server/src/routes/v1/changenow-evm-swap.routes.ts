/**
 * ChangeNOW EVM Swap Routes — /api/v1/swap/changenow/evm
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SICUREZZA                                                  ║
 * ║  • Tutti gli endpoint richiedono JWT via authenticate()     ║
 * ║  • La API key ChangeNOW NON appare MAI nelle risposte       ║
 * ║  • Il server crea l'ordine e fornisce il depositEvmAddress  ║
 * ║  • Firma e broadcast TX EVM avvengono nel wallet utente     ║
 * ║  • Il server NON custodisce fondi né fa broadcast           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Routes:
 *   GET  /pairs/:from/:to        — verifica coppia EVM→EVM
 *   POST /quote                  — stima importo ricevuto
 *   POST /create                 — crea exchange (ottieni depositEvmAddress)
 *   POST /:swapId/commit         — salva depositTxHash (write-before-submit)
 *   GET  /:swapId/status         — poll status (source of truth: ChangeNOW API)
 *   GET  /active                 — swap attivo utente (recovery post-reload)
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.middleware.js";
import {
  checkEvmPair,
  getEvmQuote,
  createEvmExchange,
  commitEvmFunds,
  getEvmSwapStatus,
  getActiveEvmSwapForUser,
} from "../../services/swap/changenow-evm-swap.service.js";

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────
//
// IMPORTANTE: i ticker NON vengono validati contro una whitelist hardcoded.
// La disponibilità della coppia è determinata dalla API ChangeNOW.
// La regex impedisce input malevoli (injection, path traversal) senza
// limitare artificialmente le coppie supportate.

/** Ticker ChangeNOW: solo caratteri alfanumerici minuscoli, 1-30 char */
const tickerSchema = z.string().regex(/^[a-z0-9]{1,30}$/, "Formato ticker non valido");

const EvmQuoteSchema = z.object({
  fromTicker: tickerSchema,
  toTicker:   tickerSchema,
  fromAmount: z.number().positive().max(100_000),
});

const EvmCreateSchema = z.object({
  fromTicker:            tickerSchema,
  toTicker:              tickerSchema,
  fromAmount:            z.number().positive().max(100_000),
  /** Indirizzo EVM di destinazione — letto automaticamente dal wallet frontend */
  destinationEvmAddress: z.string().min(10).max(100),
  /** Indirizzo EVM per rimborso sulla chain sorgente — letto automaticamente */
  refundEvmAddress:      z.string().min(10).max(100).optional(),
});

const EvmCommitSchema = z.object({
  /** Hash TX utente→depositEvmAddress — NON è la destinationTxHash */
  depositTxHash: z.string().min(10).max(200),
});

// ── Helper ────────────────────────────────────────────────────────────────────

function getUserId(req: Request): string | null {
  return (req as any).user?.userId ?? null;
}

// ── GET /pairs/:from/:to ──────────────────────────────────────────────────────

router.get(
  "/pairs/:from/:to",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await checkEvmPair(req.params.from, req.params.to);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /active — PRIMA di /:swapId per evitare conflitti routing ─────────────

router.get(
  "/active",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ ok: false, code: "UNAUTHORIZED" }); return; }
      const swap = await getActiveEvmSwapForUser(userId);
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
      const parsed = EvmQuoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: parsed.error.errors });
        return;
      }
      const quote = await getEvmQuote(parsed.data);
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
      const parsed = EvmCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: parsed.error.errors });
        return;
      }
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ ok: false, code: "UNAUTHORIZED" }); return; }

      const result = await createEvmExchange({
        userId,
        fromTicker:            parsed.data.fromTicker,
        toTicker:              parsed.data.toTicker,
        fromAmount:            parsed.data.fromAmount,
        destinationEvmAddress: parsed.data.destinationEvmAddress,
        refundEvmAddress:      parsed.data.refundEvmAddress ?? parsed.data.destinationEvmAddress,
      });
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
      const parsed = EvmCommitSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, code: "VALIDATION_ERROR", errors: parsed.error.errors });
        return;
      }
      const userId = getUserId(req);
      if (!userId) { res.status(401).json({ ok: false, code: "UNAUTHORIZED" }); return; }

      await commitEvmFunds(userId, req.params.swapId, parsed.data.depositTxHash);
      res.json({ ok: true, fundsCommitted: true });
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
      const swap = await getEvmSwapStatus(userId, req.params.swapId);
      res.json({ ok: true, swap });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
