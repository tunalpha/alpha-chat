/**
 * state-machine.ts — State machine del Chat Payment Engine (Sprint 1)
 *
 * Funzione pura: nessun I/O, nessuna dipendenza esterna.
 * transition(currentStatus, action) → nextStatus | throws
 *
 * Stato    Azione            Prossimo stato
 * ──────────────────────────────────────────────────────────
 * awaiting_deposit + deposit_confirmed → pending
 * pending          + accept            → accepting      (lock)
 * pending          + reject            → rejecting      (lock)
 * pending          + cancel            → cancelling     (lock)
 * pending          + expire            → refunding      (lock — scheduler)
 * accepting        + release_ok        → accepted       ✅
 * rejecting        + refund_ok         → rejected       ↩️
 * cancelling       + refund_ok         → cancelled      🚫
 * refunding        + refund_ok         → expired        ⏰
 * [any lock state] + fail              → failed         ❌
 * awaiting_deposit + fail              → failed         ❌
 * pending          + fail              → failed         ❌
 */

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type ChatTransferStatus =
  | "awaiting_deposit"
  | "pending"
  | "accepting"    // lock state — A ha premuto Accetta
  | "accepted"     // terminale ✅
  | "rejecting"    // lock state — B ha premuto Rifiuta
  | "rejected"     // terminale ↩️
  | "cancelling"   // lock state — A ha annullato
  | "cancelled"    // terminale 🚫
  | "refunding"    // lock state — scheduler timeout
  | "refunded"     // terminale — admin refund (riservato, non usato in v1)
  | "expired"      // terminale ⏰ — timeout scheduler completato
  | "failed";      // terminale ❌

export type TransferAction =
  | "deposit_confirmed"  // deposito on-chain verificato
  | "accept"             // destinatario accetta
  | "reject"             // destinatario rifiuta
  | "cancel"             // mittente annulla (solo da pending)
  | "expire"             // scheduler: timeout 48h
  | "release_ok"         // TX escrow → destinatario completata
  | "refund_ok"          // TX escrow → mittente completata (qualsiasi causa)
  | "fail";              // errore non recuperabile

// ---------------------------------------------------------------------------
// Tabella di transizione
// ---------------------------------------------------------------------------

type TransitionTable = {
  [S in ChatTransferStatus]?: {
    [A in TransferAction]?: ChatTransferStatus;
  };
};

const TRANSITIONS: TransitionTable = {
  awaiting_deposit: {
    deposit_confirmed: "pending",
    fail:              "failed",
  },
  pending: {
    accept: "accepting",
    reject: "rejecting",
    cancel: "cancelling",
    expire: "refunding",
    fail:   "failed",
  },
  accepting: {
    release_ok: "accepted",
    fail:       "failed",
  },
  rejecting: {
    refund_ok: "rejected",
    fail:      "failed",
  },
  cancelling: {
    refund_ok: "cancelled",
    fail:      "failed",
  },
  refunding: {
    refund_ok: "expired",
    fail:      "failed",
  },
  // Terminal states: nessuna transizione valida
  accepted:  {},
  rejected:  {},
  cancelled: {},
  refunded:  {},
  expired:   {},
  failed:    {},
};

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/**
 * Calcola il prossimo stato dato quello corrente e un'azione.
 * Lancia Error se la transizione non è valida.
 */
export function transition(
  current: ChatTransferStatus,
  action: TransferAction,
): ChatTransferStatus {
  const next = TRANSITIONS[current]?.[action];
  if (next === undefined) {
    throw new Error(
      `[ChatPaymentEngine] Transizione non valida: status="${current}" action="${action}"`,
    );
  }
  return next;
}

/**
 * Restituisce true se lo stato è terminale (nessuna ulteriore transizione possibile).
 */
export function isTerminal(status: ChatTransferStatus): boolean {
  return ["accepted", "rejected", "cancelled", "refunded", "expired", "failed"].includes(status);
}

/**
 * Restituisce true se lo stato è un lock state (operazione blockchain in corso).
 * Usato dal recovery job per individuare trasferimenti bloccati.
 */
export function isLockState(status: ChatTransferStatus): boolean {
  return ["accepting", "rejecting", "cancelling", "refunding"].includes(status);
}

/**
 * Restituisce tutte le azioni valide per uno stato dato.
 * Utile per validazione lato controller.
 */
export function validActionsFor(status: ChatTransferStatus): TransferAction[] {
  const table = TRANSITIONS[status] ?? {};
  return Object.keys(table) as TransferAction[];
}
