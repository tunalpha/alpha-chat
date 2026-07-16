/**
 * Test 05 — Rotazione Signed PreKey
 *
 * La Signal spec raccomanda la rotazione periodica della Signed PreKey
 * (settimanalmente). Verifica che:
 * - Sessioni esistenti continuano a funzionare dopo la rotazione (le
 *   sessioni attive non dipendono dalla SPK dopo X3DH)
 * - Nuove sessioni usano la nuova SPK
 * - La vecchia SPK può essere rimossa dallo store
 */

import { describe, it, expect, beforeAll } from "vitest";
// @ts-ignore
import { KeyHelper, SignalProtocolAddress, SessionBuilder } from "@privacyresearch/libsignal-protocol-typescript";
import { initLibsignal } from "../helpers/setup.js";
import {
  createPersona,
  buildSession,
  encryptMessage,
  decryptMessage,
  buildDeviceBundle,
  type Persona,
} from "../helpers/utils.js";

beforeAll(async () => {
  await initLibsignal();
});

/** Ruota la Signed PreKey di una persona e aggiorna lo store */
async function rotateSPK(persona: Persona, newKeyId: number): Promise<{
  newSpkKeyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer };
  newSpkSignature: ArrayBuffer;
}> {
  const newSpk = await KeyHelper.generateSignedPreKey(persona.identityKey, newKeyId);
  await persona.store.storeSignedPreKey(newKeyId, newSpk.keyPair);
  // Aggiorna il signedPreKeyId locale (simulazione)
  persona.signedPreKeyId = newKeyId;
  persona.signedPreKey = newSpk.keyPair;
  persona.signedPreKeySignature = newSpk.signature;
  return {
    newSpkKeyPair: newSpk.keyPair,
    newSpkSignature: newSpk.signature,
  };
}

describe("05 — Rotazione Signed PreKey", () => {
  it("Sessione esistente continua dopo rotazione SPK di Alice", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    // Sessione stabilita con SPK originale
    await buildSession(bob, alice, true);
    const ct0 = await encryptMessage(bob, "alice", 1, "Prima della rotazione");
    await decryptMessage(alice, "bob", 1, ct0);

    // Alice ruota la SPK
    await rotateSPK(alice, 2);

    // La sessione esistente non usa più la SPK → continua a funzionare
    const ct1 = await encryptMessage(alice, "bob", 1, "Dopo rotazione SPK");
    const pt1 = await decryptMessage(bob, "alice", 1, ct1);
    expect(pt1).toBe("Dopo rotazione SPK");

    const ct2 = await encryptMessage(bob, "alice", 1, "Bob risponde dopo rotazione");
    const pt2 = await decryptMessage(alice, "bob", 1, ct2);
    expect(pt2).toBe("Bob risponde dopo rotazione");
  });

  it("Nuova sessione usa la nuova SPK dopo rotazione", async () => {
    const alice = await createPersona("alice", 1, 5);
    const charlie = await createPersona("charlie", 1);

    // Alice ruota la SPK prima che Charlie si connetta
    await rotateSPK(alice, 99);

    // Charlie stabilisce sessione con il nuovo bundle (nuova SPK)
    await buildSession(charlie, alice, true);
    const ct = await encryptMessage(charlie, "alice", 1, "Ciao con nuova SPK");
    const pt = await decryptMessage(alice, "charlie", 1, ct);
    expect(pt).toBe("Ciao con nuova SPK");
  });

  it("Vecchia SPK può essere rimossa dopo rotazione senza rompere sessioni attive", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    // Sessione stabilita con SPK 1
    await buildSession(bob, alice, true);
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // Alice ruota e rimuove la vecchia SPK
    await rotateSPK(alice, 2);
    await alice.store.removeSignedPreKey(1); // rimuove SPK originale

    // Sessione attiva non dipende dalla SPK originale dopo X3DH
    const ct1 = await encryptMessage(bob, "alice", 1, "Con vecchia SPK rimossa");
    const pt1 = await decryptMessage(alice, "bob", 1, ct1);
    expect(pt1).toBe("Con vecchia SPK rimossa");
  });

  it("Rotazione multipla (3 volte): sessioni stabili", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    await buildSession(bob, alice, true);
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    for (let r = 2; r <= 4; r++) {
      await rotateSPK(alice, r);
      const msg = `Rotazione ${r}`;
      const ct = await encryptMessage(alice, "bob", 1, msg);
      const pt = await decryptMessage(bob, "alice", 1, ct);
      expect(pt).toBe(msg);
    }
  });
});
