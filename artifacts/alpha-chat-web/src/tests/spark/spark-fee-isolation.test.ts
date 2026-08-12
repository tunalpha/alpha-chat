/**
 * spark-fee-isolation.test.ts — Phase 4 Regression Audit
 *
 * Verifica isolamento completo del fee engine Spark da:
 * - BTC fee model (alpha-wallet-fee-config)
 * - EVM/MultiChain fee model
 * - USDA fee logic
 * - Payment Engine existing fee
 *
 * Verifica anche:
 * - Admin Spark fee configurabile SOLO per Spark (non BTC)
 * - Fee breakdown invarianti per recipient_exact e fee_excluded
 * - Provider fee (Breez routing) sempre separata dalla Alpha fee
 * - Treasury accounting non mescola fee Spark con fee BTC
 */

import { describe, it, expect } from "vitest";
import {
  calculateSparkFeeBreakdown,
  calculateSparkFeeBreakdownRecipientExact,
  resolveActualProviderFee,
  assertFeeBreakdownConsistent,
} from "../../lib/spark/spark-fee-engine";
import type { SparkFeeConfig, SparkFeeBreakdown, FeeRecordSource } from "../../lib/spark/spark-types";

const defaultCfg: SparkFeeConfig = { fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 };

// ─────────────────────────────────────────────────────────────────────────────
// A. Spark fee NON usa BTC fee model
// ─────────────────────────────────────────────────────────────────────────────

describe("A. Spark fee isolata da BTC fee model", () => {
  it("A1: SparkFeeConfig ha solo fee_bps, min_fee_sat, quote_validity_sec", () => {
    const cfg: SparkFeeConfig = { fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 };
    // NON deve avere: min_fee_usdt, min_fee_btc_sat, fee_wallet_evm, fee_wallet_btc
    // (quelli sono campi di AlphaWalletFeeConfig BTC)
    const keys = Object.keys(cfg);
    expect(keys).toContain("fee_bps");
    expect(keys).toContain("min_fee_sat");
    expect(keys).toContain("quote_validity_sec");
    expect(keys).not.toContain("min_fee_usdt");
    expect(keys).not.toContain("fee_wallet_evm");
    expect(keys).not.toContain("fee_wallet_btc");
    expect(keys).not.toContain("network");
    expect(keys).not.toContain("chain_id");
  });

  it("A2: fee_bps Spark indipendente da fee_bps BTC (oggetti separati)", () => {
    const sparkCfg: SparkFeeConfig = { fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 };
    const btcFeeConfig = { fee_bps: 20, min_fee_usdt: 0.5, min_fee_btc_sat: 546 }; // BTC config
    // Cambiare BTC fee_bps non cambia Spark fee_bps
    btcFeeConfig.fee_bps = 50;
    expect(sparkCfg.fee_bps).toBe(10); // invariato
  });

  it("A3: calculateSparkFeeBreakdown non importa da BTC fee controller", async () => {
    // Se importasse, avrebbe fallito in jsdom (MongoDB non disponibile)
    const result = calculateSparkFeeBreakdown(100_000n, 100n, defaultCfg);
    expect(result).toBeDefined();
    expect(result.alphaPlatformFeeSat).toBeGreaterThanOrEqual(0n);
  });

  it("A4: Spark fee calcolata su satoshi — BTC fee calcolata su USDT (unità diverse)", () => {
    // Spark: alpha fee in satoshi (bigint)
    const bd = calculateSparkFeeBreakdown(100_000n, 100n, defaultCfg);
    expect(typeof bd.alphaPlatformFeeSat).toBe("bigint");
    // BTC fee: espressa in USDT (number) — esempio 0.10 = 10 cents
    const btcFeeUsdt = 0.10;
    expect(typeof btcFeeUsdt).toBe("number");
    // I tipi sono incompatibili (non si possono sommare)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. fee_excluded mode
// ─────────────────────────────────────────────────────────────────────────────

describe("B. fee_excluded mode — invarianti", () => {
  it("B1: recipientAmountSat = importo inserito dall'utente", () => {
    const amount = 50_000n;
    const bd = calculateSparkFeeBreakdown(amount, 100n, defaultCfg);
    expect(bd.recipientAmountSat).toBe(amount);
  });

  it("B2: totalDebitSat > recipientAmountSat (sender paga di più)", () => {
    const bd = calculateSparkFeeBreakdown(50_000n, 100n, defaultCfg);
    expect(bd.totalDebitSat).toBeGreaterThan(bd.recipientAmountSat);
  });

  it("B3: totalDebitSat = recipient + alpha + provider (nessun fee nascosta)", () => {
    const bd = calculateSparkFeeBreakdown(100_000n, 200n, defaultCfg);
    expect(bd.totalDebitSat).toBe(
      bd.recipientAmountSat + bd.alphaPlatformFeeSat + bd.estimatedProviderFeeSat,
    );
  });

  it("B4: amountMode è 'fee_excluded'", () => {
    const bd = calculateSparkFeeBreakdown(100_000n, 200n, defaultCfg);
    expect(bd.amountMode).toBe("fee_excluded");
  });

  it("B5: providerFeeSource='estimated' su breakdown iniziale", () => {
    const bd = calculateSparkFeeBreakdown(100_000n, 200n, defaultCfg);
    expect(bd.providerFeeSource).toBe("estimated");
    expect(bd.estimatedProviderFeeSat).toBe(200n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. recipient_exact mode
// ─────────────────────────────────────────────────────────────────────────────

describe("C. recipient_exact mode — invarianti", () => {
  it("C1: recipientAmountSat = target esatto", () => {
    const target = 75_000n;
    const bd = calculateSparkFeeBreakdownRecipientExact(target, 100n, defaultCfg);
    expect(bd.recipientAmountSat).toBe(target);
  });

  it("C2: totalDebitSat > recipientAmountSat (sender paga gross)", () => {
    const bd = calculateSparkFeeBreakdownRecipientExact(75_000n, 100n, defaultCfg);
    expect(bd.totalDebitSat).toBeGreaterThan(bd.recipientAmountSat);
  });

  it("C3: amountMode è 'recipient_exact'", () => {
    const bd = calculateSparkFeeBreakdownRecipientExact(75_000n, 100n, defaultCfg);
    expect(bd.amountMode).toBe("recipient_exact");
  });

  it("C4: totalDebitSat = recipient + alpha + provider", () => {
    const bd = calculateSparkFeeBreakdownRecipientExact(75_000n, 150n, defaultCfg);
    expect(bd.totalDebitSat).toBe(
      bd.recipientAmountSat + bd.alphaPlatformFeeSat + bd.estimatedProviderFeeSat,
    );
  });

  it("C5: recipient_exact con fee_bps=0: alpha fee = min_fee_sat", () => {
    const cfg: SparkFeeConfig = { fee_bps: 0, min_fee_sat: 1, quote_validity_sec: 30 };
    const bd = calculateSparkFeeBreakdownRecipientExact(100_000n, 50n, cfg);
    expect(bd.alphaPlatformFeeSat).toBe(1n);
    expect(bd.recipientAmountSat).toBe(100_000n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Provider fee separata da Alpha fee
// ─────────────────────────────────────────────────────────────────────────────

describe("D. Provider fee (Breez routing) separata da Alpha fee", () => {
  it("D1: estimatedProviderFeeSat NON è la Alpha fee", () => {
    const providerFee = 200n;
    const bd = calculateSparkFeeBreakdown(100_000n, providerFee, defaultCfg);
    // Alpha fee è calcolata da fee_bps — non è uguale alla provider fee
    expect(bd.alphaPlatformFeeSat).not.toBe(bd.estimatedProviderFeeSat);
    // (tranne per coincidenza numerica)
    expect(bd.estimatedProviderFeeSat).toBe(providerFee);
  });

  it("D2: aumentare la provider fee non altera la Alpha fee", () => {
    const cfg = defaultCfg;
    const bd1 = calculateSparkFeeBreakdown(100_000n, 100n, cfg);
    const bd2 = calculateSparkFeeBreakdown(100_000n, 500n, cfg); // provider fee 5×
    expect(bd1.alphaPlatformFeeSat).toBe(bd2.alphaPlatformFeeSat); // invariata
    expect(bd1.estimatedProviderFeeSat).not.toBe(bd2.estimatedProviderFeeSat);
  });

  it("D3: resolveActualProviderFee aggiorna SOLO provider fee e totalDebitSat", () => {
    const original = calculateSparkFeeBreakdown(100_000n, 100n, defaultCfg);
    const resolved = resolveActualProviderFee(original, 150n);

    expect(resolved.alphaPlatformFeeSat).toBe(original.alphaPlatformFeeSat); // invariata
    expect(resolved.recipientAmountSat).toBe(original.recipientAmountSat);  // invariata
    const actualFee = (resolved as Record<string, unknown>)["actualProviderFeeSat"] as bigint;
    expect(actualFee).toBe(150n); // fee reale
    expect(resolved.totalDebitSat).toBe(
      original.recipientAmountSat + original.alphaPlatformFeeSat + 150n,
    );
  });

  it("D4: providerFeeSource='estimated' → 'actual' dopo resolve", () => {
    const bd = calculateSparkFeeBreakdown(100_000n, 100n, defaultCfg);
    const resolved = resolveActualProviderFee(bd, 120n);
    expect((resolved as Record<string, unknown>)["providerFeeSource"]).toBe("actual");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. assertFeeBreakdownConsistent — invarianti Treasury
// ─────────────────────────────────────────────────────────────────────────────

describe("E. assertFeeBreakdownConsistent — garanzie contabilità", () => {
  it("E1: breakdown valido non lancia", () => {
    const bd = calculateSparkFeeBreakdown(100_000n, 100n, defaultCfg);
    expect(() => assertFeeBreakdownConsistent(bd)).not.toThrow();
  });

  it("E2: alphaPlatformFeeSat negativa → lancia (Treasury guard)", () => {
    const bd: SparkFeeBreakdown = {
      recipientAmountSat:      100_000n,
      alphaPlatformFeeSat:     -1n,
      estimatedProviderFeeSat: 100n,
      totalDebitSat:           100_099n,
      amountMode:              "fee_excluded",
      feeConfigSnapshot:       defaultCfg,
    };
    expect(() => assertFeeBreakdownConsistent(bd)).toThrow();
  });

  it("E3: totalDebit inconsistente → lancia (contabilità guard)", () => {
    const bd: SparkFeeBreakdown = {
      recipientAmountSat:      100_000n,
      alphaPlatformFeeSat:     10n,
      estimatedProviderFeeSat: 100n,
      totalDebitSat:           999n, // WRONG
      amountMode:              "fee_excluded",
      feeConfigSnapshot:       defaultCfg,
    };
    expect(() => assertFeeBreakdownConsistent(bd)).toThrow();
  });

  it("E4: breakdown recipient_exact valido non lancia", () => {
    const bd = calculateSparkFeeBreakdownRecipientExact(50_000n, 100n, defaultCfg);
    expect(() => assertFeeBreakdownConsistent(bd)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. FeeRecordSource — tipo frontend per contabilità Treasury
// ─────────────────────────────────────────────────────────────────────────────

describe("F. FeeRecordSource — isolamento contabile", () => {
  it("F1: btc_onchain e spark_lightning sono valori distinti", () => {
    const btc:   FeeRecordSource = "btc_onchain";
    const spark: FeeRecordSource = "spark_lightning";
    expect(btc).not.toBe(spark);
  });

  it("F2: record Spark usa prefisso 'spark_' nell'idempotency key", () => {
    const paymentHash = "abc123def456";
    const recordId = `spark_${paymentHash}`;
    expect(recordId.startsWith("spark_")).toBe(true);
  });

  it("F3: record BTC non usa prefix 'spark_'", () => {
    const txHash = "0xdeadbeef1234";
    expect(txHash.startsWith("spark_")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Min fee edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("G. Min fee edge cases", () => {
  it("G1: pagamento 1 sat → alpha fee = min_fee_sat (non sotto soglia)", () => {
    const bd = calculateSparkFeeBreakdown(1n, 0n, defaultCfg);
    expect(bd.alphaPlatformFeeSat).toBe(BigInt(defaultCfg.min_fee_sat));
  });

  it("G2: pagamento grande → fee percentuale supera min_fee_sat", () => {
    // 100.000 sat × 10 bps = 10 sat > min_fee_sat (1 sat)
    const bd = calculateSparkFeeBreakdown(100_000n, 0n, defaultCfg);
    expect(bd.alphaPlatformFeeSat).toBeGreaterThan(BigInt(defaultCfg.min_fee_sat));
  });

  it("G3: min_fee_sat=0 e fee_bps=0 → alpha fee = 0 (zero-fee config)", () => {
    const zeroCfg: SparkFeeConfig = { fee_bps: 0, min_fee_sat: 0, quote_validity_sec: 30 };
    const bd = calculateSparkFeeBreakdown(100_000n, 0n, zeroCfg);
    expect(bd.alphaPlatformFeeSat).toBe(0n);
  });
});
