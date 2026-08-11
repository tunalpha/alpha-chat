/**
 * Test — Alpha Wallet Core: Mnemonic (BIP-39)
 *
 * Verifica:
 * - Generazione seed phrase valida
 * - Validazione formato
 * - Conteggio parole
 * - Normalizzazione
 * - Conversione in seed bytes
 */

import { describe, it, expect } from "vitest";
import {
  createMnemonic,
  isValidMnemonic,
  mnemonicWordCount,
  mnemonicToSeedBytes,
  normalizeMnemonic,
} from "@/wallet/core/mnemonic";

// Mnemonic di test noto — Hardhat test mnemonic (pubblico, solo per test)
const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

describe("createMnemonic", () => {
  it("genera una seed phrase di 12 parole (default)", () => {
    const m = createMnemonic();
    const words = m.trim().split(/\s+/);
    expect(words).toHaveLength(12);
  });

  it("genera una seed phrase di 24 parole (256 bit)", () => {
    const m = createMnemonic(256);
    const words = m.trim().split(/\s+/);
    expect(words).toHaveLength(24);
  });

  it("genera seed phrase diversa ad ogni chiamata", () => {
    const a = createMnemonic();
    const b = createMnemonic();
    expect(a).not.toBe(b);
  });

  it("la seed phrase generata è valida BIP-39", () => {
    const m = createMnemonic();
    expect(isValidMnemonic(m)).toBe(true);
  });

  it("la seed phrase a 24 parole è valida BIP-39", () => {
    const m = createMnemonic(256);
    expect(isValidMnemonic(m)).toBe(true);
  });
});

describe("isValidMnemonic", () => {
  it("accetta la Hardhat test mnemonic", () => {
    expect(isValidMnemonic(HARDHAT_MNEMONIC)).toBe(true);
  });

  it("rifiuta una stringa casuale", () => {
    expect(isValidMnemonic("hello world foo bar")).toBe(false);
  });

  it("rifiuta stringa vuota", () => {
    expect(isValidMnemonic("")).toBe(false);
  });

  it("rifiuta mnemonic con 11 parole", () => {
    const words = HARDHAT_MNEMONIC.split(" ").slice(0, 11).join(" ");
    expect(isValidMnemonic(words)).toBe(false);
  });

  it("rifiuta parole non nella wordlist BIP-39", () => {
    expect(isValidMnemonic("invalidword " + HARDHAT_MNEMONIC)).toBe(false);
  });

  it("accetta mnemonic con spazi extra (normalizzazione)", () => {
    const spaced = "  test  test test test test test test test test test test junk  ";
    expect(isValidMnemonic(spaced)).toBe(true);
  });

  it("accetta mnemonic uppercase (normalizzazione)", () => {
    expect(isValidMnemonic(HARDHAT_MNEMONIC.toUpperCase())).toBe(true);
  });
});

describe("mnemonicWordCount", () => {
  it("conta 12 parole", () => {
    expect(mnemonicWordCount(HARDHAT_MNEMONIC)).toBe(12);
  });

  it("conta 24 parole", () => {
    const m = createMnemonic(256);
    expect(mnemonicWordCount(m)).toBe(24);
  });

  it("gestisce spazi multipli", () => {
    const padded = "  test  test  test  ";
    expect(mnemonicWordCount(padded)).toBe(3);
  });
});

describe("mnemonicToSeedBytes", () => {
  it("produce 64 bytes (512 bit) da una seed phrase valida", async () => {
    const seed = await mnemonicToSeedBytes(HARDHAT_MNEMONIC);
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
  });

  it("produce lo stesso seed per la stessa mnemonic (determinismo)", async () => {
    const seed1 = await mnemonicToSeedBytes(HARDHAT_MNEMONIC);
    const seed2 = await mnemonicToSeedBytes(HARDHAT_MNEMONIC);
    expect(Array.from(seed1)).toEqual(Array.from(seed2));
  });

  it("produce seed diversi per mnemonic diverse", async () => {
    const m2 = createMnemonic();
    const seed1 = await mnemonicToSeedBytes(HARDHAT_MNEMONIC);
    const seed2 = await mnemonicToSeedBytes(m2);
    expect(Array.from(seed1)).not.toEqual(Array.from(seed2));
  });
});

describe("normalizeMnemonic", () => {
  it("converte in lowercase", () => {
    expect(normalizeMnemonic("TEST TEST TEST")).toBe("test test test");
  });

  it("rimuove spazi extra", () => {
    expect(normalizeMnemonic("  test  test  ")).toBe("test test");
  });

  it("non modifica una mnemonic già normalizzata", () => {
    expect(normalizeMnemonic(HARDHAT_MNEMONIC)).toBe(HARDHAT_MNEMONIC);
  });
});
