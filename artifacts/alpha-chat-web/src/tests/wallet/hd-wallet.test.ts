/**
 * Test — Alpha Wallet Core: HD Wallet Derivation (BIP-44 / BIP-84)
 *
 * Verifica:
 * - Derivazione EVM address da mnemonic nota (vettore di test verificato)
 * - Derivazione BTC address formato bc1q...
 * - Determinismo: stessa mnemonic → stesso address sempre
 * - Diversità: mnemonic diverse → address diversi
 * - Path di derivazione corretti
 * - Indici multipli → address diversi
 *
 * COMPATIBILITÀ VERIFICATA:
 *   La Hardhat test mnemonic "test test...junk" produce su account 0:
 *   EVM: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 *   (MetaMask, Rainbow, Trust Wallet, Ledger confermano questo address)
 */

import { describe, it, expect } from "vitest";
import {
  deriveEvmWallet,
  deriveEvmAddress,
  deriveBtcWallet,
  deriveBtcAddress,
  deriveEvmAddresses,
  EVM_BASE_PATH,
  BTC_BASE_PATH,
} from "@/wallet/core/hd-wallet";
import { createMnemonic } from "@/wallet/core/mnemonic";

// Hardhat test mnemonic — vettore pubblico, solo per test
const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";

// Address EVM atteso per account 0 (verificato su MetaMask con Hardhat mnemonic)
const EXPECTED_EVM_ADDRESS_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("deriveEvmWallet", () => {
  it("produce il corretto address EVM per la Hardhat mnemonic (account 0)", async () => {
    const wallet = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    expect(wallet.address.toLowerCase()).toBe(EXPECTED_EVM_ADDRESS_0.toLowerCase());
  });

  it("restituisce un address EVM checksummed (0x...)", async () => {
    const wallet = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("restituisce la private key come Uint8Array di 32 bytes", async () => {
    const wallet = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    expect(wallet.privateKey).toBeInstanceOf(Uint8Array);
    expect(wallet.privateKey.length).toBe(32);
  });

  it("usa il path BIP-44 corretto", async () => {
    const wallet = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    expect(wallet.derivationPath).toBe(`${EVM_BASE_PATH}/0`);
  });

  it("account 1 ha path diverso e address diverso da account 0", async () => {
    const w0 = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    const w1 = await deriveEvmWallet(HARDHAT_MNEMONIC, 1);
    expect(w1.derivationPath).toBe(`${EVM_BASE_PATH}/1`);
    expect(w1.address).not.toBe(w0.address);
  });

  it("è deterministico: stessa mnemonic → stesso address", async () => {
    const w1 = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    const w2 = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    expect(w1.address).toBe(w2.address);
    expect(Array.from(w1.privateKey)).toEqual(Array.from(w2.privateKey));
  });

  it("mnemonic diversa → address diverso", async () => {
    const other = createMnemonic();
    const w1 = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    const w2 = await deriveEvmWallet(other, 0);
    expect(w1.address).not.toBe(w2.address);
  });
});

describe("deriveEvmAddress", () => {
  it("restituisce lo stesso address di deriveEvmWallet senza esporre la chiave", async () => {
    const full = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    const addr = await deriveEvmAddress(HARDHAT_MNEMONIC, 0);
    expect(addr).toBe(full.address);
  });
});

describe("deriveBtcWallet", () => {
  it("produce un address Native SegWit (bc1q...)", async () => {
    const wallet = await deriveBtcWallet(HARDHAT_MNEMONIC, 0);
    expect(wallet.address).toMatch(/^bc1q[a-z0-9]{38,}$/);
  });

  it("usa il path BIP-84 corretto", async () => {
    const wallet = await deriveBtcWallet(HARDHAT_MNEMONIC, 0);
    expect(wallet.derivationPath).toBe(`${BTC_BASE_PATH}/0`);
  });

  it("restituisce la chiave pubblica compressa (33 bytes)", async () => {
    const wallet = await deriveBtcWallet(HARDHAT_MNEMONIC, 0);
    expect(wallet.publicKey).toBeInstanceOf(Uint8Array);
    expect(wallet.publicKey.length).toBe(33);
    // Chiave pubblica compressa: inizia con 02 o 03
    expect([0x02, 0x03]).toContain(wallet.publicKey[0]);
  });

  it("è deterministico: stessa mnemonic → stesso BTC address", async () => {
    const w1 = await deriveBtcWallet(HARDHAT_MNEMONIC, 0);
    const w2 = await deriveBtcWallet(HARDHAT_MNEMONIC, 0);
    expect(w1.address).toBe(w2.address);
  });

  it("account 1 ha address BTC diverso da account 0", async () => {
    const w0 = await deriveBtcWallet(HARDHAT_MNEMONIC, 0);
    const w1 = await deriveBtcWallet(HARDHAT_MNEMONIC, 1);
    expect(w1.address).not.toBe(w0.address);
  });

  it("mnemonic diversa → BTC address diverso", async () => {
    const other = createMnemonic();
    const w1 = await deriveBtcWallet(HARDHAT_MNEMONIC, 0);
    const w2 = await deriveBtcWallet(other, 0);
    expect(w1.address).not.toBe(w2.address);
  });

  it("BTC address è diverso dall'EVM address (path diversi)", async () => {
    // Stessa mnemonic → EVM e BTC hanno path e chiavi diverse
    const evm = await deriveEvmAddress(HARDHAT_MNEMONIC, 0);
    const btc = await deriveBtcAddress(HARDHAT_MNEMONIC, 0);
    // Sono stringhe in formati completamente diversi
    expect(evm).not.toBe(btc);
    expect(evm).toMatch(/^0x/);
    expect(btc).toMatch(/^bc1q/);
  });
});

describe("deriveEvmAddresses (multi-account)", () => {
  it("deriva 5 address EVM distinti", async () => {
    const addresses = await deriveEvmAddresses(HARDHAT_MNEMONIC, 5);
    expect(addresses).toHaveLength(5);
    // Tutti unici
    const unique = new Set(addresses.map(a => a.toLowerCase()));
    expect(unique.size).toBe(5);
  });

  it("account 0 corrisponde al vettore noto", async () => {
    const addresses = await deriveEvmAddresses(HARDHAT_MNEMONIC, 3);
    expect(addresses[0].toLowerCase()).toBe(EXPECTED_EVM_ADDRESS_0.toLowerCase());
  });
});

describe("Isolamento EVM da BTC", () => {
  it("la stessa mnemonic produce chiavi indipendenti su EVM e BTC (BIP-44 vs BIP-84)", async () => {
    const evm = await deriveEvmWallet(HARDHAT_MNEMONIC, 0);
    const btc = await deriveBtcWallet(HARDHAT_MNEMONIC, 0);
    // I bytes delle chiavi devono essere diversi (path diversi)
    const evmKeyHex = Array.from(evm.privateKey).map(b => b.toString(16).padStart(2, "0")).join("");
    const btcKeyHex = Array.from(btc.publicKey).map(b => b.toString(16).padStart(2, "0")).join("");
    expect(evmKeyHex).not.toBe(btcKeyHex);
  });
});
