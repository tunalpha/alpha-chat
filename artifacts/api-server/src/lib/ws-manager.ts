/**
 * WsManager — registro centralizzato delle connessioni WebSocket attive.
 *
 * Responsabilità:
 *   - Traccia userId → Set<ClientConnection> (multi-device)
 *   - Espone sendToUser / sendToUsers per broadcast
 *   - Gestisce i timer del typing indicator (5s auto-stop)
 *
 * Non contiene logica di business: è un registry puro.
 */

import WebSocket from "ws";
import { logger } from "./logger";
import type { WsOutboundEvent } from "../types/ws-events";

// ---------------------------------------------------------------------------
// Tipi interni
// ---------------------------------------------------------------------------

export interface ClientConnection {
  ws: WebSocket;
  userId: string;
  isAlive: boolean;
}

// ---------------------------------------------------------------------------
// WsManager
// ---------------------------------------------------------------------------

class WsManager {
  /** userId → Set di connessioni attive (multi-device) */
  private readonly userConnections = new Map<string, Set<ClientConnection>>();

  /** chiave `${userId}:${conversationId}` → timer typing auto-stop */
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Set di userId attualmente in una chiamata attiva (per busy detection) */
  private readonly inCallUsers = new Set<string>();

  // ── Registry ────────────────────────────────────────────────────────────

  register(conn: ClientConnection): void {
    const { userId } = conn;
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(conn);
    // DIAG: promosso a INFO temporaneamente per tracciare mancata registrazione callee
    logger.info(
      { userId, connections: this.userConnections.get(userId)!.size },
      "[DIAG-SRV] WsManager.register() — connCount dopo registrazione",
    );
  }

  /** Numero di utenti unici con almeno una connessione WebSocket attiva. */
  getOnlineCount(): number {
    return this.userConnections.size;
  }

  unregister(conn: ClientConnection): void {
    const { userId } = conn;
    const conns = this.userConnections.get(userId);
    if (!conns) return;
    conns.delete(conn);
    if (conns.size === 0) {
      this.userConnections.delete(userId);
    }
    logger.debug(
      { userId, remaining: conns.size },
      "WS client unregistered",
    );
  }

  // ── Presenza ────────────────────────────────────────────────────────────

  isOnline(userId: string): boolean {
    const conns = this.userConnections.get(userId);
    return !!(conns && conns.size > 0);
  }

  getOnlineUserIds(userIds: string[]): string[] {
    return userIds.filter((id) => this.isOnline(id));
  }

  // ── Invio eventi ────────────────────────────────────────────────────────

  sendToUser(userId: string, event: WsOutboundEvent): void {
    const conns = this.userConnections.get(userId);
    if (!conns) return;
    const msg = JSON.stringify(event);
    for (const conn of conns) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(msg, (err) => {
          if (err) {
            logger.warn({ err, userId }, "WS send error");
          }
        });
      }
    }
  }

  sendToUsers(userIds: string[], event: WsOutboundEvent): void {
    for (const userId of userIds) {
      this.sendToUser(userId, event);
    }
  }

  /** Invia a tutti i socket dell'utente TRANNE la connessione specificata. */
  sendToUserExcept(userId: string, excludeConn: ClientConnection, event: WsOutboundEvent): void {
    const conns = this.userConnections.get(userId);
    if (!conns) return;
    const msg = JSON.stringify(event);
    for (const conn of conns) {
      if (conn === excludeConn) continue;
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(msg, (err) => { if (err) logger.warn({ err, userId }, "WS send error"); });
      }
    }
  }

  /** Numero di connessioni attive per un utente (per multi-device). */
  getConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size ?? 0;
  }

  /**
   * DIAG ONLY — rimuovere dopo diagnosi.
   * Restituisce lo stato dettagliato di tutte le connessioni di un utente:
   *   connCount     — connessioni registrate nel Map
   *   readyStates   — readyState di ogni socket (0=CONNECTING,1=OPEN,2=CLOSING,3=CLOSED)
   *   openCount     — socket effettivamente in stato OPEN
   */
  diagCalleeState(userId: string): { connCount: number; readyStates: number[]; openCount: number } {
    const conns = this.userConnections.get(userId);
    if (!conns || conns.size === 0) return { connCount: 0, readyStates: [], openCount: 0 };
    const readyStates = Array.from(conns).map((c) => c.ws.readyState);
    const openCount   = readyStates.filter((s) => s === WebSocket.OPEN).length;
    return { connCount: conns.size, readyStates, openCount };
  }

  // ── In-call tracking (busy detection) ──────────────────────────────────

  setInCall(userId: string): void  { this.inCallUsers.add(userId); }
  clearInCall(userId: string): void { this.inCallUsers.delete(userId); }
  isInCall(userId: string): boolean { return this.inCallUsers.has(userId); }

  // ── Typing timer ────────────────────────────────────────────────────────

  /**
   * Avvia (o resetta) il timer di auto-stop typing per userId+conversationId.
   * onTimeout viene chiamato dopo 5 secondi senza rinnovo.
   */
  setTypingTimer(
    userId: string,
    conversationId: string,
    onTimeout: () => void,
  ): void {
    const key = `${userId}:${conversationId}`;
    const existing = this.typingTimers.get(key);
    if (existing) clearTimeout(existing);
    this.typingTimers.set(
      key,
      setTimeout(() => {
        this.typingTimers.delete(key);
        onTimeout();
      }, 5_000),
    );
  }

  clearTypingTimer(userId: string, conversationId: string): void {
    const key = `${userId}:${conversationId}`;
    const timer = this.typingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(key);
    }
  }
}

/** Singleton globale — importato da ws-server e message.service */
export const wsManager = new WsManager();
