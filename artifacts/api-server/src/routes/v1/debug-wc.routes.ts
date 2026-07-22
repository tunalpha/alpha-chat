/**
 * debug-wc.routes.ts — riceve log WalletConnect dal frontend mobile.
 * Endpoint temporaneo per diagnostica — rimuovere dopo la verifica.
 */
import { Router } from "express";
import { logger } from "../../lib/logger";

const router = Router();

router.post("/", (req, res) => {
  const { phase, error, stack, json, extra } = req.body ?? {};
  logger.warn(
    { phase, error, stack, json, extra },
    "[WC-DEBUG] log ricevuto dal client"
  );
  res.json({ ok: true });
});

export default router;
