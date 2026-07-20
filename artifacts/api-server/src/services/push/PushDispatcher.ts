/**
 * PushDispatcher — fire-and-forget.
 *
 * REGOLA FONDAMENTALE: dispatch() è sincrono e ritorna immediatamente.
 * L'invio reale avviene in un setImmediate() separato per non bloccare
 * mai il flusso di messaggi, Signal, WebSocket o chiamate.
 *
 * Un errore nell'invio non può mai propagarsi al chiamante.
 */

import { logger } from "../../lib/logger";
import * as PushNotificationService from "./PushNotificationService";
import type { PushEvent } from "./PushEvents";

/**
 * Dispatcha un evento Push a una lista di utenti.
 * Fire-and-forget: ritorna subito, errori silenziosi (solo log warn).
 */
export function dispatch(userIds: string[], event: PushEvent): void {
  if (!PushNotificationService.isConfigured() || userIds.length === 0) return;
  setImmediate(() => {
    PushNotificationService.sendToUsers(userIds, event).catch((err) => {
      logger.warn({ err, eventType: event.type }, "PushDispatcher: errore non gestito");
    });
  });
}

/**
 * Dispatcha un evento Push a un singolo utente.
 */
export function dispatchToOne(userId: string, event: PushEvent): void {
  dispatch([userId], event);
}
