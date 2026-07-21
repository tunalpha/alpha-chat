import { useEffect, useRef, useCallback, useState } from "react";
import { getAccessToken } from "../lib/auth";
import { diagLog } from "../lib/diagnosticLogger";

export type WsEvent =
  | { type: "message.new"; payload: Record<string, unknown> }
  | { type: "typing.start"; payload: { user_id: string; conversation_id: string } }
  | { type: "typing.stop"; payload: { user_id: string; conversation_id: string } }
  | { type: "presence.online"; payload: { user_id: string } }
  | { type: "presence.offline"; payload: { user_id: string; last_seen_at: string } }
  | { type: "read.receipt"; payload: { conversation_id: string; user_id: string; read_at: string } }
  | { type: "message.edited"; payload: Record<string, unknown> }
  | { type: "message.deleted"; payload: { message_id: string; conversation_id: string; for_everyone: boolean } }
  | { type: "message.destroyed"; payload: { message_id: string; conversation_id: string; destroyed_by: string | null } }
  | { type: "conversation.disappearing_updated"; payload: { conversation_id: string; enabled: boolean; duration_ms: number | null; updated_by: string } }
  | { type: "auth.ok"; payload: { user_id: string } }
  | { type: "auth.error"; payload: { message: string } }
  | { type: "ping" }
  | { type: "error"; payload: { message: string } }
  | { type: "phoenix:lock"; payload: { reason: string } }
  | { type: "phoenix:destroy"; payload: { reason: string } }
  // WebRTC signaling — Sprint 23/25
  | { type: "call.incoming";        payload: Record<string, unknown> }
  | { type: "call.answered";        payload: Record<string, unknown> }
  | { type: "call.ice_candidate";   payload: Record<string, unknown> }
  | { type: "call.rejected";        payload: Record<string, unknown> }
  | { type: "call.ended";           payload: Record<string, unknown> }
  | { type: "call.busy";            payload: Record<string, unknown> }
  | { type: "call.missed";          payload: Record<string, unknown> }
  | { type: "call.ended_elsewhere"; payload: Record<string, unknown> }
  | { type: "call.signal_ack";      payload: Record<string, unknown> }
  // USDA Payments
  | { type: "usda.payment.update";  payload: Record<string, unknown> };

type EventHandler = (event: WsEvent) => void;

/** Evento in coda — accodato quando il WS non è OPEN, consegnato alla riconnessione. */
interface QueuedEvent {
  data: object;
  enqueuedAt: number;
}

/**
 * TTL della coda: gli eventi più vecchi di questo valore vengono scartati al flush.
 * 5 secondi è sufficiente per typing (auto-stop server a 5s) e call signaling iniziale.
 */
const QUEUE_TTL_MS = 5_000;
/** Limite massimo di eventi in coda — evita memory leak in sessioni lunghe offline. */
const QUEUE_MAX = 50;

export function useWebSocket(accessToken: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<EventHandler>>(new Set());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  /**
   * Coda degli eventi inviati mentre il WS era disconnesso.
   * Vengono consegnati appena auth.ok arriva (WS pronto), scartando quelli scaduti.
   */
  const pendingEventsRef = useRef<QueuedEvent[]>([]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      // WS non disponibile: accoda l'evento invece di scartarlo silenziosamente.
      // Sarà consegnato al prossimo auth.ok se ancora entro il TTL.
      pendingEventsRef.current.push({ data, enqueuedAt: Date.now() });
      // Impedisci crescita illimitata: rimuovi il più vecchio se supera il limite.
      if (pendingEventsRef.current.length > QUEUE_MAX) {
        pendingEventsRef.current.shift();
      }
    }
  }, []);

  const on = useCallback((handler: EventHandler) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  const sendTypingStart = useCallback((conversationId: string) => {
    send({ type: "typing.start", payload: { conversation_id: conversationId } });
  }, [send]);

  const sendTypingStop = useCallback((conversationId: string) => {
    send({ type: "typing.stop", payload: { conversation_id: conversationId } });
  }, [send]);

  useEffect(() => {
    mountedRef.current = true;
    if (!accessToken) return;

    function connect(reason = "unknown") {
      console.log('[WS] connect() reason=' + reason + ' mounted=' + mountedRef.current);
      if (!mountedRef.current) return;

      // CRITICAL FIX: leggi SEMPRE il token fresco da localStorage, non la prop React.
      //
      // Perché: il token viene rinnovato da attemptRefresh() (in api.ts) che aggiorna
      // solo localStorage, mai il React state in AuthContext. Se il WS cade e deve
      // riconnettersi, usare la prop chiusa nello useEffect restituisce il token
      // originale (scaduto) → il server lo rifiuta → auth.error → ciclo infinito di
      // disconnessioni.
      //
      // Il prop `accessToken` resta nella dipendenza di useEffect SOLO come gate
      // binario (login presente / logout) — non come sorgente del token per la WS auth.
      const freshToken = getAccessToken();
      if (!freshToken) {
        const delay = reconnectDelay.current;
        console.log('[WS] token null → reconnect scheduled delay=' + delay + 'ms');
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(delay * 2, 30_000);
          console.log('[WS] reconnect started (no-token) — nextDelay=' + reconnectDelay.current + 'ms');
          connect("backoff-no-token");
        }, delay);
        return;
      }
      console.log('[WS] token ok (' + freshToken.substring(0, 12) + '...) — apertura WebSocket');

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        console.log('[WS] onopen — connessione TCP stabilita');
        diagLog('ws.open');
        ws.send(JSON.stringify({ type: "auth", payload: { token: freshToken } }));
        console.log('[WS] auth sent — token=' + freshToken.substring(0, 12) + '...');
        reconnectDelay.current = 1000; // reset backoff su connessione riuscita
      };

      ws.onmessage = (e: MessageEvent) => {
        let event: WsEvent;
        try { event = JSON.parse(e.data as string) as WsEvent; } catch { return; }

        // Handle ping → pong
        if (event.type === "ping") {
          console.log('[WS] ping received — invio pong');
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        if (event.type === "auth.ok") {
          console.log('[WS] auth.ok ricevuto — WS autenticata e pronta');
          diagLog('ws.auth.ok');
          if (mountedRef.current) setConnected(true);

          // Flush coda: consegna gli eventi accodati durante la disconnessione,
          // scartando quelli scaduti (oltre QUEUE_TTL_MS).
          const now = Date.now();
          const pending = pendingEventsRef.current.splice(0);
          if (pending.length > 0) console.log('[WS] flush coda — eventi in coda:', pending.length);
          for (const { data, enqueuedAt } of pending) {
            if (now - enqueuedAt < QUEUE_TTL_MS) {
              ws.send(JSON.stringify(data));
            }
            // Gli eventi scaduti vengono scartati silenziosamente — erano già stale
            // (es. typing.start senza typing.stop, call.offer non più rilevante).
          }
        }

        // Dispatch to all handlers
        handlersRef.current.forEach((h) => h(event));
      };

      ws.onclose = (ev) => {
        console.log('[WS] onclose — code=' + ev.code + ' reason=' + (ev.reason || '(none)') + ' wasClean=' + ev.wasClean);
        diagLog('ws.close', { code: ev.code, reason: ev.reason || '', wasClean: ev.wasClean });
        if (mountedRef.current) setConnected(false);
        if (!mountedRef.current) return;
        const delay = reconnectDelay.current;
        console.log('[WS] reconnect scheduled — delay=' + delay + 'ms');
        // Exponential backoff reconnect
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(delay * 2, 30_000);
          console.log('[WS] reconnect started — nextDelay=' + reconnectDelay.current + 'ms');
          connect("backoff-onclose");
        }, delay);
      };

      ws.onerror = (ev) => {
        console.log('[WS] onerror — type=' + ev.type);
        diagLog('ws.error', { type: ev.type });
        ws.close();
      };
    }

    // ── Riconnessione immediata al ritorno in foreground ───────────────────
    // iOS sospende completamente l'esecuzione JS quando l'app va in background.
    // Il setTimeout del backoff viene congelato → al ritorno in foreground il
    // timer potrebbe non essere ancora partito. Il visibilitychange forza una
    // riconnessione immediata, cancellando qualsiasi timer di backoff in corso.
    function handleVisibilityChange(): void {
      if (!mountedRef.current || document.hidden) return;
      const ws = wsRef.current;
      const state = ws?.readyState ?? -1;
      const stateLabel = ['CONNECTING','OPEN','CLOSING','CLOSED'][state] ?? ('?'+state);
      console.log('[WS] visibilitychange → foreground, readyState=' + stateLabel + ' (' + state + ')');
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('[WS] visibilitychange → WS già attiva, nessuna azione');
        return;
      }
      // Cancella il backoff in corso e riprova subito.
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
        console.log('[WS] visibilitychange → timer backoff annullato, riconnessione immediata');
      }
      reconnectDelay.current = 1_000;
      connect("visibilitychange");
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    connect("initial");

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
        wsRef.current = null;
      }
      // Svuota la coda: gli eventi accodati durante il logout/unmount non hanno senso
      // da consegnare alla prossima sessione (token diverso, contesto diverso).
      pendingEventsRef.current = [];
      setConnected(false);
    };
  }, [accessToken]);

  return { connected, on, send, sendTypingStart, sendTypingStop };
}
