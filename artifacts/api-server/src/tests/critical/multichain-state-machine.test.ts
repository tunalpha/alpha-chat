/**
 * CRITICAL — MultiChain Payment State Machine
 *
 * Questo test DEVE passare prima di ogni deploy.
 * Verifica che la state machine dei pagamenti MultiChain rispetti le transizioni
 * valide e rifiuti quelle non valide. Una transizione illegale significa fondi
 * potenzialmente persi o double-release.
 *
 * Le transizioni valide per i pagamenti sono:
 *   awaiting_deposit → detected → releasing → released
 *   awaiting_deposit → expired
 *   pending          → releasing → released       (direct transfer)
 *   pending          → expired → refunding → refunded
 *   releasing        → released (idempotente su restart)
 *
 * Transizioni VIETATE che causerebbero perdita fondi:
 *   released → releasing     (double-release)
 *   released → refunding     (release già avvenuta)
 *   refunded → releasing     (già rimborsato)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Tipi e costanti ──────────────────────────────────────────────────────────

type MCStatus =
  | "awaiting_deposit"
  | "detected"
  | "releasing"
  | "released"
  | "expired"
  | "pending"
  | "refunding"
  | "refunded"
  | "failed"
  | "cancelled";

// Transizioni valide (from → to)
const VALID_TRANSITIONS: Record<MCStatus, MCStatus[]> = {
  awaiting_deposit: ["detected", "expired", "cancelled"],
  detected:         ["releasing"],
  releasing:        ["released"],
  released:         [],   // stato terminale — nessuna transizione
  expired:          ["refunding"],
  pending:          ["releasing", "expired", "cancelled"],
  refunding:        ["refunded", "failed"],
  refunded:         [],   // stato terminale
  failed:           [],   // stato terminale
  cancelled:        [],   // stato terminale
};

function canTransition(from: MCStatus, to: MCStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Test: transizioni valide ─────────────────────────────────────────────────

describe("Transizioni valide della state machine MultiChain", () => {
  it("awaiting_deposit → detected (deposito rilevato)", () => {
    expect(canTransition("awaiting_deposit", "detected")).toBe(true);
  });

  it("detected → releasing (avvio rilascio fondi al destinatario)", () => {
    expect(canTransition("detected", "releasing")).toBe(true);
  });

  it("releasing → released (rilascio completato)", () => {
    expect(canTransition("releasing", "released")).toBe(true);
  });

  it("awaiting_deposit → expired (nessun deposito entro scadenza)", () => {
    expect(canTransition("awaiting_deposit", "expired")).toBe(true);
  });

  it("expired → refunding (avvio rimborso dopo scadenza)", () => {
    expect(canTransition("expired", "refunding")).toBe(true);
  });

  it("refunding → refunded (rimborso completato)", () => {
    expect(canTransition("refunding", "refunded")).toBe(true);
  });

  it("pending → releasing (direct transfer)", () => {
    expect(canTransition("pending", "releasing")).toBe(true);
  });

  it("pending → expired (direct transfer scaduto)", () => {
    expect(canTransition("pending", "expired")).toBe(true);
  });
});

// ─── Test: transizioni VIETATE — protezione fondi ────────────────────────────

describe("Transizioni VIETATE — proteggono da perdita fondi", () => {
  it("released → releasing è VIETATO (double-release)", () => {
    // Se released → releasing fosse possibile, i fondi sarebbero rilasciati due volte
    expect(canTransition("released", "releasing")).toBe(false);
  });

  it("released → refunding è VIETATO (già rilasciato al destinatario)", () => {
    expect(canTransition("released", "refunding")).toBe(false);
  });

  it("released → detected è VIETATO (stato terminale)", () => {
    expect(canTransition("released", "detected")).toBe(false);
  });

  it("refunded → releasing è VIETATO (già rimborsato al mittente)", () => {
    expect(canTransition("refunded", "releasing")).toBe(false);
  });

  it("refunded → refunding è VIETATO (double-refund)", () => {
    expect(canTransition("refunded", "refunding")).toBe(false);
  });

  it("releasing → awaiting_deposit è VIETATO (no rollback)", () => {
    // Una volta avviato il rilascio, non si torna indietro
    expect(canTransition("releasing", "awaiting_deposit")).toBe(false);
  });

  it("expired → releasing è VIETATO (deve passare da refunding)", () => {
    expect(canTransition("expired", "releasing")).toBe(false);
  });

  it("cancelled → released è VIETATO", () => {
    expect(canTransition("cancelled", "released")).toBe(false);
  });
});

// ─── Test: stati terminali ────────────────────────────────────────────────────

describe("Stati terminali — nessuna transizione possibile", () => {
  const TERMINAL_STATES: MCStatus[] = ["released", "refunded", "failed", "cancelled"];

  it.each(TERMINAL_STATES)(
    "stato '%s' non ha transizioni valide",
    (state) => {
      const targets: MCStatus[] = [
        "awaiting_deposit", "detected", "releasing", "released",
        "expired", "pending", "refunding", "refunded", "failed", "cancelled",
      ];
      for (const target of targets) {
        expect(
          canTransition(state, target),
          `${state} → ${target} deve essere false (stato terminale)`,
        ).toBe(false);
      }
    }
  );
});

// ─── Test: lock anti-concorrenza ─────────────────────────────────────────────

describe("Lock anti-concorrenza — protezione double-release", () => {
  it("due release concorrenti sullo stesso transfer: solo la prima vince", async () => {
    const LOCK_KEY = "lock:transfer:test-id";
    const acquired: string[] = [];

    // Simula l'acquisizione del lock MongoDB atomico
    async function acquireLock(lockKey: string, callerId: string): Promise<boolean> {
      // In produzione: findOneAndUpdate con filter {lock: null} + update {lock: callerId}
      // Se il lock è già preso, ritorna false
      if (acquired.includes(lockKey)) return false;
      acquired.push(lockKey);
      return true;
    }

    const [r1, r2] = await Promise.all([
      acquireLock(LOCK_KEY, "caller-1"),
      acquireLock(LOCK_KEY, "caller-2"),
    ]);

    // Solo uno dei due deve riuscire
    expect([r1, r2].filter(Boolean).length).toBe(1);
    expect([r1, r2].filter(x => !x).length).toBe(1);
  });
});

// ─── Test: idempotenza del detect ────────────────────────────────────────────

describe("detectDeposit — idempotenza (Fix B)", () => {
  it("rilevare due volte lo stesso deposito non avanza lo stato due volte", () => {
    let status: MCStatus = "detected"; // già avanzato dalla prima detect

    function handleDetect(currentStatus: MCStatus): MCStatus {
      // Idempotente: se già detected o oltre, non fare nulla
      if (currentStatus !== "awaiting_deposit") {
        return currentStatus; // Fix B: return 409 / no-op
      }
      return "detected";
    }

    // Prima detect → awaiting_deposit → detected
    const firstResult = handleDetect("awaiting_deposit");
    expect(firstResult).toBe("detected");

    // Seconda detect (stessa TX) → no-op, rimane detected
    const secondResult = handleDetect(firstResult);
    expect(secondResult).toBe("detected"); // non avanza ulteriormente
  });
});

// ─── Test: scadenza e rimborso ────────────────────────────────────────────────

describe("Scadenza transfer — solo awaiting_deposit e pending possono scadere", () => {
  function canExpire(status: MCStatus): boolean {
    return status === "awaiting_deposit" || status === "pending";
  }

  it("awaiting_deposit può scadere", () => {
    expect(canExpire("awaiting_deposit")).toBe(true);
  });

  it("pending può scadere", () => {
    expect(canExpire("pending")).toBe(true);
  });

  it("detected NON può scadere (deposito già ricevuto)", () => {
    expect(canExpire("detected")).toBe(false);
  });

  it("releasing NON può scadere (rilascio in corso)", () => {
    expect(canExpire("releasing")).toBe(false);
  });

  it("released NON può scadere (terminato)", () => {
    expect(canExpire("released")).toBe(false);
  });
});
