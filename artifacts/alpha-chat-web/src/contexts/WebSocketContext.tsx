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
 */

import { createContext, useContext, type ReactNode } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAuth } from "./AuthContext";

type WsContextValue = ReturnType<typeof useWebSocket>;

const WebSocketContext = createContext<WsContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  // Il gate binario (null = non autenticato) viene letto qui una volta sola.
  // L'hook legge sempre il token fresco da localStorage al momento della
  // connessione/riconnessione — non dipende dal valore chiuso nello useEffect.
  const ws = useWebSocket(auth?.accessToken ?? null);
  return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>;
}

export function useWs(): WsContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWs must be used within WebSocketProvider");
  return ctx;
}
