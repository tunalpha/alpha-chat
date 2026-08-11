/**
 * Test — Alpha Wallet: Flussi Create / Import / Lock / Unlock / Backup
 *
 * Verifica i flussi principali del wallet senza UI:
 * - createMnemonic + encryptSeed + decryptSeed
 * - importWallet: mnemonic valida → crea keystore
 * - PIN errato → eccezione
 * - markBackupVerified
 * - validatePin / pinValidationError
 *
 * Nota: WalletContext usa React hooks e non può essere testato qui.
 * I test delle funzioni core (crypto) sono in keystore.test.ts e mnemonic.test.ts.
 * Questo file testa l'integrazione dei flow a livello di funzioni pure.
 */

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMnemonic, isValidMnemonic } from "@/wallet/core/mnemonic";
import { deriveEvmAddress, deriveBtcAddress } from "@/wallet/core/hd-wallet";
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
import {
  validatePin,
  pinValidationError,
  normalizePin,
  isWebAuthnAvailable,
  getBestAuthMethod,
  recordAuthSuccess,
  invalidateSession,
  isSessionValid,
  WALLET_SESSION_TIMEOUT_MS,
} from "@/wallet/core/wallet-auth";

const VALID_PIN = "123456";
const WRONG_PIN = "654321";
const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

// ─── PIN Validation ────────────────────────────────────────────────────────

describe("validatePin", () => {
  it("accetta PIN di 6 cifre", () => {
    expect(validatePin("123456")).toBe(true);
  });
  it("accetta PIN di 8 cifre", () => {
    expect(validatePin("12345678")).toBe(true);
  });
  it("rifiuta PIN di 5 cifre", () => {
    expect(validatePin("12345")).toBe(false);
  });
  it("rifiuta PIN con lettere", () => {
    expect(validatePin("1234ab")).toBe(false);
  });
  it("rifiuta stringa vuota", () => {
    expect(validatePin("")).toBe(false);
  });
  it("rifiuta PIN con spazi", () => {
    expect(validatePin("123 456")).toBe(false);
  });
});

describe("pinValidationError", () => {
  it("nessun errore per PIN valido", () => {
    expect(pinValidationError("123456")).toBeNull();
  });
  it("errore per stringa vuota", () => {
    expect(pinValidationError("")).not.toBeNull();
  });
  it("errore per PIN con lettere", () => {
    expect(pinValidationError("abc123")).not.toBeNull();
  });
  it("errore per PIN troppo corto", () => {
    expect(pinValidationError("12345")).not.toBeNull();
  });
});

describe("normalizePin", () => {
  it("rimuove spazi", () => {
    expect(normalizePin("  123456  ")).toBe("123456");
  });
});

// ─── Sessione wallet ───────────────────────────────────────────────────────

describe("Wallet session", () => {
  afterEach(() => invalidateSession());

  it("isSessionValid è false inizialmente", () => {
    invalidateSession();
    expect(isSessionValid()).toBe(false);
  });

  it("isSessionValid è true dopo recordAuthSuccess", () => {
    recordAuthSuccess();
    expect(isSessionValid()).toBe(true);
  });

  it("invalidateSession resetta la sessione", () => {
    recordAuthSuccess();
    invalidateSession();
    expect(isSessionValid()).toBe(false);
  });

  it("WALLET_SESSION_TIMEOUT_MS è 15 minuti", () => {
    expect(WALLET_SESSION_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});

// ─── Flusso Create ────────────────────────────────────────────────────────

describe("Flusso Create Wallet", () => {
  afterEach(() => { closeWalletDB(); });
  beforeEach(async () => { closeWalletDB(); await clearKeystore(); });

  it("createMnemonic genera seed valida", () => {
    const m = createMnemonic();
    expect(isValidMnemonic(m)).toBe(true);
  });

  it("pipeline: mnemonic → encrypt → save → load → decrypt", async () => {
    const mnemonic = createMnemonic();
    const entry = await encryptSeed(mnemonic, VALID_PIN);
    await saveKeystore(entry);

    const loaded = await loadKeystore();
    expect(loaded).not.toBeNull();

    const recovered = await decryptSeed(loaded!, VALID_PIN);
    expect(recovered).toBe(mnemonic);
  });

  it("hasKeystore è true dopo il save", async () => {
    const entry = await encryptSeed(HARDHAT_MNEMONIC, VALID_PIN);
    await saveKeystore(entry);
    expect(await hasKeystore()).toBe(true);
  });

  it("PIN errato → eccezione appropriata", async () => {
    const entry = await encryptSeed(HARDHAT_MNEMONIC, VALID_PIN);
    await saveKeystore(entry);
    const loaded = await loadKeystore();
    await expect(decryptSeed(loaded!, WRONG_PIN)).rejects.toThrow();
  });

  it("wallet meta salvato con evmAddress e btcAddress", async () => {
    const evmAddress = await deriveEvmAddress(HARDHAT_MNEMONIC);
    const btcAddress = await deriveBtcAddress(HARDHAT_MNEMONIC);
    const meta = {
      evmAddress,
      btcAddress,
      backupVerified: false,
      createdAt: Date.now(),
    };
    const entry = await encryptSeed(HARDHAT_MNEMONIC, VALID_PIN);
    await saveKeystore(entry);
    await saveWalletMeta(meta);

    const loadedMeta = await loadWalletMeta();
    expect(loadedMeta?.evmAddress).toBe(evmAddress);
    expect(loadedMeta?.btcAddress).toBe(btcAddress);
    expect(loadedMeta?.backupVerified).toBe(false);
  });
});

// ─── Flusso Import ────────────────────────────────────────────────────────

describe("Flusso Import Wallet", () => {
  afterEach(() => { closeWalletDB(); });
  beforeEach(async () => { closeWalletDB(); await clearKeystore(); });

  it("mnemonic valida → indirizzo EVM deterministico", async () => {
    if (!isValidMnemonic(HARDHAT_MNEMONIC)) throw new Error("Test mnemonic non valida");
    const addr = await deriveEvmAddress(HARDHAT_MNEMONIC);
    expect(addr.toLowerCase()).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
  });

  it("mnemonic invalida → isValidMnemonic restituisce false", () => {
    expect(isValidMnemonic("parola sbagliata test test")).toBe(false);
    expect(isValidMnemonic("")).toBe(false);
    expect(isValidMnemonic("abandon abandon abandon")).toBe(false);
  });

  it("import da mnemonic: encrypt con nuovo PIN", async () => {
    const entry = await encryptSeed(HARDHAT_MNEMONIC, "987654");
    await saveKeystore(entry);
    const loaded = await loadKeystore();
    const recovered = await decryptSeed(loaded!, "987654");
    expect(recovered).toBe(HARDHAT_MNEMONIC);
  });
});

// ─── Backup Obbligatorio ──────────────────────────────────────────────────

describe("Backup obbligatorio", () => {
  afterEach(() => { closeWalletDB(); });
  beforeEach(async () => { closeWalletDB(); await clearKeystore(); });

  it("backupVerified è false alla creazione", async () => {
    const entry = await encryptSeed(HARDHAT_MNEMONIC, VALID_PIN);
    await saveKeystore(entry);
    await saveWalletMeta({
      evmAddress: await deriveEvmAddress(HARDHAT_MNEMONIC),
      btcAddress: await deriveBtcAddress(HARDHAT_MNEMONIC),
      backupVerified: false,
      createdAt: Date.now(),
    });
    const meta = await loadWalletMeta();
    expect(meta?.backupVerified).toBe(false);
  });

  it("markBackupVerified imposta backupVerified = true", async () => {
    const entry = await encryptSeed(HARDHAT_MNEMONIC, VALID_PIN);
    await saveKeystore(entry);
    await saveWalletMeta({
      evmAddress: await deriveEvmAddress(HARDHAT_MNEMONIC),
      btcAddress: await deriveBtcAddress(HARDHAT_MNEMONIC),
      backupVerified: false,
      createdAt: Date.now(),
    });
    await markBackupVerified();
    const meta = await loadWalletMeta();
    expect(meta?.backupVerified).toBe(true);
  });
});

// ─── WebAuthn ─────────────────────────────────────────────────────────────

describe("WebAuthn availability", () => {
  it("isWebAuthnAvailable non lancia eccezioni in ambiente test", async () => {
    const result = await isWebAuthnAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("getBestAuthMethod restituisce 'pin' o 'webauthn'", async () => {
    const method = await getBestAuthMethod();
    expect(["pin", "webauthn"]).toContain(method);
  });
});
