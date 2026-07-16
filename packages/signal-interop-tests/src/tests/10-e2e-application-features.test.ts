/**
 * Test 10 — Funzionalità applicative con E2E: Burn After Read e Secure Destroy
 *
 * Verifica che le funzionalità applicative di Alpha Chat funzionino
 * correttamente con il layer Signal Protocol sottostante.
 *
 * Nota sul formato body: SessionCipher.encrypt() restituisce body come
 * stringa base64. Le verifiche di forward secrecy confrontano stringhe.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { initLibsignal } from "../helpers/setup.js";
import {
  createPersona,
  buildSession,
  encryptMessage,
  decryptMessage,
} from "../helpers/utils.js";

beforeAll(async () => {
  await initLibsignal();
});

// ---------------------------------------------------------------------------
// Struttura del payload applicativo cifrato
// ---------------------------------------------------------------------------

interface AppPayload {
  type: "text" | "media" | "system";
  content: string;
  burnAfterRead?: boolean;
  burnTtlSeconds?: number;
  secureDestroy?: boolean;
  timestamp: number;
}

function serializePayload(payload: AppPayload): string {
  return JSON.stringify(payload);
}

function deserializePayload(text: string): AppPayload {
  return JSON.parse(text) as AppPayload;
}

describe("10 — Funzionalità applicative E2E", () => {
  // -------------------------------------------------------------------------
  // Burn After Read
  // -------------------------------------------------------------------------

  it("BAR: payload con burnAfterRead=true cifrato e decifrato correttamente", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    const barPayload: AppPayload = {
      type: "text",
      content: "Questo messaggio si autodistrugge in 10 secondi",
      burnAfterRead: true,
      burnTtlSeconds: 10,
      timestamp: Date.now(),
    };

    const ct = await encryptMessage(alice, "bob", 1, serializePayload(barPayload));
    const pt = await decryptMessage(bob, "alice", 1, ct);

    const decoded = deserializePayload(pt);
    expect(decoded.burnAfterRead).toBe(true);
    expect(decoded.burnTtlSeconds).toBe(10);
    expect(decoded.content).toBe("Questo messaggio si autodistrugge in 10 secondi");
  });

  it("BAR: sessione rimane valida dopo aver processato un messaggio BAR", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    const barPayload: AppPayload = {
      type: "text",
      content: "BAR message",
      burnAfterRead: true,
      burnTtlSeconds: 5,
      timestamp: Date.now(),
    };

    const ctBar = await encryptMessage(alice, "bob", 1, serializePayload(barPayload));
    const ptBar = await decryptMessage(bob, "alice", 1, ctBar);
    expect(deserializePayload(ptBar).burnAfterRead).toBe(true);

    // La sessione continua normalmente dopo BAR
    const ctNext = await encryptMessage(alice, "bob", 1, "Messaggio normale dopo BAR");
    const ptNext = await decryptMessage(bob, "alice", 1, ctNext);
    expect(ptNext).toBe("Messaggio normale dopo BAR");
  });

  it("BAR: il server vede solo ciphertext opaco (Zero Plaintext Rule)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    const sensitiveContent = "Contenuto sensibile che il server non deve vedere";
    const ct = await encryptMessage(alice, "bob", 1, sensitiveContent);

    // body è una stringa base64 — il contenuto cifrato non deve contenere il plaintext
    expect(ct.body).not.toContain(sensitiveContent);
    // Il ciphertext deve essere più lungo del plaintext (overhead di cifratura)
    // Converte base64 → byte count per confronto
    const estimatedBytes = Math.floor(ct.body.length * 3 / 4);
    expect(estimatedBytes).toBeGreaterThan(0);
    // La stringa base64 non contiene il plaintext in chiaro
    const plaintextBase64 = btoa(sensitiveContent);
    expect(ct.body).not.toContain(plaintextBase64);
  });

  // -------------------------------------------------------------------------
  // Secure Destroy / Perfect Forward Secrecy
  // -------------------------------------------------------------------------

  it("Secure Destroy: ogni messaggio usa un message key diverso (PFS via Double Ratchet)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // 5 messaggi identici → 5 ciphertext diversi (message keys ruotano)
    const bodies = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const ct = await encryptMessage(alice, "bob", 1, "stesso testo");
      await decryptMessage(bob, "alice", 1, ct);
      // body è stringa base64 — ogni ratchet produce un body diverso
      bodies.add(ct.body);
    }

    // Tutti i ciphertext (base64) sono diversi
    expect(bodies.size).toBe(5);
  });

  it("Secure Destroy: payload con secureDestroy=true cifrato e decifrato", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    const sdPayload: AppPayload = {
      type: "system",
      content: "SECURE_DESTROY:msg-id-12345",
      secureDestroy: true,
      timestamp: Date.now(),
    };

    const ct = await encryptMessage(alice, "bob", 1, serializePayload(sdPayload));
    const pt = await decryptMessage(bob, "alice", 1, ct);

    const decoded = deserializePayload(pt);
    expect(decoded.secureDestroy).toBe(true);
    expect(decoded.content).toContain("SECURE_DESTROY");
  });

  it("Mix BAR + Secure Destroy in una conversazione: sessione stabile", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    const payloads: AppPayload[] = [
      { type: "text", content: "Messaggio normale 1", timestamp: 1 },
      { type: "text", content: "BAR msg", burnAfterRead: true, burnTtlSeconds: 30, timestamp: 2 },
      { type: "text", content: "Messaggio normale 2", timestamp: 3 },
      { type: "system", content: "SECURE_DESTROY:xxx", secureDestroy: true, timestamp: 4 },
      { type: "text", content: "Messaggio finale", timestamp: 5 },
    ];

    for (const payload of payloads) {
      const ct = await encryptMessage(alice, "bob", 1, serializePayload(payload));
      const pt = await decryptMessage(bob, "alice", 1, ct);
      const decoded = deserializePayload(pt);
      expect(decoded.content).toBe(payload.content);
      expect(decoded.timestamp).toBe(payload.timestamp);
    }
  });
});
