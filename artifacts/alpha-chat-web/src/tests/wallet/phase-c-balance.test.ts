/**
 * Phase C — Balance Service Tests
 *
 * Tests: ETH balance, ERC-20 balance, BTC balance, decimals,
 *        portfolio calculation, error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchEvmBalance,
  fetchBtcBalance,
  calcPortfolioValue,
} from "../../wallet/services/balance-service";
import type { AssetPrices } from "../../wallet/services/price-service";
import { formatCrypto } from "../../wallet/services/price-service";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("../../lib/alpha-wallet-api", () => ({
  apiWalletGetEvmBalance: vi.fn(),
  apiWalletGetBtcBalance: vi.fn(),
  apiWalletGetTokenInfo:  vi.fn(),
  apiWalletGetEvmTransactions: vi.fn(),
  apiWalletGetBtcTransactions: vi.fn(),
  apiWalletGetGasEstimate: vi.fn(),
  apiWalletBroadcastEvmTx: vi.fn(),
  apiWalletGetBtcUTXOs: vi.fn(),
  apiWalletGetBtcFeeRate: vi.fn(),
  apiWalletBroadcastBtcTx: vi.fn(),
  apiWalletGetPrices: vi.fn(),
}));

vi.mock("../../wallet/evm/token-registry", () => ({
  getVerifiedTokens: vi.fn().mockReturnValue([]),
  buildCustomTokenPreview: vi.fn(),
  USDA_CONTRACT_POLYGON: "0x23396cF899Ca06c4472205fC903bDB4de249D6f",
}));

import { apiWalletGetEvmBalance, apiWalletGetBtcBalance } from "../../lib/alpha-wallet-api";

const mockPrices: AssetPrices = {
  eth:  { usd: 3000, eur: 2800 },
  pol:  { usd: 0.50, eur: 0.46 },
  bnb:  { usd: 600,  eur: 555  },
  btc:  { usd: 65000, eur: 60000 },
  usdt: { usd: 1, eur: 0.91 },
  usdc: { usd: 1, eur: 0.91 },
  usda: { usd: 1, eur: 0.91 },
};

// ─── EVM Balance ────────────────────────────────────────────────────────────

describe("fetchEvmBalance — ETH native", () => {
  it("returns native ETH balance from backend", async () => {
    vi.mocked(apiWalletGetEvmBalance).mockResolvedValueOnce({
      chainId: 1,
      address: "0xabc",
      native:  { symbol: "ETH", name: "Ethereum", balance: "1000000000000000000", decimals: 18 },
      tokens:  [],
    });

    const result = await fetchEvmBalance(1, "0xabc" as `0x${string}`);

    expect(result.chainId).toBe(1);
    expect(result.native.symbol).toBe("ETH");
    expect(result.native.rawBalance).toBe(1_000_000_000_000_000_000n); // 1 ETH
    expect(result.native.decimals).toBe(18);
    expect(result.native.formatted).toContain("ETH");
  });
});

describe("fetchEvmBalance — Polygon POL", () => {
  it("returns POL native balance", async () => {
    vi.mocked(apiWalletGetEvmBalance).mockResolvedValueOnce({
      chainId: 137,
      address: "0xdef",
      native:  { symbol: "POL", name: "Polygon", balance: "5500000000000000000", decimals: 18 },
      tokens:  [],
    });

    const result = await fetchEvmBalance(137, "0xdef" as `0x${string}`);
    expect(result.native.rawBalance).toBe(5_500_000_000_000_000_000n);
    expect(result.native.symbol).toBe("POL");
  });
});

describe("fetchEvmBalance — ERC-20 tokens", () => {
  it("returns USDT balance with correct decimals (6 for Polygon USDT)", async () => {
    vi.mocked(apiWalletGetEvmBalance).mockResolvedValueOnce({
      chainId: 137,
      address: "0xabc",
      native:  { symbol: "POL", name: "Polygon", balance: "0", decimals: 18 },
      tokens: [{
        symbol:          "USDT",
        name:            "Tether USD",
        balance:         "1500000", // 1.5 USDT at 6 decimals
        decimals:        6,
        contractAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      }],
    });

    const result = await fetchEvmBalance(137, "0xabc" as `0x${string}`);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].symbol).toBe("USDT");
    expect(result.tokens[0].rawBalance).toBe(1_500_000n);
    expect(result.tokens[0].decimals).toBe(6);
    expect(result.tokens[0].formatted).toContain("USDT");
  });

  it("handles BSC USDT with 18 decimals correctly", async () => {
    vi.mocked(apiWalletGetEvmBalance).mockResolvedValueOnce({
      chainId: 56,
      address: "0xabc",
      native:  { symbol: "BNB", name: "BNB", balance: "0", decimals: 18 },
      tokens: [{
        symbol:          "USDT",
        name:            "Tether USD (BSC)",
        balance:         "2000000000000000000", // 2 USDT at 18 decimals (BSC)
        decimals:        18,
        contractAddress: "0x55d398326f99059ff775485246999027b3197955",
      }],
    });

    const result = await fetchEvmBalance(56, "0xabc" as `0x${string}`);
    const usdtToken = result.tokens.find(t => t.symbol === "USDT")!;
    expect(usdtToken.decimals).toBe(18);
    expect(usdtToken.rawBalance).toBe(2_000_000_000_000_000_000n);
  });

  it("handles zero balance tokens", async () => {
    vi.mocked(apiWalletGetEvmBalance).mockResolvedValueOnce({
      chainId: 137,
      address: "0xabc",
      native:  { symbol: "POL", name: "Polygon", balance: "0", decimals: 18 },
      tokens: [{ symbol: "USDC", name: "USD Coin", balance: "0", decimals: 6, contractAddress: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174" }],
    });

    const result = await fetchEvmBalance(137, "0xabc" as `0x${string}`);
    expect(result.tokens[0].rawBalance).toBe(0n);
    expect(result.tokens[0].formatted).toContain("0");
  });
});

// ─── BTC Balance ────────────────────────────────────────────────────────────

describe("fetchBtcBalance", () => {
  it("returns confirmed satoshi balance from backend", async () => {
    vi.mocked(apiWalletGetBtcBalance).mockResolvedValueOnce({
      address:         "bc1qtest",
      confirmedSat:    100_000_000,  // 1 BTC
      mempoolDeltaSat: 0,
      totalSat:        100_000_000,
      confirmedBtc:    "1.00000000",
      txCount:         5,
    });

    const result = await fetchBtcBalance("bc1qtest");
    expect(result.confirmedSat).toBe(100_000_000n);
    expect(result.formatted).toBe("1.00000000 BTC");
    expect(result.txCount).toBe(5);
  });

  it("handles zero BTC balance", async () => {
    vi.mocked(apiWalletGetBtcBalance).mockResolvedValueOnce({
      address: "bc1qempty", confirmedSat: 0, mempoolDeltaSat: 0,
      totalSat: 0, confirmedBtc: "0.00000000", txCount: 0,
    });

    const result = await fetchBtcBalance("bc1qempty");
    expect(result.confirmedSat).toBe(0n);
    expect(result.formatted).toContain("0");
  });

  it("propagates backend error", async () => {
    vi.mocked(apiWalletGetBtcBalance).mockRejectedValueOnce(new Error("INVALID_BTC_ADDRESS"));
    await expect(fetchBtcBalance("invalid")).rejects.toThrow("INVALID_BTC_ADDRESS");
  });
});

// ─── Portfolio Value ────────────────────────────────────────────────────────

describe("calcPortfolioValue", () => {
  it("calculates ETH portfolio in EUR", async () => {
    vi.mocked(apiWalletGetEvmBalance).mockResolvedValueOnce({
      chainId: 1, address: "0xabc",
      native: { symbol: "ETH", name: "Ethereum", balance: "1000000000000000000", decimals: 18 },
      tokens: [],
    });

    const chainBal = await fetchEvmBalance(1, "0xabc" as `0x${string}`);
    const total = calcPortfolioValue([chainBal], null, mockPrices, "EUR");
    // 1 ETH * €2800 = €2800
    expect(total).toBeCloseTo(2800, 0);
  });

  it("includes ERC-20 tokens in total", async () => {
    vi.mocked(apiWalletGetEvmBalance).mockResolvedValueOnce({
      chainId: 137, address: "0xabc",
      native:  { symbol: "POL", name: "Polygon", balance: "10000000000000000000", decimals: 18 }, // 10 POL
      tokens: [{ symbol: "USDT", name: "Tether", balance: "5000000", decimals: 6, contractAddress: "0xc2132..." }], // 5 USDT
    });

    const chainBal = await fetchEvmBalance(137, "0xabc" as `0x${string}`);
    const total = calcPortfolioValue([chainBal], null, mockPrices, "EUR");
    // 10 POL * €0.46 + 5 USDT * €0.91 = 4.6 + 4.55 = €9.15
    expect(total).toBeCloseTo(9.15, 1);
  });

  it("includes BTC in portfolio total", async () => {
    const btcBalance = {
      confirmedSat: 50_000_000n, // 0.5 BTC
      totalSat:     50_000_000n,
      formatted:    "0.50000000 BTC",
      txCount:      1,
      fetchedAt:    Date.now(),
    };
    const total = calcPortfolioValue([], btcBalance, mockPrices, "EUR");
    // 0.5 BTC * €60000 = €30000
    expect(total).toBeCloseTo(30000, 0);
  });

  it("returns null when prices are null", () => {
    const total = calcPortfolioValue([], null, null, "EUR");
    expect(total).toBeNull();
  });
});
