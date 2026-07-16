/**
 * Test 02 — X3DH: Bob stabilisce la sessione con Alice
 *
 * Scenario completo X3DH (Extended Triple Diffie-Hellman):
 *   1. Alice pubblica il suo prekey bundle (Identity Key + Signed PreKey + OTPK)
 *   2. Bob processa il bundle di Alice tramite SessionBuilder
 *   3. Bob cifra il primo messaggio → tipo 3 (PreKeyWhisperMessage)
 *   4. Alice riceve e decifra il PreKeyWhisperMessage → stabilisce la sessione
 *   5. Alice e Bob si scambiano messaggi via Double Ratchet → tipo 1 (WhisperMessage)
 *
 * Se uno qualsiasi di questi step fallisce, il test blocca la Fase 2.
 *
 * Nota sul formato body: SessionCipher.encrypt() restituisce body come stringa
 * base64 (tipo runtime = string, conforme alla dichiarazione TS).
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

describe("02 — X3DH: instaurazione sessione Alice ↔ Bob", () => {
  it("Bob processa il bundle di Alice senza errori", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await expect(buildSession(bob, alice, true)).resolves.not.toThrow();
  });

  it("Bob cifra il primo messaggio → tipo 3 (PreKeyWhisperMessage)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct = await encryptMessage(bob, "alice", 1, "Ciao Alice!");
    // Il primo messaggio è sempre PreKeyWhisperMessage (type 3)
    expect(ct.type).toBe(3);
    // body è una stringa base64 (conforme alla dichiarazione TS)
    expect(typeof ct.body).toBe("string");
    expect(ct.body.length).toBeGreaterThan(0);
  });

  it("Alice decifra il PreKeyWhisperMessage di Bob (stabilisce la sessione)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct = await encryptMessage(bob, "alice", 1, "Primo messaggio segreto");
    const plaintext = await decryptMessage(alice, "bob", 1, ct);

    expect(plaintext).toBe("Primo messaggio segreto");
  });

  it("Alice → Bob: Double Ratchet dopo la sessione iniziale", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    // Bob → Alice (stabilisce sessione Alice-side)
    const ct1 = await encryptMessage(bob, "alice", 1, "Ciao da Bob");
    await decryptMessage(alice, "bob", 1, ct1);

    // Alice → Bob (Double Ratchet, tipo 1)
    const ct2 = await encryptMessage(alice, "bob", 1, "Ciao da Alice");
    expect(ct2.type).toBe(1); // WhisperMessage
    const plaintext2 = await decryptMessage(bob, "alice", 1, ct2);
    expect(plaintext2).toBe("Ciao da Alice");
  });

  it("Bob → Alice: risposta dopo Double Ratchet", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    // Stabilisci la sessione
    const ct1 = await encryptMessage(bob, "alice", 1, "Primo");
    await decryptMessage(alice, "bob", 1, ct1);

    // Alice risponde
    const ct2 = await encryptMessage(alice, "bob", 1, "Seconda");
    await decryptMessage(bob, "alice", 1, ct2);

    // Bob risponde di nuovo
    const ct3 = await encryptMessage(bob, "alice", 1, "Terzo");
    expect(ct3.type).toBe(1);
    const plaintext3 = await decryptMessage(alice, "bob", 1, ct3);
    expect(plaintext3).toBe("Terzo");
  });

  it("Sessione full-duplex: 10 messaggi alternati senza errori", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    // Setup iniziale (PreKeyWhisperMessage)
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    const messages = [
      { sender: alice, receiver: bob, senderName: "alice", receiverName: "bob", text: "Alice 1" },
      { sender: bob, receiver: alice, senderName: "bob", receiverName: "alice", text: "Bob 1" },
      { sender: alice, receiver: bob, senderName: "alice", receiverName: "bob", text: "Alice 2" },
      { sender: bob, receiver: alice, senderName: "bob", receiverName: "alice", text: "Bob 2" },
      { sender: alice, receiver: bob, senderName: "alice", receiverName: "bob", text: "Alice 3" },
      { sender: bob, receiver: alice, senderName: "bob", receiverName: "alice", text: "Bob 3" },
      { sender: alice, receiver: bob, senderName: "alice", receiverName: "bob", text: "Alice 4" },
      { sender: bob, receiver: alice, senderName: "bob", receiverName: "alice", text: "Bob 4" },
      { sender: alice, receiver: bob, senderName: "alice", receiverName: "bob", text: "Alice 5" },
      { sender: bob, receiver: alice, senderName: "bob", receiverName: "alice", text: "Bob 5" },
    ];

    for (const msg of messages) {
      const ct = await encryptMessage(msg.sender, msg.receiverName, 1, msg.text);
      const pt = await decryptMessage(msg.receiver, msg.senderName, 1, ct);
      expect(pt).toBe(msg.text);
    }
  });

  it("Il ciphertext cambia ogni volta anche per lo stesso testo (forward secrecy)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    // Setup
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // Alice manda lo stesso messaggio due volte
    const ct1 = await encryptMessage(alice, "bob", 1, "testo identico");
    await decryptMessage(bob, "alice", 1, ct1);

    const ct2 = await encryptMessage(alice, "bob", 1, "testo identico");
    await decryptMessage(bob, "alice", 1, ct2);

    // I ciphertext (stringhe base64) devono essere diversi (Double Ratchet avanza)
    expect(ct1.body).not.toBe(ct2.body);
  });

  it("Messaggio con contenuto binario (emoji, caratteri Unicode)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    const unicodeMsg = "🔐 Messaggio privato — αβγδ — 你好世界 — ñoño";
    const ct = await encryptMessage(alice, "bob", 1, unicodeMsg);
    const pt = await decryptMessage(bob, "alice", 1, ct);
    expect(pt).toBe(unicodeMsg);
  });

  it("Messaggio vuoto cifrato e decifrato correttamente", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    const ct = await encryptMessage(alice, "bob", 1, "");
    const pt = await decryptMessage(bob, "alice", 1, ct);
    expect(pt).toBe("");
  });
});
