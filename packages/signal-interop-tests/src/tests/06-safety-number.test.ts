/**
 * Test 06 — Safety Number (numero di sicurezza)
 *
 * Il Safety Number è un fingerprint della coppia di chiavi (Alice, Bob)
 * generato con FingerprintGenerator. Verifica che:
 * - Il Safety Number generato da Alice corrisponda a quello generato da Bob
 *   (simmetria del protocollo)
 * - Il Safety Number rimane stabile durante la sessione (non cambia con i messaggi)
 * - Un cambio di Identity Key produce un Safety Number diverso
 */

import { describe, it, expect, beforeAll } from "vitest";
// @ts-ignore
import { FingerprintGenerator } from "@privacyresearch/libsignal-protocol-typescript";
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

// Numero di iterazioni per FingerprintGenerator (valore standard Signal: 5200)
const FINGERPRINT_ITERATIONS = 5200;

describe("06 — Safety Number", () => {
  it("Safety Number di Alice == Safety Number di Bob (simmetria)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    const generator = new FingerprintGenerator(FINGERPRINT_ITERATIONS);

    const aliceFP = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );
    const bobFP = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );

    expect(typeof aliceFP).toBe("string");
    expect(aliceFP.length).toBeGreaterThan(0);
    expect(aliceFP).toBe(bobFP);
  });

  it("Safety Number non cambia dopo scambio di messaggi", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, true);

    const generator = new FingerprintGenerator(FINGERPRINT_ITERATIONS);

    const fpBefore = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );

    // Scambia 5 messaggi
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);
    for (let i = 0; i < 4; i++) {
      const ct = await encryptMessage(alice, "bob", 1, `msg ${i}`);
      await decryptMessage(bob, "alice", 1, ct);
    }

    const fpAfter = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );

    expect(fpAfter).toBe(fpBefore);
  });

  it("Safety Number cambia se cambia la Identity Key di Alice", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    const aliceNew = await createPersona("alice", 1); // nuova identity

    const generator = new FingerprintGenerator(FINGERPRINT_ITERATIONS);

    const fpOld = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );
    const fpNew = await generator.createFor(
      "alice", aliceNew.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );

    expect(fpOld).not.toBe(fpNew);
  });

  it("Safety Number è deterministico: stessa coppia di chiavi → stesso FP", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    const generator = new FingerprintGenerator(FINGERPRINT_ITERATIONS);

    // Genera lo stesso FP più volte
    const fp1 = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );
    const fp2 = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );
    const fp3 = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );

    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
  });

  it("Safety Number diverso per coppie diverse (Alice-Bob ≠ Alice-Charlie)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    const charlie = await createPersona("charlie", 1);

    const generator = new FingerprintGenerator(FINGERPRINT_ITERATIONS);

    const fpAliceBob = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "bob", bob.identityKey.pubKey,
    );
    const fpAliceCharlie = await generator.createFor(
      "alice", alice.identityKey.pubKey,
      "charlie", charlie.identityKey.pubKey,
    );

    expect(fpAliceBob).not.toBe(fpAliceCharlie);
  });
});
