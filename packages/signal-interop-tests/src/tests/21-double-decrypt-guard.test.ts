/**
 * Test 21 — Double-decrypt guard: Path C in ChatPage.decryptSingleMsg
 *
 * Contesto:
 *   ChatPage.decryptSingleMsg ha tre percorsi per i messaggi ricevuti:
 *
 *   Path A — gruppi con device_ciphertexts   → IDB cache guard ✅ (riga 784)
 *   Path B — 1:1 con device_ciphertexts      → IDB cache guard ✅ (riga 860)
 *   Path C — 1:1 senza device_ciphertexts    → IDB cache guard ❌ (bug, fix applicato)
 *
 *   Il Path C è attivo quando device_ciphertexts è vuoto (es. bundle Signal non
 *   disponibile sul server → fan-out produce 0 entry). In questo caso, il client
 *   chiama signalDecrypt() direttamente sul campo ciphertext del messaggio.
 *
 *   Al WS reconnect (false→true in useEffect riga 1039), decryptBatch() viene
 *   rieseguito su tutti i messaggi già in state. Senza il cache guard, Path C
 *   chiama signalDecrypt() una seconda volta sullo stesso messaggio.
 *
 * Nota sul tipo dei messaggi:
 *   Dopo il primo encrypt() di Alice (type=3, PreKeyWhisperMessage), Alice rimane
 *   in "pending prekey" finché non riceve una risposta da Bob. Gli encrypt() successivi
 *   di Alice sono ancora type=3.
 *   Bob invece, dopo aver decifrato il type=3 di Alice, può rispondere con type=1
 *   (WhisperMessage) immediatamente — è il session-builder a generare il tipo corretto.
 *   I test usano quindi BOB come mittente del WhisperMessage (type=1) per testare il
 *   comportamento del double-decrypt su messaggi di tipo 1.
 *
 * Cosa dimostrano questi test:
 *
 *   21.A — Il secondo decrypt sullo stesso WhisperMessage (type=1) inviato da Bob
 *           FALLISCE con un'eccezione reale (Bad MAC o counter mismatch).
 *           Prova che senza cache guard, il catch di decryptSingleMsg produce
 *           "[Messaggio non decifrabile]" su un messaggio già decifrato correttamente.
 *
 *   21.B — Il secondo decrypt sullo stesso PreKeyWhisperMessage (type=3) FALLISCE.
 *           Conferma il pattern: OTPK già consumata → secondo tentativo → eccezione.
 *
 *   21.C — Pattern cache guard: se il plaintext è già disponibile (IDB cache),
 *           il secondo decrypt Signal viene bypassato completamente.
 *
 *   21.D — Robustezza del ratchet: dopo un tentativo fallito su M, il messaggio
 *           M+1 (diverso) può ancora essere decifrato correttamente.
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

// ---------------------------------------------------------------------------
// Helper condiviso: stabilisce la sessione Alice → Bob e verifica che Bob
// possa rispondere con un WhisperMessage (type=1) subito dopo.
// ---------------------------------------------------------------------------

async function setupAndOpenSession(tag: string): Promise<{
  alice: Awaited<ReturnType<typeof createPersona>>;
  bob:   Awaited<ReturnType<typeof createPersona>>;
}> {
  const alice = await createPersona(`alice-21-${tag}`, 1, 5);
  const bob   = await createPersona(`bob-21-${tag}`,   1, 5);

  // Alice esegue X3DH verso Bob e invia il PreKeyWhisperMessage (type=3)
  await buildSession(alice, bob);
  const opener = await encryptMessage(alice, bob.name, bob.deviceId, "open");
  expect(opener.type).toBe(3);

  // Bob decifra l'opener: da questo momento Bob ha una sessione attiva con Alice
  // e può rispondere con WhisperMessage (type=1, senza pendingPreKey)
  const openerText = await decryptMessage(bob, alice.name, alice.deviceId, opener);
  expect(openerText).toBe("open");

  return { alice, bob };
}

// ---------------------------------------------------------------------------
// Test 21.A — Il secondo decrypt di un WhisperMessage (type=1) da Bob fallisce
// ---------------------------------------------------------------------------

describe("21.A — secondo decrypt WhisperMessage (type=1) fallisce", () => {
  it("21.A.1 — primo decrypt riuscito; secondo tentativo sullo stesso body lancia eccezione", async () => {
    const { alice, bob } = await setupAndOpenSession("a1");

    // Bob invia un WhisperMessage a Alice (type=1 — Bob non ha pendingPreKey)
    const msg = await encryptMessage(bob, alice.name, alice.deviceId, "Ggghu");
    expect(msg.type).toBe(1); // ← deve essere type=1

    // ── Primo decrypt (Alice): deve riuscire ──
    const firstResult = await decryptMessage(alice, bob.name, bob.deviceId, msg);
    expect(firstResult).toBe("Ggghu");

    // ── Secondo decrypt (stesso body/type): DEVE fallire ──
    // Questo è ciò che accade in Path C senza il cache guard: decryptBatch al
    // WS reconnect chiama signalDecrypt sullo stesso messaggio già decifrato.
    // Il Double Ratchet ha avanzato il suo stato → il secondo tentativo
    // produce un'eccezione che il catch trasforma in "[Messaggio non decifrabile]".
    await expect(
      decryptMessage(alice, bob.name, bob.deviceId, msg),
    ).rejects.toThrow();
  });

  it("21.A.2 — l'eccezione del secondo decrypt è un Error reale (non reject vuoto)", async () => {
    const { alice, bob } = await setupAndOpenSession("a2");

    const msg = await encryptMessage(bob, alice.name, alice.deviceId, "Cffg");
    expect(msg.type).toBe(1);
    await decryptMessage(alice, bob.name, bob.deviceId, msg);

    // Cattura l'eccezione per verificare che sia un Error concreto
    let caughtError: unknown = null;
    try {
      await decryptMessage(alice, bob.name, bob.deviceId, msg);
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError).toBeInstanceOf(Error);
    // La presenza di un Error reale motiva il guard nel catch di decryptSingleMsg:
    // senza protezione, questo errore sovrascrive il plaintext già in state.
    expect((caughtError as Error).message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 21.B — Il secondo decrypt di un PreKeyWhisperMessage (type=3) fallisce
// ---------------------------------------------------------------------------

describe("21.B — secondo decrypt PreKeyWhisperMessage (type=3) fallisce", () => {
  it("21.B.1 — secondo tentativo type=3 lancia eccezione (OTPK già consumata)", async () => {
    const alice = await createPersona("alice-21-b1", 1, 5);
    const bob   = await createPersona("bob-21-b1",   1, 5);

    await buildSession(alice, bob);
    const opener = await encryptMessage(alice, bob.name, bob.deviceId, "primo");
    expect(opener.type).toBe(3);

    // Primo decrypt: stabilisce la sessione, OTPK consumata
    const firstResult = await decryptMessage(bob, alice.name, alice.deviceId, opener);
    expect(firstResult).toBe("primo");

    // Secondo tentativo sullo stesso type=3: OTPK già rimossa → errore
    await expect(
      decryptMessage(bob, alice.name, alice.deviceId, opener),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 21.C — Il cache guard bypassa il secondo tentativo Signal
// ---------------------------------------------------------------------------

describe("21.C — pattern cache guard: IDB lookup bypassa il secondo decrypt", () => {
  it("21.C.1 — se il plaintext è già in cache, il secondo decrypt Signal non viene chiamato", async () => {
    const { alice, bob } = await setupAndOpenSession("c1");

    const msg = await encryptMessage(bob, alice.name, alice.deviceId, "Fggiiugy");
    expect(msg.type).toBe(1);

    // ── Primo decrypt: plaintext ottenuto e "salvato in cache" ──
    const firstResult = await decryptMessage(alice, bob.name, bob.deviceId, msg);
    expect(firstResult).toBe("Fggiiugy");

    // Simula getMetaByMessageId(msgId) → il valore cached è disponibile
    const cachedPlaintext: string | null = firstResult;

    // ── Simulazione del fix in Path C ──
    // Prima di chiamare signalDecrypt, controlla la cache IDB.
    // Se disponibile → restituisci direttamente, senza toccare il ratchet.
    const resultFromCache = cachedPlaintext ?? await decryptMessage(alice, bob.name, bob.deviceId, msg);
    expect(resultFromCache).toBe("Fggiiugy"); // ✅ Plaintext preservato

    // Conferma che il secondo decrypt diretto (senza cache guard) avrebbe fallito:
    // è questo il comportamento che il fix in ChatPage.tsx previene.
    await expect(
      decryptMessage(alice, bob.name, bob.deviceId, msg),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 21.D — Il ratchet di Bob rimane usabile dopo un decrypt fallito
// ---------------------------------------------------------------------------

describe("21.D — il ratchet rimane usabile dopo un fallimento", () => {
  it("21.D.1 — il messaggio M+1 viene decifrato dopo il fallimento del re-decrypt di M", async () => {
    const { alice, bob } = await setupAndOpenSession("d1");

    // Bob invia msg1
    const msg1 = await encryptMessage(bob, alice.name, alice.deviceId, "primo");
    expect(msg1.type).toBe(1);

    // Alice decifra msg1 correttamente
    const first = await decryptMessage(alice, bob.name, bob.deviceId, msg1);
    expect(first).toBe("primo");

    // Alice tenta di ridecifrate msg1 (simula WS reconnect senza cache guard) → fallisce
    await expect(
      decryptMessage(alice, bob.name, bob.deviceId, msg1),
    ).rejects.toThrow();

    // Bob invia msg2 — ciphertext DIVERSO, ratchet avanzato da Bob
    const msg2 = await encryptMessage(bob, alice.name, alice.deviceId, "secondo");
    expect(msg2.type).toBe(1);

    // Alice decifra msg2: il fallimento sul re-decrypt di msg1 non ha
    // corrotto il ratchet di Alice — msg2 è un nuovo ciphertext.
    const second = await decryptMessage(alice, bob.name, bob.deviceId, msg2);
    expect(second).toBe("secondo");
  });
});
