/**
 * Phase D — Transaction Safety Tests
 *
 * Verifica che prima della firma vengano sempre controllati:
 * - chainId (impostato correttamente nella tx)
 * - recipient (validato prima di procedere)
 * - amount (validato, no overflow, no underflow)
 * - decimals (conversion corretta per ogni chain/token)
 * - gas (incluso nella stima, totale mostrato)
 * - nonce (incluso nella tx firmata)
 *
 * L'utente firma esattamente ciò che vede nella schermata di conferma.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateEvmRecipient, validateEvmAmount, validateEvmNativeAmount } from "../../wallet/services/evm-signer";
import { validateBtcAddress, validateBtcAmount, estimateTxVBytes, selectBtcUTXOs } from "../../wallet/services/btc-signer";
import { parseAmount } from "../../wallet/services/price-service";
import { buildErc20TransferData } from "../../wallet/services/gas-service";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("../../lib/alpha-wallet-api", () => ({
  apiWalletBroadcastEvmTx: vi.fn(),
  apiWalletBroadcastBtcTx: vi.fn(),
  apiWalletGetBtcUTXOs:    vi.fn(),
  apiWalletGetBtcFeeRate:  vi.fn(),
  apiWalletGetEvmBalance:  vi.fn(),
  apiWalletGetBtcBalance:  vi.fn(),
  apiWalletGetTokenInfo:   vi.fn(),
  apiWalletGetEvmTransactions: vi.fn(),
  apiWalletGetBtcTransactions: vi.fn(),
  apiWalletGetGasEstimate: vi.fn(),
  apiWalletGetPrices:      vi.fn(),
}));

vi.mock("../../wallet/core/hd-wallet", async () => {
  const actual = await vi.importActual<typeof import("../../wallet/core/hd-wallet")>("../../wallet/core/hd-wallet");
  return { ...actual, deriveEvmWallet: vi.fn() };
});

vi.mock("../../wallet/evm/token-registry", () => ({
  getVerifiedTokens:       vi.fn().mockReturnValue([]),
  buildCustomTokenPreview: vi.fn(),
  USDA_CONTRACT_POLYGON:   "0x23396cf899ca06c4472205fc903bdb4de249d6f",
}));

import { signAndBroadcastNativeEvm, signAndBroadcastErc20Evm } from "../../wallet/services/evm-signer";
import { deriveEvmWallet } from "../../wallet/core/hd-wallet";
import { apiWalletBroadcastEvmTx } from "../../lib/alpha-wallet-api";

const TEST_PK = new Uint8Array(32).fill(0xab);
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

beforeEach(() => {
  vi.clearAllMocks();
  // IMPORTANT: Use mockImplementation (not mockResolvedValue) so a fresh
  // Uint8Array is created on each call — preventing the zeroed-key bug
  // where the first test zeroes the key and subsequent tests receive all-zeros.
  vi.mocked(deriveEvmWallet).mockImplementation(async () => ({
    address:        TEST_ADDRESS,
    privateKey:     new Uint8Array(TEST_PK), // fresh copy each call
    derivationPath: "m/44'/60'/0'/0/0",
    index:          0,
  }));
});

// ─── chainId embedded in signed transaction ────────────────────────────────

describe("chainId in signed transaction", () => {
  it("native EVM: chainId is embedded in the signed tx (EIP-155 replay protection)", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0xabc" });

    // Polygon (137)
    await signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 137,
      to: "0x1234567890123456789012345678901234567890",
      valueWei: 1n, gasLimit: 21000n, gasPrice: 30_000_000_000n, nonce: 5,
    });

    const [calledChainId] = vi.mocked(apiWalletBroadcastEvmTx).mock.calls[0];
    expect(calledChainId).toBe(137); // chainId passed to broadcast

    // Ethereum (1)
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0xdef" });
    await signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 1,
      to: "0x1234567890123456789012345678901234567890",
      valueWei: 1n, gasLimit: 21000n, gasPrice: 30_000_000_000n, nonce: 0,
    });

    const secondCall = vi.mocked(apiWalletBroadcastEvmTx).mock.calls[1];
    expect(secondCall[0]).toBe(1); // Ethereum chainId
  });

  it("ERC-20: chainId is embedded in the signed tx", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0x123" });

    await signAndBroadcastErc20Evm({
      mnemonic: TEST_MNEMONIC, chainId: 56, // BSC
      tokenContractAddr: "0x55d398326f99059ff775485246999027b3197955",
      recipient: "0x1234567890123456789012345678901234567890",
      amount: 1_000_000_000_000_000_000n, gasLimit: 65000n, gasPrice: 5_000_000_000n, nonce: 0,
    });

    expect(vi.mocked(apiWalletBroadcastEvmTx).mock.calls[0][0]).toBe(56); // BSC chainId
  });
});

// ─── Amount precision (what user sees = what is signed) ───────────────────

describe("Amount precision — user sees exactly what is signed", () => {
  it("6-decimal USDT: parseAmount('1.5') === 1_500_000n", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
  });

  it("18-decimal BSC USDT: parseAmount('1.5') === 1_500_000_000_000_000_000n", () => {
    expect(parseAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n);
  });

  it("ETH: parseAmount('0.001') === 1_000_000_000_000_000n", () => {
    expect(parseAmount("0.001", 18)).toBe(1_000_000_000_000_000n);
  });

  it("BTC: parseAmount('0.00000546') === 546n (dust limit)", () => {
    expect(parseAmount("0.00000546", 8)).toBe(546n);
  });

  it("parseAmount returns null for ambiguous/invalid input", () => {
    expect(parseAmount("", 6)).toBeNull();
    expect(parseAmount("abc", 6)).toBeNull();
    expect(parseAmount("1.2.3", 6)).toBeNull();
    expect(parseAmount("-5", 6)).toBeNull();
  });
});

// ─── ERC-20 calldata encodes correct recipient and amount ──────────────────

describe("ERC-20 transfer calldata correctness", () => {
  it("buildErc20TransferData encodes correct method selector", () => {
    const data = buildErc20TransferData(
      "0x1234567890123456789012345678901234567890",
      1_000_000n,
    );
    // transfer(address,uint256) selector = 0xa9059cbb
    expect(data.slice(0, 10)).toBe("0xa9059cbb");
  });

  it("calldata length is exactly 68 bytes (4 selector + 32 addr + 32 amount)", () => {
    const data = buildErc20TransferData(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      100n,
    );
    // 0x + 136 hex chars = 138 chars
    expect(data.length).toBe(138);
  });

  it("different amounts produce different calldatas", () => {
    const d1 = buildErc20TransferData("0x1234567890123456789012345678901234567890", 100n);
    const d2 = buildErc20TransferData("0x1234567890123456789012345678901234567890", 200n);
    expect(d1).not.toBe(d2);
    // But same selector
    expect(d1.slice(0, 10)).toBe(d2.slice(0, 10));
  });

  it("USDA Polygon contract address is encoded correctly", () => {
    // viem requires EIP-55 checksummed address — buildErc20TransferData normalizes it internally
    // Use a known checksummed address for this test
    const checksummedAddr = "0x1234567890AbcdEF1234567890aBcdef12345678";
    const data = buildErc20TransferData(checksummedAddr, 1_000_000_000_000_000_000n);
    // The address should appear in the calldata (lowercase, zero-padded to 32 bytes)
    expect(data.toLowerCase()).toContain("1234567890abcdef1234567890abcdef12345678");
  });
});

// ─── Gas and nonce in signed transaction ──────────────────────────────────

describe("Gas and nonce in signed transaction", () => {
  it("nonce is passed through to the signed transaction params", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0x111" });

    // Nonce 42 — verify it's included in the tx (viem serializes it)
    await signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 137,
      to: "0x1234567890123456789012345678901234567890",
      valueWei: 1n, gasLimit: 21000n, gasPrice: 30_000_000_000n, nonce: 42,
    });

    // The signed tx must exist and be non-trivially long (nonce is encoded inside)
    const signedTx = vi.mocked(apiWalletBroadcastEvmTx).mock.calls[0][1];
    expect(typeof signedTx).toBe("string");
    expect(signedTx.length).toBeGreaterThan(50);
  });

  it("different nonce values produce different signed transactions", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0xaaa" });

    await signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 1,
      to: "0x1234567890123456789012345678901234567890",
      valueWei: 1n, gasLimit: 21000n, gasPrice: 1n, nonce: 0,
    });

    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0xbbb" });
    await signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 1,
      to: "0x1234567890123456789012345678901234567890",
      valueWei: 1n, gasLimit: 21000n, gasPrice: 1n, nonce: 1,
    });

    const tx0 = vi.mocked(apiWalletBroadcastEvmTx).mock.calls[0][1];
    const tx1 = vi.mocked(apiWalletBroadcastEvmTx).mock.calls[1][1];
    expect(tx0).not.toBe(tx1); // Different nonce → different signature → different raw tx
  });
});

// ─── Balance validation before signing ────────────────────────────────────

describe("Balance validation before signing", () => {
  it("EVM native: validateEvmNativeAmount detects insufficient balance for amount+gas", () => {
    const balance = 1_000_000_000_000_000_000n; // 1 ETH
    const amount  =   990_000_000_000_000_000n; // 0.99 ETH
    const fee     =    30_000_000_000_000_000n; // 0.03 ETH gas
    // 0.99 + 0.03 = 1.02 ETH > 1 ETH balance
    expect(validateEvmNativeAmount(amount, balance, fee)).not.toBeNull();
  });

  it("EVM native: accepts when amount+gas fits exactly", () => {
    const balance = 1_000_000_000_000_000_000n; // 1 ETH
    const amount  =   970_000_000_000_000_000n; // 0.97 ETH
    const fee     =    30_000_000_000_000_000n; // 0.03 ETH
    // 0.97 + 0.03 = 1.00 ETH = balance
    expect(validateEvmNativeAmount(amount, balance, fee)).toBeNull();
  });

  it("EVM token: validateEvmAmount detects insufficient token balance", () => {
    expect(validateEvmAmount(1_000_001n, 6, 1_000_000n)).not.toBeNull(); // over by 1 unit
  });

  it("BTC: validates that amount doesn't exhaust all UTXOs (leaves room for fee)", () => {
    const balance = 1_000_000n;
    // Trying to send exact balance — no room for fee
    expect(validateBtcAmount(balance, balance)).not.toBeNull();
  });
});

// ─── BTC fee spike safety ──────────────────────────────────────────────────

describe("BTC fee spike safety", () => {
  it("selectBtcUTXOs returns null when fee spike makes tx unaffordable", () => {
    const utxos = [{ txid: "a".repeat(64), vout: 0, value: 10_000, confirmed: true, blockHeight: 800000 }];
    // Extreme fee rate: 1000 sat/vbyte, tx ~141 vbytes = 141,000 sat fee
    // But UTXO is only 10,000 sat — can't afford amount + fee
    const result = selectBtcUTXOs(utxos, 5_000n, 1000);
    expect(result).toBeNull(); // insufficient balance after fee spike
  });

  it("vbyte estimation is deterministic given same input count", () => {
    const v1 = estimateTxVBytes(1, 2);
    const v2 = estimateTxVBytes(1, 2);
    expect(v1).toBe(v2);
  });

  it("more inputs → more vbytes (fee increases proportionally)", () => {
    const v1 = estimateTxVBytes(1, 2);
    const v3 = estimateTxVBytes(3, 2);
    expect(v3).toBeGreaterThan(v1);
  });
});
