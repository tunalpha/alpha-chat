/**
 * PushEvents — definizione dei tipi di eventi Push.
 *
 * Architettura Event-Driven: il MessageService e il ws-server emettono questi
 * eventi. Il PushDispatcher li elabora in modo completamente asincrono.
 *
 * SICUREZZA: nessun evento contiene:
 *   - Identity Keys / Session Keys / Private Keys
 *   - JWT o token di sessione
 *   - Payload Signal cifrati
 *   - Testo in chiaro dei messaggi
 */

export interface MessageNewEvent {
  type: "message.new";
  recipientUserIds: string[];  // esclude sempre il mittente
  senderId: string;
  senderName: string;          // display_name del mittente — non il contenuto
  conversationId: string;
  conversationName: string | null;  // solo per gruppi
  isGroup: boolean;
}

export interface CallIncomingEvent {
  type: "call.incoming";
  recipientUserId: string;
  callerId: string;
  callerName: string;
  callType: "audio" | "video";
}

export interface CallMissedEvent {
  type: "call.missed";
  recipientUserId: string;
  callerId: string;
  callerName: string;
}

export interface SwapCompletedEvent {
  type: "swap.completed";
  recipientUserId: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
}

/** Evento terminale Li.FI emesso solo dal reconciler server-authoritative. */
export interface SwapLifecycleEvent {
  type: "swap.lifecycle";
  recipientUserId: string;
  swapId: string;
  lifecycle: "completed" | "failed" | "refunded" | "expired";
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
}

export type PushEvent =
  | MessageNewEvent
  | CallIncomingEvent
  | CallMissedEvent
  | SwapCompletedEvent
  | SwapLifecycleEvent;
