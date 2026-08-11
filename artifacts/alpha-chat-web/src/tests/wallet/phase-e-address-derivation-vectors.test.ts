/**
 * Phase E — Address Derivation Vectors (Interoperability)
 *
 * OBIETTIVO: verificare che la derivazione BIP-44/84 produca gli STESSI address
 * che produrrebbero MetaMask (EVM) e BlueWallet/Sparrow (BTC) con lo stesso seed.
 *
 * Usa i vettori ufficiali BIP-39/44/84 con il mnemonic "abandon×11 about":
 *   - Pubblicato nella documentazione ufficiale BIP-84
 *   - Usato come riferimento da MetaMask, BlueWallet, Sparrow, Trezor, Ledger
 *   - Non è un wallet reale (tutti i fondi qui sarebbero immediatamente rubati)
 *
 * INDICI TESTATI: 0 e 1 (i primi due account)
 *
 * Fonti dei vettori:
 *   EVM: https://github.com/MetaMask/eth-hd-wallet (abbrev. in docs ufficiali)
 *   BTC: https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
 */

import { describe, it, expect } from "vitest";
import { deriveEvmWallet, deriveBtcWallet } from "../../wallet/core/hd-wallet";

// ─── Mnemonic di test BIP-39 standard ─────────────────────────────────────
// ATTENZIONE: NON usare mai questo mnemonic per un wallet reale
const BIP39_TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// ─── Vettori attesi ────────────────────────────────────────────────────────
//
// EVM — m/44'/60'/0'/0/N (BIP-44 Ethereum):
//   Indice 0: 0x9858EfFD232B4033E47d90003D41EC34EcaedA94 (MetaMask account #1)
//   Indice 1: 0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0 (MetaMask account #2)
//
// BTC — m/84'/0'/0'/0/N (BIP-84 Native SegWit P2WPKH):
//   Indice 0: bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu (BIP-84 test vector)
//   Indice 1: bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g (BIP-84 test vector)

const EXPECTED_EVM = [
  { index: 0, address: "0x9858EfFD232B4033E47d90003D41EC34EcaedA94" },
  { index: 1, address: "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0" },
];

const EXPECTED_BTC = [
  { index: 0, address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu" },
  { index: 1, address: "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g" },
];

// ─── EVM Address Derivation ───────────────────────────────────────────────

describe("EVM BIP-44 address derivation — interoperabilità MetaMask", () => {
  for (const { index, address } of EXPECTED_EVM) {
    it(`m/44'/60'/0'/0/${index} → ${address}`, async () => {
      const wallet = await deriveEvmWallet(BIP39_TEST_MNEMONIC, index);
      // Case-insensitive comparison (EIP-55 checksum può variare)
      expect(wallet.address.toLowerCase()).toBe(address.toLowerCase());
    });

    it(`indice ${index}: percorso di derivazione è m/44'/60'/0'/0/${index}`, async () => {
      const wallet = await deriveEvmWallet(BIP39_TEST_MNEMONIC, index);
      expect(wallet.derivationPath).toBe(`m/44'/60'/0'/0/${index}`);
      expect(wallet.index).toBe(index);
    });

    it(`indice ${index}: private key è un Uint8Array di 32 byte`, async () => {
      const wallet = await deriveEvmWallet(BIP39_TEST_MNEMONIC, index);
      expect(wallet.privateKey).toBeInstanceOf(Uint8Array);
      expect(wallet.privateKey.length).toBe(32);
      // Non deve essere tutti-zero (chiave degenerata)
      const allZero = wallet.privateKey.every(b => b === 0);
      expect(allZero).toBe(false);
    });
  }

  it("indice 0 e indice 1 producono address DIVERSI (no collision)", async () => {
    const w0 = await deriveEvmWallet(BIP39_TEST_MNEMONIC, 0);
    const w1 = await deriveEvmWallet(BIP39_TEST_MNEMONIC, 1);
    expect(w0.address.toLowerCase()).not.toBe(w1.address.toLowerCase());
  });

  it("stessa mnemonic, stessa chiamata → stesso indirizzo (determinismo)", async () => {
    const a = await deriveEvmWallet(BIP39_TEST_MNEMONIC, 0);
    const b = await deriveEvmWallet(BIP39_TEST_MNEMONIC, 0);
    expect(a.address.toLowerCase()).toBe(b.address.toLowerCase());
  });

  it("mnemonic diversa → indirizzo diverso (no clash cross-wallet)", async () => {
    const OTHER = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
    const a = await deriveEvmWallet(BIP39_TEST_MNEMONIC, 0);
    const b = await deriveEvmWallet(OTHER,              0);
    expect(a.address.toLowerCase()).not.toBe(b.address.toLowerCase());
  });
});

// ─── BTC Address Derivation ───────────────────────────────────────────────

describe("BTC BIP-84 address derivation — interoperabilità BlueWallet/Sparrow", () => {
  for (const { index, address } of EXPECTED_BTC) {
    it(`m/84'/0'/0'/0/${index} → ${address}`, async () => {
      const wallet = await deriveBtcWallet(BIP39_TEST_MNEMONIC, index);
      expect(wallet.address).toBe(address); // bech32 è case-sensitive (minuscolo)
    });

    it(`indice ${index}: percorso di derivazione è m/84'/0'/0'/0/${index}`, async () => {
      const wallet = await deriveBtcWallet(BIP39_TEST_MNEMONIC, index);
      expect(wallet.derivationPath).toBe(`m/84'/0'/0'/0/${index}`);
    });

    it(`indice ${index}: address inizia con bc1q (Native SegWit P2WPKH)`, async () => {
      const wallet = await deriveBtcWallet(BIP39_TEST_MNEMONIC, index);
      // bc1q = mainnet Native SegWit
      expect(wallet.address.startsWith("bc1q")).toBe(true);
    });

    it(`indice ${index}: private key è un Uint8Array di 32 byte non-zero`, async () => {
      const wallet = await deriveBtcWallet(BIP39_TEST_MNEMONIC, index);
      expect(wallet.privateKey).toBeInstanceOf(Uint8Array);
      expect(wallet.privateKey.length).toBe(32);
      const allZero = wallet.privateKey.every(b => b === 0);
      expect(allZero).toBe(false);
    });
  }

  it("indice 0 e indice 1 producono address bech32 DIVERSI", async () => {
    const b0 = await deriveBtcWallet(BIP39_TEST_MNEMONIC, 0);
    const b1 = await deriveBtcWallet(BIP39_TEST_MNEMONIC, 1);
    expect(b0.address).not.toBe(b1.address);
  });

  it("derivazione BTC è deterministica (stessa call → stesso address)", async () => {
    const a = await deriveBtcWallet(BIP39_TEST_MNEMONIC, 0);
    const b = await deriveBtcWallet(BIP39_TEST_MNEMONIC, 0);
    expect(a.address).toBe(b.address);
  });
});

// ─── EVM ↔ BTC Separation ────────────────────────────────────────────────

describe("Separazione derivazione EVM ↔ BTC", () => {
  it("EVM usa BIP-44 path (60'), BTC usa BIP-84 path (0') — path diversi", async () => {
    const evm = await deriveEvmWallet(BIP39_TEST_MNEMONIC, 0);
    const btc = await deriveBtcWallet(BIP39_TEST_MNEMONIC, 0);
    expect(evm.derivationPath).toContain("44'");
    expect(evm.derivationPath).toContain("60'");
    expect(btc.derivationPath).toContain("84'");
    expect(btc.derivationPath).not.toContain("60'");
  });

  it("EVM address è hex 0x, BTC address è bech32 bc1q — formati incompatibili", async () => {
    const evm = await deriveEvmWallet(BIP39_TEST_MNEMONIC, 0);
    const btc = await deriveBtcWallet(BIP39_TEST_MNEMONIC, 0);
    expect(evm.address.startsWith("0x")).toBe(true);
    expect(btc.address.startsWith("bc1q")).toBe(true);
  });

  it("private key EVM e BTC sono diverse per stesso mnemonic+indice (path diversi)", async () => {
    const evm = await deriveEvmWallet(BIP39_TEST_MNEMONIC, 0);
    const btc = await deriveBtcWallet(BIP39_TEST_MNEMONIC, 0);
    // Chiavi diverse perché derivate da path diversi
    const evmHex = Array.from(evm.privateKey).map(b => b.toString(16).padStart(2, "0")).join("");
    const btcHex = Array.from(btc.privateKey).map(b => b.toString(16).padStart(2, "0")).join("");
    expect(evmHex).not.toBe(btcHex);
  });
});
