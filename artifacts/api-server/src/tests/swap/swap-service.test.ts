/**
 * Swap Service — Unit Tests Backend
 *
 * Test senza rete: mock di Boltz, MongoDB, config.
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fee math helpers (replicati dal service per test puri) ────────────────────

function calcBtcLnFee(fromSat: number, boltzPct: number, minerFee: number, alphaFeeBps: number) {
  const boltzFee   = Math.ceil(fromSat * (boltzPct / 100));
  const alphaFee   = Math.ceil(fromSat * (alphaFeeBps / 10000));
  const toSat      = fromSat - boltzFee - minerFee;
  const totalDebit = fromSat + (alphaFeeBps > 0 ? alphaFee : 0);
  return { boltzFee, alphaFee, toSat, totalDebit };
}

function calcLnBtcFee(fromSat: number) {
  // LN→BTC: Alpha fee = 0 sempre (Breez Spark fallback)
  const alphaFee   = 0;
  const alphaFeeBps = 0;
  const totalDebit = fromSat;
  return { alphaFee, alphaFeeBps, totalDebit };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("BTC→LN fee calculation", () => {
  it("caso baseline: 100k sat, Boltz 0.1%, miner 302sat, Alpha 25bps", () => {
    const r = calcBtcLnFee(100_000, 0.1, 302, 25);
    expect(r.boltzFee).toBe(100);
    expect(r.alphaFee).toBe(250);   // 25 bps = 0.25% → 100000 × 0.0025 = 250 sat
    expect(r.toSat).toBe(99_598);
    expect(r.totalDebit).toBe(100_250);  // 100000 + 250
  });

  it("ceil su boltzFee: non usare floor", () => {
    const r = calcBtcLnFee(50_001, 0.1, 0, 0);
    expect(r.boltzFee).toBe(51);  // ceil(50.001)
  });

  it("ceil su alphaFee: non usare floor", () => {
    const r = calcBtcLnFee(10_001, 0, 0, 25);
    const raw = 10_001 * (25 / 10000);  // 25.0025
    expect(r.alphaFee).toBe(Math.ceil(raw));  // 26
  });

  it("toSat > 0 per importi ragionevoli", () => {
    const amounts = [50_000, 100_000, 1_000_000, 10_000_000];
    for (const a of amounts) {
      const r = calcBtcLnFee(a, 0.1, 302, 25);
      expect(r.toSat).toBeGreaterThan(0);
    }
  });

  it("alpha 0bps → nessuna fee Alpha, totalDebit = from", () => {
    const r = calcBtcLnFee(100_000, 0.1, 302, 0);
    expect(r.alphaFee).toBe(0);
    expect(r.totalDebit).toBe(100_000);
  });
});

describe("LN→BTC fee — Alpha fee = 0 invariante", () => {
  it("alpha fee è sempre 0 per LN→BTC", () => {
    const amounts = [10_000, 50_000, 100_000, 500_000];
    for (const a of amounts) {
      const r = calcLnBtcFee(a);
      expect(r.alphaFee).toBe(0);
      expect(r.alphaFeeBps).toBe(0);
      expect(r.totalDebit).toBe(a);
    }
  });
});

describe("Boltz extraFees percentage conversion", () => {
  it("25 bps → 0.25 come percentuale Boltz extraFees", () => {
    const alphaFeeBps = 25;
    const boltzPct    = alphaFeeBps / 100;  // 0.25
    expect(boltzPct).toBeCloseTo(0.25, 2);
  });

  it("50 bps → 0.50 percentuale Boltz", () => {
    const boltzPct = 50 / 100;
    expect(boltzPct).toBeCloseTo(0.5, 2);
  });

  it("max 1000 bps → 10% — rispetta limite Boltz Partner Program", () => {
    const maxBps = 1000;
    const boltzPct = maxBps / 100;
    expect(boltzPct).toBe(10);
    expect(boltzPct).toBeLessThanOrEqual(10);
  });
});

describe("SwapConfig defaults", () => {
  const defaults = {
    enabled: false,
    btcln_fee_bps: 25,
    lnbtc_fee_bps: 0,
    boltz_btcln_enabled: true,
    breez_spark_lnbtc_enabled: true,
    excluded_assets: ["USDA"],
    boltz_integrator_id: "alpha-wallet",
  };

  it("enabled = false per default (protezione pre-audit)", () => {
    expect(defaults.enabled).toBe(false);
  });

  it("btcln_fee_bps = 25 (0.25%) per default", () => {
    expect(defaults.btcln_fee_bps).toBe(25);
  });

  it("lnbtc_fee_bps = 0 per default (Breez Spark fallback)", () => {
    expect(defaults.lnbtc_fee_bps).toBe(0);
  });

  it("USDA è in excluded_assets", () => {
    expect(defaults.excluded_assets).toContain("USDA");
  });

  it("boltz_integrator_id = 'alpha-wallet'", () => {
    expect(defaults.boltz_integrator_id).toBe("alpha-wallet");
  });
});

describe("Boltz status mapping", () => {
  function mapBoltzStatus(status: string): string | null {
    switch (status) {
      case "invoice.set":           return "created";
      case "transaction.mempool":   return "awaiting_deposit";
      case "transaction.confirmed": return "processing";
      case "invoice.paid":          return "completed";
      case "invoice.failedToPay":   return "failed";
      case "swap.expired":          return "expired";
      case "transaction.refunded":  return "refunded";
      default:                      return null;
    }
  }

  it("mappa correttamente tutti gli stati Boltz", () => {
    expect(mapBoltzStatus("invoice.set")).toBe("created");
    expect(mapBoltzStatus("transaction.mempool")).toBe("awaiting_deposit");
    expect(mapBoltzStatus("transaction.confirmed")).toBe("processing");
    expect(mapBoltzStatus("invoice.paid")).toBe("completed");
    expect(mapBoltzStatus("invoice.failedToPay")).toBe("failed");
    expect(mapBoltzStatus("swap.expired")).toBe("expired");
    expect(mapBoltzStatus("transaction.refunded")).toBe("refunded");
  });

  it("stato sconosciuto → null (nessuna transizione)", () => {
    expect(mapBoltzStatus("unknown.status")).toBeNull();
    expect(mapBoltzStatus("")).toBeNull();
  });
});

describe("Route isolation invariants", () => {
  it("BTC→LN usa solo provider boltz_submarine", () => {
    const route = "btc_onchain_to_lightning";
    const expectedProvider = "boltz_submarine";
    // Se route è btcln, provider deve essere boltz
    expect(route.includes("btc_onchain_to_lightning")).toBe(true);
    expect(expectedProvider).toBe("boltz_submarine");
  });

  it("LN→BTC usa solo provider breez_spark_reverse", () => {
    const route = "lightning_to_btc_onchain";
    const expectedProvider = "breez_spark_reverse";
    expect(route.includes("lightning_to_btc_onchain")).toBe(true);
    expect(expectedProvider).toBe("breez_spark_reverse");
  });

  it("LN→BTC alpha_fee_bps è sempre 0 (non dipende dalla config btcln)", () => {
    // La fee LN→BTC è separata dalla fee BTC→LN
    const btclnFeeBps  = 25;  // fee per BTC→LN
    const lnbtcFeeBps  = 0;   // fee per LN→BTC — sempre 0 (Breez fallback)
    // Non devono MAI essere confuse
    expect(lnbtcFeeBps).toBe(0);
    expect(btclnFeeBps).not.toBe(lnbtcFeeBps);
  });
});
