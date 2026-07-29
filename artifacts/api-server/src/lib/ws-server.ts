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
import { callMetrics } from "./call-metrics";
import * as callSessionService from "../services/call-session.service";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { UserModel } from "../models/user.model";
import type {
  WsInboundEvent,
  WsOutboundEvent,
  AuthPayload,
  TypingPayload,
} from "../types/ws-events";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const PING_INTERVAL_MS = 15_000; // 15 secondi (ridotto da 30s — zombie window massima)
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
    let lastPingSentAt: number | null = null;
    let lastPongAt: number | null = null;

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
          logger.info(
            { userId, lastPingSentAt, lastPongAt, msSinceLastPing: lastPingSentAt ? Date.now() - lastPingSentAt : null },
            "[WS] heartbeat timeout — nessun pong ricevuto → terminate()",
          );
          ws.terminate();
          return;
        }
        isAlive = false;
        conn.isAlive = false;
        lastPingSentAt = Date.now();
        logger.info({ userId, lastPingSentAt }, "[WS] ping sent");
        safeSend(ws, { type: "ping" });
      }, PING_INTERVAL_MS);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    async function cleanup(): Promise<void> {
      if (pingInterval) clearInterval(pingInterval);
      if (authTimeout) clearTimeout(authTimeout);

      if (userId) {
        wsManager.unregister(conn);
        // Fix #3 — libera sempre lo stato inCall su disconnect WS.
        // Se la connessione cade senza call.end (crash, iOS background, rete assente),
        // l'utente restava in inCallUsers indefinitamente → prossima chiamata = call.busy.
        wsManager.clearInCall(userId);
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

          // Re-deliver pending call.incoming se il callee si è riconnesso
          // mentre una chiamata era in corso (iOS background → foreground).
          // Il caller ha già inviato call.offer; il server lo ha bufferizzato
          // in pendingCalls e lo reinvia solo a questa nuova connessione.
          const pendingCall = wsManager.getPendingCall(userId);
          if (pendingCall) {
            logger.info({ userId }, "[DIAG-SRV] WS reconnect — re-delivering pending call.incoming");
            safeSend(ws, { type: "call.incoming", payload: pendingCall } as unknown as Parameters<typeof safeSend>[1]);
          }

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
          const { conversation_id, activity } = (event.payload ?? {}) as Partial<TypingPayload>;
          if (!conversation_id) break;

          void setTyping(userId, conversation_id);

          // Broadcast ai membri della conversazione (escluso il mittente).
          // activity inoltra "typing" | "recording" così il destinatario può
          // distinguere "sta scrivendo" da "sta registrando un vocale".
          void broadcastTyping(userId, conversation_id, "typing.start", activity);

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

        // ── WebRTC signaling — Sprint 23 ──────────────────────────────────
        // Il server fa solo relay: instrada i messaggi tra caller e callee.
        // Nessuna logica di chiamata sul server — tutto P2P via ICE/STUN.

        // ── WebRTC signaling Sprint 25 — busy/DND/multi-device ───────────
        case "call.offer": {
          // [TIMING] T0 — ricezione call.offer
          const _t0 = performance.now();

          const p = (event.payload ?? {}) as Record<string, unknown>;
          const toId   = p["to_user_id"] as string | undefined;
          const callId = p["call_id"]    as string | undefined;
          if (!toId) break;

          // M4 — Deduplicazione: se questo call_id è già stato elaborato (retry del caller),
          // restituiamo un ACK silenzioso senza rielaborare l'offer per evitare doppio squillo.
          if (callId && wsManager.hasProcessedOffer(callId)) {
            logger.info({ callId, callerId: userId, calleeId: toId }, "[CALL-M4] call.offer duplicato ignorato (stesso call_id)");
            callMetrics.calls_retried++;
            callMetrics.calls_deduplicated++;
            break;
          }
          // Marca subito come elaborato, prima di qualsiasi await, per prevenire
          // condizioni di gara in caso di retry rapido (es. due ritrasmissioni quasi simultanee).
          if (callId) wsManager.markOfferProcessed(callId);
          callMetrics.calls_started++;

          // Busy check: callee già in chiamata attiva
          if (wsManager.isInCall(toId)) {
            safeSend(ws, { type: "call.busy", payload: { to_user_id: toId } });
            // Fire-and-forget — non blocca il signaling
            callSessionService.onCallBusy(callId, userId!, toId);
            break;
          }

          // DND check: allow_calls_from del destinatario
          // [TIMING] T1 — inizio UserModel.findById (DND check)
          const _t1 = performance.now();
          try {
            const callee = await UserModel.findById(toId).select("allow_calls_from").lean() as { allow_calls_from?: string } | null;
            // [TIMING] T2 — fine UserModel.findById
            const _t2 = performance.now();
            logger.info(
              { callId, calleeId: toId, dnd_lookup_ms: Math.round(_t2 - _t1) },
              "[TIMING] call.offer DND lookup completato",
            );
            if (callee) {
              const pref = callee.allow_calls_from ?? "contacts";
              if (pref === "nobody") {
                safeSend(ws, { type: "call.rejected", payload: { from_user_id: toId, reason: "privacy" } });
                break;
              }
              // "contacts" check — semplificato: se non online accetta comunque (server non traccia contatti)
            }
          } catch (dndErr) {
            // [TIMING] T2-err — findById fallito
            const _t2err = performance.now();
            logger.warn(
              { callId, calleeId: toId, dnd_lookup_ms: Math.round(_t2err - _t1), err: dndErr },
              "[TIMING] call.offer DND lookup fallito (non bloccante)",
            );
          }

          // [DIAG-SRV] Snapshot dettagliato del WsManager prima di qualsiasi azione
          const diagBefore = wsManager.diagCalleeState(toId);
          logger.info(
            {
              callerId:    userId,
              calleeId:    toId,
              connCount:   diagBefore.connCount,
              readyStates: diagBefore.readyStates,   // es. [1] = OPEN, [3] = CLOSED
              openCount:   diagBefore.openCount,
              isOnline:    wsManager.isOnline(toId),
            },
            "[DIAG-SRV] call.offer → stato callee pre-delivery",
          );

          // Fan-out a TUTTI i device del destinatario (multi-device ring).
          // M4 fix: avvolto in try/catch — se il relay fallisce per un errore imprevisto,
          // rimuoviamo il call_id dal registry per permettere retry legittimi.
          // Nota: busy/privacy → break prima di questo punto → dedup preservata (corretto).
          // Nota: il DND try/catch sopra swallows errori DB → esecuzione sempre qui.
          const callIncomingPayload = { ...p, from_user_id: userId! };
          let offerRelayCount = 0;
          // [TIMING] T3 — inizio relay WS
          const _t3 = performance.now();
          try {
            offerRelayCount = wsManager.sendToUser(toId, {
              type: "call.incoming",
              payload: callIncomingPayload,
            });
            // [TIMING] T4 — fine relay WS
            const _t4 = performance.now();
            logger.info(
              { callId, calleeId: toId, relay_ms: Math.round(_t4 - _t3), delivered_sockets: offerRelayCount },
              "[TIMING] call.offer relay WS completato",
            );

            // Bufferizza per re-delivery se il callee si riconnette entro 35s
            wsManager.setPendingCall(toId, callIncomingPayload);
            // Fire-and-forget state machine — non blocca il signaling
            callSessionService.onCallOffer(
              callId, userId!, toId,
              ((p["call_type"] as string) === "video" ? "video" : "audio"),
              p["conversation_id"] as string | undefined,
            );

            // Push per dispositivi offline oppure con zombie connection (isOnline=true ma openCount=0)
            // In entrambi i casi non esiste un socket OPEN → la push è l'unico canale affidabile.
            // Fire-and-forget — non blocca il signaling
            if (!wsManager.isOnline(toId) || diagBefore.openCount === 0) {
              logger.info(
                { calleeId: toId, isOnline: wsManager.isOnline(toId), openCount: diagBefore.openCount },
                wsManager.isOnline(toId)
                  ? "[CALL-M5] callee isOnline=true ma openCount=0 (zombie) → push inviata"
                  : "[CALL-M5] callee offline → push inviata",
              );
              const { dispatchToOne } = await import("../services/push/PushDispatcher");
              dispatchToOne(toId, {
                type:          "call.incoming",
                recipientUserId: toId,
                callerId:      userId!,
                callerName:    (p["from_display_name"] as string) ?? "Utente",
                callType:      ((p["call_type"] as string) === "video" ? "video" : "audio"),
              });
            } else {
              logger.info(
                { calleeId: toId, openCount: diagBefore.openCount },
                "[CALL-M5] callee online, openCount=" + diagBefore.openCount + " → WS delivery, push non necessaria",
              );
            }
          } catch (relayErr) {
            // Errore imprevisto nel relay: libera il call_id per permettere retry legittimi.
            logger.error({ callId, calleeId: toId, err: relayErr }, "[CALL-M4] relay fallito dopo markOfferProcessed → clearProcessedOffer");
            if (callId) wsManager.clearProcessedOffer(callId);
            break;
          }

          // M2 — ACK al caller: conferma che almeno un socket OPEN del callee ha ricevuto l'offer
          // (oppure 0 se solo pendingCalls/push). NON significa "callee ha risposto".
          // [TIMING] T5 — invio call.signal_ack
          const _t5 = performance.now();
          logger.info(
            {
              callId,
              callerId:      userId,
              calleeId:      toId,
              delivered:     offerRelayCount > 0,
              t_dnd_ms:      Math.round(_t1 - _t0),
              t_lookup_ms:   Math.round(_t5 - _t1),   // include DND await + relay
              t_relay_ms:    Math.round(_t3 - _t1),   // solo DND await
              t_ack_ms:      Math.round(_t5 - _t3),   // dal relay all'ACK
              t_total_ms:    Math.round(_t5 - _t0),   // dall'arrivo offer all'ACK
            },
            "[TIMING] call.offer → call.signal_ack INVIATO",
          );
          safeSend(ws, {
            type: "call.signal_ack",
            payload: { call_id: callId, event_type: "call.offer", delivered: offerRelayCount > 0 },
          });
          break;
        }

        case "call.answer": {
          const p      = (event.payload ?? {}) as Record<string, unknown>;
          const toId   = p["to_user_id"] as string | undefined;
          const callId = p["call_id"]    as string | undefined;
          if (!toId) break;

          logger.info({ calleeId: userId, callerId: toId }, "[DIAG-SRV] call.answer ricevuto → callee ha ACCETTATO");
          callMetrics.calls_answered++;
          // Fire-and-forget state machine
          callSessionService.onCallAnswer(callId, userId!, toId);

          // Chiamata accettata: cancella la pending call (non serve più re-delivery)
          wsManager.clearPendingCall(userId!);

          // Relay risposta al chiamante
          const answerDelivered = wsManager.sendToUser(toId, {
            type: "call.answered",
            payload: { ...p, from_user_id: userId },
          });

          // M2 — ACK al callee: conferma che il call.answer è arrivato al socket del caller.
          // NON significa "chiamata attiva" o "WebRTC avviato".
          safeSend(ws, {
            type: "call.signal_ack",
            payload: { call_id: callId, event_type: "call.answer", delivered: answerDelivered > 0 },
          });

          // Marca entrambi come "in chiamata"
          wsManager.setInCall(userId!);
          wsManager.setInCall(toId);

          // Dice agli ALTRI device del callee di smettere di squillare
          wsManager.sendToUserExcept(userId!, conn, {
            type: "call.ended_elsewhere",
            payload: { from_user_id: toId },
          });
          break;
        }

        case "call.ice_candidate": {
          const p = (event.payload ?? {}) as Record<string, unknown>;
          const toId = p["to_user_id"] as string | undefined;
          if (!toId) break;
          wsManager.sendToUser(toId, {
            type: "call.ice_candidate",
            payload: { ...p, from_user_id: userId },
          });
          break;
        }

        case "call.reject": {
          const p      = (event.payload ?? {}) as Record<string, unknown>;
          const toId   = p["to_user_id"] as string | undefined;
          const callId = p["call_id"]    as string | undefined;
          if (!toId) break;

          logger.info({ calleeId: userId, callerId: toId, reason: p["reason"] }, "[DIAG-SRV] call.reject ricevuto → callee ha RIFIUTATO (o errore acceptCall)");
          callMetrics.calls_failed++;
          // Fire-and-forget state machine
          callSessionService.onCallReject(callId, userId!, toId, p["reason"] as string | undefined);

          // Chiamata rifiutata: cancella la pending call
          wsManager.clearPendingCall(userId!);

          // Relay rifiuto al chiamante
          const rejectDelivered = wsManager.sendToUser(toId, {
            type: "call.rejected",
            payload: { from_user_id: userId, reason: p["reason"] },
          });

          // M2 — ACK al callee: conferma che il call.reject è arrivato al socket del caller.
          safeSend(ws, {
            type: "call.signal_ack",
            payload: { call_id: callId, event_type: "call.reject", delivered: rejectDelivered > 0 },
          });

          // Dismisses gli altri device del callee (se erano anche loro in squillo)
          wsManager.sendToUserExcept(userId!, conn, {
            type: "call.ended_elsewhere",
            payload: { from_user_id: toId },
          });
          break;
        }

        case "call.end": {
          const p      = (event.payload ?? {}) as Record<string, unknown>;
          const toId   = p["to_user_id"] as string | undefined;
          const callId = p["call_id"]    as string | undefined;
          if (!toId) break;

          const calleeOnline = wsManager.isOnline(toId);
          logger.info(
            { callerId: userId, calleeId: toId, reason: p["reason"], calleeOnline },
            "[DIAG-SRV] call.end ricevuto → invio call.ended al callee",
          );
          callMetrics.calls_completed++;
          if (p["reason"] === "timeout" || p["reason"] === "cancelled") {
            callMetrics.calls_failed++;
          }
          // Fire-and-forget state machine
          callSessionService.onCallEnd(callId, userId!, toId, p["reason"] as string | undefined);
          const endDelivered = wsManager.sendToUser(toId, {
            type: "call.ended",
            payload: { from_user_id: userId },
          });

          // M2 — ACK al sender: conferma che call.ended ha raggiunto ≥1 socket del destinatario.
          safeSend(ws, {
            type: "call.signal_ack",
            payload: { call_id: callId, event_type: "call.end", delivered: endDelivered > 0 },
          });

          // Se il caller annulla prima della risposta → notifica "chiamata persa" al callee
          if (p["reason"] === "timeout" || p["reason"] === "cancelled") {
            wsManager.sendToUser(toId, {
              type: "call.missed",
              payload: { from_user_id: userId },
            });
          }

          // Chiamata terminata dal caller: cancella pending (callee non ha risposto)
          wsManager.clearPendingCall(toId);

          // Libera entrambi dal "in call" status
          wsManager.clearInCall(userId!);
          wsManager.clearInCall(toId);
          break;
        }

        // ── Signal session recovery ──────────────────────────────────────────
        // Il destinatario (recipient) ha ricevuto un WhisperMessage ma non ha
        // più la sessione Signal in IDB (clear browser, nuovo device, ecc.).
        // Il messaggio è irrecuperabile, ma il destinatario chiede al mittente
        // di cancellare la sessione locale: il prossimo signalEncrypt() produrrà
        // automaticamente un PreKeyWhisperMessage, ri-stabilendo la sessione.
        case "signal.session.reset": {
          const p    = (event.payload ?? {}) as Record<string, unknown>;
          const toId = p["to_user_id"] as string | undefined;
          if (!toId) break;

          logger.info(
            { recipient: userId, sender: toId },
            "[SIGNAL] signal.session.reset — relay al mittente",
          );

          // Relay al mittente (tutti i suoi device, multi-device safe)
          wsManager.sendToUser(toId, {
            type: "signal.session.reset",
            payload: { from_user_id: userId },
          });
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
      lastPongAt = Date.now();
      logger.info(
        { userId, lastPongAt, rttMs: lastPingSentAt ? lastPongAt - lastPingSentAt : null },
        "[WS] pong received",
      );
    });

    ws.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason.toString() || "(none)";
      logger.info(
        { userId, code, reason: reasonStr, lastPingSentAt, lastPongAt,
          msSinceLastPong: lastPongAt ? Date.now() - lastPongAt : null },
        "[WS] onclose",
      );
      void cleanup();
    });

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
  activity?: "typing" | "recording",
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
      // activity incluso solo su typing.start quando fornito (retro-compat:
      // se assente, il client lo tratta come "typing" normale).
      payload: { user_id: senderId, conversation_id: conversationId, ...(activity ? { activity } : {}) },
    });
  } catch (err) {
    logger.warn({ err, senderId, conversationId }, "broadcastTyping failed");
  }
}
