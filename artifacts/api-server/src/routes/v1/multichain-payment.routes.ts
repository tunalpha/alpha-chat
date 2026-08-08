/**
 * multichain-payment.routes.ts — Routes Multi-Chain Payment Engine (Phase 2+)
 *
 * Base path: /api/v1/multichain
 *
 * Endpoints:
 *   GET  /config                     → info reti/asset abilitati (pubblico, M-6 trimmed)
 *   POST /transfers                  → crea trasferimento (autenticato + H-4 validation)
 *   GET  /transfers/:id              → stato trasferimento (autenticato)
 *   POST /transfers/:id/detect       → rileva deposito (autenticato + M-5 rate limit)
 *   POST /transfers/:id/release      → rilascia transfer (autenticato)
 *   POST /transfers/:id/refund       → rimborsa mittente (autenticato)
 *
 * Zero dipendenze da routes USDA o payment esistenti.
 */

import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import {
  getMultiChainConfig,
  handleCreateTransfer,
  handlePaymentQuote,
  handleGetTransfer,
  handleDetectDeposit,
  handleReleaseTransfer,
  handleRefundTransfer,
} from "../../controllers/multichain-payment.controller";
import { authenticate }                                           from "../../middleware/authenticate.middleware";
import { validate }                                               from "../../middleware/validate.middleware";
import { CreateMultiChainTransferSchema, PaymentQuoteSchema }     from "../../validation/multichain.schemas";

const router = Router();

// ─── M-5: Rate limiter per /detect ────────────────────────────────────────────
//
// Protegge dalle query RPC illimitate via polling aggressivo.
// Limite: DETECT_MAX_PER_MINUTE richieste al minuto per (userId + transferId).
// In-memory sliding window — non richiede Redis.

const DETECT_MAX_PER_MINUTE = 10;

function buildDetectRateLimiter(): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  // Pulizia periodica per evitare memory leak su server long-running
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (now > entry.resetAt) buckets.delete(key);
    }
  }, 5 * 60_000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // H-06: usa req.user?.userId (non req.user?.id)
    const userId     = req.user?.userId ?? req.ip ?? "anon";
    const transferId = req.params["id"] ?? "unknown";
    const key        = `${userId}:${transferId}`;
    const now        = Date.now();

    const entry = buckets.get(key);
    if (!entry || now > entry.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (entry.count >= DETECT_MAX_PER_MINUTE) {
      res.status(429).json({
        error:        "RATE_LIMIT_EXCEEDED",
        message:      `Massimo ${DETECT_MAX_PER_MINUTE} richieste /detect al minuto per trasferimento`,
        retryAfterMs: entry.resetAt - now,
      });
      return;
    }
    entry.count++;
    next();
  };
}

const detectRateLimit = buildDetectRateLimiter();

// ─── Routes ───────────────────────────────────────────────────────────────────

// Configurazione pubblica — M-6: solo dati necessari al frontend (senza fee wallets/contracts)
router.get("/config", getMultiChainConfig);

// Quote / Preview — calcolo preventivo SENZA creare un transfer nel DB.
// IMPORTANTE: questa route deve stare PRIMA di /:id per evitare conflitti di routing.
// Il client chiama questo endpoint per mostrare il breakdown prima della conferma.
router.post(
  "/transfers/quote",
  authenticate,
  validate("body", PaymentQuoteSchema),
  handlePaymentQuote,
);

// Crea trasferimento — H-4: validazione Zod prima del controller
// STEP 3: supporta amountMode ("send_amount" | "recipient_exact") + targetNetAmountUnits.
router.post(
  "/transfers",
  authenticate,
  validate("body", CreateMultiChainTransferSchema),
  handleCreateTransfer,
);

router.get("/transfers/:id",          authenticate, handleGetTransfer);
router.post("/transfers/:id/detect",  authenticate, detectRateLimit, handleDetectDeposit);
router.post("/transfers/:id/release", authenticate, handleReleaseTransfer);
router.post("/transfers/:id/refund",  authenticate, handleRefundTransfer);

export default router;
