/**
 * Tipi per gli eventi WebSocket di Alpha Chat.
 *
 * Convenzione:
 *   WsInboundEvent  — messaggi che il CLIENT invia al SERVER
 *   WsOutboundEvent — messaggi che il SERVER invia al CLIENT
 */

// ---------------------------------------------------------------------------
// Inbound (client → server)
// ---------------------------------------------------------------------------

export type WsInboundEventType =
  | "auth"          // primo messaggio: autenticazione con JWT
  | "pong"          // risposta al ping del server
  | "typing.start"  // utente ha iniziato a scrivere
  | "typing.stop";  // utente ha smesso di scrivere

export interface WsInboundEvent {
  type: WsInboundEventType;
  payload?: unknown;
}

// payload di ogni evento inbound
export interface AuthPayload      { token: string }
export interface TypingPayload    { conversation_id: string }

// ---------------------------------------------------------------------------
// Outbound (server → client)
// ---------------------------------------------------------------------------

export type WsOutboundEventType =
  | "auth.ok"           // autenticazione riuscita
  | "auth.error"        // token invalido / mancante
  | "ping"              // heartbeat
  | "error"             // errore generico
  | "message.new"       // nuovo messaggio nella conversazione
  | "message.delivered" // consegna confermata (Sprint 8)
  | "presence.online"   // utente connesso
  | "presence.offline"  // utente disconnesso
  | "typing.start"      // utente sta scrivendo (broadcast ai membri)
  | "typing.stop"       // utente ha smesso (broadcast ai membri)
  | "read.receipt"      // l'altra persona ha letto i messaggi
  | "message.edited"    // un messaggio è stato modificato
  | "message.deleted";  // un messaggio è stato eliminato per tutti

export interface WsOutboundEvent {
  type: WsOutboundEventType;
  payload?: unknown;
}

export interface ReadReceiptPayload {
  conversation_id: string;
  user_id: string;       // chi ha letto
  read_at: string;       // ISO timestamp
}
