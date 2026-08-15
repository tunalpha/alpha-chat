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
import { authenticate } from "../../middleware/authenticate.middleware";
import {
  getSparkFeeConfigHandler,
  updateSparkFeeConfigHandler,
  recordSparkFeeHandler,
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

/**
 * POST /api/v1/spark/user-status
 * Crea o aggiorna il record di stato Spark per l'utente autenticato.
 * Chiamato dal client (AlphaWalletPage) quando spark.state → "connected".
 * Fire-and-forget: errori non bloccano il flusso Spark.
 * Auth: utente normale autenticato (authenticate, NON requireAdmin).
 */
router.post("/user-status", authenticate, upsertSparkUserStatusHandler);

/**
 * POST /api/v1/spark/fee-record
 * Registra nel ledger la fee Alpha Platform di un pagamento Lightning completato.
 * Idempotente su paymentId. Fire-and-forget lato client.
 * Auth: utente autenticato normale.
 */
router.post("/fee-record", authenticate, recordSparkFeeHandler);

/**
 * GET /api/v1/spark/monitoring/users
 * Lista paginata degli utenti con stato Spark registrato.
 * Accesso: read_only admin o superiore.
 * Query: status (enabled|disabled), limit (1-100), page (1-based)
 */
router.get("/monitoring/users",       requireAdmin("read_only"), getSparkUsersHandler);

/**
 * GET /api/v1/spark/monitoring/users/stats
 * Conteggi aggregati utenti Spark (total_enabled, total_disabled, total).
 * Accesso: read_only admin o superiore.
 */
router.get("/monitoring/users/stats", requireAdmin("read_only"), getSparkUsersStatsHandler);

export default router;
