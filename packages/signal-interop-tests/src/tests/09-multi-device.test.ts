/**
 * Test 09 — Multi-device: due dispositivi di Alice
 *
 * In Signal Protocol, tutti i dispositivi dello stesso utente condividono
 * la stessa Identity Key (device linkati). Il trust è per-nome-utente
 * (remoteAddress.name = "alice"), non per-address-completo ("alice.1").
 *
 * Ogni dispositivo ha però:
 * - Il proprio Signed PreKey (diverso per ogni device)
 * - Il proprio pool di One-Time PreKeys
 * - Il proprio stato di sessione (sessioni separate)
 *
 * Bob può comunicare con entrambi i dispositivi di Alice in modo
 * indipendente (sessioni separate, chiavi DH separate, ma stessa IK).
 */

import { describe, it, expect, beforeAll } from "vitest";
// @ts-ignore
import { KeyHelper } from "@privacyresearch/libsignal-protocol-typescript";
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

/**
 * Crea due dispositivi di Alice con la STESSA identity key (linked devices).
 * Ogni dispositivo ha Signed PreKey e OTPKs propri.
 */
async function createAliceDevices() {
  // L'identity key è condivisa tra tutti i dispositivi di Alice
  const sharedIdentityKey = await KeyHelper.generateIdentityKeyPair();
  const alice1 = await createPersona("alice", 1, 5, sharedIdentityKey);
  const alice2 = await createPersona("alice", 2, 5, sharedIdentityKey);
  return { alice1, alice2, sharedIdentityKey };
}

describe("09 — Multi-device: due dispositivi di Alice", () => {
  it("Bob stabilisce sessioni separate con device1 e device2 di Alice", async () => {
    const { alice1, alice2 } = await createAliceDevices();
    const bob = await createPersona("bob", 1);

    // Bob → Alice device1
    await expect(buildSession(bob, alice1, true)).resolves.not.toThrow();
    // Bob → Alice device2 (stessa IK, diverso SPK e OTPK)
    await expect(buildSession(bob, alice2, true)).resolves.not.toThrow();
  });

  it("Bob cifra per device1, Alice-device1 decifra, Alice-device2 non può", async () => {
    const { alice1, alice2 } = await createAliceDevices();
    const bob = await createPersona("bob", 1);

    await buildSession(bob, alice1, true);
    await buildSession(bob, alice2, true);

    // Messaggio specifico per device1
    const ct1 = await encryptMessage(bob, "alice", 1, "Solo per Alice device1");

    // Alice device1 decifra: successo
    const pt1 = await decryptMessage(alice1, "bob", 1, ct1);
    expect(pt1).toBe("Solo per Alice device1");

    // Alice device2 non ha la sessione corretta per questo messaggio
    await expect(
      decryptMessage(alice2, "bob", 1, ct1)
    ).rejects.toThrow();
  });

  it("Bob cifra per device2, Alice-device2 decifra, Alice-device1 non può", async () => {
    const { alice1, alice2 } = await createAliceDevices();
    const bob = await createPersona("bob", 1);

    await buildSession(bob, alice1, true);
    await buildSession(bob, alice2, true);

    // Setup device1 (PreKeyWhisperMessage deve essere decifrato dal destinatario)
    const ct1 = await encryptMessage(bob, "alice", 1, "Setup device1");
    await decryptMessage(alice1, "bob", 1, ct1);

    // Messaggio specifico per device2
    const ct2 = await encryptMessage(bob, "alice", 2, "Solo per Alice device2");

    // Alice device2 decifra: successo
    const pt2 = await decryptMessage(alice2, "bob", 1, ct2);
    expect(pt2).toBe("Solo per Alice device2");

    // Alice device1 non può decifrare il messaggio destinato a device2
    await expect(
      decryptMessage(alice1, "bob", 1, ct2)
    ).rejects.toThrow();
  });

  it("Sessioni device1 e device2 sono completamente indipendenti", async () => {
    const { alice1, alice2 } = await createAliceDevices();
    const bob = await createPersona("bob", 1);

    await buildSession(bob, alice1, true);
    await buildSession(bob, alice2, true);

    // Setup entrambe le sessioni
    const ctSetup1 = await encryptMessage(bob, "alice", 1, "Setup1");
    await decryptMessage(alice1, "bob", 1, ctSetup1);

    const ctSetup2 = await encryptMessage(bob, "alice", 2, "Setup2");
    await decryptMessage(alice2, "bob", 1, ctSetup2);

    // Scambio parallelo su entrambi i dispositivi
    const msg1 = "Conversazione con device1";
    const msg2 = "Conversazione con device2";

    const ct1 = await encryptMessage(alice1, "bob", 1, msg1);
    const ct2 = await encryptMessage(alice2, "bob", 1, msg2);

    const pt1 = await decryptMessage(bob, "alice", 1, ct1);
    const pt2 = await decryptMessage(bob, "alice", 2, ct2);

    expect(pt1).toBe(msg1);
    expect(pt2).toBe(msg2);
  });

  it("Bob ha sessioni separate in store: deviceId diverso → chiave sessione diversa", async () => {
    const { alice1, alice2 } = await createAliceDevices();
    const bob = await createPersona("bob", 1);

    await buildSession(bob, alice1, true);
    await buildSession(bob, alice2, true);

    // Stabilisci entrambe le sessioni
    const ct1 = await encryptMessage(bob, "alice", 1, "S1");
    await decryptMessage(alice1, "bob", 1, ct1);
    const ct2 = await encryptMessage(bob, "alice", 2, "S2");
    await decryptMessage(alice2, "bob", 1, ct2);

    // Bob ha 2+ sessioni nello store (una per device)
    expect(bob.store.sessionCount).toBeGreaterThanOrEqual(2);
  });

  it("Tre dispositivi: Bob gestisce sessioni alice.1, alice.2, alice.3", async () => {
    const sharedIdentityKey = await KeyHelper.generateIdentityKeyPair();
    const alice1 = await createPersona("alice", 1, 5, sharedIdentityKey);
    const alice2 = await createPersona("alice", 2, 5, sharedIdentityKey);
    const alice3 = await createPersona("alice", 3, 5, sharedIdentityKey);
    const bob = await createPersona("bob", 1);

    await buildSession(bob, alice1, true);
    await buildSession(bob, alice2, true);
    await buildSession(bob, alice3, true);

    const devices = [
      { alice: alice1, deviceId: 1 },
      { alice: alice2, deviceId: 2 },
      { alice: alice3, deviceId: 3 },
    ];

    for (const { alice, deviceId } of devices) {
      const ct = await encryptMessage(bob, "alice", deviceId, `Ciao device ${deviceId}`);
      const pt = await decryptMessage(alice, "bob", 1, ct);
      expect(pt).toBe(`Ciao device ${deviceId}`);
    }
  });
});
