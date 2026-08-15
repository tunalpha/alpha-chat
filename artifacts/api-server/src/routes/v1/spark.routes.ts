/**
 * Spark/Lightning routes — v1
 *
 * ISOLAMENTO: completamente separato da alpha-wallet.routes, multichain, USDA.
 * Zero import da quei moduli.
 *
 * Routes:
 *
 *   ─── Fee config ──────────────────────────────────────────────────────────────
 *   GET   /api/v1/spark/fee-config        — config completa (read_only admin)
 *   PATCH /api/v1/spark/fee-config        — aggiorna config (super_admin)
 *   GET   /api/v1/spark/user-fee-config   — config per client (utente normale autenticato)
 *
 *   ─── Fee collection C2+A ─────────────────────────────────────────────────────
 *   POST  /api/v1/spark/fee-record                 — registra fee pending (utente auth)
 *   PATCH /api/v1/spark/fee-record/collected       — marca fee come raccolta — Tier 1 (utente auth)
 *   PATCH /api/v1/spark/fee-record/bulk-collected  — marca N fee raccolte — Tier 2 (utente auth)
 *   GET   /api/v1/spark/fee-record/pending         — fee pendenti per utente (utente auth)
 *
 *   ─── Monitoring (admin) ──────────────────────────────────────────────────────
 *   GET /api/v1/spark/monitoring/dashboard
 *   GET /api/v1/spark/monitoring/movements
 *   GET /api/v1/spark/monitoring/health
 *   GET /api/v1/spark/monitoring/reconciliation
 *   GET /api/v1/spark/monitoring/users
 *   GET /api/v1/spark/monitoring/users/stats
 *
 *   ─── User status ─────────────────────────────────────────────────────────────
 *   POST /api/v1/spark/user-status
 */

import { Router } from "express";
import { requireAdmin } from "../../middleware/require-admin.middleware";
import { authenticate }  from "../../middleware/authenticate.middleware";
import {
  getSparkFeeConfigHandler,
  getUserFeeConfigHandler,
  updateSparkFeeConfigHandler,
  recordSparkFeeHandler,
  markFeeCollectedHandler,
  markFeesBulkCollectedHandler,
  getPendingFeesHandler,
} from "../../controllers/spark-fee.controller.js";
import {
  getSparkDashboardHandler,
  getSparkMovementsHandler,
  getSparkHealthHandler,
  getSparkReconciliationHandler,
} from "../../controllers/spark-monitoring.controller.js";
import {
  upsertSparkUserStatusHandler,
  getSparkUsersHandler,
  getSparkUsersStatsHandler,
} from "../../controllers/spark-user-status.controller.js";

const router = Router();

// ─── Fee config ───────────────────────────────────────────────────────────────

/** GET /api/v1/spark/fee-config — config completa con audit (read_only admin) */
router.get("/fee-config", requireAdmin("read_only"), getSparkFeeConfigHandler);

/** PATCH /api/v1/spark/fee-config — aggiorna config (super_admin) */
router.patch("/fee-config", requireAdmin("super_admin"), updateSparkFeeConfigHandler);

/**
 * GET /api/v1/spark/user-fee-config
 * Config per il client: fee_bps + min_fee_sat + fee_address.
 * Accessibile a tutti gli utenti autenticati (non solo admin).
 * Fail-safe: mai lancia, restituisce defaults se DB non raggiungibile.
 */
router.get("/user-fee-config", authenticate, getUserFeeConfigHandler);

// ─── Fee collection C2+A ─────────────────────────────────────────────────────

/**
 * POST /api/v1/spark/fee-record
 * Registra fee come pending_collection.
 * Chiamato immediatamente dopo ogni main payment Lightning riuscito.
 * Idempotente su paymentId. Fire-and-forget lato client.
 * SCOPE LOCK: non modifica il main Lightning payment flow.
 */
router.post("/fee-record", authenticate, recordSparkFeeHandler);

/**
 * PATCH /api/v1/spark/fee-record/collected
 * Tier 1: marca una singola fee come raccolta dopo il pagamento Spark diretto.
 * Idempotente su feePaymentId.
 */
router.patch("/fee-record/collected", authenticate, markFeeCollectedHandler);

/**
 * PATCH /api/v1/spark/fee-record/bulk-collected
 * Tier 2: marca N fee pendenti come raccolte con un singolo pagamento aggregato.
 * Idempotente: record già success vengono ignorati.
 */
router.patch("/fee-record/bulk-collected", authenticate, markFeesBulkCollectedHandler);

/**
 * GET /api/v1/spark/fee-record/pending
 * Restituisce le fee pendenti dell'utente + fee_address attuale.
 * Il client usa questa risposta per il Tier-2 aggregated collection al login.
 */
router.get("/fee-record/pending", authenticate, getPendingFeesHandler);

// ─── Monitoring ───────────────────────────────────────────────────────────────

router.get("/monitoring/dashboard",       requireAdmin("read_only"), getSparkDashboardHandler);
router.get("/monitoring/movements",       requireAdmin("read_only"), getSparkMovementsHandler);
router.get("/monitoring/health",          requireAdmin("read_only"), getSparkHealthHandler);
router.get("/monitoring/reconciliation",  requireAdmin("read_only"), getSparkReconciliationHandler);
router.get("/monitoring/users",           requireAdmin("read_only"), getSparkUsersHandler);
router.get("/monitoring/users/stats",     requireAdmin("read_only"), getSparkUsersStatsHandler);

// ─── User status ──────────────────────────────────────────────────────────────

/**
 * POST /api/v1/spark/user-status
 * Crea/aggiorna il record stato Spark per l'utente autenticato.
 * Fire-and-forget: errori non bloccano il flusso Spark.
 */
router.post("/user-status", authenticate, upsertSparkUserStatusHandler);

export default router;
