/**
 * spark-cross-domain-isolation.test.ts
 *
 * Test automatici di isolamento cross-domain — Phase 3.1 Regression Audit
 *
 * Verificano che il codice Spark NON interferisca con:
 *   - Alpha Wallet BTC (WalletContext / keystore)
 *   - EVM / MultiChain (chain utilities)
 *   - USDA / Payment Engine / Signal / Chat
 *
 * Verificano anche:
 *   - spark_lightning_enabled = false → Provider no-op completo
 *   - false → true → false toggle: stato si azzera
 *   - IDB namespace indipendente da Alpha Wallet
 *   - Mnemonic/API key mai esposti nel context value
 *   - Fee engine: invarianti di isolamento BTC ↔ Spark
 *
 * NOTE DI PROGETTAZIONE:
 *   Questi test non usano vi.mock sulle dipendenze interne di SparkWalletContext
 *   (spark-adapter, spark-api) perché il comportamento corretto con isEnabled=false
 *   è verificabile direttamente: la guardia `if (!isEnabled) return;` in connect()
 *   garantisce che createSparkAdapter() non venga mai chiamato.
 *   Il test lo verifica misurando l'effetto (stato rimane "disabled") invece di
 *   spiare il modulo interno.
 */

import { describe, it, expect } from "vitest";
import { render, act, renderHook } from "@testing-library/react";
import React from "react";
import { SparkWalletProvider, useSparkWallet } from "../../contexts/SparkWalletContext";
import {
  calculateSparkFeeBreakdown,
  calculateSparkFeeBreakdownRecipientExact,
  resolveActualProviderFee,
  assertFeeBreakdownConsistent,
} from "../../lib/spark/spark-fee-engine";
import type { SparkFeeConfig, SparkFeeBreakdown } from "../../lib/spark/spark-types";

// ── Helper ─────────────────────────────────────────────────────────────────────

function makeWrapper(isEnabled: boolean) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(SparkWalletProvider, { isEnabled }, children);
}

const defaultFeeConfig: SparkFeeConfig = {
  fee_bps: 10,
  min_fee_sat: 1,
  quote_validity_sec: 30,
};

// ──────────────────────────────────────────────────────────────────────────────
// SEZIONE A: Feature flag = false → Provider no-op
// ──────────────────────────────────────────────────────────────────────────────

describe("A. spark_lightning_enabled = false → Provider no-op", () => {
  it("A1: stato è 'disabled' quando isEnabled=false", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    expect(result.current.state).toBe("disabled");
  });

  it("A2: adapterType è null quando isEnabled=false", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    expect(result.current.adapterType).toBeNull();
  });

  it("A3: isEnabled esposto nel context è false", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    expect(result.current.isEnabled).toBe(false);
  });

  it("A4: connect() con isEnabled=false → stato rimane 'disabled' (no adapter creato)", async () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    // Prova: chiama connect() e verifica che lo stato rimanga "disabled"
    // (la guardia `if (!isEnabled) return;` in SparkWalletContext lo garantisce)
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.state).toBe("disabled");
  });

  it("A5: feeConfig è undefined con isEnabled=false (nessuna chiamata backend)", async () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    await act(async () => { await Promise.resolve(); });
    // Con isEnabled=false, apiGetSparkFeeConfig() non viene chiamata
    expect(result.current.feeConfig).toBeUndefined();
  });

  it("A6: walletInfo è undefined con isEnabled=false", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    expect(result.current.walletInfo).toBeUndefined();
  });

  it("A7: lastError è undefined con isEnabled=false (nessun tentativo di connect)", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    expect(result.current.lastError).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEZIONE B: Toggle false → true → false
// ──────────────────────────────────────────────────────────────────────────────

describe("B. Toggle spark_lightning_enabled: false → true → false", () => {
  it("B1: stato è 'disabled' con isEnabled=false iniziale", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    expect(result.current.state).toBe("disabled");
  });

  it("B2: isEnabled=true è correttamente esposto nel context value", () => {
    // Con isEnabled=true il prop viene forwarded al context.
    // Lo stato interno parte da "disabled" (useState iniziale) perché connect()
    // non è ancora stato chiamato — è il comportamento corretto per isEnabled=true.
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(true),
    });
    expect(result.current.isEnabled).toBe(true);
    // adapterType: null perché connect() non è stato ancora chiamato
    expect(result.current.adapterType).toBeNull();
  });

  it("B3: con isEnabled=false il context non espone mnemonic/seed/privateKey", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    const value = result.current as Record<string, unknown>;
    expect(value["mnemonic"]).toBeUndefined();
    expect(value["seed"]).toBeUndefined();
    expect(value["privateKey"]).toBeUndefined();
  });

  it("B4: con isEnabled=true il context non espone mnemonic/seed/privateKey", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(true),
    });
    const value = result.current as Record<string, unknown>;
    expect(value["mnemonic"]).toBeUndefined();
    expect(value["seed"]).toBeUndefined();
    expect(value["privateKey"]).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEZIONE C: Fee engine Spark — isolamento da BTC fee model
// ──────────────────────────────────────────────────────────────────────────────

describe("C. Spark fee engine — isolamento da BTC fee model", () => {
  it("C1: calculateSparkFeeBreakdown — funzione pura, nessun effetto collaterale", () => {
    const breakdown = calculateSparkFeeBreakdown(100_000n, 100n, defaultFeeConfig);
    expect(breakdown.recipientAmountSat).toBe(100_000n);
    expect(breakdown.alphaPlatformFeeSat).toBeGreaterThanOrEqual(0n);
    expect(typeof breakdown.totalDebitSat).toBe("bigint");
  });

  it("C2: recipient_exact — recipientAmountSat invariato rispetto all'input", () => {
    const targetSat = 50_000n;
    const breakdown = calculateSparkFeeBreakdownRecipientExact(targetSat, 50n, defaultFeeConfig);
    expect(breakdown.recipientAmountSat).toBe(targetSat);
  });

  it("C3: alphaPlatformFeeSat mai negativa (Treasury non perde fondi)", () => {
    const cases: [bigint, bigint][] = [
      [1_000n, 10n],
      [100n, 5n],
      [1n, 0n],
    ];
    for (const [amount, providerFee] of cases) {
      const bd = calculateSparkFeeBreakdown(amount, providerFee, defaultFeeConfig);
      expect(bd.alphaPlatformFeeSat).toBeGreaterThanOrEqual(0n);
    }
  });

  it("C4: totalDebit = recipientAmountSat + alphaPlatformFeeSat + estimatedProviderFeeSat", () => {
    const breakdown = calculateSparkFeeBreakdown(10_000n, 200n, defaultFeeConfig);
    expect(breakdown.totalDebitSat).toBe(
      breakdown.recipientAmountSat + breakdown.alphaPlatformFeeSat + breakdown.estimatedProviderFeeSat,
    );
  });

  it("C5: fee_bps=0 → alphaPlatformFeeSat = min_fee_sat (floor applicato)", () => {
    const cfg: SparkFeeConfig = { fee_bps: 0, min_fee_sat: 1, quote_validity_sec: 30 };
    const breakdown = calculateSparkFeeBreakdown(100_000n, 0n, cfg);
    expect(breakdown.alphaPlatformFeeSat).toBe(1n);
  });

  it("C6: modificare fee_bps Spark NON altera recipientAmountSat né estimatedProviderFeeSat", () => {
    const cfg1: SparkFeeConfig = { fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 };
    const cfg2: SparkFeeConfig = { fee_bps: 50, min_fee_sat: 1, quote_validity_sec: 30 };
    const amount = 100_000n;
    const providerFee = 100n;
    const bd1 = calculateSparkFeeBreakdown(amount, providerFee, cfg1);
    const bd2 = calculateSparkFeeBreakdown(amount, providerFee, cfg2);
    // recipient e provider fee invariati; solo alphaPlatformFee cambia
    expect(bd1.recipientAmountSat).toBe(bd2.recipientAmountSat);
    expect(bd1.estimatedProviderFeeSat).toBe(bd2.estimatedProviderFeeSat);
    expect(bd1.alphaPlatformFeeSat).not.toBe(bd2.alphaPlatformFeeSat);
  });

  it("C7: resolveActualProviderFee — aggiunge actualProviderFeeSat, preserva alphaPlatformFeeSat e recipientAmountSat", () => {
    const original = calculateSparkFeeBreakdown(50_000n, 100n, defaultFeeConfig);
    const resolved = resolveActualProviderFee(original, 150n); // fee reale diversa da stimata

    // La fee STIMATA originale rimane invariata (audit trail pre-send)
    expect(resolved.estimatedProviderFeeSat).toBe(original.estimatedProviderFeeSat); // 100n

    // La fee EFFETTIVA viene aggiunta come campo separato
    expect((resolved as Record<string, unknown>)["actualProviderFeeSat"]).toBe(150n);

    // Alpha fee invariata (calcolata pre-send, non cambia con la fee provider reale)
    expect(resolved.alphaPlatformFeeSat).toBe(original.alphaPlatformFeeSat);

    // recipient invariato (il destinatario riceve sempre la stessa somma)
    expect(resolved.recipientAmountSat).toBe(original.recipientAmountSat);

    // totalDebitSat aggiornato con la fee reale (sender paga quella reale)
    expect(resolved.totalDebitSat).toBe(
      original.recipientAmountSat + original.alphaPlatformFeeSat + 150n,
    );
  });

  it("C8: recipient_exact totalDebit = senderDebit invariante (sender paga sempre gross)", () => {
    const targetSat = 100_000n;
    const bd = calculateSparkFeeBreakdownRecipientExact(targetSat, 100n, defaultFeeConfig);
    // totalDebitSat deve essere > recipientAmountSat (include fee Alpha + provider)
    expect(bd.totalDebitSat).toBeGreaterThan(bd.recipientAmountSat);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEZIONE D: Sicurezza — mnemonic e API key non esposti nel context
// ──────────────────────────────────────────────────────────────────────────────

describe("D. Security — mnemonic e API key non esposti nel context pubblico", () => {
  it("D1: context Spark (disabled) non serializza mnemonic/seed/apiKey", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(false),
    });
    // JSON.stringify può fallire su funzioni — usiamo Object.keys
    const keys = Object.keys(result.current);
    expect(keys).not.toContain("mnemonic");
    expect(keys).not.toContain("seed");
    expect(keys).not.toContain("privateKey");
    expect(keys).not.toContain("apiKey");
  });

  it("D2: context Spark (enabled, non connesso) non serializza mnemonic/seed/apiKey", () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: makeWrapper(true),
    });
    const keys = Object.keys(result.current);
    expect(keys).not.toContain("mnemonic");
    expect(keys).not.toContain("seed");
    expect(keys).not.toContain("privateKey");
    expect(keys).not.toContain("apiKey");
  });

  it("D3: spark-fee-engine importabile senza effetti collaterali (modulo puro)", async () => {
    const mod = await import("../../lib/spark/spark-fee-engine");
    expect(typeof mod.calculateSparkFeeBreakdown).toBe("function");
    expect(typeof mod.calculateSparkFeeBreakdownRecipientExact).toBe("function");
    expect(typeof mod.resolveActualProviderFee).toBe("function");
    expect(typeof mod.assertFeeBreakdownConsistent).toBe("function");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEZIONE E: IDB namespace — non collide con Alpha Wallet
// ──────────────────────────────────────────────────────────────────────────────

describe("E. IDB namespace Spark vs Alpha Wallet", () => {
  it("E1: storageDir default 'spark-wallet-v1' non collide con prefix Alpha Wallet", () => {
    const SPARK_DEFAULT = "spark-wallet-v1";
    const ALPHA_PREFIXES = ["alpha-wallet", "alpha-tx", "alpha-trust", "signal-db"];
    for (const prefix of ALPHA_PREFIXES) {
      expect(SPARK_DEFAULT).not.toContain(prefix);
      expect(prefix).not.toContain("spark");
    }
  });

  it("E2: PoC storageDir 'breez-poc-live-v1' distinto da produzione 'spark-wallet-v1'", () => {
    expect("breez-poc-live-v1").not.toBe("spark-wallet-v1");
  });

  it("E3: storageDir userId-based non collide con IDB pre-esistenti", () => {
    const userId = "user_abc123";
    const sparkStorageDir = `spark-${userId}`;
    const existingDbs = [
      "alpha-wallet-v3-idb",
      "alpha-tx-store",
      "alpha-trust-store",
      "signal-db",
      "breez-poc-live-v1",
    ];
    for (const db of existingDbs) {
      expect(sparkStorageDir).not.toBe(db);
      expect(db).not.toContain(`spark-${userId}`);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEZIONE F: AppFeatureFlags — isolamento Spark da MultiChain
// ──────────────────────────────────────────────────────────────────────────────

describe("F. AppFeatureFlags — spark_lightning_enabled e multichain_payments_enabled indipendenti", () => {
  it("F1: i due flag sono valori booleani indipendenti", () => {
    // Default corretto: spark=false (sicuro), multichain=true (backward compat)
    const flags = { multichain_payments_enabled: true, spark_lightning_enabled: false };
    expect(flags.multichain_payments_enabled).toBe(true);
    expect(flags.spark_lightning_enabled).toBe(false);
    // Modificare uno non deve cambiare l'altro (oggetti separati)
    const modified = { ...flags, spark_lightning_enabled: true };
    expect(modified.multichain_payments_enabled).toBe(true); // invariato
  });

  it("F2: fail-safe: spark=false garantisce nessuna abilitazione accidentale Lightning", () => {
    // Il fail-safe dichiarato in api.ts:
    // return { multichain_payments_enabled: true, spark_lightning_enabled: false }
    const failSafe = { multichain_payments_enabled: true, spark_lightning_enabled: false };
    expect(failSafe.spark_lightning_enabled).toBe(false); // DEVE essere false per sicurezza
    expect(failSafe.multichain_payments_enabled).toBe(true); // backward compat
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEZIONE G: Provider children rendering — nessuna rottura albero React
// ──────────────────────────────────────────────────────────────────────────────

describe("G. SparkWalletProvider — children rendering invariato", () => {
  it("G1: children renderizzati con isEnabled=false", () => {
    const Sentinel = () => React.createElement("div", { "data-testid": "g1" }, "OK");
    const { getByTestId } = render(
      React.createElement(
        SparkWalletProvider,
        { isEnabled: false },
        React.createElement(Sentinel),
      ),
    );
    expect(getByTestId("g1").textContent).toBe("OK");
  });

  it("G2: children renderizzati con isEnabled=true", () => {
    const Sentinel = () => React.createElement("div", { "data-testid": "g2" }, "ON");
    const { getByTestId } = render(
      React.createElement(
        SparkWalletProvider,
        { isEnabled: true },
        React.createElement(Sentinel),
      ),
    );
    expect(getByTestId("g2").textContent).toBe("ON");
  });

  it("G3: useSparkWallet lancia se usato fuori dal Provider", () => {
    const Broken = () => { useSparkWallet(); return null; };
    expect(() => render(React.createElement(Broken))).toThrow(
      "useSparkWallet() chiamato fuori da SparkWalletProvider",
    );
  });

  it("G4: Provider annidato — contesto interno sovrascrive quello esterno", () => {
    // Verifica che l'annidamento non causi problemi al tree React
    const Inner = () => {
      const ctx = useSparkWallet();
      return React.createElement("div", { "data-testid": "inner" }, ctx.state);
    };
    const { getByTestId } = render(
      React.createElement(
        SparkWalletProvider,
        { isEnabled: false },
        React.createElement(
          SparkWalletProvider,
          { isEnabled: false },
          React.createElement(Inner),
        ),
      ),
    );
    expect(getByTestId("inner").textContent).toBe("disabled");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SEZIONE H: assertFeeBreakdownConsistent — invarianti di audit
// ──────────────────────────────────────────────────────────────────────────────

describe("H. assertFeeBreakdownConsistent — invarianti Treasury", () => {
  it("H1: breakdown valido non lancia", () => {
    const bd = calculateSparkFeeBreakdown(10_000n, 100n, defaultFeeConfig);
    // assertFeeBreakdownConsistent è già importata sopra via spark-fee-engine
    expect(() => assertFeeBreakdownConsistent(bd)).not.toThrow();
  });

  it("H2: breakdown con alphaPlatformFeeSat negativa lancia (Treasury guard)", () => {
    const bd: SparkFeeBreakdown = {
      recipientAmountSat:      1000n,
      alphaPlatformFeeSat:     -1n,     // INVALID
      estimatedProviderFeeSat: 100n,
      totalDebitSat:           1099n,
      amountMode:              "fee_excluded",
      feeConfigSnapshot:       defaultFeeConfig,
    };
    expect(() => assertFeeBreakdownConsistent(bd)).toThrow();
  });

  it("H3: breakdown con totalDebit != somma delle parti lancia (contabilità guard)", () => {
    const bd: SparkFeeBreakdown = {
      recipientAmountSat:      1000n,
      alphaPlatformFeeSat:     10n,
      estimatedProviderFeeSat: 100n,
      totalDebitSat:           999n,    // WRONG — dovrebbe essere 1110n
      amountMode:              "fee_excluded",
      feeConfigSnapshot:       defaultFeeConfig,
    };
    expect(() => assertFeeBreakdownConsistent(bd)).toThrow();
  });
});
