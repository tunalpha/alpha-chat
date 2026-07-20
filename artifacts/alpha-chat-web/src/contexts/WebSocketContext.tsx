/**
 * WebSocketContext — connessione WS sempre viva per tutta la sessione autenticata.
 *
 * Motivazione: in precedenza useWebSocket era istanziato solo dentro ChatPage.
 * Se l'utente si trovava su LockScreen, ProfilePage o qualsiasi altra vista,
 * il componente non era montato → nessuna connessione WS → connCount=0 → il
 * server non poteva consegnare call.incoming via WS e cadeva sul push.
 *
 * Soluzione: WebSocketProvider viene montato subito dentro AuthProvider,
 * indipendentemente dalla vista corrente. Il WS si connette al login e si
 * chiude solo al logout (accessToken=null).
 *
 * Presenza (onlineUsers):
 * Mantenuta qui — NON in ChatPage — per evitare due bug:
 *   1. Race condition: sendInitialPresence arriva prima che ChatPage registri
 *      il suo handler → eventi persi → tutti offline.
 *   2. Flicker: ChatPage smonta/rimonta (cambio vista) → onlineUsers si azzera.
 * Al (ri)connessione WS viene fatto un fetch REST per ottenere lo stato attuale
 * senza dipendere dal timing degli eventi WS.
 */

import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react";
import { useWebSocket, type WsEvent } from "../hooks/useWebSocket";
import { useAuth } from "./AuthContext";
import { apiGetContactsPresence } from "../lib/api";

type WsContextValue = ReturnType<typeof useWebSocket> & {
  onlineUsers: Set<string>;
};

const WebSocketContext = createContext<WsContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  // Il gate binario (null = non autenticato) viene letto qui una volta sola.
  // L'hook legge sempre il token fresco da localStorage al momento della
  // connessione/riconnessione — non dipende dal valore chiuso nello useEffect.
  const ws = useWebSocket(auth?.accessToken ?? null);

  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  // ── Phoenix Protocol: forced logout ──────────────────────────────────────
  // Quando il server esegue phoenix:destroy o phoenix:lock invia un WS event.
  // Dispatchiamo "auth:expired" che AuthContext ascolta → clearAuth() + setAuth(null).
  // Questo è l'unico posto globale con accesso sia al WS che al lifecycle auth.
  useEffect(() => {
    return ws.on((event: WsEvent) => {
      if (event.type === "phoenix:destroy" || event.type === "phoenix:lock") {
        window.dispatchEvent(new Event("auth:expired"));
      }
    });
  }, [ws.on]);

  // ── Presenza: aggiornamento real-time via WS ──────────────────────────────
  // Gli eventi presence.online / presence.offline aggiornano il Set in tempo reale.
  // Gestiti qui (non in ChatPage) perché il provider è sempre montato.
  useEffect(() => {
    return ws.on((event: WsEvent) => {
      if (event.type === "presence.online") {
        setOnlineUsers((prev) => new Set(prev).add(event.payload.user_id));
      } else if (event.type === "presence.offline") {
        setOnlineUsers((prev) => {
          const s = new Set(prev);
          s.delete(event.payload.user_id);
          return s;
        });
      }
    });
  }, [ws.on]);

  // ── Presenza: stato iniziale via REST al (ri)connessione ─────────────────
  // Risolve la race condition: sendInitialPresence invia eventi WS subito dopo
  // auth.ok, ma ChatPage potrebbe non essere ancora montata. Con la fetch REST
  // otteniamo lo stato attuale in modo affidabile, indipendente dal timing.
  //
  // Quando connected passa a false (disconnessione) azzeriamo il Set: i contatti
  // non sono "online" durante la disconnessione, e la prossima connessione li
  // ripopolerà. Questo elimina anche i falsi "online" residui dopo un logout.
  useEffect(() => {
    if (!ws.connected) {
      setOnlineUsers(new Set());
      return;
    }
    // WS appena connessa → fetch snapshot attuale
    apiGetContactsPresence()
      .then((data) => setOnlineUsers(new Set(data.online_user_ids)))
      .catch(() => {/* ignora errori di rete — gli eventi WS coprono gli aggiornamenti */});
  }, [ws.connected]);

  const value: WsContextValue = useMemo(
    () => ({ ...ws, onlineUsers }),
    // ws è stabile (useCallback/useState interni), onlineUsers cambia solo su eventi presenza
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.connected, ws.on, ws.send, ws.sendTypingStart, ws.sendTypingStop, onlineUsers],
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWs(): WsContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWs must be used within WebSocketProvider");
  return ctx;
}
