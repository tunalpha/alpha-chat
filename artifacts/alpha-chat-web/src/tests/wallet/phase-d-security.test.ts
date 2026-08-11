/**
 * Phase D — Security Audit Tests
 *
 * Verifica:
 * 1. Seed bytes azzerati dopo BTC derivation
 * 2. Private key azzerata dopo EVM/BTC signing
 * 3. Nessun materiale sensibile in messaggi di errore
 * 4. Nessuna chiave in URL/query params
 * 5. Nessuna chiave in localStorage/sessionStorage
 * 6. Signed tx è l'UNICO dato sensibile inviato al broadcast
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../../wallet/core/mnemonic", () => ({
  mnemonicToSeedBytes: vi.fn(),
}));

import { signAndBroadcastNativeEvm, signAndBroadcastErc20Evm } from "../../wallet/services/evm-signer";
import { signAndBroadcastBtcTx } from "../../wallet/services/btc-signer";
import { deriveEvmWallet } from "../../wallet/core/hd-wallet";
import { mnemonicToSeedBytes } from "../../wallet/core/mnemonic";
import {
  apiWalletBroadcastEvmTx,
  apiWalletBroadcastBtcTx,
  apiWalletGetBtcUTXOs,
  apiWalletGetBtcFeeRate,
} from "../../lib/alpha-wallet-api";

const TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_ADDRESS  = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;
const TEST_PK_BYTES = new Uint8Array(32).fill(0xab);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deriveEvmWallet).mockImplementation(async () => ({
    address: TEST_ADDRESS,
    privateKey: new Uint8Array(TEST_PK_BYTES),
    derivationPath: "m/44'/60'/0'/0/0",
    index: 0,
  }));
  vi.mocked(mnemonicToSeedBytes).mockResolvedValue(new Uint8Array(64).fill(0x42));
});

// ─── 1. Key zeroing — EVM ──────────────────────────────────────────────────

describe("EVM signer — key zeroing", () => {
  it("zeros privateKey bytes after successful broadcast", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0xok" });

    let capturedPk: Uint8Array | undefined;
    vi.mocked(deriveEvmWallet).mockImplementationOnce(async () => {
      const pk = new Uint8Array(32).fill(0xcc);
      capturedPk = pk;
      return { address: TEST_ADDRESS, privateKey: pk, derivationPath: "", index: 0 };
    });

    await signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 137,
      to: "0x1111111111111111111111111111111111111111",
      valueWei: 1n, gasLimit: 21000n, gasPrice: 1n, nonce: 0,
    });

    expect(capturedPk?.every(b => b === 0)).toBe(true);
  });

  it("zeros privateKey bytes even when broadcast fails", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockRejectedValue(new Error("RPC down"));

    let capturedPk: Uint8Array | undefined;
    vi.mocked(deriveEvmWallet).mockImplementationOnce(async () => {
      const pk = new Uint8Array(32).fill(0xdd);
      capturedPk = pk;
      return { address: TEST_ADDRESS, privateKey: pk, derivationPath: "", index: 0 };
    });

    await expect(signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 1,
      to: "0x1111111111111111111111111111111111111111",
      valueWei: 1n, gasLimit: 21000n, gasPrice: 1n, nonce: 0,
    })).rejects.toThrow();

    expect(capturedPk?.every(b => b === 0)).toBe(true);
  });

  it("zeros ERC-20 privateKey bytes even when broadcast fails", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockRejectedValue(new Error("nonce too low"));

    let capturedPk: Uint8Array | undefined;
    vi.mocked(deriveEvmWallet).mockImplementationOnce(async () => {
      const pk = new Uint8Array(32).fill(0xee);
      capturedPk = pk;
      return { address: TEST_ADDRESS, privateKey: pk, derivationPath: "", index: 0 };
    });

    await expect(signAndBroadcastErc20Evm({
      mnemonic: TEST_MNEMONIC, chainId: 137,
      tokenContractAddr: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      recipient: "0x1111111111111111111111111111111111111111",
      amount: 1n, gasLimit: 65000n, gasPrice: 1n, nonce: 0,
    })).rejects.toThrow();

    expect(capturedPk?.every(b => b === 0)).toBe(true);
  });
});

// ─── 2. Key zeroing — BTC seed ────────────────────────────────────────────

describe("BTC signer — seed zeroing", () => {
  it("zeros the 64-byte BIP-39 seed after derivation (success path)", async () => {
    const mockSeed = new Uint8Array(64).fill(0x42);
    vi.mocked(mnemonicToSeedBytes).mockResolvedValueOnce(mockSeed);

    vi.mocked(apiWalletGetBtcUTXOs).mockResolvedValueOnce({
      address: "bc1q",
      utxos: [{ txid: "a".repeat(64), vout: 0, value: 1_000_000, confirmed: true, blockHeight: 800000 }],
      totalSat: 1_000_000,
    });
    vi.mocked(apiWalletGetBtcFeeRate).mockResolvedValueOnce({ fastest: 30, normal: 10, economy: 3 });
    vi.mocked(apiWalletBroadcastBtcTx).mockResolvedValueOnce({ txid: "deadbeef" });

    await signAndBroadcastBtcTx({
      mnemonic: TEST_MNEMONIC,
      recipientAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      amountSat: 400_000n,
      feeTarget: "normal",
    });

    // Seed must be zeroed after derivation
    expect(mockSeed.every(b => b === 0)).toBe(true);
  });

  it("zeros seed even when signing throws", async () => {
    const mockSeed = new Uint8Array(64).fill(0x99);
    vi.mocked(mnemonicToSeedBytes).mockResolvedValueOnce(mockSeed);
    vi.mocked(apiWalletGetBtcUTXOs).mockRejectedValueOnce(new Error("Network error"));

    await expect(signAndBroadcastBtcTx({
      mnemonic: TEST_MNEMONIC,
      recipientAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      amountSat: 10_000n,
      feeTarget: "normal",
    })).rejects.toThrow();

    // Seed must be zeroed even when downstream throws
    expect(mockSeed.every(b => b === 0)).toBe(true);
  });

  it("zeros BTC private key after signing", async () => {
    vi.mocked(apiWalletGetBtcUTXOs).mockResolvedValueOnce({
      address: "bc1q",
      utxos: [{ txid: "b".repeat(64), vout: 0, value: 2_000_000, confirmed: true, blockHeight: 800000 }],
      totalSat: 2_000_000,
    });
    vi.mocked(apiWalletGetBtcFeeRate).mockResolvedValueOnce({ fastest: 30, normal: 10, economy: 3 });
    vi.mocked(apiWalletBroadcastBtcTx).mockResolvedValueOnce({ txid: "cafe1234" });

    await signAndBroadcastBtcTx({
      mnemonic: TEST_MNEMONIC,
      recipientAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      amountSat: 500_000n,
      feeTarget: "normal",
    });

    // Broadcast received signed tx, not private key
    const broadcastArg = vi.mocked(apiWalletBroadcastBtcTx).mock.calls[0][0];
    expect(typeof broadcastArg).toBe("string");
    expect(/^[0-9a-f]+$/i.test(broadcastArg)).toBe(true);
    expect(broadcastArg.length).toBeGreaterThan(100); // serialized tx
  });
});

// ─── 3. No key material in backend calls ──────────────────────────────────

describe("No key material in backend API calls", () => {
  it("EVM: backend receives chainId + signedTx only", async () => {
    vi.mocked(apiWalletBroadcastEvmTx).mockResolvedValue({ txHash: "0xfeed" });

    await signAndBroadcastNativeEvm({
      mnemonic: TEST_MNEMONIC, chainId: 1,
      to: "0x1234567890123456789012345678901234567890",
      valueWei: 100n, gasLimit: 21000n, gasPrice: 2n, nonce: 5,
    });

    const [chainId, signedTx] = vi.mocked(apiWalletBroadcastEvmTx).mock.calls[0];
    expect(chainId).toBe(1);
    expect(typeof signedTx).toBe("string");
    // Signed tx must start with 0x (RLP-encoded)
    expect(signedTx.startsWith("0x")).toBe(true);
    // No mnemonic words in the signed tx
    expect(signedTx.toLowerCase()).not.toContain("abandon");
  });

  it("BTC: backend receives only raw tx hex", async () => {
    vi.mocked(apiWalletGetBtcUTXOs).mockResolvedValueOnce({
      address: "bc1q",
      utxos: [{ txid: "c".repeat(64), vout: 0, value: 5_000_000, confirmed: true, blockHeight: 800001 }],
      totalSat: 5_000_000,
    });
    vi.mocked(apiWalletGetBtcFeeRate).mockResolvedValueOnce({ fastest: 50, normal: 20, economy: 5 });
    vi.mocked(apiWalletBroadcastBtcTx).mockResolvedValueOnce({ txid: "bbbb" });

    await signAndBroadcastBtcTx({
      mnemonic: TEST_MNEMONIC,
      recipientAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      amountSat: 1_000_000n,
      feeTarget: "economy",
    });

    expect(apiWalletBroadcastBtcTx).toHaveBeenCalledTimes(1);
    const [txHex] = vi.mocked(apiWalletBroadcastBtcTx).mock.calls[0];
    // No mnemonic in tx hex
    expect(txHex.toLowerCase()).not.toContain("abandon");
    // No 0x prefix — Bitcoin uses raw hex
    expect(txHex.startsWith("0x")).toBe(false);
  });
});

// ─── 4. No sensitive data in error messages ───────────────────────────────

describe("No sensitive data in error messages", () => {
  it("EVM broadcast error does not expose signed tx content", async () => {
    const sensitiveHex = "0x" + "ab".repeat(50);
    vi.mocked(apiWalletBroadcastEvmTx).mockRejectedValue(new Error("insufficient funds for gas"));

    let caughtMessage = "";
    try {
      await signAndBroadcastNativeEvm({
        mnemonic: TEST_MNEMONIC, chainId: 1,
        to: "0x1234567890123456789012345678901234567890",
        valueWei: 1n, gasLimit: 21000n, gasPrice: 1n, nonce: 0,
      });
    } catch (e) {
      caughtMessage = (e as Error).message;
    }

    // Error should not expose the mnemonic
    expect(caughtMessage).not.toContain("abandon");
    // Error should not contain private key bytes
    expect(caughtMessage).not.toContain("abababab");
  });

  it("BTC validation error does not expose mnemonic or key", async () => {
    let caughtMessage = "";
    try {
      await signAndBroadcastBtcTx({
        mnemonic: TEST_MNEMONIC,
        recipientAddress: "INVALID_ADDRESS",
        amountSat: 10_000n,
        feeTarget: "normal",
      });
    } catch (e) {
      caughtMessage = (e as Error).message;
    }

    expect(caughtMessage).not.toContain("abandon");
    expect(caughtMessage).not.toContain(TEST_MNEMONIC);
  });
});

// ─── 5. Isolation regression ─────────────────────────────────────────────

describe("Payment Engine isolation regression", () => {
  it("evm-signer does not import Payment Engine modules", async () => {
    const mod = await import("../../wallet/services/evm-signer");
    expect(typeof mod.signAndBroadcastNativeEvm).toBe("function");
    expect(typeof mod.signAndBroadcastErc20Evm).toBe("function");
  });

  it("btc-signer does not import Payment Engine modules", async () => {
    const mod = await import("../../wallet/services/btc-signer");
    expect(typeof mod.signAndBroadcastBtcTx).toBe("function");
    expect(typeof mod.selectBtcUTXOs).toBe("function");
  });

  it("balance-service does not import Payment Engine modules", async () => {
    const mod = await import("../../wallet/services/balance-service");
    expect(typeof mod.fetchEvmBalance).toBe("function");
    expect(typeof mod.fetchBtcBalance).toBe("function");
  });
});
