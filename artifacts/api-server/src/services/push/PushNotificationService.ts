/**
 * PushNotificationService — invio Web Push via VAPID.
 *
 * Configurazione: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in env.
 * Se le chiavi non sono presenti, il servizio è silenzioso (no-op).
 *
 * Compatibilità:
 *  ✅ Chrome Android / Desktop — pieno supporto
 *  ✅ Firefox Desktop / Android — pieno supporto
 *  ✅ Edge — pieno supporto
 *  ⚠️  Safari iOS (≥16.4, PWA installata) — supportato solo da Home Screen
 *  ❌  Safari iOS (browser) — non supportato (limitazione Apple pre-iOS 17)
 *  ❌  Chrome iOS / Firefox iOS — stesso limite Apple (motore WebKit obbligatorio)
 */

import webPush from "web-push";
import { logger } from "../../lib/logger";
import { PushSubscriptionRepository } from "../../repositories/push-subscription.repository";
import type { PushEvent } from "./PushEvents";

const repo = new PushSubscriptionRepository();

// ── Configurazione VAPID ──────────────────────────────────────────────────────

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     ?? "mailto:admin@alphachat.sbs";

let _configured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    _configured = true;
    logger.info("Web Push (VAPID) configurato ✓");
  } catch (err) {
    logger.error({ err }, "Errore configurazione VAPID — push disabilitato");
  }
} else {
  logger.warn("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non impostate — push disabilitato");
}

export function isConfigured(): boolean { return _configured; }
export function getVapidPublicKey(): string { return VAPID_PUBLIC_KEY; }

// ── Costruzione payload ───────────────────────────────────────────────────────

function buildPayload(event: PushEvent): string {
  switch (event.type) {
    case "message.new":
      return JSON.stringify({
        type:  "message.new",
        title: "Alpha Chat ⇄ Wallet",
        body:  `${event.senderName} — nuovo messaggio`,
        data:  {
          conversationId:   event.conversationId,
          senderId:         event.senderId,
          senderName:       event.senderName,
          isGroup:          event.isGroup,
          conversationName: event.conversationName,
          // URL usato dal SW solo se nessuna finestra è aperta
          url: `/?push_conv=${encodeURIComponent(event.conversationId)}`,
        },
        tag:      `msg-${event.conversationId}`,
        renotify: false,
        icon:     "/favicon-192.png",
        badge:    "/favicon-192.png",   // iOS richiede PNG — SVG ignorato
      });

    case "call.incoming":
      return JSON.stringify({
        type:  "call.incoming",
        title: "📞 Chiamata in arrivo",
        body:  event.callerName,
        data:  {
          callerId:  event.callerId,
          callerName: event.callerName,
          callType:  event.callType,
          url:       "/",
        },
        tag:               "call-incoming",
        requireInteraction: true,
        vibrate:            [300, 100, 300, 100, 300],
        icon:               "/favicon-192.png",
        badge:              "/favicon-192.png",   // iOS richiede PNG — SVG ignorato
      });

    case "call.missed":
      return JSON.stringify({
        type:  "call.missed",
        title: "Alpha Chat ⇄ Wallet",
        body:  `📵 Chiamata persa da ${event.callerName}`,
        data:  {
          callerId:   event.callerId,
          callerName: event.callerName,
          url:        "/",
        },
        tag:  `call-missed-${event.callerId}`,
        icon: "/favicon-192.png",
        badge: "/favicon-192.png",
      });

    case "swap.completed":
      return JSON.stringify({
        type:  "swap.completed",
        title: "✅ Alpha Swap completato",
        body:  `${event.fromAmount} ${event.fromToken} → ${event.toAmount} ${event.toToken}`,
        data:  { url: "/" },
        tag:   "swap-completed",
        icon:  "/favicon-192.png",
        badge: "/favicon-192.png",
      });
  }
}

// ── Invio ─────────────────────────────────────────────────────────────────────

export async function sendToUser(userId: string, event: PushEvent): Promise<void> {
  if (!_configured) return;
  const subs = await repo.findByUserId(userId);

  // Log 2 — subscription trovate (o assenti) per questo destinatario
  if (subs.length === 0) {
    logger.info({ userId }, "Push skip — no subscription found");
    return;
  }
  logger.info({ userId, subscriptionCount: subs.length }, "Push dispatch — subscriptions found");

  const payload  = buildPayload(event);
  // "high" = APNs priority 10: consegna immediata su iOS (PWA installata ≥ 16.4).
  // "normal" (APNs priority 5) può essere ritardato o soppresso da iOS in
  // power-saving / schermo spento — non adatto a messaggistica in tempo reale.
  const urgency: webPush.Urgency = "high";

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { urgency },
        );
        void repo.touchEndpoint(sub.endpoint).catch(() => {});
        logger.info(
          { userId, endpoint: sub.endpoint, eventType: event.type, success: true },
          "Sending push — success",
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          // Subscription scaduta — rimuovi silenziosamente
          await repo.deleteByEndpoint(sub.endpoint).catch(() => {});
          logger.info({ userId, endpoint: sub.endpoint }, "Push subscription scaduta — rimossa");
        } else {
          logger.warn({ err, userId, endpoint: sub.endpoint, eventType: event.type }, "Sending push — failed");
        }
      }
    }),
  );
}

export async function sendToUsers(userIds: string[], event: PushEvent): Promise<void> {
  if (!_configured || userIds.length === 0) return;
  await Promise.allSettled(
    userIds.map((uid) => sendToUser(uid, { ...event } as PushEvent)),
  );
}
