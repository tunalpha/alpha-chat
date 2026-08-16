/**
 * Alpha Swap routes — v1
 *
 * ISOLAMENTO: completamente separato da payment, USDA, MultiChain, Spark, alpha-wallet.
 *
 * Routes:
 *   GET  /api/v1/swap/config                — config pubblica
 *   GET  /api/v1/swap/quote/btcln           — quote BTC→Lightning (auth)
 *   POST /api/v1/swap/create/btcln          — crea submarine swap (auth, idempotent)
 *   POST /api/v1/swap/record/lnbtc          — registra swap LN→BTC client-side (auth)
 *   GET  /api/v1/swap/status/:swapId        — stato swap (auth)
 *   GET  /api/v1/swap/active                — swap BTC→LN attivo per recovery (auth)
 *   GET  /api/v1/swap/history               — storico utente (auth)
 *   GET  /api/v1/swap/admin/config          — config completa admin
 *   PATCH /api/v1/swap/admin/config         — aggiorna config (super_admin)
 *   GET  /api/v1/swap/admin/swaps           — lista swap (read_only admin)
 *   GET  /api/v1/swap/admin/revenue         — revenue aggregata (read_only admin)
 */

import { Router } from "express";
import { requireAdmin } from "../../middleware/require-admin.middleware.js";
import { authenticate  } from "../../middleware/authenticate.middleware.js";
import {
  getSwapConfigHandler,
  getBtcLnQuoteHandler,
  createBtcLnSwapHandler,
  recordLnBtcSwapHandler,
  getSwapStatusHandler,
  getActiveBtcLnSwapHandler,
  getSwapHistoryHandler,
  adminGetSwapsHandler,
  adminGetRevenueHandler,
  adminPatchSwapConfigHandler,
  adminGetSwapConfigHandler,
} from "../../controllers/swap.controller.js";

const router = Router();

// ── Public ─────────────────────────────────────────────────────────────────────
router.get("/config", getSwapConfigHandler);

// ── Auth ───────────────────────────────────────────────────────────────────────
router.get("/quote/btcln",      authenticate, getBtcLnQuoteHandler);
router.post("/create/btcln",    authenticate, createBtcLnSwapHandler);
router.post("/record/lnbtc",    authenticate, recordLnBtcSwapHandler);
router.get("/active",           authenticate, getActiveBtcLnSwapHandler);
router.get("/status/:swapId",   authenticate, getSwapStatusHandler);
router.get("/history",          authenticate, getSwapHistoryHandler);

// ── Admin ──────────────────────────────────────────────────────────────────────
router.get("/admin/config",   requireAdmin("read_only"),   adminGetSwapConfigHandler);
router.patch("/admin/config", requireAdmin("super_admin"), adminPatchSwapConfigHandler);
router.get("/admin/swaps",    requireAdmin("read_only"),   adminGetSwapsHandler);
router.get("/admin/revenue",  requireAdmin("read_only"),   adminGetRevenueHandler);

export default router;
