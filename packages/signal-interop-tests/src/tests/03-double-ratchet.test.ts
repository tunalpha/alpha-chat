/**
 * Test 03 — Double Ratchet: proprietà avanzate
 *
 * Verifica che il Double Ratchet implementi correttamente:
 * - Forward Secrecy (ogni messaggio usa un chain key diverso)
 * - Burst di messaggi dallo stesso lato
 * - Messaggi lunghi
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

/** Setup helper: stabilisce la sessione e fa il primo scambio */
async function setupSession() {
  const alice = await createPersona("alice", 1, 5);
  const bob = await createPersona("bob", 1, 5);
  await buildSession(bob, alice, true);
  const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
  await decryptMessage(alice, "bob", 1, ct0);
  return { alice, bob };
}

describe("03 — Double Ratchet: proprietà avanzate", () => {
  it("Burst: Alice manda 5 messaggi consecutivi senza risposta di Bob", async () => {
    const { alice, bob } = await setupSession();

    const messages = ["msg1", "msg2", "msg3", "msg4", "msg5"];
    const ciphertexts = [];
    for (const msg of messages) {
      ciphertexts.push(await encryptMessage(alice, "bob", 1, msg));
    }

    // Bob decifra tutti in ordine
    for (let i = 0; i < ciphertexts.length; i++) {
      const pt = await decryptMessage(bob, "alice", 1, ciphertexts[i]!);
      expect(pt).toBe(messages[i]);
    }
  });

  it("Burst inverso: Bob manda 5 messaggi consecutivi senza risposta di Alice", async () => {
    const { alice, bob } = await setupSession();

    const messages = ["b1", "b2", "b3", "b4", "b5"];
    const ciphertexts = [];
    for (const msg of messages) {
      ciphertexts.push(await encryptMessage(bob, "alice", 1, msg));
    }

    for (let i = 0; i < ciphertexts.length; i++) {
      const pt = await decryptMessage(alice, "bob", 1, ciphertexts[i]!);
      expect(pt).toBe(messages[i]);
    }
  });

  it("Alternanza 20 messaggi: Alice e Bob si scambiano in sequenza", async () => {
    const { alice, bob } = await setupSession();

    for (let i = 0; i < 10; i++) {
      const aMsg = `Alice turn ${i}`;
      const bMsg = `Bob turn ${i}`;
      const ctA = await encryptMessage(alice, "bob", 1, aMsg);
      const ptA = await decryptMessage(bob, "alice", 1, ctA);
      expect(ptA).toBe(aMsg);

      const ctB = await encryptMessage(bob, "alice", 1, bMsg);
      const ptB = await decryptMessage(alice, "bob", 1, ctB);
      expect(ptB).toBe(bMsg);
    }
  });

  it("Forward secrecy: 10 ciphertext diversi per lo stesso plaintext", async () => {
    const { alice, bob } = await setupSession();
    const text = "testo sempre uguale";

    const bodies = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const ct = await encryptMessage(alice, "bob", 1, text);
      await decryptMessage(bob, "alice", 1, ct);
      // body è una stringa base64 — ogni ratchet produce un body diverso
      bodies.add(ct.body);
    }

    // Tutti i ciphertext (base64) sono diversi
    expect(bodies.size).toBe(10);
  });

  it("Messaggio lungo (10KB) cifrato e decifrato correttamente", async () => {
    const { alice, bob } = await setupSession();

    // Genera stringa da 10KB
    const longText = "A".repeat(10 * 1024);
    const ct = await encryptMessage(alice, "bob", 1, longText);
    const pt = await decryptMessage(bob, "alice", 1, ct);
    expect(pt).toBe(longText);
  });

  it("Tutti i ciphertext dopo ratchet sono tipo 1 (WhisperMessage)", async () => {
    const { alice, bob } = await setupSession();

    for (let i = 0; i < 5; i++) {
      const ct = await encryptMessage(alice, "bob", 1, `msg ${i}`);
      expect(ct.type).toBe(1); // WhisperMessage, non PreKeyWhisperMessage
      await decryptMessage(bob, "alice", 1, ct);
    }
  });
});
