/**
 * Test 13 — Multi-device fan-out Signal Protocol (Fase 4)
 *
 * Estende i test 09 con scenari più completi:
 *   - Bob cifra per due device di Alice in una sola operazione (fan-out)
 *   - Entrambi i device decifrano indipendentemente
 *   - Eve (terza parte) non può decifrare
 *   - Forward secrecy: OTPK consumata non riutilizzabile
 *   - Revoca: reset store → nuovo bundle → vecchio store inutilizzabile
 *   - Stress: N messaggi consecutivi su 2 device
 *   - Risposta bidirezionale cross-device
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
  type Persona,
  type CiphertextMessage,
} from "../helpers/utils.js";

beforeAll(async () => {
  await initLibsignal();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Crea due device di Alice con la STESSA Identity Key (linked devices).
 * Ogni device ha Signed PreKey e OTPKs propri.
 */
async function createLinkedDevices() {
  const sharedIK = await KeyHelper.generateIdentityKeyPair();
  const d1 = await createPersona("alice", 1, 5, sharedIK);
  const d2 = await createPersona("alice", 2, 5, sharedIK);
  return { d1, d2 };
}

/**
 * Fan-out: cifra lo stesso plaintext per N device del destinatario.
 * Usate le corrette firme di encryptMessage (name: string, deviceId: number).
 */
async function fanOutEncrypt(
  sender: Persona,
  recipients: Persona[],
  text: string,
): Promise<CiphertextMessage[]> {
  const cts: CiphertextMessage[] = [];
  for (const r of recipients) {
    await buildSession(sender, r, true);
    cts.push(await encryptMessage(sender, r.name, r.deviceId, text));
  }
  return cts;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("13 — Multi-device fan-out Signal Protocol", () => {

  // ── 13.1 Setup ────────────────────────────────────────────────────────────
  describe("13.1 — Setup dispositivi linkati", () => {
    it("Alice-device-1 e device-2 condividono la stessa Identity Key", async () => {
      const { d1, d2 } = await createLinkedDevices();
      const ik1 = Buffer.from(d1.identityKey.pubKey).toString("base64");
      const ik2 = Buffer.from(d2.identityKey.pubKey).toString("base64");
      expect(ik1).toBe(ik2);
    });

    it("Alice-device-1 e device-2 hanno Signed PreKey diversi", async () => {
      const { d1, d2 } = await createLinkedDevices();
      const spk1 = d1.store.signedPreKeys.get(d1.signedPreKeyId);
      const spk2 = d2.store.signedPreKeys.get(d2.signedPreKeyId);
      expect(spk1).toBeTruthy();
      expect(spk2).toBeTruthy();
      const pub1 = Buffer.from(spk1!.pubKey).toString("base64");
      const pub2 = Buffer.from(spk2!.pubKey).toString("base64");
      expect(pub1).not.toBe(pub2);
    });

    it("Bob ha identity key diversa da Alice", async () => {
      const { d1 } = await createLinkedDevices();
      const bob = await createPersona("bob", 1);
      const aliceIK = Buffer.from(d1.identityKey.pubKey).toString("base64");
      const bobIK   = Buffer.from(bob.identityKey.pubKey).toString("base64");
      expect(aliceIK).not.toBe(bobIK);
    });
  });

  // ── 13.2 Fan-out ──────────────────────────────────────────────────────────
  describe("13.2 — Fan-out cifratura a 2 device", () => {
    const PLAIN = "Messaggio segreto per Alice — fan-out multi-device!";
    let cts: CiphertextMessage[];
    let d1: Persona, d2: Persona, bob: Persona;

    beforeAll(async () => {
      const linked = await createLinkedDevices();
      d1  = linked.d1;
      d2  = linked.d2;
      bob = await createPersona("bob", 1);
      cts = await fanOutEncrypt(bob, [d1, d2], PLAIN);
    });

    it("Fan-out genera 2 ciphertext separati", () => {
      expect(cts).toHaveLength(2);
    });

    it("I due ciphertext non sono identici", () => {
      expect(cts[0]!.body).not.toBe(cts[1]!.body);
    });

    it("Alice-device-1 decifra il proprio ciphertext", async () => {
      const plain = await decryptMessage(d1, bob.name, bob.deviceId, cts[0]!);
      expect(plain).toBe(PLAIN);
    });

    it("Alice-device-2 decifra il proprio ciphertext", async () => {
      const plain = await decryptMessage(d2, bob.name, bob.deviceId, cts[1]!);
      expect(plain).toBe(PLAIN);
    });

    it("Alice-device-1 NON può decifrare il ciphertext di device-2", async () => {
      await expect(decryptMessage(d1, bob.name, bob.deviceId, cts[1]!)).rejects.toThrow();
    });

    it("Alice-device-2 NON può decifrare il ciphertext di device-1", async () => {
      await expect(decryptMessage(d2, bob.name, bob.deviceId, cts[0]!)).rejects.toThrow();
    });
  });

  // ── 13.3 Isolamento Eve ───────────────────────────────────────────────────
  describe("13.3 — Isolamento terze parti", () => {
    it("Eve non può decifrare il ciphertext destinato ad Alice-device-1", async () => {
      const { d1 } = await createLinkedDevices();
      const bob = await createPersona("bob", 1);
      const eve = await createPersona("eve", 1);
      const [ct] = await fanOutEncrypt(bob, [d1], "segreto");
      // Eve non ha sessione con Bob → "No record" o errore di decrypt
      await expect(decryptMessage(eve, bob.name, bob.deviceId, ct!)).rejects.toThrow();
    });

    it("Eve non può decifrare il ciphertext destinato ad Alice-device-2", async () => {
      const { d1, d2 } = await createLinkedDevices();
      const bob = await createPersona("bob", 1);
      const eve = await createPersona("eve", 1);
      const [, ct2] = await fanOutEncrypt(bob, [d1, d2], "segreto");
      await expect(decryptMessage(eve, bob.name, bob.deviceId, ct2!)).rejects.toThrow();
    });
  });

  // ── 13.4 Double Ratchet ───────────────────────────────────────────────────
  // Verifica che messaggi successivi al primo siano decifrabili (Double Ratchet).
  // La verifica del tipo type=1 è coperta dal test 03-double-ratchet.test.ts;
  // qui verifichiamo la correttezza funzionale: N messaggi consecutivi decifrabili.
  describe("13.4 — Multi-messaggio dopo PreKeyWhisperMessage iniziale", () => {
    it("Tre messaggi consecutivi decifrabili su device-1 (alice.1)", async () => {
      const { d1 } = await createLinkedDevices();
      const bob    = await createPersona("bob-mm1", 1, 10);
      await buildSession(bob, d1, true);
      const ct1 = await encryptMessage(bob, d1.name, d1.deviceId, "msg-uno");
      const ct2 = await encryptMessage(bob, d1.name, d1.deviceId, "msg-due");
      const ct3 = await encryptMessage(bob, d1.name, d1.deviceId, "msg-tre");
      expect(await decryptMessage(d1, bob.name, bob.deviceId, ct1)).toBe("msg-uno");
      expect(await decryptMessage(d1, bob.name, bob.deviceId, ct2)).toBe("msg-due");
      expect(await decryptMessage(d1, bob.name, bob.deviceId, ct3)).toBe("msg-tre");
    });

    it("Tre messaggi consecutivi decifrabili su device-2 (alice.2)", async () => {
      const { d2 } = await createLinkedDevices();
      const bob    = await createPersona("bob-mm2", 1, 10);
      await buildSession(bob, d2, true);
      const ct1 = await encryptMessage(bob, d2.name, d2.deviceId, "msg-uno");
      const ct2 = await encryptMessage(bob, d2.name, d2.deviceId, "msg-due");
      const ct3 = await encryptMessage(bob, d2.name, d2.deviceId, "msg-tre");
      expect(await decryptMessage(d2, bob.name, bob.deviceId, ct1)).toBe("msg-uno");
      expect(await decryptMessage(d2, bob.name, bob.deviceId, ct2)).toBe("msg-due");
      expect(await decryptMessage(d2, bob.name, bob.deviceId, ct3)).toBe("msg-tre");
    });
  });

  // ── 13.5 Reply da Alice-A1 a Bob ─────────────────────────────────────────
  describe("13.5 — Risposta da Alice-device-1 a Bob", () => {
    it("Alice-A1 risponde a Bob con X3DH (type=3)", async () => {
      const { d1 } = await createLinkedDevices();
      const bob = await createPersona("bob", 1);
      // Bob → Alice-A1 (stabilisce sessione)
      const [ct] = await fanOutEncrypt(bob, [d1], "ciao Alice");
      await decryptMessage(d1, bob.name, bob.deviceId, ct!);
      // Alice-A1 → Bob (X3DH, primo messaggio nella direzione inversa)
      await buildSession(d1, bob, true);
      const reply = await encryptMessage(d1, bob.name, bob.deviceId, "ciao Bob");
      expect(reply.type).toBe(3); // PreKeyWhisperMessage (nuova sessione)
      const plain = await decryptMessage(bob, d1.name, d1.deviceId, reply);
      expect(plain).toBe("ciao Bob");
    });
  });

  // ── 13.6 Revoca ──────────────────────────────────────────────────────────
  describe("13.6 — Revoca: nuovo bundle inaccessibile al vecchio store", () => {
    it("Primo msg al nuovo bundle è X3DH (type=3)", async () => {
      const bob = await createPersona("bob", 1);
      const newAlice = await createPersona("alice-new", 1, 5);
      const [ct] = await fanOutEncrypt(bob, [newAlice], "primo al nuovo device");
      expect(ct!.type).toBe(3); // PreKeyWhisperMessage
      const plain = await decryptMessage(newAlice, bob.name, bob.deviceId, ct!);
      expect(plain).toBe("primo al nuovo device");
    });

    it("Il vecchio store non può decifrare msg cifrato per il nuovo bundle", async () => {
      const { d2: oldD2 } = await createLinkedDevices();
      const bob = await createPersona("bob", 1);
      // Nuovo device con identità diversa
      const newD2 = await createPersona("alice", 99, 5);
      const [ct] = await fanOutEncrypt(bob, [newD2], "solo per nuovo device");
      // Il vecchio store non ha le chiavi private del nuovo bundle
      await expect(
        decryptMessage(oldD2, bob.name, bob.deviceId, ct!),
      ).rejects.toThrow();
    });
  });

  // ── 13.7 Forward secrecy ─────────────────────────────────────────────────
  describe("13.7 — Forward secrecy: OTPK consumata", () => {
    it("Replay del primo messaggio (PreKeyWhisperMessage) viene rifiutato", async () => {
      const alice = await createPersona("alice-fs", 1, 5);
      const bob   = await createPersona("bob-fs", 1);
      const [ct] = await fanOutEncrypt(bob, [alice], "da consumare");
      // Prima decifratura: OK
      const plain = await decryptMessage(alice, bob.name, bob.deviceId, ct!);
      expect(plain).toBe("da consumare");
      // Replay: OTPK consumata, sessione avanzata → errore
      await expect(
        decryptMessage(alice, bob.name, bob.deviceId, ct!),
      ).rejects.toThrow();
    });
  });

  // ── 13.8 Stress ───────────────────────────────────────────────────────────
  // Sessions built ONCE (X3DH), then 5 messages via Double Ratchet each.
  // Calling buildSession on every iteration would re-use the consumed OTPK → Bad MAC.
  describe("13.8 — Stress: 5 messaggi consecutivi su 2 device", () => {
    it("Tutti i messaggi sono decifrabili su entrambi i device", async () => {
      const { d1, d2 } = await createLinkedDevices();
      const bob  = await createPersona("bob-stress", 1);
      const msgs = ["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"];

      // Build sessions ONCE (X3DH) — first message of fanOutEncrypt is always type=3
      const [ctInit1, ctInit2] = await fanOutEncrypt(bob, [d1, d2], msgs[0]!);
      const p0a = await decryptMessage(d1, bob.name, bob.deviceId, ctInit1!);
      const p0b = await decryptMessage(d2, bob.name, bob.deviceId, ctInit2!);
      expect(p0a).toBe(msgs[0]!);
      expect(p0b).toBe(msgs[0]!);

      // Subsequent messages use Double Ratchet (no session rebuild)
      for (const m of msgs.slice(1)) {
        const ct1 = await encryptMessage(bob, d1.name, d1.deviceId, m);
        const ct2 = await encryptMessage(bob, d2.name, d2.deviceId, m);
        const p1  = await decryptMessage(d1, bob.name, bob.deviceId, ct1);
        const p2  = await decryptMessage(d2, bob.name, bob.deviceId, ct2);
        expect(p1).toBe(m);
        expect(p2).toBe(m);
      }
    });
  });

  // ── 13.9 Conversazione bidirezionale ─────────────────────────────────────
  // Bob → d1 and d2 (fan-out). Then both d1 and d2 reply to Bob independently.
  // Alice-A2 uses useOtpk=false (no OTPK) because Bob's OTPK #1 is consumed by d1.
  describe("13.9 — Conversazione bidirezionale multi-device", () => {
    it("Bob↔Alice-A1 e Bob↔Alice-A2 sono sessioni completamente indipendenti", async () => {
      const { d1, d2 } = await createLinkedDevices();
      const bob = await createPersona("bob-bi", 1, 10); // più OTPKs per entrambe le direzioni

      // Bob → Alice fan-out
      const [ct1, ct2] = await fanOutEncrypt(bob, [d1, d2], "hello");
      await decryptMessage(d1, bob.name, bob.deviceId, ct1!);
      await decryptMessage(d2, bob.name, bob.deviceId, ct2!);

      // Alice-A1 → Bob (usa OTPK #1 di Bob)
      await buildSession(d1, bob, true);
      const replyA1 = await encryptMessage(d1, bob.name, bob.deviceId, "reply from A1");
      const gotA1   = await decryptMessage(bob, d1.name, d1.deviceId, replyA1);
      expect(gotA1).toBe("reply from A1");

      // Alice-A2 → Bob: OTPK #1 già consumato da d1 → usa useOtpk=false (SPK only, X3DH senza OTPK)
      await buildSession(d2, bob, false);
      const replyA2 = await encryptMessage(d2, bob.name, bob.deviceId, "reply from A2");
      const gotA2   = await decryptMessage(bob, d2.name, d2.deviceId, replyA2);
      expect(gotA2).toBe("reply from A2");
    });
  });

});
