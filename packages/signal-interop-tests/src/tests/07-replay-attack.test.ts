/**
 * Test 07 — Replay Attack: un messaggio intercettato non può essere riutilizzato
 *
 * Il Double Ratchet usa message keys monouso. Una volta che Alice decifra
 * un messaggio, il message key viene scartato. Qualsiasi tentativo di
 * decifrare lo stesso ciphertext una seconda volta deve fallire.
 *
 * Questo protegge da:
 * - Attaccante che intercetta e ritrasmette ciphertext
 * - Errore applicativo che processa lo stesso messaggio due volte
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

describe("07 — Replay Attack", () => {
  it("WhisperMessage (tipo 1): replay rifiutato dopo il primo decrypt", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    // Setup
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // Alice cifra un messaggio
    const ct = await encryptMessage(alice, "bob", 1, "Messaggio originale");
    expect(ct.type).toBe(1);

    // Prima decifrazione: successo
    const pt = await decryptMessage(bob, "alice", 1, ct);
    expect(pt).toBe("Messaggio originale");

    // Secondo tentativo con lo stesso ciphertext: deve fallire
    await expect(
      decryptMessage(bob, "alice", 1, ct)
    ).rejects.toThrow();
  });

  it("PreKeyWhisperMessage (tipo 3): replay rifiutato", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    // Primo messaggio (PreKeyWhisperMessage)
    const ct = await encryptMessage(bob, "alice", 1, "Primo PreKey messaggio");
    expect(ct.type).toBe(3);

    // Prima decifrazione: stabilisce la sessione
    const pt = await decryptMessage(alice, "bob", 1, ct);
    expect(pt).toBe("Primo PreKey messaggio");

    // Replay dello stesso PreKeyWhisperMessage: deve fallire
    await expect(
      decryptMessage(alice, "bob", 1, ct)
    ).rejects.toThrow();
  });

  it("Replay del messaggio N non funziona dopo aver ricevuto N+1", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // Alice manda msg1 e msg2
    const ct1 = await encryptMessage(alice, "bob", 1, "msg1");
    const ct2 = await encryptMessage(alice, "bob", 1, "msg2");

    // Bob riceve entrambi in ordine
    await decryptMessage(bob, "alice", 1, ct1);
    await decryptMessage(bob, "alice", 1, ct2);

    // Replay di msg1 (il ratchet è già avanzato oltre)
    await expect(
      decryptMessage(bob, "alice", 1, ct1)
    ).rejects.toThrow();
  });

  it("Replay su terza parte (Eve non può decifrare messaggio di Alice→Bob)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    const eve = await createPersona("eve", 1); // nessuna sessione con Alice

    await buildSession(bob, alice, true);

    // Setup
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // Alice → Bob
    const ct = await encryptMessage(alice, "bob", 1, "Segreto");

    // Eve tenta di decifrare come se fosse Bob → deve fallire
    // (Eve non ha la sessione né le chiavi DH di Bob)
    await expect(
      decryptMessage(eve, "alice", 1, ct)
    ).rejects.toThrow();
  });
});
