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
  | "auth"               // primo messaggio: autenticazione con JWT
  | "pong"               // risposta al ping del server
  | "typing.start"       // utente ha iniziato a scrivere
  | "typing.stop"        // utente ha smesso di scrivere
  // WebRTC signaling — Sprint 23
  | "call.offer"         // Caller → Server: avvio chiamata
  | "call.answer"        // Callee → Server: risposta chiamata
  | "call.ice_candidate" // entrambi → Server: candidato ICE
  | "call.reject"        // Callee → Server: rifiuto
  | "call.end";          // entrambi → Server: fine chiamata

export interface WsInboundEvent {
  type: WsInboundEventType;
  payload?: unknown;
}

// payload di ogni evento inbound
export interface AuthPayload      { token: string }
export interface TypingPayload    { conversation_id: string }

// payload chiamate (tipi plain — il server fa solo relay, non interpreta WebRTC)
export interface CallOfferPayload       { to_user_id: string; sdp: Record<string, unknown>; call_type: "audio" | "video"; from_display_name: string }
export interface CallAnswerPayload      { to_user_id: string; sdp: Record<string, unknown> }
export interface CallIceCandidatePayload{ to_user_id: string; candidate: Record<string, unknown> }
export interface CallRejectPayload      { to_user_id: string; reason?: string }
export interface CallEndPayload         { to_user_id: string }

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
  | "message.deleted"   // un messaggio è stato eliminato per tutti
  | "message.destroyed"  // un messaggio è stato distrutto definitivamente (Secure Destroy)
  | "conversation.disappearing_updated" // impostazioni messaggi a scomparsa aggiornate (Sprint 15)
  | "phoenix:lock"      // Emergency Lock Mode — il client deve revocare le chiavi locali e fare logout
  | "phoenix:destroy"   // Phoenix Protocol — il client deve distruggere tutto e fare logout
  // WebRTC signaling — Sprint 23
  | "call.incoming"     // Server → Callee: chiamata in arrivo
  | "call.answered"     // Server → Caller: callee ha risposto
  | "call.ice_candidate"// Server → Client: candidato ICE
  | "call.rejected"     // Server → Caller: callee ha rifiutato
  | "call.ended"        // Server → Client: chiamata terminata
  | "call.busy"            // Server → Caller: callee già in chiamata
  | "call.ended_elsewhere" // Server → Callee altri device: chiamata risposta altrove
  | "call.missed"          // Server → Callee: chiamata persa (caller ha annullato)
  | "conversation.cleared"; // Server → membri: tutti i messaggi eliminati (Sprint 24)

export interface WsOutboundEvent {
  type: WsOutboundEventType;
  payload?: unknown;
}

export interface ReadReceiptPayload {
  conversation_id: string;
  user_id: string;       // chi ha letto
  read_at: string;       // ISO timestamp
}
