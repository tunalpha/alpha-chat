/**
 * fee-config.test.ts — Unit test per il calcolo commissioni
 *
 * Verifica:
 *   - Calcolo fee 0.10% con BigInt (zero floating point)
 *   - Invariante contabile: netAmount + projectFee === grossAmount
 *   - Esempi esatti dalla spec
 *   - Edge cases: zero, importo minimo, importo grande
 *   - FeeConfigRegistry: risoluzione con fallback
 *   - assertFeeInvariant: lancio su invariante violata
 */

import { describe, it, expect } from "vitest";
import {
  calculateFee,
  assertFeeInvariant,
  bpsToPercent,
  FeeConfigRegistry,
  DEFAULT_FEE_BPS,
  BASIS_POINTS_DENOMINATOR,
} from "../fee-config";

describe("calculateFee", () => {
  describe("esempi dalla spec", () => {
    it("100 USDT (6 dec) → 99.90 + 0.10", () => {
      // 100 USDT = 100_000_000 (6 decimali)
      const result = calculateFee(100_000_000n, 10n, "0xFeeWallet");
      expect(result.grossAmount).toBe(100_000_000n);
      expect(result.projectFee).toBe(100_000n);    // 0.10 USDT
      expect(result.netAmount).toBe(99_900_000n);  // 99.90 USDT
      expect(result.feeBps).toBe(10n);
    });

    it("1000 USDT (6 dec) → 999 + 1", () => {
      const result = calculateFee(1_000_000_000n, 10n);
      expect(result.projectFee).toBe(1_000_000n);   // 1.00 USDT
      expect(result.netAmount).toBe(999_000_000n);  // 999 USDT
    });

    it("0.01 BTC (8 dec) → 0.00999 + 0.00001", () => {
      // 0.01 BTC = 1_000_000 satoshi
      const result = calculateFee(1_000_000n, 10n, "bc1qFeeWallet");
      expect(result.projectFee).toBe(1_000n);      // 0.00001000 BTC
      expect(result.netAmount).toBe(999_000n);     // 0.00999000 BTC
    });

    it("1 BTC (8 dec) → 0.999 + 0.001", () => {
      // 1 BTC = 100_000_000 satoshi
      const result = calculateFee(100_000_000n, 10n);
      expect(result.projectFee).toBe(100_000n);     // 0.00100000 BTC
      expect(result.netAmount).toBe(99_900_000n);   // 0.99900000 BTC
    });

    it("100 USDA (18 dec) → invariante verificata", () => {
      // 100 USDA = 100 * 10^18
      const gross = 100n * 10n ** 18n;
      const result = calculateFee(gross, 10n);
      expect(result.netAmount + result.projectFee).toBe(gross);
    });
  });

  describe("fee rate configurabile", () => {
    it("fee zero (0 bps) → tutto al destinatario", () => {
      const result = calculateFee(1_000_000n, 0n);
      expect(result.projectFee).toBe(0n);
      expect(result.netAmount).toBe(1_000_000n);
    });

    it("fee 50 bps (0.50%)", () => {
      // 50 bps = 0.50% di 100_000_000n (100 USDT) = 500_000n (0.50 USDT)
      // Formula: 100_000_000 × 50 / 10_000 = 500_000n
      const result = calculateFee(100_000_000n, 50n);
      expect(result.projectFee).toBe(500_000n);    // 0.50 USDT (6 dec) ✓
      expect(result.netAmount).toBe(99_500_000n);  // 99.50 USDT ✓
    });

    it("fee 100 bps (1.00%)", () => {
      const result = calculateFee(100_000_000n, 100n);
      expect(result.projectFee).toBe(1_000_000n);  // 1.00 USDT (6 dec)
      expect(result.netAmount).toBe(99_000_000n);
    });

    it("usa DEFAULT_FEE_BPS (10) se feeBps non specificato", () => {
      const result = calculateFee(100_000_000n);
      expect(result.feeBps).toBe(DEFAULT_FEE_BPS);
      expect(result.feeBps).toBe(10n);
    });
  });

  describe("edge cases", () => {
    it("importo zero → fee zero, net zero", () => {
      const result = calculateFee(0n, 10n);
      expect(result.projectFee).toBe(0n);
      expect(result.netAmount).toBe(0n);
    });

    it("importo minimo (1 satoshi)", () => {
      // 1 satoshi → fee = (1 × 10) / 10000 = 0 (integer division)
      const result = calculateFee(1n, 10n);
      expect(result.projectFee).toBe(0n);
      expect(result.netAmount).toBe(1n);
    });

    it("importo elevato (1 milione BTC)", () => {
      const gross = 100_000_000_000_000n; // 1_000_000 BTC in satoshi
      const result = calculateFee(gross, 10n);
      expect(result.netAmount + result.projectFee).toBe(gross); // invariante
    });

    it("feeWallet null → presente nel risultato come null", () => {
      const result = calculateFee(1_000_000n, 10n, null);
      expect(result.feeWallet).toBeNull();
    });

    it("feeWallet stringa → presente nel risultato", () => {
      const result = calculateFee(1_000_000n, 10n, "0xABCDEF");
      expect(result.feeWallet).toBe("0xABCDEF");
    });
  });

  describe("validazione parametri", () => {
    it("grossAmount negativo → errore esplicito", () => {
      expect(() => calculateFee(-1n, 10n)).toThrow("FEE_CALCULATION_ERROR");
    });

    it("feeBps negativo → errore esplicito", () => {
      expect(() => calculateFee(1_000n, -1n)).toThrow("FEE_CALCULATION_ERROR");
    });

    it("feeBps > 10000 → errore esplicito", () => {
      expect(() => calculateFee(1_000n, 10_001n)).toThrow("FEE_CALCULATION_ERROR");
    });

    it("feeBps = 10000 (100%) → consentito", () => {
      const result = calculateFee(1_000n, BASIS_POINTS_DENOMINATOR);
      expect(result.projectFee).toBe(1_000n);
      expect(result.netAmount).toBe(0n);
    });
  });

  describe("invariante contabile", () => {
    it("net + fee === gross per ogni importo", () => {
      const testCases = [1n, 100n, 999n, 1_000_000n, 100_000_000n, 10n ** 18n];
      for (const gross of testCases) {
        const result = calculateFee(gross, 10n);
        expect(result.netAmount + result.projectFee).toBe(gross);
      }
    });
  });
});

describe("assertFeeInvariant", () => {
  it("non lancia per risultato corretto", () => {
    const result = calculateFee(100_000_000n, 10n);
    expect(() => assertFeeInvariant(result)).not.toThrow();
  });

  it("lancia per invariante violata", () => {
    const badResult = {
      grossAmount: 100_000_000n,
      projectFee:  100_001n,  // off by 1
      netAmount:   99_900_000n,
      feeBps:      10n,
      feeWallet:   null,
    };
    expect(() => assertFeeInvariant(badResult)).toThrow("FEE_CALCULATION_ERROR");
  });
});

describe("bpsToPercent", () => {
  it("10 bps → '0.10%'", () => {
    expect(bpsToPercent(10n)).toBe("0.10%");
  });

  it("100 bps → '1.00%'", () => {
    expect(bpsToPercent(100n)).toBe("1.00%");
  });

  it("0 bps → '0.00%'", () => {
    expect(bpsToPercent(0n)).toBe("0.00%");
  });

  it("10000 bps → '100.00%'", () => {
    expect(bpsToPercent(10_000n)).toBe("100.00%");
  });
});

describe("FeeConfigRegistry", () => {
  it("risolve configurazione specifica network:asset", () => {
    const registry = new FeeConfigRegistry();
    registry.set("polygon", "USDT", { feeBps: 10n, feeWallet: "0xA", enabled: true });
    registry.set("polygon", "*",    { feeBps: 20n, feeWallet: "0xB", enabled: true });

    const resolved = registry.resolve("polygon", "USDT");
    expect(resolved.feeWallet).toBe("0xA");
    expect(resolved.feeBps).toBe(10n);
  });

  it("fallback a network:* se asset non configurato", () => {
    const registry = new FeeConfigRegistry();
    registry.set("polygon", "*", { feeBps: 15n, feeWallet: "0xB", enabled: true });

    const resolved = registry.resolve("polygon", "USDA");
    expect(resolved.feeBps).toBe(15n);
  });

  it("fallback a * se network non configurato", () => {
    const registry = new FeeConfigRegistry();
    registry.set("*", "*", { feeBps: 8n, feeWallet: "0xC", enabled: true });

    const resolved = registry.resolve("ethereum", "USDT");
    expect(resolved.feeBps).toBe(8n);
  });

  it("default globale (10 bps) se nessuna config", () => {
    const registry = new FeeConfigRegistry();
    const resolved = registry.resolve("bsc", "USDT");
    expect(resolved.feeBps).toBe(DEFAULT_FEE_BPS);
    expect(resolved.feeWallet).toBeNull();
  });

  it("entries() restituisce tutte le configurazioni", () => {
    const registry = new FeeConfigRegistry();
    registry.set("polygon", "USDT", { feeBps: 10n, feeWallet: null, enabled: true });
    registry.set("bitcoin", "*",    { feeBps: 10n, feeWallet: null, enabled: true });

    const entries = registry.entries();
    expect(entries).toHaveLength(2);
  });
});
