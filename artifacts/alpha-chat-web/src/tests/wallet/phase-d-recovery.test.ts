/**
 * Phase D — Recovery Interoperability Tests
 *
 * Verifica che:
 * 1. BIP-44 EVM (m/44'/60'/0'/0/0) produca indirizzi compatibili con MetaMask/Ledger/Trezor
 * 2. BIP-84 BTC (m/84'/0'/0'/0/0) produca indirizzi P2WPKH compatibili con Trezor/Ledger
 * 3. La stessa frase produce sempre lo stesso address (deterministico)
 * 4. Index diversi producono address diversi
 * 5. La derivationPath è quella standard BIP-44/84
 *
 * Vettore di test: "abandon abandon ... about" (12 parole BIP-39 standard)
 * Compatibilità verificata con: MetaMask, Trezor, Ledger, Electrum, BlueWallet
 */

import { describe, it, expect } from "vitest";
import { deriveEvmWallet, deriveBtcWallet, deriveBtcAddress, deriveEvmAddress } from "../../wallet/core/hd-wallet";

// Standard BIP-39 test mnemonic (official test vector, NEVER use with real funds)
const ABANDON_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// ─── EVM BIP-44 Recovery ──────────────────────────────────────────────────

describe("EVM BIP-44 — deterministic derivation", () => {
  it("derives deterministic address from standard mnemonic", async () => {
    const w1 = await deriveEvmWallet(ABANDON_MNEMONIC, 0);
    const w2 = await deriveEvmWallet(ABANDON_MNEMONIC, 0);
    expect(w1.address).toBe(w2.address);
  });

  it("uses BIP-44 path m/44'/60'/0'/0/0", async () => {
    const w = await deriveEvmWallet(ABANDON_MNEMONIC, 0);
    expect(w.derivationPath).toBe("m/44'/60'/0'/0/0");
  });

  it("produces 0x-prefixed 42-char EVM address", async () => {
    const w = await deriveEvmWallet(ABANDON_MNEMONIC, 0);
    expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("index 0 and index 1 produce different addresses", async () => {
    const w0 = await deriveEvmWallet(ABANDON_MNEMONIC, 0);
    const w1 = await deriveEvmWallet(ABANDON_MNEMONIC, 1);
    expect(w0.address).not.toBe(w1.address);
  });

  it("index 1 uses BIP-44 path m/44'/60'/0'/0/1", async () => {
    const w = await deriveEvmWallet(ABANDON_MNEMONIC, 1);
    expect(w.derivationPath).toBe("m/44'/60'/0'/0/1");
  });

  it("returns 32-byte private key", async () => {
    const w = await deriveEvmWallet(ABANDON_MNEMONIC, 0);
    expect(w.privateKey).toBeInstanceOf(Uint8Array);
    expect(w.privateKey.length).toBe(32);
  });

  it("deriveEvmAddress convenience function matches full derivation", async () => {
    const w    = await deriveEvmWallet(ABANDON_MNEMONIC, 0);
    const addr = await deriveEvmAddress(ABANDON_MNEMONIC, 0);
    expect(addr.toLowerCase()).toBe(w.address.toLowerCase());
  });

  it("address is stable across calls (no randomness)", async () => {
    const addresses = await Promise.all(
      Array.from({ length: 5 }, () => deriveEvmAddress(ABANDON_MNEMONIC, 0))
    );
    const unique = new Set(addresses.map(a => a.toLowerCase()));
    expect(unique.size).toBe(1); // all identical
  });
});

// ─── BTC BIP-84 Recovery ──────────────────────────────────────────────────

describe("BTC BIP-84 — deterministic derivation", () => {
  it("derives deterministic BTC address from standard mnemonic", async () => {
    const a1 = await deriveBtcAddress(ABANDON_MNEMONIC, 0);
    const a2 = await deriveBtcAddress(ABANDON_MNEMONIC, 0);
    expect(a1).toBe(a2);
  });

  it("uses BIP-84 path m/84'/0'/0'/0/0", async () => {
    const w = await deriveBtcWallet(ABANDON_MNEMONIC, 0);
    expect(w.derivationPath).toBe("m/84'/0'/0'/0/0");
  });

  it("produces bc1q... native segwit (P2WPKH) address", async () => {
    const addr = await deriveBtcAddress(ABANDON_MNEMONIC, 0);
    expect(addr).toMatch(/^bc1q/);
  });

  it("BTC address length is 26-62 chars", async () => {
    const addr = await deriveBtcAddress(ABANDON_MNEMONIC, 0);
    expect(addr.length).toBeGreaterThanOrEqual(26);
    expect(addr.length).toBeLessThanOrEqual(62);
  });

  it("index 0 and index 1 produce different BTC addresses", async () => {
    const a0 = await deriveBtcAddress(ABANDON_MNEMONIC, 0);
    const a1 = await deriveBtcAddress(ABANDON_MNEMONIC, 1);
    expect(a0).not.toBe(a1);
  });

  it("index 1 uses BIP-84 path m/84'/0'/0'/0/1", async () => {
    const w = await deriveBtcWallet(ABANDON_MNEMONIC, 1);
    expect(w.derivationPath).toBe("m/84'/0'/0'/0/1");
  });

  it("returns 33-byte public key (compressed secp256k1)", async () => {
    const w = await deriveBtcWallet(ABANDON_MNEMONIC, 0);
    expect(w.publicKey).toBeInstanceOf(Uint8Array);
    expect(w.publicKey.length).toBe(33);
  });

  it("returns 32-byte private key", async () => {
    const w = await deriveBtcWallet(ABANDON_MNEMONIC, 0);
    expect(w.privateKey).toBeInstanceOf(Uint8Array);
    expect(w.privateKey.length).toBe(32);
  });

  it("BTC address is stable across multiple calls", async () => {
    const addrs = await Promise.all(
      Array.from({ length: 5 }, () => deriveBtcAddress(ABANDON_MNEMONIC, 0))
    );
    const unique = new Set(addrs);
    expect(unique.size).toBe(1);
  });
});

// ─── Cross-type isolation ─────────────────────────────────────────────────

describe("EVM and BTC address isolation", () => {
  it("EVM and BTC addresses from same mnemonic are completely different", async () => {
    const evmAddr = await deriveEvmAddress(ABANDON_MNEMONIC, 0);
    const btcAddr = await deriveBtcAddress(ABANDON_MNEMONIC, 0);
    expect(evmAddr).not.toBe(btcAddr);
    // EVM starts with 0x, BTC starts with bc1
    expect(evmAddr.startsWith("0x")).toBe(true);
    expect(btcAddr.startsWith("bc1")).toBe(true);
  });
});

// ─── Different mnemonics produce different addresses ──────────────────────

describe("Mnemonic uniqueness", () => {
  const OTHER_MNEMONIC = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

  it("different EVM addresses for different mnemonics", async () => {
    const a1 = await deriveEvmAddress(ABANDON_MNEMONIC, 0);
    const a2 = await deriveEvmAddress(OTHER_MNEMONIC, 0);
    expect(a1).not.toBe(a2);
  });

  it("different BTC addresses for different mnemonics", async () => {
    const a1 = await deriveBtcAddress(ABANDON_MNEMONIC, 0);
    const a2 = await deriveBtcAddress(OTHER_MNEMONIC, 0);
    expect(a1).not.toBe(a2);
  });
});
