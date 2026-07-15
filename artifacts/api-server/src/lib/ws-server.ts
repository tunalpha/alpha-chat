/**
 * WebSocket Server — Alpha Chat Sprint 7A
 *
 * Attach al server HTTP esistente su /api/ws.
 * Nessuna porta aggiuntiva — usa l'upgrade mechanism HTTP.
 *
 * Flusso:
 *   1. Client si connette → 10s window per autenticarsi
 *   2. Client invia { type:"auth", payload:{ token } }
 *   3. Server verifica JWT → registra in WsManager → setOnline
 *   4. Heartbeat: server invia ping JSON ogni 30s, client risponde pong
 *   5. Su disconnect: unregister → se ultimo device → setOffline
 *
 * Tutti gli errori di business (DB, broadcast) sono loggati come warn —
 * non causano crash del server.
 */

import WebSocket, { WebSocketServer } from "ws";
import type { IncomingMessage, Server as HttpServer } from "http";
import mongoose from "mongoose";
import { logger } from "./logger";
import { wsManager, type ClientConnection } from "./ws-manager";
import { verifyAccessToken } from "../services/jwt.service";
import { setOnline, setOffline, setTyping } from "../services/presence.service";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import type {
  WsInboundEvent,
  WsOutboundEvent,
  AuthPayload,
  TypingPayload,
} from "../types/ws-events";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const PING_INTERVAL_MS = 30_000; // 30 secondi
const AUTH_TIMEOUT_MS = 10_000;  // 10 secondi per autenticarsi

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const memberRepo = new ConversationMemberRepository();

function safeSend(ws: WebSocket, event: WsOutboundEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event), (err) => {
      if (err) logger.warn({ err }, "WS safeSend error");
    });
  }
}

function parseInbound(raw: WebSocket.RawData): WsInboundEvent | null {
  try {
    return JSON.parse(raw.toString()) as WsInboundEvent;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// createWsServer
// ---------------------------------------------------------------------------

export function createWsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // ── HTTP Upgrade → WebSocket ──────────────────────────────────────────
  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== "/api/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // ── Connessione ───────────────────────────────────────────────────────
  wss.on("connection", (ws: WebSocket) => {
    let userId: string | null = null;
    let isAlive = true;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let authTimeout: ReturnType<typeof setTimeout> | null = null;

    // Oggetto conn usato come chiave nel WsManager
    const conn: ClientConnection = { ws, userId: "", isAlive };

    // ── Auth timeout ────────────────────────────────────────────────────
    authTimeout = setTimeout(() => {
      if (!userId) {
        logger.debug("WS auth timeout — disconnecting unauthenticated client");
        ws.terminate();
      }
    }, AUTH_TIMEOUT_MS);

    // ── Heartbeat ───────────────────────────────────────────────────────
    function startHeartbeat(): void {
      pingInterval = setInterval(() => {
        if (!isAlive) {
          logger.debug({ userId }, "WS heartbeat timeout — terminating");
          ws.terminate();
          return;
        }
        isAlive = false;
        conn.isAlive = false;
        safeSend(ws, { type: "ping" });
      }, PING_INTERVAL_MS);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    async function cleanup(): Promise<void> {
      if (pingInterval) clearInterval(pingInterval);
      if (authTimeout) clearTimeout(authTimeout);

      if (userId) {
        wsManager.unregister(conn);
        if (!wsManager.isOnline(userId)) {
          // Ultimo device disconnesso → offline
          await setOffline(userId);
          void broadcastPresence(userId, "presence.offline");
          logger.info({ userId }, "User went offline");
        }
      }
    }

    // ── Message handler ─────────────────────────────────────────────────
    ws.on("message", async (raw) => {
      const event = parseInbound(raw);
      if (!event) {
        safeSend(ws, { type: "error", payload: { message: "Invalid JSON" } });
        return;
      }

      // ── Non ancora autenticato ──────────────────────────────────────
      if (!userId) {
        if (event.type !== "auth") {
          safeSend(ws, { type: "error", payload: { message: "Send auth first" } });
          return;
        }

        const { token } = (event.payload ?? {}) as AuthPayload;
        if (!token) {
          safeSend(ws, { type: "auth.error", payload: { message: "token required" } });
          ws.terminate();
          return;
        }

        try {
          const payload = await verifyAccessToken(token);
          userId = payload.sub;
          conn.userId = userId;

          if (authTimeout) { clearTimeout(authTimeout); authTimeout = null; }

          wsManager.register(conn);
          safeSend(ws, { type: "auth.ok", payload: { user_id: userId } });
          startHeartbeat();
          await setOnline(userId);

          // Invia presenza iniziale: chi tra i contatti è già online
          void sendInitialPresence(userId, ws);
          // Notifica i contatti che questo utente è online
          void broadcastPresence(userId, "presence.online");

          logger.info({ userId }, "WS client authenticated");
        } catch {
          safeSend(ws, { type: "auth.error", payload: { message: "invalid token" } });
          ws.terminate();
        }
        return;
      }

      // ── Autenticato ─────────────────────────────────────────────────
      switch (event.type) {
        case "pong":
          isAlive = true;
          conn.isAlive = true;
          break;

        case "typing.start": {
          const { conversation_id } = (event.payload ?? {}) as Partial<TypingPayload>;
          if (!conversation_id) break;

          void setTyping(userId, conversation_id);

          // Broadcast ai membri della conversazione (escluso il mittente)
          void broadcastTyping(userId, conversation_id, "typing.start");

          // Auto-stop dopo 5s se il client non resetta
          wsManager.setTypingTimer(userId, conversation_id, () => {
            void setTyping(userId!, null);
            void broadcastTyping(userId!, conversation_id, "typing.stop");
          });
          break;
        }

        case "typing.stop": {
          const { conversation_id } = (event.payload ?? {}) as Partial<TypingPayload>;
          if (!conversation_id) break;

          wsManager.clearTypingTimer(userId, conversation_id);
          void setTyping(userId, null);
          void broadcastTyping(userId, conversation_id, "typing.stop");
          break;
        }

        default:
          safeSend(ws, {
            type: "error",
            payload: { message: `Unknown event: ${event.type}` },
          });
      }
    });

    // ── Native WebSocket pong frame ─────────────────────────────────────
    ws.on("pong", () => {
      isAlive = true;
      conn.isAlive = true;
    });

    ws.on("close", () => { void cleanup(); });

    ws.on("error", (err) => {
      logger.warn({ err, userId }, "WS socket error");
    });
  });

  logger.info("WebSocket server attached to /api/ws");
  return wss;
}

// ---------------------------------------------------------------------------
// Helpers broadcast
// ---------------------------------------------------------------------------

/**
 * Invia al client appena connesso un evento presence.online per ogni contatto
 * che è già online in questo momento. Risolve il problema "Marco appare offline
 * perché si era connesso prima di Cricco".
 */
async function sendInitialPresence(userId: string, ws: WebSocket): Promise<void> {
  try {
    const contactIds = await memberRepo.listContactUserIds(
      new mongoose.Types.ObjectId(userId),
    );
    for (const contactId of contactIds) {
      if (wsManager.isOnline(contactId)) {
        safeSend(ws, { type: "presence.online", payload: { user_id: contactId } });
      }
    }
  } catch (err) {
    logger.warn({ err, userId }, "sendInitialPresence failed");
  }
}

/**
 * Broadcast presence.online / presence.offline a tutti i contatti connessi
 * dell'utente (tutti i membri delle sue conversazioni, escluso se stesso).
 */
async function broadcastPresence(
  userId: string,
  type: "presence.online" | "presence.offline",
): Promise<void> {
  try {
    const contactIds = await memberRepo.listContactUserIds(
      new mongoose.Types.ObjectId(userId),
    );
    if (contactIds.length === 0) return;

    const payload =
      type === "presence.online"
        ? { user_id: userId }
        : { user_id: userId, last_seen_at: new Date().toISOString() };

    wsManager.sendToUsers(contactIds, { type, payload } as WsOutboundEvent);
  } catch (err) {
    logger.warn({ err, userId, type }, "broadcastPresence failed");
  }
}

async function broadcastTyping(
  senderId: string,
  conversationId: string,
  type: "typing.start" | "typing.stop",
): Promise<void> {
  try {
    const members = await memberRepo.listMembers(
      new mongoose.Types.ObjectId(conversationId),
    );
    const recipientIds = members
      .map((m) => m.user_id.toString())
      .filter((id) => id !== senderId);

    wsManager.sendToUsers(recipientIds, {
      type,
      payload: { user_id: senderId, conversation_id: conversationId },
    });
  } catch (err) {
    logger.warn({ err, senderId, conversationId }, "broadcastTyping failed");
  }
}
