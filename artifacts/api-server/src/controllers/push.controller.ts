/**
 * PushController — endpoint HTTP per gestione subscription Web Push.
 *
 * GET  /api/v1/push/vapid-public-key  — chiave pubblica VAPID (non autenticato)
 * POST /api/v1/push/subscribe         — registra subscription
 * DELETE /api/v1/push/subscribe       — rimuove subscription
 */

import type { RequestHandler } from "express";
import { PushSubscriptionRepository } from "../repositories/push-subscription.repository";
import * as PushNotificationService from "../services/push/PushNotificationService";
import { successResponse } from "../utils/response";
import { logger } from "../lib/logger";

const repo = new PushSubscriptionRepository();

/** GET /api/v1/push/vapid-public-key */
export const getVapidPublicKey: RequestHandler = (_req, res) => {
  res.json(successResponse({ publicKey: PushNotificationService.getVapidPublicKey() }));
};

/** POST /api/v1/push/subscribe */
export const subscribe: RequestHandler = async (req, res, next) => {
  try {
    const { endpoint, p256dh, auth, platform, browser, device } = req.body as {
      endpoint: string;
      p256dh:   string;
      auth:     string;
      platform?: string;
      browser?:  string;
      device?:   string;
    };
    if (!endpoint || !p256dh || !auth) {
      res.status(400).json({ error: "endpoint, p256dh e auth sono obbligatori" });
      return;
    }
    const userId = req.user!.userId;
    const doc = await repo.upsert({ userId, endpoint, p256dh, auth, platform, browser, device });
    logger.info(
      { userId, endpoint, platform: platform ?? null, browser: browser ?? null, createdAt: doc.createdAt },
      "Push subscription registered",
    );
    res.status(201).json(successResponse({ subscribed: true }));
  } catch (err) { next(err); }
};

/** DELETE /api/v1/push/subscribe */
export const unsubscribe: RequestHandler = async (req, res, next) => {
  try {
    const { endpoint } = req.body as { endpoint?: string };
    const userId = req.user!.userId;
    if (endpoint) {
      await repo.deleteByEndpoint(endpoint);
    } else {
      // Rimuovi tutte le subscription dell'utente
      await repo.deleteByUserId(userId);
    }
    logger.info({ userId }, "Push subscription rimossa");
    res.json(successResponse({ unsubscribed: true }));
  } catch (err) { next(err); }
};
