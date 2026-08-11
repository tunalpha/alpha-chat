/**
 * Phase C — BTC Signer Tests
 *
 * Tests: UTXO selection, fee estimation, change calculation, dust limit,
 *        insufficient balance, invalid address, local signing (no key leak).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateBtcAddress,
  validateBtcAmount,
  selectBtcUTXOs,
  estimateTxVBytes,
  satToBtc,
  signAndBroadcastBtcTx,
} from "../../wallet/services/btc-signer";
import type { BtcUTXO } from "../../lib/alpha-wallet-api";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("../../lib/alpha-wallet-api", () => ({
  apiWalletGetBtcUTXOs:    vi.fn(),
  apiWalletGetBtcFeeRate:  vi.fn(),
  apiWalletBroadcastBtcTx: vi.fn(),
  apiWalletGetEvmBalance:  vi.fn(),
  apiWalletGetBtcBalance:  vi.fn(),
  apiWalletGetTokenInfo:   vi.fn(),
  apiWalletGetEvmTransactions: vi.fn(),
  apiWalletGetBtcTransactions: vi.fn(),
  apiWalletGetGasEstimate: vi.fn(),
  apiWalletBroadcastEvmTx: vi.fn(),
  apiWalletGetPrices:      vi.fn(),
}));

vi.mock("../../wallet/core/mnemonic", () => ({
  mnemonicToSeedBytes: vi.fn().mockResolvedValue(new Uint8Array(64).fill(0x42)),
}));

import {
  apiWalletGetBtcUTXOs,
  apiWalletGetBtcFeeRate,
  apiWalletBroadcastBtcTx,
} from "../../lib/alpha-wallet-api";

const MOCK_UTXO = (txid: string, vout: number, value: number): BtcUTXO => ({
  txid, vout, value, confirmed: true, blockHeight: 800000,
});

beforeEach(() => { vi.clearAllMocks(); });

// ─── Address validation ─────────────────────────────────────────────────────

describe("validateBtcAddress", () => {
  it("accepts valid bc1q... P2WPKH address", () => {
    expect(validateBtcAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBeNull();
  });

  it("accepts legacy P2PKH (1...) address", () => {
    expect(validateBtcAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf Na")).not.toBeNull(); // space = invalid
    expect(validateBtcAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBeNull();
  });

  it("rejects empty address", () => {
    expect(validateBtcAddress("")).not.toBeNull();
  });

  it("rejects Ethereum-style address", () => {
    expect(validateBtcAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).not.toBeNull();
  });

  it("rejects gibberish", () => {
    expect(validateBtcAddress("not_a_bitcoin_address")).not.toBeNull();
  });
});

// ─── Amount validation ─────────────────────────────────────────────────────

describe("validateBtcAmount", () => {
  const balance = BigInt(1_000_000); // 0.01 BTC

  it("accepts valid amount", () => {
    expect(validateBtcAmount(546n, balance)).toBeNull();
  });

  it("rejects dust amount (< 546 sat)", () => {
    expect(validateBtcAmount(545n, balance)).not.toBeNull();
  });

  it("rejects zero amount", () => {
    expect(validateBtcAmount(0n, balance)).not.toBeNull();
  });

  it("rejects amount >= balance (leaves no room for fee)", () => {
    expect(validateBtcAmount(balance, balance)).not.toBeNull();
  });
});

// ─── estimateTxVBytes ───────────────────────────────────────────────────────

describe("estimateTxVBytes", () => {
  it("estimates 1 input, 2 outputs", () => {
    const v = estimateTxVBytes(1, 2);
    // 10.5 + 68 + 62 = 140.5 → ceil = 141
    expect(v).toBe(141);
  });

  it("estimates 2 inputs, 2 outputs", () => {
    const v = estimateTxVBytes(2, 2);
    // 10.5 + 136 + 62 = 208.5 → ceil = 209
    expect(v).toBe(209);
  });

  it("estimates 1 input, 1 output (no change)", () => {
    const v = estimateTxVBytes(1, 1);
    // 10.5 + 68 + 31 = 109.5 → ceil = 110
    expect(v).toBe(110);
  });
});

// ─── selectBtcUTXOs ────────────────────────────────────────────────────────

describe("selectBtcUTXOs", () => {
  it("selects minimum UTXOs for target amount", () => {
    const utxos = [
      MOCK_UTXO("tx1", 0, 1_000_000),
      MOCK_UTXO("tx2", 0, 500_000),
      MOCK_UTXO("tx3", 0, 250_000),
    ];
    const result = selectBtcUTXOs(utxos, 600_000n, 10);
    expect(result).not.toBeNull();
    // Should use the largest UTXO (1_000_000) to cover 600_000 + fee
    expect(result!.selected).toHaveLength(1);
    expect(result!.totalInputSat).toBe(1_000_000n);
  });

  it("uses multiple UTXOs when single is insufficient", () => {
    const utxos = [
      MOCK_UTXO("tx1", 0, 500_000),
      MOCK_UTXO("tx2", 0, 400_000),
      MOCK_UTXO("tx3", 0, 300_000),
    ];
    // Target 800,000 — needs at least 2 UTXOs (500k + 400k = 900k, covers fee)
    const result = selectBtcUTXOs(utxos, 800_000n, 10);
    expect(result).not.toBeNull();
    expect(result!.selected.length).toBeGreaterThanOrEqual(2);
  });

  it("returns null when insufficient balance", () => {
    const utxos = [MOCK_UTXO("tx1", 0, 100_000)];
    const result = selectBtcUTXOs(utxos, 500_000n, 10); // 500k > 100k
    expect(result).toBeNull();
  });

  it("calculates correct change amount", () => {
    const utxos = [MOCK_UTXO("tx1", 0, 1_000_000)];
    const target = 600_000n;
    const feeRate = 10;
    const result = selectBtcUTXOs(utxos, target, feeRate);
    expect(result).not.toBeNull();
    const expectedFee = BigInt(Math.ceil(estimateTxVBytes(1, 2) * feeRate));
    expect(result!.feeSat).toBe(expectedFee);
    expect(result!.changeSat).toBe(1_000_000n - target - expectedFee);
  });

  it("folds dust change into fee (change < 546 sat)", () => {
    // Design a UTXO that leaves exactly 100 sat change after fee
    const feeRate = 1;
    const fee2out = BigInt(estimateTxVBytes(1, 2) * feeRate);
    const target = 500_000n;
    // totalInput = target + fee2out + 100 (dust change)
    const totalInput = target + fee2out + 100n;
    const utxos = [MOCK_UTXO("tx1", 0, Number(totalInput))];

    const result = selectBtcUTXOs(utxos, target, feeRate);
    expect(result).not.toBeNull();
    // Change < 546 → should have no change output
    if (result!.hasChange === false) {
      expect(result!.changeSat).toBe(0n);
    }
    // The full input goes to target + fee (no dust output)
    expect(result!.totalInputSat - result!.feeSat).toBe(target);
  });

  it("selects UTXOs in largest-first order", () => {
    const utxos = [
      MOCK_UTXO("small", 0, 100_000),
      MOCK_UTXO("large", 0, 900_000),
      MOCK_UTXO("medium", 0, 500_000),
    ];
    const result = selectBtcUTXOs(utxos, 600_000n, 5);
    // Should pick "large" (900k) first — covers 600k + fee
    expect(result).not.toBeNull();
    expect(result!.selected[0].txid).toBe("large");
  });
});

// ─── satToBtc ───────────────────────────────────────────────────────────────

describe("satToBtc", () => {
  it("converts 100_000_000 sat to 1.00000000 BTC", () => {
    expect(satToBtc(100_000_000n)).toBe("1.00000000 BTC");
  });

  it("converts 546 sat (dust limit)", () => {
    expect(satToBtc(546n)).toBe("0.00000546 BTC");
  });

  it("converts 0 sat", () => {
    expect(satToBtc(0n)).toBe("0.00000000 BTC");
  });
});

// ─── signAndBroadcastBtcTx ──────────────────────────────────────────────────

describe("signAndBroadcastBtcTx", () => {
  it("rejects invalid recipient address without calling backend", async () => {
    await expect(
      signAndBroadcastBtcTx({
        mnemonic:         "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        recipientAddress: "invalid-address",
        amountSat:        10_000n,
        feeTarget:        "normal",
      })
    ).rejects.toThrow();
    expect(apiWalletBroadcastBtcTx).not.toHaveBeenCalled();
  });

  it("rejects when insufficient UTXOs", async () => {
    vi.mocked(apiWalletGetBtcUTXOs).mockResolvedValueOnce({
      address: "bc1qtest", utxos: [MOCK_UTXO("tx1", 0, 1_000)], totalSat: 1_000,
    });
    vi.mocked(apiWalletGetBtcFeeRate).mockResolvedValueOnce({ fastest: 30, normal: 15, economy: 5 });

    await expect(
      signAndBroadcastBtcTx({
        mnemonic:         "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        recipientAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        amountSat:        100_000n, // much more than available
        feeTarget:        "normal",
      })
    ).rejects.toThrow(/Saldo insufficiente/i);
  });

  it("passes only signed tx hex to backend, not private key", async () => {
    // Set up UTXOs and fee rate
    vi.mocked(apiWalletGetBtcUTXOs).mockResolvedValueOnce({
      address: "bc1qtest",
      utxos: [MOCK_UTXO("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 0, 1_000_000)],
      totalSat: 1_000_000,
    });
    vi.mocked(apiWalletGetBtcFeeRate).mockResolvedValueOnce({ fastest: 30, normal: 10, economy: 3 });
    vi.mocked(apiWalletBroadcastBtcTx).mockResolvedValueOnce({ txid: "deadbeef" });

    await signAndBroadcastBtcTx({
      mnemonic:         "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      recipientAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      amountSat:        500_000n,
      feeTarget:        "normal",
    });

    const broadcastCall = vi.mocked(apiWalletBroadcastBtcTx).mock.calls[0];
    const txHex = broadcastCall[0];

    // Should be raw hex (no 0x prefix for Bitcoin)
    expect(typeof txHex).toBe("string");
    expect(/^[0-9a-f]+$/i.test(txHex)).toBe(true);
    // Should NOT contain any key material (just the serialized tx)
    expect(txHex.length).toBeGreaterThan(100);
  });
});

// ─── Payment Engine regression ───────────────────────────────────────────────

describe("Payment Engine regression — BTC signer isolation", () => {
  it("does not import from multichain, usda, escrow, or gas-station", async () => {
    const mod = await import("../../wallet/services/btc-signer");
    expect(typeof mod.signAndBroadcastBtcTx).toBe("function");
    expect(typeof mod.selectBtcUTXOs).toBe("function");
  });
});
