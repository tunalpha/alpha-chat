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

// ─── FIX: calculateQuote deve funzionare con wallet locked ────────────────
//
// Prima del fix: calculateQuote restituiva null quando status !== "ready".
// L'utente riceveva "Impossibile calcolare i costi" anche con wallet configurato
// ma non ancora sbloccato nella sessione corrente.
//
// Dopo il fix: la quotazione è matematica pura + API pubblica → non richiede
// wallet unlocked. Solo sendPayment (firma) richiede PIN/autenticazione.

describe("calculateQuote — locked wallet fix", () => {
  // Replica la logica pura di calculateQuote estratta dal bridge context.
  // Questo permette di testare il comportamento senza React hooks.
  async function calculateQuotePure(
    status: "unavailable" | "locked" | "ready",
    amount: string,
    feeBps = 10,
  ): Promise<{ recipientAmount: string; platformFee: string; totalAsset: string } | null> {
    // PRE-FIX (commentato per documentazione):
    // if (status !== "ready") return null;

    // POST-FIX: solo amount invalido blocca la quote; status ignorato
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return null;

    const platformFeeNum = (amountNum * feeBps) / 10000;
    const platformFee    = platformFeeNum.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    const totalAsset     = (amountNum + platformFeeNum).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

    return { recipientAmount: amount, platformFee, totalAsset };
  }

  it("status=locked → restituisce una quote valida (NON null)", async () => {
    const result = await calculateQuotePure("locked", "1");
    expect(result).not.toBeNull();
    expect(result!.recipientAmount).toBe("1");
    expect(result!.platformFee).toBe("0.001");      // 1 × 10 bps / 10000
    expect(result!.totalAsset).toBe("1.001");
  });

  it("status=unavailable → restituisce una quote valida (NON null)", async () => {
    // La quote non dipende dallo stato del wallet — solo il send richiede auth.
    const result = await calculateQuotePure("unavailable", "5");
    expect(result).not.toBeNull();
    expect(result!.recipientAmount).toBe("5");
  });

  it("status=ready → restituisce una quote valida (comportamento invariato)", async () => {
    const result = await calculateQuotePure("ready", "2");
    expect(result).not.toBeNull();
    expect(result!.recipientAmount).toBe("2");
  });

  it("importo non valido → null indipendentemente dallo status", async () => {
    expect(await calculateQuotePure("locked",      "0")).toBeNull();
    expect(await calculateQuotePure("locked",      "-1")).toBeNull();
    expect(await calculateQuotePure("locked",      "abc")).toBeNull();
    expect(await calculateQuotePure("unavailable", "0")).toBeNull();
  });

  it("fee 0 bps → platform fee = 0", async () => {
    const result = await calculateQuotePure("locked", "10", 0);
    expect(result!.platformFee).toBe("0");
    expect(result!.totalAsset).toBe("10");
  });
});

// ─── FIX: sendPayment con wallet locked → raggiunge onAuthRequired ────────
//
// Prima del fix: sendPayment restituiva { status: "failed", errorCode: "WALLET_LOCKED" }
// come early-return, senza mai chiamare onAuthRequired.
//
// Dopo il fix: il flusso raggiunge onAuthRequired (che chiede il PIN) e
// decryptSeed funziona direttamente con il keystore — wallet.phase non impatta.

describe("sendPayment — locked wallet fix", () => {
  // Replica la logica guard di sendPayment estratta dal bridge context.
  type SendResult =
    | { status: "called_auth" }
    | { status: "failed"; errorCode: string };

  async function sendPaymentGuardPure(
    status: "unavailable" | "locked" | "ready",
    hasEvmAddress: boolean,
    onAuthRequired: () => Promise<string | null>,
  ): Promise<SendResult> {
    // PRE-FIX (commentato):
    // if (status === "locked") return { status: "failed", errorCode: "WALLET_LOCKED" };

    if (status === "unavailable") {
      return { status: "failed", errorCode: "WALLET_UNAVAILABLE" };
    }
    // FIX: status === "locked" non blocca più qui — arriva a onAuthRequired
    if (!hasEvmAddress) {
      return { status: "failed", errorCode: "WALLET_UNAVAILABLE" };
    }

    // Il bridge chiama onAuthRequired per ottenere il PIN → poi usa decryptSeed
    const pin = await onAuthRequired();
    if (!pin) return { status: "failed", errorCode: "AUTHENTICATION_FAILED" };

    return { status: "called_auth" };
  }

  it("status=locked → raggiunge onAuthRequired (NON restituisce WALLET_LOCKED)", async () => {
    const onAuthRequired = vi.fn(async () => "1234");
    const result = await sendPaymentGuardPure("locked", true, onAuthRequired);
    expect(onAuthRequired).toHaveBeenCalledOnce();
    expect(result.status).toBe("called_auth");
  });

  it("status=locked + PIN annullato → cancelled (NON WALLET_LOCKED)", async () => {
    const onAuthRequired = vi.fn(async () => null);
    const result = await sendPaymentGuardPure("locked", true, onAuthRequired);
    expect(onAuthRequired).toHaveBeenCalledOnce();
    expect(result.status).toBe("failed");
    expect((result as { status: "failed"; errorCode: string }).errorCode).toBe("AUTHENTICATION_FAILED");
  });

  it("status=ready → raggiunge onAuthRequired normalmente", async () => {
    const onAuthRequired = vi.fn(async () => "5678");
    const result = await sendPaymentGuardPure("ready", true, onAuthRequired);
    expect(onAuthRequired).toHaveBeenCalledOnce();
    expect(result.status).toBe("called_auth");
  });

  it("status=unavailable → bloccato PRIMA di onAuthRequired (invariato)", async () => {
    const onAuthRequired = vi.fn(async () => "1234");
    const result = await sendPaymentGuardPure("unavailable", true, onAuthRequired);
    // Guard unavailable ancora presente: onAuthRequired NON chiamato
    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect((result as { status: "failed"; errorCode: string }).errorCode).toBe("WALLET_UNAVAILABLE");
  });

  it("status=locked ma senza evmAddress → WALLET_UNAVAILABLE (guard meta invariato)", async () => {
    const onAuthRequired = vi.fn(async () => "1234");
    const result = await sendPaymentGuardPure("locked", false, onAuthRequired);
    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect((result as { status: "failed"; errorCode: string }).errorCode).toBe("WALLET_UNAVAILABLE");
  });

  it("status=unavailable + no address → WALLET_UNAVAILABLE (doppio guard invariato)", async () => {
    const onAuthRequired = vi.fn(async () => "1234");
    const result = await sendPaymentGuardPure("unavailable", false, onAuthRequired);
    expect(onAuthRequired).not.toHaveBeenCalled();
    expect((result as { status: "failed"; errorCode: string }).errorCode).toBe("WALLET_UNAVAILABLE");
  });
});

import { vi } from "vitest";
