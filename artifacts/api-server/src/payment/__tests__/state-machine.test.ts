/**
 * state-machine.test.ts — Unit test per il Chat Payment Engine (Sprint 1)
 *
 * Framework: Vitest
 * Coverage: tutte le transizioni valide, tutte le transizioni invalide,
 *           stati terminali, stati di lock, azioni valide per stato.
 */

import { describe, it, expect } from "vitest";
import {
  transition,
  isTerminal,
  isLockState,
  validActionsFor,
  type ChatTransferStatus,
  type TransferAction,
} from "../state-machine";

// ---------------------------------------------------------------------------
// Transizioni valide
// ---------------------------------------------------------------------------

describe("transition — transizioni valide", () => {
  const validCases: [ChatTransferStatus, TransferAction, ChatTransferStatus][] = [
    // Flusso principale: deposito → accettazione
    ["awaiting_deposit", "deposit_confirmed", "pending"],
    ["pending",          "accept",            "accepting"],
    ["accepting",        "release_ok",        "accepted"],

    // Flusso: rifiuto da parte di B
    ["pending",    "reject",     "rejecting"],
    ["rejecting",  "refund_ok",  "rejected"],

    // Flusso: annullamento da parte di A
    ["pending",     "cancel",     "cancelling"],
    ["cancelling",  "refund_ok",  "cancelled"],

    // Flusso: scadenza 48h (scheduler)
    ["pending",    "expire",     "refunding"],
    ["refunding",  "refund_ok",  "expired"],

    // Flusso: errori nelle fasi di lock
    ["awaiting_deposit", "fail", "failed"],
    ["pending",          "fail", "failed"],
    ["accepting",        "fail", "failed"],
    ["rejecting",        "fail", "failed"],
    ["cancelling",       "fail", "failed"],
    ["refunding",        "fail", "failed"],
  ];

  for (const [current, action, expected] of validCases) {
    it(`${current} + ${action} → ${expected}`, () => {
      expect(transition(current, action)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Transizioni invalide
// ---------------------------------------------------------------------------

describe("transition — transizioni invalide lanciano errore", () => {
  const invalidCases: [ChatTransferStatus, TransferAction][] = [
    // Stato terminale non può transitare
    ["accepted",  "accept"],
    ["accepted",  "fail"],
    ["rejected",  "fail"],
    ["cancelled", "fail"],
    ["expired",   "fail"],
    ["failed",    "fail"],
    ["refunded",  "refund_ok"],

    // Azioni non applicabili allo stato
    ["awaiting_deposit", "accept"],
    ["awaiting_deposit", "reject"],
    ["awaiting_deposit", "cancel"],
    ["awaiting_deposit", "expire"],
    ["awaiting_deposit", "release_ok"],
    ["awaiting_deposit", "refund_ok"],

    ["pending", "release_ok"],
    ["pending", "refund_ok"],
    ["pending", "deposit_confirmed"],

    ["accepting", "accept"],
    ["accepting", "reject"],
    ["accepting", "cancel"],
    ["accepting", "expire"],
    ["accepting", "refund_ok"],

    ["rejecting", "release_ok"],
    ["rejecting", "accept"],

    ["cancelling", "release_ok"],
    ["cancelling", "accept"],

    ["refunding", "release_ok"],
    ["refunding", "accept"],
  ];

  for (const [current, action] of invalidCases) {
    it(`${current} + ${action} → Error`, () => {
      expect(() => transition(current, action)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// isTerminal
// ---------------------------------------------------------------------------

describe("isTerminal", () => {
  const terminalStates: ChatTransferStatus[] = [
    "accepted", "rejected", "cancelled", "refunded", "expired", "failed",
  ];
  const nonTerminalStates: ChatTransferStatus[] = [
    "awaiting_deposit", "pending", "accepting", "rejecting", "cancelling", "refunding",
  ];

  for (const status of terminalStates) {
    it(`${status} è terminale`, () => {
      expect(isTerminal(status)).toBe(true);
    });
  }

  for (const status of nonTerminalStates) {
    it(`${status} non è terminale`, () => {
      expect(isTerminal(status)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// isLockState
// ---------------------------------------------------------------------------

describe("isLockState", () => {
  const lockStates: ChatTransferStatus[] = [
    "accepting", "rejecting", "cancelling", "refunding",
  ];
  const nonLockStates: ChatTransferStatus[] = [
    "awaiting_deposit", "pending", "accepted", "rejected", "cancelled", "refunded", "expired", "failed",
  ];

  for (const status of lockStates) {
    it(`${status} è un lock state`, () => {
      expect(isLockState(status)).toBe(true);
    });
  }

  for (const status of nonLockStates) {
    it(`${status} non è un lock state`, () => {
      expect(isLockState(status)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// validActionsFor
// ---------------------------------------------------------------------------

describe("validActionsFor", () => {
  it("awaiting_deposit ha deposit_confirmed e fail", () => {
    const actions = validActionsFor("awaiting_deposit");
    expect(actions).toContain("deposit_confirmed");
    expect(actions).toContain("fail");
    expect(actions).not.toContain("accept");
  });

  it("pending ha accept, reject, cancel, expire, fail", () => {
    const actions = validActionsFor("pending");
    expect(actions).toContain("accept");
    expect(actions).toContain("reject");
    expect(actions).toContain("cancel");
    expect(actions).toContain("expire");
    expect(actions).toContain("fail");
    expect(actions).not.toContain("release_ok");
    expect(actions).not.toContain("refund_ok");
  });

  it("accepted non ha azioni valide", () => {
    expect(validActionsFor("accepted")).toHaveLength(0);
  });

  it("failed non ha azioni valide", () => {
    expect(validActionsFor("failed")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Proprietà di correttezza globale
// ---------------------------------------------------------------------------

describe("proprietà strutturali", () => {
  it("ogni lock state ha almeno una transizione di uscita", () => {
    const lockStates: ChatTransferStatus[] = ["accepting", "rejecting", "cancelling", "refunding"];
    for (const s of lockStates) {
      const actions = validActionsFor(s);
      expect(actions.length).toBeGreaterThan(0);
    }
  });

  it("nessuno stato terminale ha transizioni valide (eccetto refunded che è riservato)", () => {
    const terminalStates: ChatTransferStatus[] = [
      "accepted", "rejected", "cancelled", "expired", "failed",
    ];
    for (const s of terminalStates) {
      expect(validActionsFor(s)).toHaveLength(0);
    }
  });

  it("fail da qualsiasi stato non-terminale produce failed", () => {
    const nonTerminal: ChatTransferStatus[] = [
      "awaiting_deposit", "pending", "accepting", "rejecting", "cancelling", "refunding",
    ];
    for (const s of nonTerminal) {
      expect(transition(s, "fail")).toBe("failed");
    }
  });
});
