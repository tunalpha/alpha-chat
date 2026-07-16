/**
 * Test 11 — Integrazione applicativa: scenari reali Alpha Chat
 *
 * Verifica i pattern di utilizzo dell'app con Signal Protocol reale.
 * Simula il layer signal-messenger.ts in ambiente Node.js (senza browser).
 *
 * Nota: non usa import da signal-messenger.ts (è browser-only con import.meta.env).
 * Usa direttamente le primitive @privacyresearch con lo stesso pattern.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { initLibsignal } from "../helpers/setup.js";
import {
  createPersona,
  buildSession,
  encryptMessage,
  decryptMessage,
  type CiphertextMessage,
} from "../helpers/utils.js";
import { TestSignalStore } from "../helpers/test-store.js";
// @ts-ignore
import { KeyHelper, SessionBuilder, SessionCipher, SignalProtocolAddress } from "@privacyresearch/libsignal-protocol-typescript";

beforeAll(async () => {
  await initLibsignal();
});

// ---------------------------------------------------------------------------
// Helper: simula btoa/atob (per testare il layer base64 del messenger)
// ---------------------------------------------------------------------------

/** Simula il layer base64 di signalEncrypt/signalDecrypt */
function wrapBase64(ct: CiphertextMessage): CiphertextMessage {
  // btoa(binaryBody) → base64 per transport
  return { type: ct.type, body: btoa(ct.body) };
}
function unwrapBase64(ct: CiphertextMessage): CiphertextMessage {
  // atob(base64) → binary string per decrypt
  return { type: ct.type, body: atob(ct.body) };
}

// ---------------------------------------------------------------------------
// Helper: legacy encode/decode (pre-Fase 2)
// ---------------------------------------------------------------------------

function legacyEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binStr = String.fromCharCode(...bytes);
  return btoa(binStr);
}

function legacyDecode(ciphertext: string): string {
  try {
    const binStr = atob(ciphertext);
    const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "[cifrato]";
  }
}

describe("11 — Integrazione applicativa Alpha Chat", () => {
  // ── Alice → Bob: prima conversazione E2E ──────────────────────────────────

  it("Alice → Bob: primo messaggio E2E (PreKeyWhisperMessage)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    // Alice scarica il bundle di Bob e instaurazione sessione X3DH
    await buildSession(alice, bob, true);

    // Alice cifra il primo messaggio
    const ct = await encryptMessage(alice, "bob", 1, "Primo messaggio E2E");
    const ctBase64 = wrapBase64(ct); // simula transport base64

    // Il server vede solo ciphertext opaco
    expect(ctBase64.body).not.toContain("Primo messaggio E2E");
    expect(ctBase64.type).toBe(3); // PreKeyWhisperMessage

    // Bob riceve e decifra
    const ct2 = unwrapBase64(ctBase64); // simula ricezione lato Bob
    const plaintext = await decryptMessage(bob, "alice", 1, ct2);
    expect(plaintext).toBe("Primo messaggio E2E");
  });

  it("Bob → Alice: risposta (Double Ratchet, tipo 1)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    // Setup sessione
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    // Bob risponde
    const ct = await encryptMessage(bob, "alice", 1, "Risposta di Bob");
    expect(ct.type).toBe(1); // WhisperMessage (Double Ratchet)

    const plaintext = await decryptMessage(alice, "bob", 1, ct);
    expect(plaintext).toBe("Risposta di Bob");
  });

  it("Secondo messaggio usa Double Ratchet (body diverso dal primo)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const ct1 = await encryptMessage(bob, "alice", 1, "stesso testo");
    await decryptMessage(alice, "bob", 1, ct1);
    const ct2 = await encryptMessage(bob, "alice", 1, "stesso testo");
    await decryptMessage(alice, "bob", 1, ct2);

    // Corpo diverso = chiave di messaggio diversa (Double Ratchet)
    expect(ct1.body).not.toBe(ct2.body);
    expect(ct1.type).toBe(1);
    expect(ct2.type).toBe(1);
  });

  // ── Zero Plaintext Rule ───────────────────────────────────────────────────

  it("Server vede solo ciphertext (Zero Plaintext Rule)", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const sensitive = "Contenuto TOP SECRET che il server non deve vedere";
    const ct = await encryptMessage(alice, "bob", 1, sensitive);
    const ctBase64 = wrapBase64(ct);

    // Il body base64 non contiene il plaintext
    expect(ctBase64.body).not.toContain(sensitive);
    // Non contiene nemmeno il plaintext base64-encoded
    expect(ctBase64.body).not.toContain(btoa(sensitive));
    // Non contiene il plaintext come binary string
    expect(ct.body).not.toContain(sensitive);
  });

  // ── Sessione persistente (store riaperto) ─────────────────────────────────

  it("Sessione persistente: lo store mantiene la sessione tra operazioni successive", async () => {
    // Verifica che lo stesso store (rappresenta la persistenza su IndexedDB)
    // mantenga correttamente lo stato del Double Ratchet tra più operazioni.
    // Lo scenario "page reload" con IndexedDB è testato dall'IntegrationTest del frontend.
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);

    // Stabilisce sessione
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    // Più messaggi consecutivi — verifica che lo store (in-memory, come IndexedDB)
    // mantenga il ratchet state correttamente
    for (let i = 1; i <= 5; i++) {
      const ctA = await encryptMessage(alice, "bob", 1, `Alice → Bob #${i}`);
      const ptA = await decryptMessage(bob, "alice", 1, ctA);
      expect(ptA).toBe(`Alice → Bob #${i}`);

      const ctB = await encryptMessage(bob, "alice", 1, `Bob → Alice #${i}`);
      const ptB = await decryptMessage(alice, "bob", 1, ctB);
      expect(ptB).toBe(`Bob → Alice #${i}`);
    }
  });

  // ── Replay impossibile ────────────────────────────────────────────────────

  it("Replay impossibile: stessa coppia di chiavi → eccezione al secondo decrypt", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const ct = await encryptMessage(alice, "bob", 1, "Messaggio da riusare");
    const pt1 = await decryptMessage(bob, "alice", 1, ct);
    expect(pt1).toBe("Messaggio da riusare");

    // Replay: stessa coppia → eccezione
    await expect(decryptMessage(bob, "alice", 1, ct)).rejects.toThrow();
  });

  // ── Compatibilità legacy ──────────────────────────────────────────────────

  it("Compatibilità legacy: messaggi pre-Fase 2 decodificabili", () => {
    // I vecchi messaggi hanno ciphertext_type === null e body = btoa(plaintext)
    const plaintext = "Messaggio vecchio pre-Fase 2";
    const legacy = legacyEncode(plaintext);

    // Il legacy decoder recupera il plaintext
    expect(legacyDecode(legacy)).toBe(plaintext);

    // Il Signal decoder con type=null usa legacy decode
    // (testato qui come unità, senza sessione Signal)
    expect(legacyDecode(legacy)).toBe(plaintext);
  });

  it("Compatibilità legacy: i messaggi Signal non si scambiano con legacyDecode", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const ct = await encryptMessage(alice, "bob", 1, "Messaggio Signal");
    const ctBase64 = wrapBase64(ct);

    // legacyDecode su ciphertext Signal produce testo non valido o "[cifrato]"
    // (mai il plaintext originale)
    const legacyAttempt = legacyDecode(ctBase64.body);
    expect(legacyAttempt).not.toBe("Messaggio Signal");
  });

  // ── Multi-device invariato ────────────────────────────────────────────────

  it("Multi-device: sessioni alice.1 e alice.2 indipendenti", async () => {
    const sharedIdentityKey = await KeyHelper.generateIdentityKeyPair();
    const alice1 = await createPersona("alice", 1, 5, sharedIdentityKey);
    const alice2 = await createPersona("alice", 2, 5, sharedIdentityKey);
    const bob = await createPersona("bob", 1);

    await buildSession(bob, alice1, true);
    await buildSession(bob, alice2, true);

    // Messaggi per alice.1
    const ct1 = await encryptMessage(bob, "alice", 1, "Per device 1");
    const pt1 = await decryptMessage(alice1, "bob", 1, ct1);
    expect(pt1).toBe("Per device 1");

    // Messaggi per alice.2
    const ct2 = await encryptMessage(bob, "alice", 2, "Per device 2");
    const pt2 = await decryptMessage(alice2, "bob", 1, ct2);
    expect(pt2).toBe("Per device 2");

    // Cross-decrypt impossibile
    await expect(decryptMessage(alice2, "bob", 1, ct1)).rejects.toThrow();
  });

  // ── Secure Destroy cifrato ────────────────────────────────────────────────

  it("Secure Destroy: payload con secureDestroy=true cifrato correttamente", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const sdPayload = JSON.stringify({
      type: "system",
      content: "SECURE_DESTROY:msg-123",
      secureDestroy: true,
      timestamp: 1000000,
    });

    const ct = await encryptMessage(alice, "bob", 1, sdPayload);
    const ctBase64 = wrapBase64(ct);

    // Il server non vede il payload
    expect(ctBase64.body).not.toContain("SECURE_DESTROY");
    expect(ctBase64.body).not.toContain("secureDestroy");

    // Bob decifra e recupera il payload completo
    const ct2 = unwrapBase64(ctBase64);
    const pt = await decryptMessage(bob, "alice", 1, ct2);
    const decoded = JSON.parse(pt);
    expect(decoded.secureDestroy).toBe(true);
    expect(decoded.content).toBe("SECURE_DESTROY:msg-123");
  });

  // ── Burn After Read cifrato ───────────────────────────────────────────────

  it("BAR: payload burnAfterRead=true cifrato e sessione stabile dopo", async () => {
    const alice = await createPersona("alice", 1);
    const bob = await createPersona("bob", 1);
    await buildSession(alice, bob, true);
    const ct0 = await encryptMessage(alice, "bob", 1, "Setup");
    await decryptMessage(bob, "alice", 1, ct0);

    const barPayload = JSON.stringify({
      content: "Si autodistrugge",
      burnAfterRead: true,
      burnTtlSeconds: 5,
    });

    const ctBar = await encryptMessage(alice, "bob", 1, barPayload);
    const ptBar = await decryptMessage(bob, "alice", 1, ctBar);
    expect(JSON.parse(ptBar).burnAfterRead).toBe(true);

    // Sessione stabile dopo BAR
    const ctNext = await encryptMessage(alice, "bob", 1, "Normale dopo BAR");
    const ptNext = await decryptMessage(bob, "alice", 1, ctNext);
    expect(ptNext).toBe("Normale dopo BAR");
  });
});
