/**
 * Signal Audit Controller
 *
 * Endpoint minimale: il client invia eventi di audit Signal
 * (encrypt/decrypt results) che non sono visibili lato server.
 * Solo logging — nessuna logica funzionale.
 */

import type { RequestHandler } from "express";
import { logger } from "../lib/logger";

export const signalAudit: RequestHandler = (req, res) => {
  const { tag, data } = req.body as { tag?: string; data?: Record<string, unknown> };
  if (!tag) {
    res.status(400).json({ error: "tag mancante" });
    return;
  }
  logger.info(
    { userId: req.user!.userId, ...(data ?? {}) },
    `[SIGNAL-AUDIT] ${tag}`,
  );
  res.status(204).end();
};
