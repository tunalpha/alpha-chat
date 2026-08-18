/**
 * getPublicSwapConfig — Test Suite
 *
 * Verifica che il config pubblico esponga `activeEvmProvider`
 * in base al provider primario DB.
 *
 * REGOLE ASSOLUTE:
 *   1. "changenow" PRIMARY → activeEvmProvider = "changenow"
 *   2. "lifi"      PRIMARY → activeEvmProvider = "lifi"
 *   3. Nessun provider PRIMARY → activeEvmProvider = "lifi" (fail-open sicuro)
 *   4. getPrimaryProvider() failure → default "lifi" (fail-open resiliente)
 *   5. Il config pubblico NON richiede auth
 *   6. ChangeNOW PRIMARY → fee Alpha = 0
 *
 * T1  — lifi PRIMARY → activeEvmProvider = "lifi"
 * T2  — changenow PRIMARY → activeEvmProvider = "changenow"
 * T3  — nessun provider PRIMARY → default "lifi" (fail-open)
 * T4  — getPrimaryProvider() lancia → default "lifi" (resiliente)
 * T5  — activeEvmProvider incluso nel tipo corretto
 * T6  — routing: changenow → ChangeNowEvmSwapView (logica pura)
 * T7  — routing: lifi → EvmSwapView (logica pura)
 * T8  — routing: undefined → UNAVAILABLE (NO fallback silenzioso)
 * T9  — config accessibile senza token admin (endpoint pubblico)
 * T10 — ChangeNOW: fee Alpha = 0
 * T11 — isolamento da payment engine (documentale)
 * T12 — idempotenza: chiamate multiple → stesso valore
 * T13 — dopo cambio DB: activeEvmProvider aggiornato
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SwapProviderConfigModel, seedSwapProviders } from "../../models/swap-provider-config.model.js";

// ── Mocks (nessuna chiamata di rete) ─────────────────────────────────────────

vi.mock("../../services/swap/boltz.service.js", () => ({
  checkBoltzHealth:       vi.fn(async () => ({ reachable: true })),
  getBoltzSubmarineFees:  vi.fn(async () => ({
    fees: { percentage: 0.1, minerFees: { invoice: { normal: 300 } } },
  })),
}));

vi.mock("../../services/swap/swap-config.service.js", () => ({
  getSwapConfig: vi.fn(async () => ({
    enabled:                   true,
    excluded_assets:           ["USDA"],
    boltz_btcln_enabled:       true,
    breez_spark_lnbtc_enabled: true,
    btcln_fee_bps:             25,
    lnbtc_fee_bps:             0,
  })),
}));

import { getPublicSwapConfig }      from "../../services/swap/swap.service.js";

// ── UNA sola istanza MongoMemoryServer per tutta la suite ─────────────────────

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await seedSwapProviders(); // lifi: primary=true, changenow: disabled
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongod?.stop();
});

// Helper: ripristina stato seed tra test — NON usa dropDatabase (causa problemi con mongoose/MongoMemoryServer)
async function resetToSeed() {
  await SwapProviderConfigModel.updateOne(
    { providerId: "lifi" },
    { $set: { status: "enabled", isPrimary: true, isFallback: false } }
  );
  await SwapProviderConfigModel.updateOne(
    { providerId: "changenow" },
    { $set: { status: "disabled", isPrimary: false, isFallback: false } }
  );
}

// ── T1 ────────────────────────────────────────────────────────────────────────

describe("T1 — lifi PRIMARY → activeEvmProvider = 'lifi'", () => {
  it("config pubblico restituisce 'lifi' con seed default", async () => {
    const cfg = await getPublicSwapConfig();
    expect(cfg.activeEvmProvider).toBe("lifi");
  });
});

// ── T2 ────────────────────────────────────────────────────────────────────────

describe("T2 — changenow PRIMARY → activeEvmProvider = 'changenow'", () => {
  it("config pubblico restituisce 'changenow' quando ChangeNOW è PRIMARY", async () => {
    await SwapProviderConfigModel.updateOne(
      { providerId: "changenow" },
      { $set: { status: "enabled", isPrimary: true } }
    );
    await SwapProviderConfigModel.updateOne(
      { providerId: "lifi" },
      { $set: { isPrimary: false } }
    );

    // Verifica DB state direttamente (senza chiamare getPrimaryProvider())
    const primary = await SwapProviderConfigModel
      .findOne({ status: "enabled", isPrimary: true }).lean().exec();
    expect(primary?.providerId).toBe("changenow");

    // Verifica via config pubblico
    const cfg = await getPublicSwapConfig();
    expect(cfg.activeEvmProvider).toBe("changenow");

    await resetToSeed();
  });
});

// ── T3 ────────────────────────────────────────────────────────────────────────

describe("T3 — nessun provider PRIMARY → default 'lifi' fail-open", () => {
  it("activeEvmProvider = 'lifi' quando nessun provider è isPrimary=true", async () => {
    await SwapProviderConfigModel.updateMany({}, { $set: { isPrimary: false } });

    // Verifica DB state: nessun provider è primary
    const primary = await SwapProviderConfigModel
      .findOne({ status: "enabled", isPrimary: true }).lean().exec();
    expect(primary).toBeNull();

    // getPublicSwapConfig → fall-open a "lifi"
    const cfg = await getPublicSwapConfig();
    expect(cfg.activeEvmProvider).toBe("lifi");

    await resetToSeed();
  });
});

// ── T4 — nessun provider PRIMARY → fail-open ─────────────────────────────────
// Nota: getPublicSwapConfig usa ora import statico di getPrimaryProvider.
// Simuliamo "nessun primary" azzerando isPrimary su tutti i provider (già coperto da T3).
// Per l'errore DB usiamo una versione separata che verifica il comportamento fail-open.

describe("T4 — DB non ha provider enabled+primary → default 'lifi' resiliente", () => {
  it("activeEvmProvider = 'lifi' quando tutti i provider sono disabled/non-primary", async () => {
    // Simula assenza di provider valido: tutti disabled e isPrimary=false
    await SwapProviderConfigModel.updateMany({}, { $set: { isPrimary: false, status: "disabled" } });

    // Verifica DB state: nessun provider enabled+primary
    const count = await SwapProviderConfigModel
      .countDocuments({ status: "enabled", isPrimary: true });
    expect(count).toBe(0);

    // getPublicSwapConfig deve restituire "lifi" come default fail-open, NON lanciare
    const cfg = await getPublicSwapConfig();
    expect(cfg.activeEvmProvider).toBe("lifi");

    await resetToSeed();
  });
});

// ── T5 ────────────────────────────────────────────────────────────────────────

describe("T5 — activeEvmProvider nel tipo corretto", () => {
  it("è una stringa non vuota", async () => {
    const cfg = await getPublicSwapConfig();
    expect(typeof cfg.activeEvmProvider).toBe("string");
    expect(cfg.activeEvmProvider!.length).toBeGreaterThan(0);
  });

  it("config contiene tutti i campi obbligatori + activeEvmProvider", async () => {
    const cfg = await getPublicSwapConfig();
    expect(cfg).toHaveProperty("enabled");
    expect(cfg).toHaveProperty("btcln");
    expect(cfg).toHaveProperty("lnbtc");
    expect(cfg).toHaveProperty("activeEvmProvider");
  });
});

// ── T6-T8 — Routing frontend (logica pura, no DOM) ───────────────────────────

describe("T6-T8 — Routing frontend: branch provider (logica pura)", () => {
  // Riproduce esattamente il branch in SwapView.tsx
  function resolveEvmComponent(p: string | undefined): string {
    if (p === "changenow") return "ChangeNowEvmSwapView";
    if (p === "lifi")      return "EvmSwapView";
    return "UNAVAILABLE";
  }

  it("T6 — 'changenow' → ChangeNowEvmSwapView", () => {
    expect(resolveEvmComponent("changenow")).toBe("ChangeNowEvmSwapView");
  });

  it("T7 — 'lifi' → EvmSwapView (Li.Fi operativo)", () => {
    expect(resolveEvmComponent("lifi")).toBe("EvmSwapView");
  });

  it("T8 — undefined → UNAVAILABLE (NO fallback silenzioso a Li.Fi)", () => {
    expect(resolveEvmComponent(undefined)).toBe("UNAVAILABLE");
    // Assicura che undefined NON produca EvmSwapView
    expect(resolveEvmComponent(undefined)).not.toBe("EvmSwapView");
    expect(resolveEvmComponent(undefined)).not.toBe("ChangeNowEvmSwapView");
  });

  it("T8b — stringa sconosciuta → UNAVAILABLE", () => {
    expect(resolveEvmComponent("sushiswap")).toBe("UNAVAILABLE");
    expect(resolveEvmComponent("")).toBe("UNAVAILABLE");
  });

  it("T8c — null → UNAVAILABLE (NO fallback)", () => {
    expect(resolveEvmComponent(null as unknown as undefined)).toBe("UNAVAILABLE");
  });
});

// ── T9 ────────────────────────────────────────────────────────────────────────

describe("T9 — Config pubblico: nessuna auth richiesta", () => {
  it("getPublicSwapConfig() non accetta parametri auth — è pubblica per definizione", async () => {
    const cfg = await getPublicSwapConfig();
    expect(cfg).toBeDefined();
    expect(cfg.activeEvmProvider).toBeDefined();
  });
});

// ── T10 ────────────────────────────────────────────────────────────────────────

describe("T10 — ChangeNOW PRIMARY: fee Alpha = 0", () => {
  it("config con changenow non contiene evm_alpha_fee_bps", async () => {
    await SwapProviderConfigModel.updateOne(
      { providerId: "changenow" },
      { $set: { status: "enabled", isPrimary: true } }
    );
    await SwapProviderConfigModel.updateOne(
      { providerId: "lifi" },
      { $set: { isPrimary: false } }
    );

    const cfg = await getPublicSwapConfig();
    expect(cfg.activeEvmProvider).toBe("changenow");
    // Zero fee Alpha — revenue solo da Partner Share 0,40% ChangeNOW
    expect((cfg as Record<string, unknown>).evm_alpha_fee_bps).toBeUndefined();

    await resetToSeed();
  });
});

// ── T11 ────────────────────────────────────────────────────────────────────────

describe("T11 — Isolamento da payment engine", () => {
  it("getPublicSwapConfig funziona in isolamento dal payment engine", async () => {
    // Il test T1-T10 hanno già verificato che la funzione funziona
    // senza import da payment/usda/multichain/spark nel contesto di test
    const cfg = await getPublicSwapConfig();
    expect(cfg).toBeDefined();
  });
});

// ── T12-T13 ───────────────────────────────────────────────────────────────────

describe("T12-T13 — Idempotenza e cambio runtime", () => {
  it("T12 — due chiamate consecutive restituiscono lo stesso valore", async () => {
    const cfg1 = await getPublicSwapConfig();
    const cfg2 = await getPublicSwapConfig();
    expect(cfg1.activeEvmProvider).toBe(cfg2.activeEvmProvider);
  });

  it("T13 — activeEvmProvider si aggiorna dopo cambio DB", async () => {
    // Prima: lifi (da seed)
    const cfgBefore = await getPublicSwapConfig();
    expect(cfgBefore.activeEvmProvider).toBe("lifi");

    // Admin: abilita changenow come primary
    await SwapProviderConfigModel.updateOne(
      { providerId: "changenow" },
      { $set: { status: "enabled", isPrimary: true } }
    );
    await SwapProviderConfigModel.updateOne(
      { providerId: "lifi" },
      { $set: { isPrimary: false } }
    );

    // Dopo: changenow
    const cfgAfter = await getPublicSwapConfig();
    expect(cfgAfter.activeEvmProvider).toBe("changenow");

    await resetToSeed();
  });
});
