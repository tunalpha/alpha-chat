/**
 * Signal Audit Routes — POST /api/v1/signal/audit
 *
 * Il client invia eventi di audit crittografici che il server non può
 * osservare direttamente (encrypt/decrypt avvengono nel browser).
 * Il server li registra nei log strutturati (pino).
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { signalAudit } from "../../controllers/signal-audit.controller";

const router = Router();
router.use(authenticate);
router.post("/", signalAudit);

export default router;
