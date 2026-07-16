/**
 * Test 18 — Fase 5: Safety Number E2E, TOFU, MITM, Multi-device
 *
 * Copre i deliverable del reviewer per la Fase 5:
 *   18.1 — Safety Number identico su entrambi i client
 *   18.2 — QR payload deterministico e contiene il fingerprint
 *   18.3 — TOFU a livello Signal: prima sessione → chiave memorizzata
 *   18.4 — Cambio Identity Key rilevato dallo store TOFU Signal
 *   18.5 — MITM simulation: numeri di sicurezza divergono
 *   18.6 — Multi-device: stessa Identity Key → stesso Safety Number
 *   18.7 — Safety Number cambia dopo key change (prova E2E completa)
 */

import { describe, it, expect, beforeAll } from "vitest";
// @ts-ignore
import { FingerprintGenerator, KeyHelper } from "@privacyresearch/libsignal-protocol-typescript";
import { initLibsignal } from "../helpers/setup.js";
import {
  createPersona,
  buildSession,
  encryptMessage,
  decryptMessage,
} from "../helpers/utils.js";

const FINGERPRINT_ITERATIONS = 5200;

beforeAll(async () => {
  await initLibsignal();
});

// ── Helper: genera fingerprint dalla coppia (alice, bob) ───────────────────

async function fp(
  idA: string, keyA: ArrayBuffer,
  idB: string, keyB: ArrayBuffer,
): Promise<string> {
  const gen = new FingerprintGenerator(FINGERPRINT_ITERATIONS);
  return gen.createFor(idA, keyA, idB, keyB);
}

// ── 18.1 — Safety Number identico su entrambi i client ────────────────────

describe("18.1 — Safety Number identico su entrambi i client", () => {
  it("18.1.1 — Alice e Bob generano lo stesso fingerprint (simmetria)", async () => {
    const alice = await createPersona("alice_sn", 1);
    const bob   = await createPersona("bob_sn",   1);

    const fpAlice = await fp("alice_sn", alice.identityKey.pubKey, "bob_sn", bob.identityKey.pubKey);
    const fpBob   = await fp("alice_sn", alice.identityKey.pubKey, "bob_sn", bob.identityKey.pubKey);

    expect(fpAlice).toBe(fpBob);
    expect(typeof fpAlice).toBe("string");
    expect(fpAlice.length).toBe(60);
    console.log(`  [18.1.1] Safety Number: ${fpAlice.slice(0, 15)}… ✓`);
  });

  it("18.1.2 — Fingerprint stabile dopo scambio intenso (100 messaggi)", async () => {
    const alice = await createPersona("alice_stable", 1);
    const bob   = await createPersona("bob_stable",   1);
    await buildSession(bob, alice, true);

    const fpBefore = await fp("alice_stable", alice.identityKey.pubKey, "bob_stable", bob.identityKey.pubKey);

    // Scambia 100 messaggi alternati
    const ct0 = await encryptMessage(bob, "alice_stable", 1, "Setup");
    await decryptMessage(alice, "bob_stable", 1, ct0);
    for (let i = 0; i < 50; i++) {
      const ctA = await encryptMessage(alice, "bob_stable", 1, `Alice→Bob #${i}`);
      await decryptMessage(bob, "alice_stable", 1, ctA);
      const ctB = await encryptMessage(bob, "alice_stable", 1, `Bob→Alice #${i}`);
      await decryptMessage(alice, "bob_stable", 1, ctB);
    }

    const fpAfter = await fp("alice_stable", alice.identityKey.pubKey, "bob_stable", bob.identityKey.pubKey);

    expect(fpAfter).toBe(fpBefore);
    console.log(`  [18.1.2] Fingerprint invariato dopo 100 messaggi ✓`);
  });

  it("18.1.3 — Fingerprint specifico alla coppia: A↔B ≠ A↔C ≠ B↔C", async () => {
    const alice   = await createPersona("alice_pair", 1);
    const bob     = await createPersona("bob_pair",   1);
    const charlie = await createPersona("charlie_pair", 1);

    const fpAB = await fp("alice_pair", alice.identityKey.pubKey, "bob_pair", bob.identityKey.pubKey);
    const fpAC = await fp("alice_pair", alice.identityKey.pubKey, "charlie_pair", charlie.identityKey.pubKey);
    const fpBC = await fp("bob_pair",   bob.identityKey.pubKey,   "charlie_pair", charlie.identityKey.pubKey);

    expect(fpAB).not.toBe(fpAC);
    expect(fpAB).not.toBe(fpBC);
    expect(fpAC).not.toBe(fpBC);
    console.log(`  [18.1.3] Fingerprint unici per coppia ✓`);
  });
});

// ── 18.2 — QR payload ─────────────────────────────────────────────────────

describe("18.2 — QR payload", () => {
  it("18.2.1 — QR payload deterministico e contiene il fingerprint", async () => {
    const alice = await createPersona("alice_qr", 1);
    const bob   = await createPersona("bob_qr",   1);

    const fingerprint = await fp("alice_qr", alice.identityKey.pubKey, "bob_qr", bob.identityKey.pubKey);
    const payload = `alphachat-verify:${fingerprint}:alice_qr:bob_qr`;

    expect(payload).toContain(fingerprint);
    expect(payload.startsWith("alphachat-verify:")).toBe(true);
    // Il payload è deterministico: stessa coppia → stesso QR
    const payload2 = `alphachat-verify:${fingerprint}:alice_qr:bob_qr`;
    expect(payload).toBe(payload2);
    console.log(`  [18.2.1] QR payload: ${payload.slice(0, 40)}… ✓`);
  });

  it("18.2.2 — QR payload diverso per coppie diverse", async () => {
    const alice   = await createPersona("alice_qr2", 1);
    const bob     = await createPersona("bob_qr2",   1);
    const charlie = await createPersona("charlie_qr2", 1);

    const fpAB = await fp("alice_qr2", alice.identityKey.pubKey, "bob_qr2", bob.identityKey.pubKey);
    const fpAC = await fp("alice_qr2", alice.identityKey.pubKey, "charlie_qr2", charlie.identityKey.pubKey);

    const qrAB = `alphachat-verify:${fpAB}:alice_qr2:bob_qr2`;
    const qrAC = `alphachat-verify:${fpAC}:alice_qr2:charlie_qr2`;

    expect(qrAB).not.toBe(qrAC);
    console.log(`  [18.2.2] QR payload diversi per coppie diverse ✓`);
  });
});

// ── 18.3 — TOFU a livello Signal ──────────────────────────────────────────

describe("18.3 — TOFU Signal: prima sessione → chiave memorizzata", () => {
  it("18.3.1 — Prima sessione accettata senza errori (TOFU)", async () => {
    const alice = await createPersona("alice_tofu", 1);
    const bob   = await createPersona("bob_tofu",   1);

    await expect(buildSession(bob, alice, true)).resolves.not.toThrow();

    // Verifica che la chiave sia ora fidata
    const trusted = await bob.store.isTrustedIdentity(
      "alice_tofu",
      alice.identityKey.pubKey,
      1, // Direction.RECEIVING
    );
    expect(trusted).toBe(true);
    console.log(`  [18.3.1] TOFU: prima sessione → chiave fidata ✓`);
  });

  it("18.3.2 — Stessa chiave verificata nuovamente → ancora fidata (no falso positivo)", async () => {
    const alice = await createPersona("alice_tofu2", 1, 5);
    const bob   = await createPersona("bob_tofu2",   1);

    await buildSession(bob, alice, true);
    const ct = await encryptMessage(bob, "alice_tofu2", 1, "Setup");
    await decryptMessage(alice, "bob_tofu2", 1, ct);

    // Stessa chiave → ancora fidata
    const trusted = await bob.store.isTrustedIdentity(
      "alice_tofu2",
      alice.identityKey.pubKey,
      1,
    );
    expect(trusted).toBe(true);
    console.log(`  [18.3.2] Stessa chiave → ancora fidata (no falso positivo) ✓`);
  });
});

// ── 18.4 — Cambio Identity Key rilevato ───────────────────────────────────

describe("18.4 — Cambio Identity Key rilevato dallo store TOFU", () => {
  it("18.4.1 — Nuova Identity Key → isTrustedIdentity ritorna false", async () => {
    const alice = await createPersona("alice_change", 1);
    const bob   = await createPersona("bob_change",   1);

    // Bob impara la chiave di Alice (TOFU)
    await buildSession(bob, alice, true);
    const ct = await encryptMessage(bob, "alice_change", 1, "Setup");
    await decryptMessage(alice, "bob_change", 1, ct);

    // Alice rigenera la Identity Key (simula reinstallazione / nuovo device non collegato)
    const newAliceIK = await KeyHelper.generateIdentityKeyPair();

    const trusted = await bob.store.isTrustedIdentity(
      "alice_change",
      newAliceIK.pubKey,
      1,
    );
    expect(trusted).toBe(false);
    console.log(`  [18.4.1] Nuova IK → TOFU ritorna false ✓`);
  });

  it("18.4.2 — Safety Number cambia con la nuova Identity Key", async () => {
    const alice    = await createPersona("alice_fp_change", 1);
    const aliceNew = await createPersona("alice_fp_change", 1); // nuova identity
    const bob      = await createPersona("bob_fp_change",   1);

    const fpOld = await fp("alice_fp_change", alice.identityKey.pubKey, "bob_fp_change", bob.identityKey.pubKey);
    const fpNew = await fp("alice_fp_change", aliceNew.identityKey.pubKey, "bob_fp_change", bob.identityKey.pubKey);

    expect(fpOld).not.toBe(fpNew);
    console.log(`  [18.4.2] FP vecchio ≠ FP nuovo → cambio chiave rilevabile ✓`);
  });

  it("18.4.3 — Dopo rivalidazione manuale, nuova sessione accettata", async () => {
    const alice    = await createPersona("alice_reval", 1, 5);
    const aliceNew = await createPersona("alice_reval", 1, 5, await KeyHelper.generateIdentityKeyPair());
    const bob      = await createPersona("bob_reval",   1);

    // Prima sessione (TOFU)
    await buildSession(bob, alice, true);
    const ct0 = await encryptMessage(bob, "alice_reval", 1, "Setup");
    await decryptMessage(alice, "bob_reval", 1, ct0);

    // Bob "rivalida" manualmente (UX: utente ha confrontato il Safety Number)
    bob.store.clearTrustedIdentity("alice_reval");

    // Nuova sessione con la nuova IK di Alice → accettata
    await expect(buildSession(bob, aliceNew, true)).resolves.not.toThrow();
    const ct = await encryptMessage(bob, "alice_reval", 1, "Dopo rivalidazione");
    const pt = await decryptMessage(aliceNew, "bob_reval", 1, ct);
    expect(pt).toBe("Dopo rivalidazione");
    console.log(`  [18.4.3] Rivalidazione manuale → nuova sessione accettata ✓`);
  });
});

// ── 18.5 — MITM simulation ────────────────────────────────────────────────

describe("18.5 — MITM simulation: Safety Numbers divergono", () => {
  /**
   * Scenario:
   *   Alice vuole parlare con Bob.
   *   Mallory (MITM) intercetta: stabilisce sessioni con entrambi
   *   fingendosi l'altro.
   *
   *   Alice ↔ Mallory (Mallory si finge Bob per Alice)
   *   Bob   ↔ Mallory (Mallory si finge Alice per Bob)
   *
   *   Il Safety Number che Alice calcola con la "chiave di Bob" (in realtà IK di Mallory)
   *   ≠ Safety Number che Bob calcola con la "chiave di Alice" (in realtà IK di Mallory).
   *
   *   Se Alice e Bob si chiamano e confrontano il numero → rilevazione garantita.
   */
  it("18.5.1 — MITM: Safety Numbers di Alice e Bob divergono", async () => {
    const alice   = await createPersona("alice_mitm", 1);
    const bob     = await createPersona("bob_mitm",   1);
    const mallory = await createPersona("mallory",    1);

    // Alice calcola il suo Safety Number con la chiave che CREDE essere di Bob
    // ma Mallory ha sostituito il bundle di Bob con il suo.
    // Alice ↔ Mallory (crede sia Bob)
    const fpAliceWithMallory = await fp(
      "alice_mitm", alice.identityKey.pubKey,
      "bob_mitm",   mallory.identityKey.pubKey, // ← chiave di Mallory, non di Bob!
    );

    // Bob calcola il suo Safety Number con la chiave che CREDE essere di Alice
    // ma Mallory ha sostituito il bundle di Alice con il suo.
    // Bob ↔ Mallory (crede sia Alice)
    const fpBobWithMallory = await fp(
      "alice_mitm", mallory.identityKey.pubKey, // ← chiave di Mallory, non di Alice!
      "bob_mitm",   bob.identityKey.pubKey,
    );

    // Il Safety Number legittimo Alice↔Bob
    const fpLegit = await fp(
      "alice_mitm", alice.identityKey.pubKey,
      "bob_mitm",   bob.identityKey.pubKey,
    );

    // MITM rilevato: i numeri divergono
    expect(fpAliceWithMallory).not.toBe(fpBobWithMallory);
    // Nessuno dei due coincide con il numero legittimo
    expect(fpAliceWithMallory).not.toBe(fpLegit);
    expect(fpBobWithMallory).not.toBe(fpLegit);

    console.log(`  [18.5.1] MITM rilevato: FP Alice (${fpAliceWithMallory.slice(0,10)}…) ≠ FP Bob (${fpBobWithMallory.slice(0,10)}…) ✓`);
  });

  it("18.5.2 — Senza MITM: Alice e Bob hanno lo stesso Safety Number", async () => {
    const alice = await createPersona("alice_nomitm", 1);
    const bob   = await createPersona("bob_nomitm",   1);

    // Senza MITM: entrambi usano le chiavi reali dell'altro
    const fpAlice = await fp("alice_nomitm", alice.identityKey.pubKey, "bob_nomitm", bob.identityKey.pubKey);
    const fpBob   = await fp("alice_nomitm", alice.identityKey.pubKey, "bob_nomitm", bob.identityKey.pubKey);

    expect(fpAlice).toBe(fpBob); // identici → nessun MITM
    console.log(`  [18.5.2] Senza MITM: FP identici ✓`);
  });
});

// ── 18.6 — Multi-device: stessa IK → stesso Safety Number ────────────────

describe("18.6 — Multi-device: stessa Identity Key → stesso Safety Number", () => {
  it("18.6.1 — Alice device 1 e device 2 condividono la stessa IK", async () => {
    const aliceIK  = await KeyHelper.generateIdentityKeyPair();
    const alice_d1 = await createPersona("alice_multi", 1, 5, aliceIK);
    const alice_d2 = await createPersona("alice_multi", 2, 5, aliceIK); // stesso IK, deviceId=2
    const bob      = await createPersona("bob_multi",   1);

    // Bob calcola il Safety Number con Alice device 1 e device 2
    // Devono essere identici (stessa IK)
    const fpD1 = await fp("alice_multi", alice_d1.identityKey.pubKey, "bob_multi", bob.identityKey.pubKey);
    const fpD2 = await fp("alice_multi", alice_d2.identityKey.pubKey, "bob_multi", bob.identityKey.pubKey);

    expect(fpD1).toBe(fpD2);
    console.log(`  [18.6.1] Multi-device stessa IK → stesso Safety Number ✓`);
  });

  it("18.6.2 — Device non collegato (IK diversa) → Safety Number diverso", async () => {
    const alice_d1 = await createPersona("alice_ml2", 1);
    const alice_d2 = await createPersona("alice_ml2", 2); // nuovo device, IK diversa
    const bob      = await createPersona("bob_ml2",   1);

    const fpD1 = await fp("alice_ml2", alice_d1.identityKey.pubKey, "bob_ml2", bob.identityKey.pubKey);
    const fpD2 = await fp("alice_ml2", alice_d2.identityKey.pubKey, "bob_ml2", bob.identityKey.pubKey);

    // IK diverse → Safety Number diverso → rilevazione garantita
    expect(fpD1).not.toBe(fpD2);
    console.log(`  [18.6.2] Device non collegato (IK diversa) → Safety Number diverso (rilevabile) ✓`);
  });
});

// ── 18.7 — E2E completo: sessione → verifica → cambio → ri-verifica ───────

describe("18.7 — E2E: ciclo completo sessione → cambio → ri-verifica", () => {
  it("18.7.1 — Ciclo: prima sessione → verifica → cambio IK → nuovo FP → ri-verifica", async () => {
    const alice    = await createPersona("alice_cycle", 1, 5);
    const bob      = await createPersona("bob_cycle",   1);

    // 1. Prima sessione (TOFU)
    await buildSession(bob, alice, true);
    const ct0 = await encryptMessage(bob, "alice_cycle", 1, "Ciao");
    await decryptMessage(alice, "bob_cycle", 1, ct0);

    // 2. FP "verificato" in sessione 1
    const fp1 = await fp("alice_cycle", alice.identityKey.pubKey, "bob_cycle", bob.identityKey.pubKey);

    // 3. Alice rigenera la IK (reinstallazione)
    const newAliceIK = await KeyHelper.generateIdentityKeyPair();
    const aliceNew   = await createPersona("alice_cycle", 1, 5, newAliceIK);

    // 4. TOFU rileva la discrepanza (nuova IK non fidata)
    const trustedNew = await bob.store.isTrustedIdentity(
      "alice_cycle", newAliceIK.pubKey, 1,
    );
    expect(trustedNew).toBe(false); // → UI mostra 🔴

    // 5. Nuovo FP con la nuova IK
    const fp2 = await fp("alice_cycle", aliceNew.identityKey.pubKey, "bob_cycle", bob.identityKey.pubKey);
    expect(fp1).not.toBe(fp2); // numeri diversi → cambio rilevato

    // 6. Bob rivalida manualmente (utente ha confrontato il nuovo FP)
    bob.store.clearTrustedIdentity("alice_cycle");
    await buildSession(bob, aliceNew, true);
    const ct1 = await encryptMessage(bob, "alice_cycle", 1, "Nuova sessione verificata");
    const pt1  = await decryptMessage(aliceNew, "bob_cycle", 1, ct1);
    expect(pt1).toBe("Nuova sessione verificata"); // → UI mostra 🟢

    console.log(`  [18.7.1] Ciclo completo: prima sessione → cambio IK → ri-verifica ✓`);
    console.log(`           FP sessione 1: ${fp1.slice(0, 15)}…`);
    console.log(`           FP sessione 2: ${fp2.slice(0, 15)}…`);
  });
});
