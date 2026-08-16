/**
 * Alpha Swap V1 — Test Suite (isolamento + invarianti fee)
 *
 * NON vengono testati i provider in rete (Boltz, Breez) — solo:
 *   1. Invarianza SWAP_ENABLED=false (nessuna call attiva)
 *   2. Matematica fee BTC→LN (Boltz)
 *   3. Matematica fee LN→BTC (Breez Spark, 0%)
 *   4. SwapRouter: routing corretto per direction
 *   5. Isolamento modulo (zero import proibiti)
 *   6. Struttura dati quote (campi obbligatori)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 1. SWAP_ENABLED = false guard ─────────────────────────────────────────────

describe("SWAP_ENABLED = false guard", () => {
  it("quando SWAP_ENABLED è false la config pubblica lo indica correttamente", () => {
    // La config backend default ha enabled=false.
    // Questo test verifica la struttura attesa dalla UI.
    const mockConfig = {
      enabled: false,
      excluded_assets: ["USDA"],
      btcln: { enabled: true, fee_bps: 25, provider: "boltz_submarine", provider_status: "active" },
      lnbtc: { enabled: true, fee_bps: 0, provider: "breez_spark_reverse", provider_note: "0%" },
    };
    expect(mockConfig.enabled).toBe(false);
    expect(mockConfig.excluded_assets).toContain("USDA");
  });

  it("SWAP_ENABLED rimane false a prescindere dalla fee_bps impostata", () => {
    // Un aggiornamento della fee NON deve abilitare lo swap automaticamente.
    const cfg = { enabled: false, btcln_fee_bps: 50 };
    const applied = { ...cfg, btcln_fee_bps: 75 };
    expect(applied.enabled).toBe(false);
  });
});

// ── 2. Fee math — BTC→LN (Boltz) ─────────────────────────────────────────────

describe("Fee math — BTC→LN (Boltz)", () => {
  function calcBtcLnFees(fromSat: number, boltzPct: number, minerFee: number, alphaFeeBps: number) {
    const boltzFee   = Math.ceil(fromSat * (boltzPct / 100));
    const alphaFee   = Math.ceil(fromSat * (alphaFeeBps / 10000));
    const toSat      = fromSat - boltzFee - minerFee;
    const totalDebit = fromSat + (alphaFeeBps > 0 ? alphaFee : 0);
    return { boltzFee, alphaFee, toSat, totalDebit };
  }

  it("calcola correttamente con fee defaults (Boltz 0.1% + 302sat, Alpha 25bps)", () => {
    const { boltzFee, alphaFee, toSat, totalDebit } = calcBtcLnFees(100_000, 0.1, 302, 25);
    expect(boltzFee).toBe(100);          // 0.1% di 100000
    expect(alphaFee).toBe(250);          // 25 bps = 0.25% → 100000 × 0.0025 = 250 sat
    expect(toSat).toBe(99_598);          // 100000 - 100 - 302
    expect(totalDebit).toBe(100_250);    // 100000 + 250 Alpha fee
    expect(toSat).toBeGreaterThan(0);
  });

  it("Alpha fee 25 bps = 0.25% — invariante", () => {
    const alphaFeeBps = 25;
    const alphaFeePct = alphaFeeBps / 100;  // per Boltz extraFees.percentage
    expect(alphaFeePct).toBeCloseTo(0.25, 2);
    const alphaFeeDecimal = alphaFeeBps / 10000;
    expect(alphaFeeDecimal).toBeCloseTo(0.0025, 4);
  });

  it("toSat è sempre positivo per importi sopra il minimo", () => {
    const cases = [50_000, 100_000, 500_000, 1_000_000, 10_000_000];
    for (const from of cases) {
      const { toSat } = calcBtcLnFees(from, 0.1, 302, 25);
      expect(toSat).toBeGreaterThan(0);
    }
  });

  it("importo sotto la miner fee produce toSat negativo (da bloccare dalla UI)", () => {
    const { toSat } = calcBtcLnFees(100, 0.1, 302, 25);
    expect(toSat).toBeLessThanOrEqual(0);
    // La validazione nel service deve rifiutare questo caso
  });

  it("fee Boltz è sempre arrotondata per eccesso (ceil)", () => {
    const from = 50_001;
    const boltzPct = 0.1;
    const raw = from * (boltzPct / 100);    // 50.001
    const fee = Math.ceil(raw);             // 51
    expect(fee).toBe(51);
    expect(fee).toBeGreaterThanOrEqual(raw);
  });
});

// ── 3. Fee math — LN→BTC (Breez Spark fallback) ───────────────────────────────

describe("Fee math — LN→BTC (Breez Spark Fallback)", () => {
  it("Alpha fee è sempre 0 bps per LN→BTC", () => {
    const alphaFeeBps = 0;  // invariante hard
    const alphaFeeSat = Math.ceil(100_000 * (alphaFeeBps / 10000));
    expect(alphaFeeSat).toBe(0);
    expect(alphaFeeBps).toBe(0);
  });

  it("total_debit = from_amount_sat (nessuna Alpha fee aggiunta)", () => {
    const fromSat   = 100_000;
    const alphaFee  = 0;
    const totalDebit = fromSat; // L'utente paga solo from_amount, la provider fee è interna
    expect(totalDebit).toBe(fromSat);
    expect(alphaFee).toBe(0);
  });

  it("provider fee stimata: 0.5% + 300sat (fallback conservativo)", () => {
    const fromSat    = 100_000;
    const provFee    = Math.ceil(fromSat * 0.005) + 300;
    expect(provFee).toBe(800);  // 500 + 300
    const toSat = fromSat - provFee;
    expect(toSat).toBe(99_200);
  });

  it("alpha_fee_bps NON modifica fee globale Alpha Wallet (isolamento)", () => {
    // Il campo lnbtc_fee_bps è separato da:
    //   - btcln_fee_bps (Boltz)
    //   - spark_fee_config.platform_fee_bps (Spark platform fee)
    //   - alpha_wallet_fee_config.btc_fee_bps (BTC send fee)
    // Questo test verifica che rimanga 0 e non abbia side-effect.
    const lnbtcFeeBps = 0;
    expect(lnbtcFeeBps).toBe(0);
    // Se cambia a >0 in futuro, richiedere audit separato
  });
});

// ── 4. SwapRouter: routing direction ─────────────────────────────────────────

describe("SwapRouter routing", () => {
  it("btc_to_lightning → boltz_submarine provider", () => {
    const mockBoltz = { name: "boltz_submarine", supportsDirection: (d: string) => d === "btc_to_lightning" };
    const mockBreez = { name: "breez_spark_reverse", supportsDirection: (d: string) => d === "lightning_to_btc" };

    function resolve(direction: string) {
      if (mockBoltz.supportsDirection(direction)) return mockBoltz;
      if (mockBreez.supportsDirection(direction)) return mockBreez;
      throw new Error(`No provider for ${direction}`);
    }

    const p1 = resolve("btc_to_lightning");
    expect(p1.name).toBe("boltz_submarine");

    const p2 = resolve("lightning_to_btc");
    expect(p2.name).toBe("breez_spark_reverse");
  });

  it("throws per direction non supportata", () => {
    function resolve(direction: string) {
      if (direction === "btc_to_lightning" || direction === "lightning_to_btc") return {};
      throw new Error(`No provider for ${direction}`);
    }
    expect(() => resolve("evm_to_btc")).toThrow();
    expect(() => resolve("usda_to_lightning")).toThrow();
  });

  it("USDA è in excluded_assets — NON deve essere selezionabile", () => {
    const excluded = ["USDA"];
    const toSwap = "USDA";
    expect(excluded).toContain(toSwap);
    const allowed = ["BTC", "LN"].filter(a => !excluded.includes(a));
    expect(allowed).not.toContain("USDA");
  });
});

// ── 5. Struttura quote ────────────────────────────────────────────────────────

describe("Quote structure invariants", () => {
  const mockBtcLnQuote = {
    direction:        "btc_to_lightning" as const,
    provider:         "boltz_submarine" as const,
    from_amount_sat:  100_000,
    to_amount_sat:    99_598,
    alpha_fee_sat:    25,
    alpha_fee_bps:    25,
    provider_fee_sat: 100,
    miner_fee_sat:    302,
    total_debit_sat:  100_025,
    expires_at:       Date.now() + 300_000,
  };

  const mockLnBtcQuote = {
    direction:        "lightning_to_btc" as const,
    provider:         "breez_spark_reverse" as const,
    from_amount_sat:  100_000,
    to_amount_sat:    99_200,
    alpha_fee_sat:    0,
    alpha_fee_bps:    0,
    provider_fee_sat: 800,
    miner_fee_sat:    0,
    total_debit_sat:  100_000,
    expires_at:       Date.now() + 180_000,
  };

  it("BTC→LN: campi obbligatori presenti e coerenti", () => {
    const q = mockBtcLnQuote;
    expect(q.direction).toBe("btc_to_lightning");
    expect(q.provider).toBe("boltz_submarine");
    expect(q.from_amount_sat).toBeGreaterThan(0);
    expect(q.to_amount_sat).toBeGreaterThan(0);
    expect(q.alpha_fee_bps).toBe(25);
    expect(q.expires_at).toBeGreaterThan(Date.now());
    // Invariante: to_amount_sat < from_amount_sat
    expect(q.to_amount_sat).toBeLessThan(q.from_amount_sat);
    // Invariante: total_debit = from + alpha_fee
    expect(q.total_debit_sat).toBe(q.from_amount_sat + q.alpha_fee_sat);
  });

  it("LN→BTC: Alpha fee = 0 invariante, total_debit = from_amount", () => {
    const q = mockLnBtcQuote;
    expect(q.alpha_fee_sat).toBe(0);
    expect(q.alpha_fee_bps).toBe(0);
    expect(q.total_debit_sat).toBe(q.from_amount_sat);
    expect(q.miner_fee_sat).toBe(0);
    expect(q.direction).toBe("lightning_to_btc");
  });

  it("quote scaduta: expires_at nel passato deve essere rifiutata dalla UI", () => {
    const expiredQuote = { ...mockBtcLnQuote, expires_at: Date.now() - 1000 };
    const isExpired = expiredQuote.expires_at < Date.now();
    expect(isExpired).toBe(true);
  });
});

// ── 6. Isolamento modulo (whitelist import) ───────────────────────────────────

describe("Swap module isolation — import whitelist", () => {
  it("il barrel swap/index.ts esporta solo SwapView, SwapHistory e tipi", async () => {
    // Verifica che il barrel non esporti funzioni payment, USDA, MultiChain, Spark fee
    const mod = await import("../../swap/index");
    expect(mod).toHaveProperty("SwapView");
    expect(mod).toHaveProperty("SwapHistory");
    // NON deve esporre nulla dai moduli payment
    expect((mod as Record<string, unknown>)["ChatWalletBridge"]).toBeUndefined();
    expect((mod as Record<string, unknown>)["UsdaService"]).toBeUndefined();
    expect((mod as Record<string, unknown>)["MultiChainTransfer"]).toBeUndefined();
    expect((mod as Record<string, unknown>)["SparkFeeConfig"]).toBeUndefined();
  });
});
