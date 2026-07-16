/**
 * Test 08 — Cambio di Identity Key: warning e nuova sessione
 *
 * Se la Identity Key di Alice cambia (es. nuovo dispositivo non collegato,
 * compromissione, o attacco man-in-the-middle), Bob deve rilevarlo:
 * - Lo store TOFU (Trust On First Use) ha memorizzato la vecchia chiave
 *   sotto la chiave "alice" (remoteAddress.name, NON l'address completo)
 * - Quando la nuova chiave arriva, isTrustedIdentity() ritorna false
 * - La sessione non può essere stabilita silenziosamente
 *
 * Scenario applicativo in Alpha Chat: il sistema deve mostrare all'utente
 * un avviso "Safety Number cambiato" e richiedere rivalidazione manuale.
 *
 * Nota TOFU: la libreria usa remoteAddress.name (es. "alice") come identifier
 * per isTrustedIdentity, non l'address completo ("alice.1"). Quindi il trust
 * è per-utente, non per-dispositivo.
 */

import { describe, it, expect, beforeAll } from "vitest";
// @ts-ignore
import { KeyHelper, SignalProtocolAddress } from "@privacyresearch/libsignal-protocol-typescript";
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

describe("08 — Cambio Identity Key", () => {
  it("Prima sessione (TOFU): Bob accetta la chiave di Alice senza errori", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    await expect(buildSession(bob, alice, true)).resolves.not.toThrow();
  });

  it("Stessa chiave: sessione ricostruita senza errori (Bob riceve lo stesso bundle)", async () => {
    const alice = await createPersona("alice", 1, 5);
    const bob = await createPersona("bob", 1);

    await buildSession(bob, alice, true);
    await expect(buildSession(bob, alice, false)).resolves.not.toThrow();
  });

  it("Chiave cambiata: lo store TOFU rileva la discrepanza", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    // Bob memorizza la chiave originale di Alice (TOFU) — stored under "alice"
    await buildSession(bob, alice, true);
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // Alice genera una NUOVA Identity Key
    const newAliceIdentity = await KeyHelper.generateIdentityKeyPair();

    // Bob ha già memorizzato la VECCHIA chiave di Alice sotto "alice"
    // isTrustedIdentity usa remoteAddress.name come identifier
    const isTrusted = await bob.store.isTrustedIdentity(
      "alice",          // identifier usato dalla libreria = remoteAddress.name
      newAliceIdentity.pubKey,
      1, // Direction.RECEIVING
    );

    // TOFU: chiave diversa → non fidata
    expect(isTrusted).toBe(false);
  });

  it("Dopo rivalidazione manuale, nuova sessione accettata", async () => {
    const alice = await createPersona("alice", 1, 5);
    const bob = await createPersona("bob", 1);

    // Prima sessione → TOFU salva la chiave originale sotto "alice"
    await buildSession(bob, alice, true);
    const ct0 = await encryptMessage(bob, "alice", 1, "Setup");
    await decryptMessage(alice, "bob", 1, ct0);

    // Alice genera nuova Identity Key
    const aliceNewIdentity = await KeyHelper.generateIdentityKeyPair();
    // Crea un nuovo persona per aliceNew con la nuova chiave
    const aliceNew = await createPersona("alice", 1, 5, aliceNewIdentity);

    // Bob "rivalida" manualmente (come farebbe l'utente nell'UI):
    // 1. Pulisce il trust TOFU per "alice" (richiede rivalidazione utente)
    // 2. Pulisce la sessione per il nuovo tentativo
    // Nota: il trust è stored sotto "alice" (name), non "alice.1" (address)
    bob.store.clearTrustedIdentity("alice");

    // Ora Bob può stabilire una nuova sessione con Alice (nuova chiave)
    await expect(buildSession(bob, aliceNew, true)).resolves.not.toThrow();

    const ct = await encryptMessage(bob, "alice", 1, "Nuova sessione dopo rivalidazione");
    const pt = await decryptMessage(aliceNew, "bob", 1, ct);
    expect(pt).toBe("Nuova sessione dopo rivalidazione");
  });

  it("Safety Number diverso dopo cambio Identity Key", async () => {
    const alice = await createPersona("alice", 1);
    const aliceNew = await createPersona("alice", 1); // nuova identità
    const bob = await createPersona("bob", 1);

    const aliceKey = Array.from(new Uint8Array(alice.identityKey.pubKey)).join(",");
    const aliceNewKey = Array.from(new Uint8Array(aliceNew.identityKey.pubKey)).join(",");

    // Con probabilità astronomicamente alta, due Identity Key sono diverse
    expect(aliceKey).not.toBe(aliceNewKey);
  });
});
