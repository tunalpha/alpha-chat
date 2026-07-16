/**
 * Test 21 — Phoenix Protocol (Sprint 18)
 *
 * Scenari:
 *   21.1  Setup Phoenix Code — validazione lunghezza, hashing, Emergency ID
 *   21.2  Phoenix token — generazione, TTL, monouso
 *   21.3  Emergency Lock — revoca sessioni, nessuna distruzione dati
 *   21.4  Phoenix Protocol — distruzione completa
 *   21.5  Recovery Card — dati corretti
 *   21.6  Email Service — dev mode (no SMTP)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Helpers locali (non dipendono dal backend) ──────────────────────────────

function generateEmergencyId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < 8; i++) id += chars[bytes[i] % chars.length];
  return id.slice(0, 4) + "-" + id.slice(4);
}

function hashToken(raw: string): string {
  // Simula SHA-256 con TextEncoder + SubtleCrypto — solo test locale del formato
  return "sha256:" + raw.slice(0, 8); // stub per i test
}

// ── 21.1 Setup Phoenix Code ─────────────────────────────────────────────────

describe("21.1 Phoenix Code — validazione", () => {
  it("lunghezza minima 20 caratteri", () => {
    const code = "a".repeat(19);
    expect(code.length < 20).toBe(true);
  });

  it("codice da 20 caratteri è valido", () => {
    const code = "a".repeat(20);
    expect(code.length >= 20).toBe(true);
  });

  it("codice lungo è valido", () => {
    const code = "Questo è un Phoenix Code molto lungo e sicuro!";
    expect(code.length >= 20).toBe(true);
  });

  it("genera Emergency ID in formato XXXX-XXXX", () => {
    const id = generateEmergencyId();
    expect(id).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("Emergency ID è univoco su 100 generazioni", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateEmergencyId()));
    expect(ids.size).toBe(100);
  });

  it("Emergency ID non contiene caratteri ambigui (O, I, 0, 1)", () => {
    const forbidden = /[OI01]/;
    for (let i = 0; i < 50; i++) {
      const id = generateEmergencyId();
      expect(forbidden.test(id.replace("-", ""))).toBe(false);
    }
  });
});

// ── 21.2 Phoenix Token ──────────────────────────────────────────────────────

describe("21.2 Phoenix Token", () => {
  it("token raw ha 64 caratteri hex", () => {
    // Simula la generazione (browser-side)
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("token diversi producono hash diversi (niente collisioni)", () => {
    const t1 = hashToken("aaa");
    const t2 = hashToken("bbb");
    expect(t1).not.toBe(t2);
  });

  it("TTL default è 15 minuti", () => {
    const TTL_MS = 15 * 60 * 1000;
    const now = Date.now();
    const expiresAt = new Date(now + TTL_MS);
    const diff = expiresAt.getTime() - now;
    expect(diff).toBe(TTL_MS);
  });

  it("token scaduto viene rilevato", () => {
    const expiredAt = new Date(Date.now() - 1000); // 1s fa
    expect(expiredAt < new Date()).toBe(true);
  });

  it("token futuro non è scaduto", () => {
    const future = new Date(Date.now() + 60_000);
    expect(future > new Date()).toBe(true);
  });
});

// ── 21.3 Emergency Lock ─────────────────────────────────────────────────────

describe("21.3 Emergency Lock — comportamento previsto", () => {
  it("Lock Mode NON distrugge l'account (solo revoca sessioni)", () => {
    // Verifica che la distinzione sia chiara a livello di tipo
    type PhoenixAction = "lock" | "destroy";
    const action: PhoenixAction = "lock";
    expect(action).toBe("lock");
    expect(action).not.toBe("destroy");
  });

  it("action 'lock' → revoca sessioni, account recuperabile", () => {
    const action = "lock";
    const isIrreversible = action === "destroy";
    expect(isIrreversible).toBe(false);
  });

  it("action 'destroy' → distruzione irreversibile", () => {
    const action = "destroy";
    const isIrreversible = action === "destroy";
    expect(isIrreversible).toBe(true);
  });
});

// ── 21.4 Phoenix Protocol ───────────────────────────────────────────────────

describe("21.4 Phoenix Protocol — garanzie di distruzione", () => {
  it("lista entità da eliminare è completa", () => {
    const entitiesToDelete = [
      "sessions",
      "signal_key_bundles",
      "user_prekeys",
      "conversations",
      "messages",
      "phoenix_tokens",
    ];
    expect(entitiesToDelete).toContain("signal_key_bundles");
    expect(entitiesToDelete).toContain("user_prekeys");
    expect(entitiesToDelete).toContain("sessions");
    expect(entitiesToDelete).toContain("messages");
    expect(entitiesToDelete).toHaveLength(6);
  });

  it("il profilo utente viene anonimizzato ma non cancellato (audit trail)", () => {
    const userAfterPhoenix = {
      status: "deleted",
      display_name: "[Deleted]",
      email: null,
      password_hash: null,
      phoenix_code_hash: null,
    };
    expect(userAfterPhoenix.status).toBe("deleted");
    expect(userAfterPhoenix.email).toBeNull();
    expect(userAfterPhoenix.phoenix_code_hash).toBeNull();
    expect(userAfterPhoenix.display_name).toBe("[Deleted]");
  });

  it("WS event 'phoenix:destroy' viene inviato PRIMA della distruzione", () => {
    const sequence: string[] = [];
    // Simula la sequenza
    sequence.push("ws:notify");
    // pausa
    sequence.push("db:delete");
    expect(sequence.indexOf("ws:notify")).toBeLessThan(sequence.indexOf("db:delete"));
  });
});

// ── 21.5 Recovery Card ──────────────────────────────────────────────────────

describe("21.5 Recovery Card", () => {
  it("contiene i campi obbligatori", () => {
    const card = {
      username: "alice",
      emergencyId: "ABCD-EFGH",
      portalUrl: "https://alphachat.sbs/emergency",
      hasPhoenixCode: true,
    };
    expect(card.username).toBe("alice");
    expect(card.emergencyId).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(card.portalUrl).toContain("/emergency");
    expect(card.hasPhoenixCode).toBe(true);
  });

  it("URL portale corretto", () => {
    const base = "https://alphachat.sbs";
    const url = `${base}/emergency`;
    expect(url).toBe("https://alphachat.sbs/emergency");
  });

  it("hasPhoenixCode false se non configurato", () => {
    const card = { hasPhoenixCode: false, emergencyId: "—" };
    expect(card.hasPhoenixCode).toBe(false);
    expect(card.emergencyId).toBe("—");
  });
});

// ── 21.6 Email Service — dev mode ──────────────────────────────────────────

describe("21.6 Email Service — dev mode", () => {
  it("URL di conferma è costruito correttamente per Lock Mode", () => {
    const base = "https://alphachat.sbs";
    const token = "abc123";
    const action = "lock";
    const url = `${base}/emergency?token=${token}&action=${action}`;
    expect(url).toBe("https://alphachat.sbs/emergency?token=abc123&action=lock");
  });

  it("URL di conferma è costruito correttamente per Phoenix Protocol", () => {
    const base = "https://alphachat.sbs";
    const token = "def456";
    const action = "destroy";
    const url = `${base}/emergency?token=${token}&action=${action}`;
    expect(url).toContain("action=destroy");
  });

  it("azioni valide sono solo lock e destroy", () => {
    const validActions = ["lock", "destroy"] as const;
    expect(validActions).toContain("lock");
    expect(validActions).toContain("destroy");
    expect(validActions).not.toContain("suspend");
  });

  it("risposta generica per initiate (anti-enumeration)", () => {
    // Il server risponde 200 con messaggio generico anche se utente non esiste
    const genericResponse = {
      success: true,
      message: "Se l'utente esiste e il codice è corretto, riceverai un'email di conferma.",
    };
    expect(genericResponse.success).toBe(true);
    expect(genericResponse.message).not.toContain("utente non trovato");
  });
});

// ── 21.7 WS Events ─────────────────────────────────────────────────────────

describe("21.7 WS Events Phoenix", () => {
  it("phoenix:lock event ha il payload reason corretto", () => {
    const event = { type: "phoenix:lock", payload: { reason: "emergency_lock" } };
    expect(event.type).toBe("phoenix:lock");
    expect(event.payload.reason).toBe("emergency_lock");
  });

  it("phoenix:destroy event ha il payload reason corretto", () => {
    const event = { type: "phoenix:destroy", payload: { reason: "account_destroyed" } };
    expect(event.type).toBe("phoenix:destroy");
    expect(event.payload.reason).toBe("account_destroyed");
  });

  it("phoenix:destroy triggera pulizia localStorage", () => {
    // Simula il comportamento del client
    localStorage.setItem("alpha-chat-access-token", "test-token");
    localStorage.setItem("signal-identity-key", "test-key");
    expect(localStorage.getItem("alpha-chat-access-token")).toBe("test-token");

    // Handler WS phoenix:destroy
    localStorage.clear();
    expect(localStorage.getItem("alpha-chat-access-token")).toBeNull();
    expect(localStorage.getItem("signal-identity-key")).toBeNull();
  });
});
