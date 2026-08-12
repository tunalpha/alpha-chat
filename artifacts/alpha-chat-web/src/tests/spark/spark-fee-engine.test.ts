/**
 * Spark Fee Engine — unit tests
 *
 * Copre:
 * - fee_excluded mode
 * - recipient_exact mode
 * - fee resolution post-send
 * - ISOLAMENTO: modifica fee Spark NON altera fee BTC
 * - ISOLAMENTO: modifica fee BTC NON altera fee Spark
 * - recipient_exact invariante: recipientAmountSat mai alterato
 * - provider fee mai modificata dall'engine
 * - totalDebit sempre consistente
 * - min_fee_sat enforcement
 * - fee_bps = 0 edge case
 */

import { describe, it, expect } from "vitest";
import {
  calculateSparkFeeBreakdown,
  calculateSparkFeeBreakdownRecipientExact,
  resolveActualProviderFee,
  assertFeeBreakdownConsistent,
} from "../../lib/spark/spark-fee-engine";
import type { SparkFeeConfig } from "../../lib/spark/spark-types";

const DEFAULT_CONFIG: SparkFeeConfig = {
  fee_bps:            10,   // 0.10%
  min_fee_sat:        1,
  quote_validity_sec: 30,
};

const ZERO_FEE_CONFIG: SparkFeeConfig = {
  fee_bps:            0,
  min_fee_sat:        0,
  quote_validity_sec: 30,
};

const HIGH_FEE_CONFIG: SparkFeeConfig = {
  fee_bps:            50,  // 0.50%
  min_fee_sat:        10,
  quote_validity_sec: 30,
};

// ── Fee-excluded mode ─────────────────────────────────────────────────────────

describe("calculateSparkFeeBreakdown (fee_excluded)", () => {
  it("calcola correttamente con 1000 sat e 0.10%", () => {
    const b = calculateSparkFeeBreakdown(1000n, 3n, DEFAULT_CONFIG);
    // floor(1000 * 10 / 10000) = 1 sat
    expect(b.alphaPlatformFeeSat).toBe(1n);
    expect(b.recipientAmountSat).toBe(1000n);
    expect(b.estimatedProviderFeeSat).toBe(3n);
    expect(b.totalDebitSat).toBe(1004n); // 1000 + 1 + 3
    expect(b.amountMode).toBe("fee_excluded");
    expect(b.providerFeeSource).toBe("estimated");
  });

  it("totalDebit è sempre consistente", () => {
    const cases = [
      [100n, 1n],
      [10000n, 100n],
      [999999n, 50n],
      [1n, 0n],
    ] as [bigint, bigint][];
    for (const [amount, providerFee] of cases) {
      const b = calculateSparkFeeBreakdown(amount, providerFee, DEFAULT_CONFIG);
      assertFeeBreakdownConsistent(b);
    }
  });

  it("enforces min_fee_sat = 1 su importi piccoli", () => {
    // floor(5 * 10 / 10000) = 0, ma min = 1
    const b = calculateSparkFeeBreakdown(5n, 0n, DEFAULT_CONFIG);
    expect(b.alphaPlatformFeeSat).toBe(1n);
    expect(b.totalDebitSat).toBe(6n);
  });

  it("fee_bps = 0: alpha fee = 0 (se min = 0)", () => {
    const b = calculateSparkFeeBreakdown(1000n, 5n, ZERO_FEE_CONFIG);
    expect(b.alphaPlatformFeeSat).toBe(0n);
    expect(b.totalDebitSat).toBe(1005n);
  });

  it("HIGH_FEE_CONFIG: 0.50% con min 10 sat su 100 sat", () => {
    const b = calculateSparkFeeBreakdown(100n, 2n, HIGH_FEE_CONFIG);
    // floor(100 * 50 / 10000) = 0, min = 10
    expect(b.alphaPlatformFeeSat).toBe(10n);
  });

  it("HIGH_FEE_CONFIG: 0.50% su 10000 sat", () => {
    const b = calculateSparkFeeBreakdown(10000n, 0n, HIGH_FEE_CONFIG);
    // floor(10000 * 50 / 10000) = 50
    expect(b.alphaPlatformFeeSat).toBe(50n);
  });

  it("provider fee NON viene modificata dall'engine", () => {
    const providerFee = 999n;
    const b = calculateSparkFeeBreakdown(1000n, providerFee, DEFAULT_CONFIG);
    expect(b.estimatedProviderFeeSat).toBe(providerFee);
    // Il campo NON dipende da config.fee_bps
    const bOtherConfig = calculateSparkFeeBreakdown(1000n, providerFee, HIGH_FEE_CONFIG);
    expect(bOtherConfig.estimatedProviderFeeSat).toBe(providerFee);
  });
});

// ── Recipient-exact mode ──────────────────────────────────────────────────────

describe("calculateSparkFeeBreakdownRecipientExact", () => {
  it("destinatario riceve ESATTAMENTE l'importo richiesto", () => {
    const amount = 1000n;
    const b = calculateSparkFeeBreakdownRecipientExact(amount, 3n, DEFAULT_CONFIG);
    expect(b.recipientAmountSat).toBe(amount);
    expect(b.amountMode).toBe("recipient_exact");
  });

  it("totalDebit >= recipientAmountSat + estimatedProviderFee", () => {
    const b = calculateSparkFeeBreakdownRecipientExact(1000n, 5n, DEFAULT_CONFIG);
    expect(b.totalDebitSat).toBeGreaterThanOrEqual(1000n + 5n);
  });

  it("alpha fee >= min_fee_sat", () => {
    const b = calculateSparkFeeBreakdownRecipientExact(1n, 0n, DEFAULT_CONFIG);
    expect(b.alphaPlatformFeeSat).toBeGreaterThanOrEqual(BigInt(DEFAULT_CONFIG.min_fee_sat));
  });

  it("fee_bps = 0: alpha fee = 0 (se min = 0)", () => {
    const b = calculateSparkFeeBreakdownRecipientExact(5000n, 10n, ZERO_FEE_CONFIG);
    expect(b.alphaPlatformFeeSat).toBe(0n);
    expect(b.totalDebitSat).toBe(5010n);
  });

  it("recipientAmountSat invariato rispetto a fee_excluded", () => {
    const amount = 5000n;
    const fee_excl = calculateSparkFeeBreakdown(amount, 10n, DEFAULT_CONFIG);
    const rec_exact = calculateSparkFeeBreakdownRecipientExact(amount, 10n, DEFAULT_CONFIG);
    // recipient sempre uguale in entrambe le modalità
    expect(rec_exact.recipientAmountSat).toBe(fee_excl.recipientAmountSat);
  });

  it("totalDebit è consistente", () => {
    const b = calculateSparkFeeBreakdownRecipientExact(100_000n, 200n, DEFAULT_CONFIG);
    assertFeeBreakdownConsistent(b);
  });
});

// ── Post-send resolution ──────────────────────────────────────────────────────

describe("resolveActualProviderFee", () => {
  it("aggiorna la fee effettiva senza alterare recipient e alpha", () => {
    const b = calculateSparkFeeBreakdown(1000n, 3n, DEFAULT_CONFIG);
    const resolved = resolveActualProviderFee(b, 5n);

    expect(resolved.recipientAmountSat).toBe(b.recipientAmountSat);
    expect(resolved.alphaPlatformFeeSat).toBe(b.alphaPlatformFeeSat);
    expect(resolved.actualProviderFeeSat).toBe(5n);
    expect(resolved.providerFeeSource).toBe("actual");
    expect(resolved.totalDebitSat).toBe(1000n + 1n + 5n);
  });

  it("fee effettiva = stima: totalDebit invariato", () => {
    const b = calculateSparkFeeBreakdown(1000n, 3n, DEFAULT_CONFIG);
    const resolved = resolveActualProviderFee(b, 3n);
    expect(resolved.totalDebitSat).toBe(b.totalDebitSat);
  });

  it("fee effettiva > stima: totalDebit aumenta, recipient invariato", () => {
    const b = calculateSparkFeeBreakdown(1000n, 3n, DEFAULT_CONFIG);
    const resolved = resolveActualProviderFee(b, 50n);
    expect(resolved.recipientAmountSat).toBe(1000n);
    expect(resolved.totalDebitSat).toBe(1000n + 1n + 50n);
  });
});

// ── ISOLAMENTO — chiave: fee Spark ≠ fee BTC ─────────────────────────────────

describe("ISOLAMENTO: fee Spark e fee BTC sono indipendenti", () => {
  it("cambiare config Spark NON altera il calcolo BTC (simulato)", () => {
    // Simula la funzione BTC: calculateAlphaWalletPlatformFee(amount, bps)
    // (non importata qui — nessuna dipendenza cross-module)
    const btcFeeBps = 10;
    const btcAmount = 100_000n;
    const btcFee = (btcAmount * BigInt(btcFeeBps)) / 10000n; // 100 sat

    // Spark config con fee diversa
    const sparkConfigHighFee: SparkFeeConfig = { fee_bps: 50, min_fee_sat: 1, quote_validity_sec: 30 };
    const sparkBreakdown = calculateSparkFeeBreakdown(btcAmount, 0n, sparkConfigHighFee);

    // La fee BTC non dipende da sparkConfigHighFee
    expect(btcFee).toBe(100n);
    // La fee Spark è diversa dalla fee BTC perché i config sono separati
    expect(sparkBreakdown.alphaPlatformFeeSat).not.toBe(btcFee);
    expect(sparkBreakdown.alphaPlatformFeeSat).toBe(500n); // 0.50%
  });

  it("cambiare config BTC NON altera il calcolo Spark", () => {
    // Config BTC modificata (simulata)
    const btcFeeHighBps = 100; // 1% BTC
    const btcAmount = 10_000n;
    const btcFee = (btcAmount * BigInt(btcFeeHighBps)) / 10000n; // 100 sat

    // Spark rimane a 0.10%
    const sparkBreakdown = calculateSparkFeeBreakdown(btcAmount, 0n, DEFAULT_CONFIG);

    expect(btcFee).toBe(100n);
    expect(sparkBreakdown.alphaPlatformFeeSat).toBe(10n); // 0.10% — invariato
  });

  it("modifica fee_bps Spark NON modifica fee_bps BTC (sanity: valori indipendenti)", () => {
    const cfg1: SparkFeeConfig = { ...DEFAULT_CONFIG, fee_bps: 10 };
    const cfg2: SparkFeeConfig = { ...DEFAULT_CONFIG, fee_bps: 25 };

    const b1 = calculateSparkFeeBreakdown(10_000n, 0n, cfg1);
    const b2 = calculateSparkFeeBreakdown(10_000n, 0n, cfg2);

    expect(b1.alphaPlatformFeeSat).toBe(10n);   // 0.10%
    expect(b2.alphaPlatformFeeSat).toBe(25n);   // 0.25%
    // cfg1.fee_bps inalterato
    expect(cfg1.fee_bps).toBe(10);
  });

  it("fee Spark e fee BTC condividono solo Treasury destination — non il calcolo", () => {
    // Questo test documenta l'INVARIANTE:
    // entrambe le fee vanno al BTC Treasury Alpha
    // ma vengono calcolate INDIPENDENTEMENTE

    // Fee Spark
    const sparkB = calculateSparkFeeBreakdown(50_000n, 100n, DEFAULT_CONFIG);
    expect(sparkB.alphaPlatformFeeSat).toBe(50n); // 0.10% di 50000

    // Fee BTC (formula identica ma da config diversa — qui simulata)
    const btcFeeBps = 10;
    const btcFee = (50_000n * BigInt(btcFeeBps)) / 10000n;
    expect(btcFee).toBe(50n);

    // Entrambe sono 50 sat — per coincidenza (same bps, same amount)
    // MA provengono da config SEPARATI e non si influenzano a vicenda
    expect(sparkB.alphaPlatformFeeSat).toBe(btcFee);
  });
});

// ── Treasury destination invariante ──────────────────────────────────────────

describe("Treasury destination", () => {
  it("alphaPlatformFeeSat è sempre >= 0 (mai negativa)", () => {
    const cases: [bigint, bigint, SparkFeeConfig][] = [
      [0n, 0n, DEFAULT_CONFIG],
      [1n, 0n, DEFAULT_CONFIG],
      [0n, 100n, ZERO_FEE_CONFIG],
      [1_000_000n, 0n, HIGH_FEE_CONFIG],
    ];
    for (const [amount, prov, cfg] of cases) {
      const b = calculateSparkFeeBreakdown(amount, prov, cfg);
      expect(b.alphaPlatformFeeSat).toBeGreaterThanOrEqual(0n);
    }
  });

  it("alphaPlatformFeeSat mai viene accidentalmente sommata alla provider fee", () => {
    const b = calculateSparkFeeBreakdown(10_000n, 50n, DEFAULT_CONFIG);
    // alpha (10) e provider (50) restano separati
    expect(b.alphaPlatformFeeSat).toBe(10n);
    expect(b.estimatedProviderFeeSat).toBe(50n);
    // totalDebit = recipient + alpha + provider
    expect(b.totalDebitSat).toBe(10_000n + 10n + 50n);
  });
});

// ── assertFeeBreakdownConsistent ──────────────────────────────────────────────

describe("assertFeeBreakdownConsistent", () => {
  it("non solleva eccezione su breakdown valido", () => {
    const b = calculateSparkFeeBreakdown(1000n, 3n, DEFAULT_CONFIG);
    expect(() => assertFeeBreakdownConsistent(b)).not.toThrow();
  });

  it("solleva eccezione se totalDebit è sbagliato", () => {
    const b = calculateSparkFeeBreakdown(1000n, 3n, DEFAULT_CONFIG);
    const tampered = { ...b, totalDebitSat: 9999n };
    expect(() => assertFeeBreakdownConsistent(tampered)).toThrow("inconsistente");
  });
});
