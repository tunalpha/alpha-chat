/**
 * Push Notification Routes — /api/v1/push
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { getVapidPublicKey, subscribe, unsubscribe } from "../../controllers/push.controller";

const router = Router();

// Chiave pubblica VAPID — non richiede autenticazione (il frontend la usa prima del login)
router.get("/vapid-public-key", getVapidPublicKey);

// Subscription management — richiede autenticazione
router.post("/subscribe",   authenticate, subscribe);
router.delete("/subscribe", authenticate, unsubscribe);

export default router;
