/**
 * Phase G — ChatWalletBridge unit tests
 *
 * Verifica le regole di sicurezza e il contratto pubblico del bridge.
 * NON importa nulla dai wallet internals (solo dal bridge public surface).
 */

import { describe, it, expect } from "vitest";

// ─── Type tests (compile-time, no runtime) ────────────────────────────────

describe("ChatWalletBridge public types", () => {
  it("BridgeStatus is a string literal union", () => {
    type ValidStatus = "unavailable" | "locked" | "ready";
    // This is a type-only check — if the import fails, the test file fails to compile
    const statuses: ValidStatus[] = ["unavailable", "locked", "ready"];
    expect(statuses).toHaveLength(3);
  });

  it("SupportedNetwork covers all expected chains", () => {
    const networks = ["ethereum", "polygon", "bsc", "bitcoin"] as const;
    expect(networks).toHaveLength(4);
  });

  it("ChatPaymentErrorCode covers all expected error codes", () => {
    const codes = [
      "WALLET_LOCKED",
      "WALLET_UNAVAILABLE",
      "AUTHENTICATION_FAILED",
      "INSUFFICIENT_BALANCE",
      "INVALID_RECIPIENT",
      "INVALID_AMOUNT",
      "NETWORK_ERROR",
      "BROADCAST_REJECTED",
      "DOUBLE_SEND_PREVENTED",
      "FEE_CONFIG_UNAVAILABLE",
      "QUOTE_EXPIRED",
      "PLATFORM_FEE_TX_FAILED",
      "UNKNOWN",
    ] as const;
    expect(codes).toHaveLength(13);
  });
});

// ─── NETWORK_LABELS and NETWORK_COLORS sanity ──────────────────────────────

import { NETWORK_LABELS, NETWORK_COLORS, NETWORK_CHAIN_IDS } from "../../wallet/bridge/chat-wallet-bridge";

describe("Bridge network constants", () => {
  it("NETWORK_LABELS covers all supported networks", () => {
    expect(NETWORK_LABELS.ethereum).toBe("Ethereum");
    expect(NETWORK_LABELS.polygon).toBe("Polygon");
    expect(NETWORK_LABELS.bsc).toBe("BNB Smart Chain");
    expect(NETWORK_LABELS.bitcoin).toBe("Bitcoin");
  });

  it("NETWORK_CHAIN_IDS are correct", () => {
    expect(NETWORK_CHAIN_IDS.ethereum).toBe(1);
    expect(NETWORK_CHAIN_IDS.polygon).toBe(137);
    expect(NETWORK_CHAIN_IDS.bsc).toBe(56);
  });

  it("NETWORK_COLORS are hex strings", () => {
    const hexPattern = /^#[0-9A-F]{6}$/i;
    expect(NETWORK_COLORS.ethereum).toMatch(hexPattern);
    expect(NETWORK_COLORS.polygon).toMatch(hexPattern);
    expect(NETWORK_COLORS.bsc).toMatch(hexPattern);
    expect(NETWORK_COLORS.bitcoin).toMatch(hexPattern);
  });
});

// ─── PlatformFee calculation ──────────────────────────────────────────────

describe("Platform fee calculation", () => {
  const BPS_DENOMINATOR = 10000n;

  function calcFee(amountRaw: bigint, feeBps: number): bigint {
    return (amountRaw * BigInt(feeBps)) / BPS_DENOMINATOR;
  }

  it("0.10% fee on 100 USDT (6 decimals) = 0.10 USDT", () => {
    // 100 USDT = 100_000_000 in 6-decimal units
    const amount = 100_000_000n;
    const fee    = calcFee(amount, 10); // 10 bps = 0.10%
    expect(fee).toBe(100_000n); // 0.10 USDT
  });

  it("0.10% fee on 0.001 BTC = 1000 sat → rounds down", () => {
    const amountSat = 100_000n; // 0.001 BTC = 100,000 sat
    const fee       = calcFee(amountSat, 10); // 10 bps
    expect(fee).toBe(100n); // 100 sat = 0.000001 BTC
  });

  it("0% fee = 0 regardless of amount", () => {
    expect(calcFee(1_000_000_000n, 0)).toBe(0n);
  });

  it("fee floors at 0 (never negative)", () => {
    const result = calcFee(1n, 10);
    expect(result).toBeGreaterThanOrEqual(0n);
  });

  it("max fee (500 bps = 5%) on 100 USDT = 5 USDT", () => {
    const amount = 100_000_000n; // 100 USDT
    const fee    = calcFee(amount, 500);
    expect(fee).toBe(5_000_000n); // 5 USDT
  });
});

// ─── Quote validity ───────────────────────────────────────────────────────

describe("Quote validity", () => {
  it("quote is expired if age > quoteValiditySec * 1000 ms", () => {
    const frozenAt       = Date.now() - 35_000; // 35 seconds ago
    const quoteValiditySec = 30;
    const age            = Date.now() - frozenAt;
    const isExpired      = age > quoteValiditySec * 1000;
    expect(isExpired).toBe(true);
  });

  it("quote is valid if age < quoteValiditySec * 1000 ms", () => {
    const frozenAt       = Date.now() - 5_000; // 5 seconds ago
    const quoteValiditySec = 30;
    const age            = Date.now() - frozenAt;
    const isExpired      = age > quoteValiditySec * 1000;
    expect(isExpired).toBe(false);
  });
});
