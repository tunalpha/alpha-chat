/**
 * Phase C — Price Service & Gas Service Tests
 *
 * Tests: fiat conversion EUR+USD, formatCrypto, parseAmount,
 *        gas estimation, ERC-20 calldata encoding.
 */

import { describe, it, expect, vi } from "vitest";
import {
  formatCrypto,
  formatFiat,
  parseAmount,
  getSymbolPrice,
  type AssetPrices,
} from "../../wallet/services/price-service";
import { buildErc20TransferData } from "../../wallet/services/gas-service";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("../../lib/alpha-wallet-api", () => ({
  apiWalletGetPrices: vi.fn(),
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
}));

const PRICES: AssetPrices = {
  eth:  { usd: 3000, eur: 2800 },
  pol:  { usd: 0.50, eur: 0.46 },
  bnb:  { usd: 600,  eur: 555  },
  btc:  { usd: 65000, eur: 60000 },
  usdt: { usd: 1, eur: 0.91 },
  usdc: { usd: 1, eur: 0.91 },
  usda: { usd: 1, eur: 0.91 },
};

// ─── formatCrypto ───────────────────────────────────────────────────────────

describe("formatCrypto", () => {
  it("formats 1 ETH correctly", () => {
    expect(formatCrypto(1_000_000_000_000_000_000n, 18, "ETH")).toBe("1 ETH");
  });

  it("formats 1.5 USDT (6 decimals)", () => {
    expect(formatCrypto(1_500_000n, 6, "USDT")).toBe("1.5 USDT");
  });

  it("formats 1 USDT (BSC — 18 decimals)", () => {
    expect(formatCrypto(1_000_000_000_000_000_000n, 18, "USDT")).toBe("1 USDT");
  });

  it("formats zero balance", () => {
    expect(formatCrypto(0n, 18, "ETH")).toBe("0 ETH");
  });

  it("formats fractional BTC (546 sat)", () => {
    const result = formatCrypto(546n, 8, "BTC");
    expect(result).toContain("BTC");
    expect(result).toContain("0.00000546");
  });

  it("trims trailing zeros in fractional part", () => {
    const result = formatCrypto(500_000n, 6, "USDT"); // 0.5 USDT
    expect(result).toBe("0.5 USDT");
  });
});

// ─── formatFiat ─────────────────────────────────────────────────────────────

describe("formatFiat", () => {
  it("formats 1 ETH as EUR correctly", () => {
    const result = formatFiat(1_000_000_000_000_000_000n, 18, PRICES.eth, "EUR");
    // Locale-agnostic: just check "2800" digits appear (locale can use '.' or ',' as separator)
    expect(result).toMatch(/2[\.,\s]?800/);
  });

  it("formats 100 USDT as USD correctly", () => {
    const result = formatFiat(100_000_000n, 6, PRICES.usdt, "USD");
    expect(result).toMatch(/100/);
  });

  it("returns — when price is null", () => {
    expect(formatFiat(1_000_000n, 6, null, "EUR")).toBe("—");
  });

  it("returns — when price is 0", () => {
    const zeroPrice = { usd: 0, eur: 0 };
    expect(formatFiat(1_000_000n, 6, zeroPrice, "EUR")).toBe("—");
  });

  it("handles BSC USDT with 18 decimals — should equal Polygon USDT at 6 decimals for same USD value", () => {
    // 1 USDT on BSC = 10^18 wei; 1 USDT on Polygon = 10^6 units
    const bscResult = formatFiat(1_000_000_000_000_000_000n, 18, PRICES.usdt, "EUR");
    const polyResult = formatFiat(1_000_000n, 6, PRICES.usdt, "EUR");
    // Both should represent €0.91
    expect(bscResult).toBe(polyResult);
  });
});

// ─── parseAmount ────────────────────────────────────────────────────────────

describe("parseAmount", () => {
  it("parses '1.5' as 6-decimal token", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
  });

  it("parses '1' ETH as wei", () => {
    expect(parseAmount("1", 18)).toBe(1_000_000_000_000_000_000n);
  });

  it("parses '0.00000001' BTC as satoshi", () => {
    expect(parseAmount("0.00000001", 8)).toBe(1n);
  });

  it("returns null for empty string", () => {
    expect(parseAmount("", 6)).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseAmount("abc", 6)).toBeNull();
  });

  it("returns null for negative", () => {
    expect(parseAmount("-1", 6)).toBeNull();
  });

  it("handles comma as decimal separator (Italian locale)", () => {
    // After comma→period normalization
    expect(parseAmount("1,5", 6)).toBe(1_500_000n);
  });

  it("truncates excess decimals (not rounds)", () => {
    // "1.123456789" with 6 decimals → 1.123456 (truncate extra)
    const result = parseAmount("1.123456789", 6);
    expect(result).toBe(1_123_456n); // truncated to 6 places
  });
});

// ─── getSymbolPrice ─────────────────────────────────────────────────────────

describe("getSymbolPrice", () => {
  it("returns price for known symbol", () => {
    const p = getSymbolPrice(PRICES, "ETH");
    expect(p?.usd).toBe(3000);
    expect(p?.eur).toBe(2800);
  });

  it("is case-insensitive", () => {
    expect(getSymbolPrice(PRICES, "eth")).toEqual(getSymbolPrice(PRICES, "ETH"));
  });

  it("returns null for unknown symbol", () => {
    expect(getSymbolPrice(PRICES, "SHIB")).toBeNull();
  });

  it("returns stablecoin price for USDA", () => {
    const p = getSymbolPrice(PRICES, "USDA");
    expect(p?.usd).toBe(1);
    expect(p?.eur).toBe(0.91);
  });
});

// ─── buildErc20TransferData ─────────────────────────────────────────────────

describe("buildErc20TransferData", () => {
  it("produces valid ABI-encoded transfer calldata", () => {
    const data = buildErc20TransferData(
      "0x1234567890123456789012345678901234567890",
      1_000_000n, // 1 USDT
    );
    // Method selector for transfer(address,uint256) = 0xa9059cbb
    expect(data.startsWith("0xa9059cbb")).toBe(true);
    // Total: 4 bytes selector + 32 bytes address + 32 bytes uint256 = 68 bytes = 136 hex chars + "0x"
    expect(data.length).toBe(138);
  });

  it("encodes recipient address correctly", () => {
    const recipient = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const data = buildErc20TransferData(recipient as `0x${string}`, 100n);
    // Address should appear in the data (zero-padded to 32 bytes)
    expect(data.toLowerCase()).toContain("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  });

  it("encodes different amounts correctly", () => {
    const data1 = buildErc20TransferData("0x1234567890123456789012345678901234567890", 1n);
    const data2 = buildErc20TransferData("0x1234567890123456789012345678901234567890", 1_000_000n);
    expect(data1).not.toBe(data2);
    // Both should have the same method selector
    expect(data1.slice(0, 10)).toBe(data2.slice(0, 10));
  });
});
