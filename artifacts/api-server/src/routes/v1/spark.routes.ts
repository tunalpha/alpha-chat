/**
 * Spark/Lightning routes — v1
 *
 * ISOLAMENTO: completamente separato da alpha-wallet.routes, multichain, USDA.
 * Zero import da quei moduli.
 *
 * Routes:
 *   GET  /api/v1/spark/fee-config   — legge la platform fee Spark (read_only admin)
 *   PATCH /api/v1/spark/fee-config  — aggiorna la platform fee Spark (super_admin)
 *
 * La provider fee (Breez SDK routing) NON è esposta qui — viene dalla UI al momento del send.
 */

import { Router } from "express";
import { requireAdmin } from "../../middleware/require-admin.middleware";
import {
  getSparkFeeConfigHandler,
  updateSparkFeeConfigHandler,
} from "../../controllers/spark-fee.controller.js";
import {
  getSparkDashboardHandler,
  getSparkMovementsHandler,
  getSparkHealthHandler,
  getSparkReconciliationHandler,
} from "../../controllers/spark-monitoring.controller.js";

const router = Router();

/**
 * GET /api/v1/spark/fee-config
 * Restituisce la configurazione corrente della Alpha Platform Fee Spark.
 * Accesso: read_only admin o superiore.
 */
router.get("/fee-config", requireAdmin("read_only"), getSparkFeeConfigHandler);

/**
 * PATCH /api/v1/spark/fee-config
 * Aggiorna uno o più campi della Platform Fee Spark.
 * Genera audit log obbligatorio con prev/new values + admin + timestamp.
 * Accesso: super_admin.
 *
 * NOTA: non è possibile modificare la provider fee (Breez/Spark routing) tramite questa route.
 */
router.patch("/fee-config", requireAdmin("super_admin"), updateSparkFeeConfigHandler);

/**
 * Monitoring routes — sola lettura (read_only admin).
 * ISOLAMENTO: zero import da BTC/EVM/USDA/Payment Engine/Chat/Signal.
 * PRIVACY: nessun secret/mnemonic/private_key restituito.
 */

/** GET /api/v1/spark/monitoring/dashboard — aggregate stats (totali, fee, error rate) */
router.get("/monitoring/dashboard",       requireAdmin("read_only"), getSparkDashboardHandler);

/** GET /api/v1/spark/monitoring/movements — paginated fee records con filtri range/status */
router.get("/monitoring/movements",       requireAdmin("read_only"), getSparkMovementsHandler);

/** GET /api/v1/spark/monitoring/health — health check (SDK key, error rate 24h, alerts) */
router.get("/monitoring/health",          requireAdmin("read_only"), getSparkHealthHandler);

/** GET /api/v1/spark/monitoring/reconciliation — Treasury reconciliation Spark vs failed records */
router.get("/monitoring/reconciliation",  requireAdmin("read_only"), getSparkReconciliationHandler);

export default router;
