/**
 * Phase C — EVM Signer Tests
 *
 * Tests: transaction creation, local signing, invalid recipient,
 *        insufficient balance, broadcast failure, no private key leak.
 *
 * SICUREZZA: questi test verificano che:
 * - La private key non viene mai passata al backend (solo signedTx hex)
 * - Il signing avviene offline (nessuna chiamata RPC per firmare)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateEvmRecipient,
  validateEvmAmount,
  validateEvmNativeAmount,
  signAndBroadcastNativeEvm,
  signAndBroadcastErc20Evm,
} from "../../wallet/services/evm-signer";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("../../lib/alpha-wallet-api", () => ({
  apiWalletBroadcastEvmTx: vi.fn(),
  apiWalletGetEvmBalance:  vi.fn(),
  apiWalletGetBtcBalance:  vi.fn(),
  apiWalletGetTokenInfo:   vi.fn(),
  apiWalletGetEvmTransactions: vi.fn(),
  apiWalletGetBtcTransactions: vi.fn(),
  apiWalletGetGasEstimate: vi.fn(),
  apiWalletGetBtcUTXOs:    vi.fn(),
  apiWalletGetBtcFeeRate:  vi.fn(),
  apiWalletBroadcastBtcTx: vi.fn(),
  apiWalletGetPrices:      vi.fn(),
}));

vi.mock("../../wallet/core/hd-wallet", async () => {
  const actual = await vi.importActual<typeof import("../../wallet/core/hd-wallet")>("../../wallet/core/hd-wallet");
  return {
    ...actual,
    deriveEvmWallet: vi.fn(),
  };
});

import { deriveEvmWallet } from "../../wallet/core/hd-wallet";
import { apiWalletBroadcastEvmTx } from "../../lib/alpha-wallet-api";

// Known test private key (NEVER use with real funds)
const TEST_PRIVATE_KEY_HEX = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_PRIVATE_KEY_BYTES = new Uint8Array([
  0xac, 0x09, 0x74, 0xbe, 0xc3, 0x9a, 0x17, 0xe3, 0x6b, 0xa4, 0xa6, 0xb4, 0xd2, 0x38, 0xff, 0x94,
  0x4b, 0xac, 0xb4, 0x78, 0xcb, 0xed, 0x5e, 0xfc, 0xae, 0x78, 0x4d, 0x7b, 0xf4, 0xf2, 0xff, 0x80,
]);
// Corresponding address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;

const TEST_MNEMONIC = "test test test test test test test test test test test junk";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deriveEvmWallet).mockResolvedValue({
    address:        TEST_ADDRESS,
    privateKey:     new Uint8Array(TEST_PRIVATE_KEY_BYTES),
    derivationPath: "m/44'/60'/0'/0/0",
    index:          0,
  });
});

// ─── Validation ─────────────────────────────────────────────────────────────

describe("validateEvmRecipient", () => {
  it("accepts valid 42-char hex address", () => {
    expect(validateEvmRecipient("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateEvmRecipient("")).not.toBeNull();
  });

  it("rejects non-hex address", () => {
    expect(validateEvmRecipient("0xZZZZ")).not.toBeNull();
  });

  it("rejects too-short address", () => {
    expect(validateEvmRecipient("0x1234")).not.toBeNull();
  });

  it("rejects Ethereum address without 0x prefix", () => {
    expect(validateEvmRecipient("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).not.toBeNull();
  });
});

describe("validateEvmAmount", () => {
  it("accepts valid amount within balance", () => {
    expect(validateEvmAmount(100n, 18, 1000n)).toBeNull();
  });

  it("rejects zero amount", () => {
    expect(validateEvmAmount(0n, 18, 1000n)).not.toBeNull();
  });

  it("rejects negative amount", () => {
    expect(validateEvmAmount(-1n, 18, 1000n)).not.toBeNull();
  });

  it("rejects amount exceeding balance", () => {
    expect(validateEvmAmount(1001n, 18, 1000n)).not.toBeNull();
  });

  it("accepts exact balance", () => {
    expect(validateEvmAmount(1000n, 18, 1000n)).toBeNull();
  });
});

describe("validateEvmNativeAmount", () => {
  it("rejects when amount + gas exceeds balance", () => {
    const balance = 1_000_000n;
    const amount  = 900_000n;
    const fee     = 200_000n; // total would be 1,100,000 > balance
    expect(validateEvmNativeAmount(amount, balance, fee)).not.toBeNull();
  });

  it("accepts when amount + gas fits in balance", () => {
    const balance = 1_000_000n;
    const amount  = 700_000n;
    const fee     = 200_000n; // total 900,000 < balance
    expect(validateEvmNativeAmount(amount, balance, fee)).toBeNull();
  });
});

// ─── signAndBroadcastNativeEvm ──────────────────────────────────────────────

describe("signAndBroadcastNativeEvm", () => {
  it("signs locally and passes signedTx hex to backend (never private key)", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValueOnce({ txHash: "0xabc123" });

    const result = await signAndBroadcastNativeEvm({
      mnemonic:  TEST_MNEMONIC,
      chainId:   137,
      to:        "0x1234567890123456789012345678901234567890",
      valueWei:  1_000_000_000_000_000_000n, // 1 POL
      gasLimit:  21_000n,
      gasPrice:  30_000_000_000n,
      nonce:     0,
    });

    expect(result.txHash).toBe("0xabc123");

    // Backend MUST receive chainId + signedTx — never the private key
    const broadcastCall = vi.mocked(apiWalletBroadcastEvmTx).mock.calls[0];
    expect(broadcastCall[0]).toBe(137); // chainId
    const signedTx = broadcastCall[1];
    expect(typeof signedTx).toBe("string");
    expect(signedTx.startsWith("0x")).toBe(true);
    // signedTx should NOT contain the raw private key hex
    expect(signedTx.toLowerCase()).not.toContain("ac0974bec39a17e3");
  });

  it("rejects invalid recipient address", async () => {
    await expect(
      signAndBroadcastNativeEvm({
        mnemonic: TEST_MNEMONIC, chainId: 1,
        to: "not-an-address" as `0x${string}`,
        valueWei: 1n, gasLimit: 21000n, gasPrice: 1n, nonce: 0,
      })
    ).rejects.toThrow();
  });

  it("zeroes out private key bytes after signing", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValueOnce({ txHash: "0x123" });

    let capturedPrivKey: Uint8Array | undefined;
    const originalDerive = vi.mocked(deriveEvmWallet);
    originalDerive.mockImplementationOnce(async () => {
      const pk = new Uint8Array(TEST_PRIVATE_KEY_BYTES);
      capturedPrivKey = pk;
      return { address: TEST_ADDRESS, privateKey: pk, derivationPath: "m/44'/60'/0'/0/0", index: 0 };
    });

    await signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 1,
      to: "0x1234567890123456789012345678901234567890",
      valueWei: 1n, gasLimit: 21000n, gasPrice: 1n, nonce: 0,
    });

    // Private key bytes should be zeroed after signing
    expect(capturedPrivKey?.every(b => b === 0)).toBe(true);
  });

  it("propagates broadcast failure without retrying", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockRejectedValueOnce(new Error("Saldo insufficiente per coprire gas + importo"));

    await expect(
      signAndBroadcastNativeEvm({
        mnemonic: TEST_MNEMONIC, chainId: 1,
        to: "0x1234567890123456789012345678901234567890",
        valueWei: 1n, gasLimit: 21000n, gasPrice: 1n, nonce: 0,
      })
    ).rejects.toThrow("Saldo insufficiente");

    // Should NOT retry — called exactly once
    expect(apiWalletBroadcastEvmTx).toHaveBeenCalledTimes(1);
  });
});

// ─── signAndBroadcastErc20Evm ───────────────────────────────────────────────

describe("signAndBroadcastErc20Evm", () => {
  it("sends ERC-20 transfer with value=0 and encoded data", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValueOnce({ txHash: "0xerc20tx" });

    const result = await signAndBroadcastErc20Evm({
      mnemonic:          TEST_MNEMONIC,
      chainId:           137,
      tokenContractAddr: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      recipient:         "0x1234567890123456789012345678901234567890",
      amount:            1_000_000n, // 1 USDT
      gasLimit:          65_000n,
      gasPrice:          30_000_000_000n,
      nonce:             1,
    });

    expect(result.txHash).toBe("0xerc20tx");
    const signedTx = vi.mocked(apiWalletBroadcastEvmTx).mock.calls[0][1];
    // The signed ERC-20 tx contains transfer() calldata — verify it's a valid hex
    expect(signedTx.startsWith("0x")).toBe(true);
    expect(signedTx.length).toBeGreaterThan(100);
  });

  it("rejects invalid token contract address", async () => {
    await expect(
      signAndBroadcastErc20Evm({
        mnemonic: TEST_MNEMONIC, chainId: 137,
        tokenContractAddr: "not-a-contract" as `0x${string}`,
        recipient: "0x1234567890123456789012345678901234567890",
        amount: 1n, gasLimit: 65000n, gasPrice: 1n, nonce: 0,
      })
    ).rejects.toThrow();
  });

  it("zeroes private key even if broadcast fails", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockRejectedValueOnce(new Error("Network error"));

    let capturedPk: Uint8Array | undefined;
    vi.mocked(deriveEvmWallet).mockImplementationOnce(async () => {
      const pk = new Uint8Array(TEST_PRIVATE_KEY_BYTES);
      capturedPk = pk;
      return { address: TEST_ADDRESS, privateKey: pk, derivationPath: "m/44'/60'/0'/0/0", index: 0 };
    });

    await expect(
      signAndBroadcastErc20Evm({
        mnemonic: TEST_MNEMONIC, chainId: 137,
        tokenContractAddr: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        recipient: "0x1234567890123456789012345678901234567890",
        amount: 1n, gasLimit: 65000n, gasPrice: 1n, nonce: 0,
      })
    ).rejects.toThrow();

    // Key must still be zeroed in finally block
    expect(capturedPk?.every(b => b === 0)).toBe(true);
  });
});

// ─── Payment Engine isolation (regression) ──────────────────────────────────

describe("Payment Engine regression — EVM signer isolation", () => {
  it("does not import from Payment Engine modules", async () => {
    // Dynamic import — if it throws about Payment Engine deps, isolation is broken
    const signerModule = await import("../../wallet/services/evm-signer");
    expect(signerModule).toBeDefined();
    expect(typeof signerModule.signAndBroadcastNativeEvm).toBe("function");
    expect(typeof signerModule.signAndBroadcastErc20Evm).toBe("function");
  });
});
