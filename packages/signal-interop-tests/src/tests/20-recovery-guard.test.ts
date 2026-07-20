/**
 * Test 20 — Recovery guard: signal-messenger.ts
 *
 * Verifica che la condizione:
 *
 *   firstErr instanceof Error && firstErr.message.startsWith("Unknown identity key")
 *
 * distingua correttamente i due scenari nel ramo di recovery di signalDecrypt():
 *
 *   A. Trust store obsoleto → errore "Unknown identity key" → recovery utile
 *   B. OTPK privata consumata → errore "Bad MAC"           → recovery inutile
 *
 * ─── Nota critica sulla sincronia di processV3 ──────────────────────────────
 * session-builder.js:230 (libsignal v0.0.16) chiama isTrustedIdentity SENZA yield:
 *
 *   const trusted = this.storage.isTrustedIdentity(name, ik, Direction.RECEIVING);
 *
 * Con store async (come key-store.ts in produzione), trusted riceve una Promise
 * (sempre truthy): il check `if (!trusted)` non scatta mai. "Unknown identity key"
 * è quindi irraggiungibile in produzione con il nostro store async.
 *
 * Conseguenza: la condizione startsWith("Unknown identity key") non si attiva mai
 * in produzione → il recovery è di fatto disabilitato → il consumo anomalo di OTPK
 * si interrompe. I test 20.A usano un SyncTrustStore (isTrustedIdentity sincrono)
 * per dimostrare che la libreria lancia effettivamente quell'errore e che il recovery
 * funziona nel caso teorico in cui il trust check scatti.
 *
 * Riferimento: @privacyresearch/libsignal-protocol-typescript v0.0.16 (congelato, ADR-001)
 *   "Unknown identity key" → session-builder.js:232 (non-awaited, raggiungibile solo con store sincrono)
 *   "Bad MAC"              → internal/crypto.js:154 (yielded, raggiungibile normalmente)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { initLibsignal } from "../helpers/setup.js";
import { buildSession, buildDeviceBundle, type Persona } from "../helpers/utils.js";
import { TestSignalStore } from "../helpers/test-store.js";
// @ts-ignore
import { KeyHelper, SessionCipher, SignalProtocolAddress } from "@privacyresearch/libsignal-protocol-typescript";

beforeAll(async () => {
  await initLibsignal();
});

// ---------------------------------------------------------------------------
// SyncTrustStore — isTrustedIdentity SINCRONO
//
// Necessario perché processV3 (session-builder.js:230) non awaita il trust check.
// Con questo store, il check funziona come previsto dalla spec Signal.
// ---------------------------------------------------------------------------

class SyncTrustStore extends TestSignalStore {
  private _trust: boolean;

  constructor(initialTrust: boolean) {
    super();
    this._trust = initialTrust;
  }

  setTrust(v: boolean): void {
    this._trust = v;
  }

  /**
   * Override SINCRONO di isTrustedIdentity.
   * processV3 chiama questo senza yield → deve restituire boolean, non Promise.
   * Con return true: trust check passa → X3DH → decrypt.
   * Con return false: trust check fallisce → "Unknown identity key".
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override isTrustedIdentity(_id: string, _ik: ArrayBuffer, _dir: any): any {
    return this._trust;
  }
}

// ---------------------------------------------------------------------------
// Helper: crea una Persona con store personalizzato
// ---------------------------------------------------------------------------

async function createPersonaWithStore<S extends TestSignalStore>(
  name: string,
  deviceId: number,
  otpkCount: number,
  store: S,
): Promise<Persona & { store: S }> {
  const identityKey = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKeyId = 1;
  const spk = await KeyHelper.generateSignedPreKey(identityKey, signedPreKeyId);

  store.storeOwnIdentity(identityKey, registrationId);
  await store.storeSignedPreKey(signedPreKeyId, spk.keyPair);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oneTimePreKeys: any[] = [];
  for (let i = 1; i <= otpkCount; i++) {
    const otpk = await KeyHelper.generatePreKey(i);
    await store.storePreKey(otpk.keyId, otpk.keyPair);
    oneTimePreKeys.push({ keyId: otpk.keyId, keyPair: otpk.keyPair });
  }

  return {
    name, deviceId, store, identityKey, registrationId,
    signedPreKeyId,
    signedPreKey: spk.keyPair,
    signedPreKeySignature: spk.signature,
    oneTimePreKeys,
  };
}

// ---------------------------------------------------------------------------
// Helper: tenta il decrypt e restituisce l'errore
// ---------------------------------------------------------------------------

async function tryDecryptPreKey(
  cipher: InstanceType<typeof SessionCipher>,
  body: string,
): Promise<Error> {
  try {
    await cipher.decryptPreKeyWhisperMessage(body, "binary");
    throw new Error("TEST-BUG: decrypt avrebbe dovuto fallire ma ha avuto successo");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("TEST-BUG:")) throw e;
    return e instanceof Error ? e : new Error(String(e));
  }
}

// ---------------------------------------------------------------------------
// Scenario A — "Unknown identity key" (SyncTrustStore, trust=false)
// ---------------------------------------------------------------------------

describe("20.A — Trust store obsoleto: Unknown identity key", () => {
  it("20.A.1 — processV3 lancia 'Unknown identity key' con store sincrono che ritorna false", async () => {
    // Alice: store normale (mittente)
    const alice = await createPersonaWithStore("alice-20a1", 1, 0, new TestSignalStore());

    // Bob: SyncTrustStore con trust=false (ricevente)
    // trust=false sincrono → processV3 vede false (non Promise) → lancia "Unknown identity key"
    const bobStore = new SyncTrustStore(false);
    const bob = await createPersonaWithStore("bob-20a1", 1, 0, bobStore);

    // Alice costruisce la sessione verso Bob (senza OTPK per semplicità) e cifra
    await buildSession(alice, bob, false);
    const addr   = new SignalProtocolAddress("alice-20a1", 1);
    const cipher = new SessionCipher(bob.store, addr);

    // Cifra da Alice
    const aliceAddr   = new SignalProtocolAddress("bob-20a1", 1);
    const aliceCipher = new SessionCipher(alice.store, aliceAddr);
    const ct = await aliceCipher.encrypt(new TextEncoder().encode("messaggio test").buffer as ArrayBuffer);
    expect(ct.type).toBe(3); // PreKeyWhisperMessage

    // Decrypt con trust=false → "Unknown identity key"
    const err = await tryDecryptPreKey(cipher, ct.body as string);

    // Verifica A: la libreria lancia effettivamente "Unknown identity key"
    expect(err.message).toMatch(/^Unknown identity key/);

    // Verifica B: la condizione usata in signal-messenger.ts è VERA → recovery attivato
    expect(err.message.startsWith("Unknown identity key")).toBe(true);
  });

  it("20.A.2 — Dopo setTrust(true), il retry del decrypt ha successo (recovery funziona)", async () => {
    const alice = await createPersonaWithStore("alice-20a2", 1, 0, new TestSignalStore());

    const bobStore = new SyncTrustStore(false);
    const bob = await createPersonaWithStore("bob-20a2", 1, 0, bobStore);

    await buildSession(alice, bob, false);

    const aliceAddr   = new SignalProtocolAddress("bob-20a2", 1);
    const aliceCipher = new SessionCipher(alice.store, aliceAddr);
    const ct = await aliceCipher.encrypt(new TextEncoder().encode("recovery OK").buffer as ArrayBuffer);

    const addr   = new SignalProtocolAddress("alice-20a2", 1);
    const cipher = new SessionCipher(bob.store, addr);

    // Primo tentativo → "Unknown identity key" (trust=false)
    const firstErr = await tryDecryptPreKey(cipher, ct.body as string);
    expect(firstErr.message).toMatch(/^Unknown identity key/);

    // Simula recovery: aggiorna il trust (come fa rebuildSession → saveIdentity)
    // Ora il trust check passerà al secondo tentativo
    bobStore.setTrust(true);

    // Secondo tentativo → deve avere successo (trust=true, stessa sessione non ancora scritta)
    const plainBuf = await cipher.decryptPreKeyWhisperMessage(ct.body as string, "binary");
    const result = new TextDecoder().decode(plainBuf as ArrayBuffer);
    expect(result).toBe("recovery OK");
  });
});

// ---------------------------------------------------------------------------
// Scenario B — "Bad MAC" (OTPK privata consumata)
// ---------------------------------------------------------------------------

describe("20.B — OTPK privata consumata: Bad MAC", () => {
  it("20.B.1 — Quando loadPreKey() restituisce undefined, la libreria lancia 'Bad MAC'", async () => {
    const alice = await createPersonaWithStore("alice-20b1", 1, 0, new TestSignalStore());
    // Bob con 1 OTPK in IDB, store normale (isTrustedIdentity async → TOFU pass)
    const bob = await createPersonaWithStore("bob-20b1", 1, 1, new TestSignalStore());

    // Alice costruisce sessione usando l'OTPK pubblica #1 di Bob
    await buildSession(alice, bob, true);

    const aliceAddr   = new SignalProtocolAddress("bob-20b1", 1);
    const aliceCipher = new SessionCipher(alice.store, aliceAddr);
    const ct = await aliceCipher.encrypt(new TextEncoder().encode("con OTPK").buffer as ArrayBuffer);
    expect(ct.type).toBe(3); // preKeyId=1 embedded nel ciphertext

    // Rimuove la chiave privata OTPK #1 da IDB di Bob — simula "già consumata"
    await bob.store.removePreKey(1);
    expect(await bob.store.loadPreKey(1)).toBeUndefined();

    const addr   = new SignalProtocolAddress("alice-20b1", 1);
    const cipher = new SessionCipher(bob.store, addr);

    const err = await tryDecryptPreKey(cipher, ct.body as string);

    // processV3: loadPreKey(1) → undefined → X3DH senza OTPK → shared secret sbagliato → "Bad MAC"
    // (la libreria continua silenziosamente senza OTPK: session-builder.js commento a riga ~257)
    expect(err.message).toBe("Bad MAC");

    // Verifica A: l'errore NON soddisfa la condizione di recovery → recovery non attivato
    expect(err.message.startsWith("Unknown identity key")).toBe(false);
  });

  it("20.B.2 — Il retry dopo 'Bad MAC' fallisce di nuovo (recovery strutturalmente inutile)", async () => {
    const alice = await createPersonaWithStore("alice-20b2", 1, 0, new TestSignalStore());
    const bob   = await createPersonaWithStore("bob-20b2", 1, 1, new TestSignalStore());

    await buildSession(alice, bob, true);

    const aliceAddr   = new SignalProtocolAddress("bob-20b2", 1);
    const aliceCipher = new SessionCipher(alice.store, aliceAddr);
    const ct = await aliceCipher.encrypt(new TextEncoder().encode("no recovery").buffer as ArrayBuffer);

    // Rimuove OTPK #1 — simula chiave già consumata
    await bob.store.removePreKey(1);

    const addr   = new SignalProtocolAddress("alice-20b2", 1);
    const cipher = new SessionCipher(bob.store, addr);

    // Primo tentativo → Bad MAC
    const firstErr = await tryDecryptPreKey(cipher, ct.body as string);
    expect(firstErr.message).toBe("Bad MAC");

    // Secondo tentativo senza modifiche allo stato (simulazione del retry nel recovery):
    // la chiave privata OTPK #1 è ancora assente → stesso shared secret sbagliato → ancora Bad MAC.
    // Dimostra che il retry non cambia l'esito: la chiave privata OTPK non è recuperabile.
    const secondErr = await tryDecryptPreKey(cipher, ct.body as string);
    expect(secondErr.message).toBe("Bad MAC");
  });
});
