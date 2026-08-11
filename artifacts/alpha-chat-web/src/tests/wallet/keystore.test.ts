/**
 * Test — Alpha Wallet Core: Keystore (AES-256-GCM)
 *
 * Verifica:
 * - Cifratura/decifratura roundtrip
 * - PIN errato → eccezione (non silenzioso)
 * - IV e salt diversi ad ogni cifratura (no IV reuse)
 * - Struttura KeystoreEntry valida
 * - Persistenza IndexedDB (save/load)
 *
 * SICUREZZA: verifica che la seed phrase non sia in chiaro nel keystore.
 *
 * Usa fake-indexeddb perché happy-dom non espone `indexedDB` come global bare.
 */

// Polyfill IndexedDB per test Node.js / happy-dom
import "fake-indexeddb/auto";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptSeed,
  decryptSeed,
  saveKeystore,
  loadKeystore,
  hasKeystore,
  clearKeystore,
  saveWalletMeta,
  loadWalletMeta,
  markBackupVerified,
  closeWalletDB,
} from "@/wallet/core/keystore";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const TEST_PIN = "123456";
const WRONG_PIN = "999999";

describe("encryptSeed", () => {
  it("restituisce un KeystoreEntry con tutti i campi obbligatori", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    expect(entry.version).toBe(1);
    expect(typeof entry.encryptedSeed).toBe("string");
    expect(typeof entry.iv).toBe("string");
    expect(typeof entry.salt).toBe("string");
    expect(typeof entry.iterations).toBe("number");
    expect(typeof entry.createdAt).toBe("number");
  });

  it("iterations è almeno 100.000", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    expect(entry.iterations).toBeGreaterThanOrEqual(100_000);
  });

  it("la seed phrase NON compare in chiaro nel ciphertext (base64)", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    // Il keystore non deve contenere la seed in chiaro
    const json = JSON.stringify(entry);
    expect(json).not.toContain(TEST_MNEMONIC);
    expect(json).not.toContain("test test");
  });

  it("IV diverso ad ogni cifratura (no IV reuse)", async () => {
    const e1 = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    const e2 = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    expect(e1.iv).not.toBe(e2.iv);
  });

  it("salt diverso ad ogni cifratura", async () => {
    const e1 = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    const e2 = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    expect(e1.salt).not.toBe(e2.salt);
  });

  it("ciphertext diverso ad ogni cifratura (IV diverso garantisce questo)", async () => {
    const e1 = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    const e2 = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    expect(e1.encryptedSeed).not.toBe(e2.encryptedSeed);
  });
});

describe("decryptSeed", () => {
  it("roundtrip: decifra la seed originale con il PIN corretto", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    const recovered = await decryptSeed(entry, TEST_PIN);
    expect(recovered).toBe(TEST_MNEMONIC);
  });

  it("lancia un'eccezione con PIN sbagliato", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    await expect(decryptSeed(entry, WRONG_PIN)).rejects.toThrow();
  });

  it("l'eccezione per PIN errato non rivela la seed phrase", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    try {
      await decryptSeed(entry, WRONG_PIN);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(TEST_MNEMONIC);
    }
  });

  it("decifra correttamente seed phrase a 24 parole", async () => {
    const long =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
    const entry = await encryptSeed(long, TEST_PIN);
    const recovered = await decryptSeed(entry, TEST_PIN);
    expect(recovered).toBe(long);
  });

  it("PIN diverso (stesso salt/iv) → eccezione", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    // Modifica il pin di un carattere
    await expect(decryptSeed(entry, "123457")).rejects.toThrow();
  });
});

describe("IndexedDB persistence", () => {
  afterEach(() => {
    // Chiude e resetta il DB singleton tra i test per isolamento
    closeWalletDB();
  });

  beforeEach(async () => {
    closeWalletDB();
    await clearKeystore();
  });

  it("hasKeystore() è false prima della creazione", async () => {
    const has = await hasKeystore();
    expect(has).toBe(false);
  });

  it("saveKeystore + loadKeystore roundtrip", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    await saveKeystore(entry);
    const loaded = await loadKeystore();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.encryptedSeed).toBe(entry.encryptedSeed);
  });

  it("hasKeystore() è true dopo il save", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    await saveKeystore(entry);
    expect(await hasKeystore()).toBe(true);
  });

  it("clearKeystore() rimuove il wallet", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    await saveKeystore(entry);
    await clearKeystore();
    expect(await hasKeystore()).toBe(false);
  });

  it("il keystore salvato e ricaricato permette la decifratura", async () => {
    const entry = await encryptSeed(TEST_MNEMONIC, TEST_PIN);
    await saveKeystore(entry);
    const loaded = await loadKeystore();
    const recovered = await decryptSeed(loaded!, TEST_PIN);
    expect(recovered).toBe(TEST_MNEMONIC);
  });
});

describe("WalletMeta persistence", () => {
  afterEach(() => {
    closeWalletDB();
  });

  beforeEach(async () => {
    closeWalletDB();
    await clearKeystore();
  });

  it("salva e ricarica i metadati del wallet", async () => {
    const meta = {
      evmAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`,
      btcAddress: "bc1qtest",
      backupVerified: false,
      createdAt: Date.now(),
    };
    await saveWalletMeta(meta);
    const loaded = await loadWalletMeta();
    expect(loaded).not.toBeNull();
    expect(loaded!.evmAddress).toBe(meta.evmAddress);
    expect(loaded!.btcAddress).toBe(meta.btcAddress);
    expect(loaded!.backupVerified).toBe(false);
  });

  it("markBackupVerified imposta backupVerified = true", async () => {
    await saveWalletMeta({
      evmAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`,
      btcAddress: "bc1qtest",
      backupVerified: false,
      createdAt: Date.now(),
    });
    await markBackupVerified();
    const loaded = await loadWalletMeta();
    expect(loaded!.backupVerified).toBe(true);
  });
});
