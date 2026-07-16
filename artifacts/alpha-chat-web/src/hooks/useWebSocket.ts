import { useEffect, useRef, useCallback, useState } from "react";

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
  // WebRTC signaling — Sprint 23
  | { type: "call.incoming";     payload: Record<string, unknown> }
  | { type: "call.answered";     payload: Record<string, unknown> }
  | { type: "call.ice_candidate";payload: Record<string, unknown> }
  | { type: "call.rejected";     payload: Record<string, unknown> }
  | { type: "call.ended";        payload: Record<string, unknown> }
  | { type: "call.busy";         payload: Record<string, unknown> };

type EventHandler = (event: WsEvent) => void;

export function useWebSocket(accessToken: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<EventHandler>>(new Set());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
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

    function connect() {
      if (!mountedRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        // Authenticate
        ws.send(JSON.stringify({ type: "auth", payload: { token: accessToken } }));
        reconnectDelay.current = 1000; // reset backoff
      };

      ws.onmessage = (e: MessageEvent) => {
        let event: WsEvent;
        try { event = JSON.parse(e.data as string) as WsEvent; } catch { return; }

        // Handle ping → pong
        if (event.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        if (event.type === "auth.ok") {
          if (mountedRef.current) setConnected(true);
        }

        // Dispatch to all handlers
        handlersRef.current.forEach((h) => h(event));
      };

      ws.onclose = () => {
        if (mountedRef.current) setConnected(false);
        if (!mountedRef.current) return;
        // Exponential backoff reconnect
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [accessToken]);

  return { connected, on, send, sendTypingStart, sendTypingStop };
}
