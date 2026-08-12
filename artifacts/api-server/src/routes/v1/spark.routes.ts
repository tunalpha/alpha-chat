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
} from "../../controllers/spark-fee.controller";

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

export default router;
