/**
 * Test 04 — OTPK esaurite: sessione senza One-Time PreKey
 *
 * La Signal spec prevede che X3DH funzioni anche senza OTPK disponibili,
 * usando solo la Signed PreKey. In questo caso la sessione è leggermente
 * meno sicura (non c'è la forward secrecy one-time) ma rimane funzionale.
 *
 * Scenario: Alice ha esaurito le sue OTPKs. Bob deve comunque poter
 * stabilire una sessione con lei usando solo la Signed PreKey.
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

describe("04 — OTPK esaurite: sessione con solo Signed PreKey", () => {
  it("X3DH senza OTPK: SessionBuilder non lancia errori", async () => {
    const alice = await createPersona("alice", 1, 0); // 0 OTPKs
    const bob = await createPersona("bob", 1);

    // useOtpk=false → DeviceType senza preKey
    await expect(buildSession(bob, alice, false)).resolves.not.toThrow();
  });

  it("Primo messaggio senza OTPK: Bob cifra → tipo 3", async () => {
    const alice = await createPersona("alice", 1, 0);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, false);

    const ct = await encryptMessage(bob, "alice", 1, "Ciao senza OTPK");
    expect(ct.type).toBe(3);
  });

  it("Alice decifra il primo messaggio senza OTPK", async () => {
    const alice = await createPersona("alice", 1, 0);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, false);

    const ct = await encryptMessage(bob, "alice", 1, "Messaggio senza OTPK");
    const pt = await decryptMessage(alice, "bob", 1, ct);
    expect(pt).toBe("Messaggio senza OTPK");
  });

  it("Double Ratchet funziona dopo sessione senza OTPK", async () => {
    const alice = await createPersona("alice", 1, 0);
    const bob = await createPersona("bob", 1);
    await buildSession(bob, alice, false);

    // Stabilisci sessione
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // Scambio successivo via Double Ratchet
    const ct1 = await encryptMessage(alice, "bob", 1, "Alice risponde");
    const pt1 = await decryptMessage(bob, "alice", 1, ct1);
    expect(pt1).toBe("Alice risponde");

    const ct2 = await encryptMessage(bob, "alice", 1, "Bob risponde");
    const pt2 = await decryptMessage(alice, "bob", 1, ct2);
    expect(pt2).toBe("Bob risponde");
  });

  it("OTPK parzialmente esaurite: prima sessione con OTPK, seconda senza", async () => {
    const alice = await createPersona("alice", 1, 1); // solo 1 OTPK

    const bob1 = await createPersona("bob1", 1);
    const bob2 = await createPersona("bob2", 1);

    // Prima sessione: usa l'OTPK disponibile
    await buildSession(bob1, alice, true);
    const ct1 = await encryptMessage(bob1, "alice", 1, "Bob1 con OTPK");
    const pt1 = await decryptMessage(alice, "bob1", 1, ct1);
    expect(pt1).toBe("Bob1 con OTPK");

    // Seconda sessione: nessuna OTPK disponibile per Alice sul "server"
    // (il bundle che bob2 riceve non ha OTPK)
    await buildSession(bob2, alice, false);
    const ct2 = await encryptMessage(bob2, "alice", 1, "Bob2 senza OTPK");
    const pt2 = await decryptMessage(alice, "bob2", 1, ct2);
    expect(pt2).toBe("Bob2 senza OTPK");
  });
});
