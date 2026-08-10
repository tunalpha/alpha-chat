/**
 * bitcoin-min-amount.service.test.ts
 *
 * Unit test per la doppia soglia minima BTC (Sprint — Dual Threshold).
 *
 * Soglia 1: netAmount >= BTC_MIN_NET_SAT (default 10 000 sat)
 * Soglia 2: btcFiatAmount >= BTC_MIN_FIAT[currency] (EUR €10 / USD $11)
 *
 * Logica AND: entrambe devono essere vere per consentire la creazione.
 *
 * Copertura: 13 scenari
 *   S01 — OK: entrambe soglie superate (EUR)
 *   S02 — OK: entrambe soglie superate (USD)
 *   S03 — FAIL: net_sat sotto soglia 1 (9 999 sat)
 *   S04 — FAIL: net_sat esattamente al limite (10 000 sat) → OK
 *   S05 — FAIL: net_sat OK, fiat EUR sotto soglia (€5)
 *   S06 — FAIL: net_sat OK, fiat USD sotto soglia ($10)
 *   S07 — OK: fiat al limite esatto EUR (€10)
 *   S08 — OK: fiat al limite esatto USD ($11)
 *   S09 — FAIL: sia sat sia fiat sotto soglia → errore sat (prima)
 *   S10 — OK: nessun btcFiatAmount fornito → solo controllo sat
 *   S11 — OK: btcFiatAmount fornito senza btcFiatCurrency → solo controllo sat
 *   S12 — Env override: BTC_MIN_NET_SAT=5000 → 6 000 sat passa la soglia 1 ridotta
 *   S13 — Env override: BTC_MIN_FIAT_EUR=5 → €7 passa la soglia EUR ridotta
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

// ─── Mock moduli esterni prima degli import ───────────────────────────────────

const { mockUserFindOne } = vi.hoisted(() => ({
  mockUserFindOne: vi.fn(),
}));

vi.mock("../../models/user.model", () => ({
  UserModel: { findOne: mockUserFindOne },
}));

vi.mock("../../models/multichain-transfer.model", () => {
  const mockCreate = vi.fn();
  const mockFindOne = vi.fn();
  const mockFindOneAndUpdate = vi.fn();
  return {
    MultiChainTransferModel: {
      create: mockCreate,
      findOne: mockFindOne,
      findOneAndUpdate: mockFindOneAndUpdate,
    },
  };
});

vi.mock("../../blockchain/adapter-registry", () => ({
  adapterRegistry: { get: vi.fn() },
}));

vi.mock("../../blockchain/dynamic-fee-estimator", () => ({
  estimateDynamicNetworkFee: vi.fn().mockResolvedValue({
    networkFeeCharged: 0n,
    gasPriceWei:       0n,
    nativePriceUsd:    0,
    tx0Gas:            0,
    tx1Gas:            0,
    tx2Gas:            0,
    tx3Gas:            0,
    safetyMarginBps:   0,
    isLiveEstimate:    false,
  }),
  DynamicFeeError: class DynamicFeeError extends Error {
    readonly code = "DYNAMIC_FEE_ERROR" as const;
    readonly httpStatus = 503;
    constructor(msg: string) { super(msg); }
  },
}));

vi.mock("../../blockchain/native-price-provider", () => ({
  getNativePriceUsd:         vi.fn().mockResolvedValue(0),
  PriceUnavailableError:     class PriceUnavailableError extends Error {
    readonly code = "PRICE_UNAVAILABLE" as const;
    readonly httpStatus = 503;
    constructor(n: string, r: string) { super(`${n}: ${r}`); }
  },
  warmupNativePrices:        vi.fn().mockResolvedValue(undefined),
  getNativePriceCacheStatus: vi.fn().mockReturnValue({}),
}));

vi.mock("../../models/mc-network-fee-config.model", () => ({
  McNetworkFeeConfigModel:   { findOne: vi.fn() },
  getNetworkFeeConfig:       vi.fn().mockResolvedValue({ safetyMarginBps: 12_000, maxNetworkFeeRaw: null }),
  DEFAULT_SAFETY_MARGIN_BPS: 12_000,
}));

vi.mock("../../blockchain/escrow-crypto", () => ({
  generateEscrowWallet: vi.fn(() => ({
    address:    "0xESCROW_FAKE",
    privateKey: "0xDEADBEEF",
    encrypted:  "enc",
  })),
  decryptEscrowKeyHex: vi.fn().mockReturnValue("0xDEADBEEF"),
}));

vi.mock("../../blockchain/bitcoin/bitcoin-wallet", () => ({
  generateBtcEscrowWallet: vi.fn(() => ({
    address:    "bc1qfakeescrow",
    wif:        "KwFake",
    privateKey: "deadbeef",
  })),
}));

// estimateBtcMinDeposit: restituisce gross + 8420 sat (miner fee 3420 + buffer 5000)
vi.mock("../../blockchain/bitcoin/bitcoin-fee-estimator", () => ({
  estimateMinerFee: vi.fn().mockReturnValue(3_420n),
}));

vi.mock("../../models/mc-fee-override.model", () => ({
  getDbNetworkFeeBps: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../models/btc-settings.model", () => ({
  BtcSettingsModel: { findOne: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeValidObjectId() {
  return new mongoose.Types.ObjectId().toString();
}

/** Parametri base per createMultiChainTransfer BTC (recipient_exact) */
function baseBtcParams(overrides: {
  targetNetAmountUnits?: string;
  btcFiatAmount?: number;
  btcFiatCurrency?: string;
} = {}) {
  return {
    senderId:              makeValidObjectId(),
    recipientId:           makeValidObjectId(),
    conversationId:        makeValidObjectId(),
    network:               "bitcoin" as const,
    asset:                 "BTC" as const,
    amountMode:            "recipient_exact" as const,
    targetNetAmountUnits:  "15000",    // 15 000 sat default — sopra la soglia 1
    clientRef:             crypto.randomUUID(),
    expiresInHours:        24,
    ...overrides,
  };
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe("Bitcoin doppia soglia minima", () => {
  let createMultiChainTransfer: typeof import("../multichain-payment.service").createMultiChainTransfer;

  beforeEach(async () => {
    vi.resetModules();

    // Reset env var overrides prima di ogni test
    delete process.env["BTC_MIN_NET_SAT"];
    delete process.env["BTC_MIN_FIAT_EUR"];
    delete process.env["BTC_MIN_FIAT_USD"];

    // Import fresh del service (e del config) dopo resetModules
    const svc = await import("../multichain-payment.service");
    createMultiChainTransfer = svc.createMultiChainTransfer;

    // Mock ENABLE_BITCOIN = true
    vi.doMock("../../blockchain/multichain-config", async (importOriginal) => {
      const orig = await importOriginal<typeof import("../../blockchain/multichain-config")>();
      return {
        ...orig,
        FEATURE_FLAGS: { ...orig.FEATURE_FLAGS, ENABLE_BITCOIN: true },
      };
    });

    // Mock MultiChainTransferModel.create per restituire un doc valido
    const { MultiChainTransferModel } = await import("../../models/multichain-transfer.model");
    (MultiChainTransferModel.create as ReturnType<typeof vi.fn>).mockImplementation(
      (doc: Record<string, unknown>) => Promise.resolve({ ...doc, _id: new mongoose.Types.ObjectId() }),
    );
  });

  // ── S01 — OK: entrambe soglie superate (EUR) ─────────────────────────────

  it("S01 — OK: net 15 000 sat + €15 EUR supera entrambe le soglie", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        btcFiatAmount:         15,
        btcFiatCurrency:       "eur",
      })),
    ).resolves.toBeDefined();
  });

  // ── S02 — OK: entrambe soglie superate (USD) ─────────────────────────────

  it("S02 — OK: net 15 000 sat + $15 USD supera entrambe le soglie", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        btcFiatAmount:         15,
        btcFiatCurrency:       "usd",
      })),
    ).resolves.toBeDefined();
  });

  // ── S03 — FAIL: net_sat sotto soglia 1 (9 999 sat) ───────────────────────

  it("S03 — FAIL: net 9 999 sat < BTC_MIN_NET_SAT (10 000) → INVALID_AMOUNT BTC_BELOW_MIN_NET_SAT", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "9999",
        btcFiatAmount:         15,
        btcFiatCurrency:       "eur",
      })),
    ).rejects.toMatchObject({
      code:    "INVALID_AMOUNT",
      details: expect.objectContaining({ reason: "BTC_BELOW_MIN_NET_SAT" }),
    });
  });

  // ── S04 — OK: net_sat esattamente al limite (10 000 sat) ─────────────────

  it("S04 — OK: net esattamente 10 000 sat = BTC_MIN_NET_SAT → accettato", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "10000",
        btcFiatAmount:         15,
        btcFiatCurrency:       "eur",
      })),
    ).resolves.toBeDefined();
  });

  // ── S05 — FAIL: net OK, fiat EUR sotto soglia ─────────────────────────────

  it("S05 — FAIL: net 15 000 sat ma €5 EUR < BTC_MIN_FIAT_EUR (€10) → INVALID_AMOUNT BTC_BELOW_MIN_FIAT", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        btcFiatAmount:         5,
        btcFiatCurrency:       "eur",
      })),
    ).rejects.toMatchObject({
      code:    "INVALID_AMOUNT",
      details: expect.objectContaining({ reason: "BTC_BELOW_MIN_FIAT", minFiatCurrency: "eur" }),
    });
  });

  // ── S06 — FAIL: net OK, fiat USD sotto soglia ─────────────────────────────

  it("S06 — FAIL: net 15 000 sat ma $10 USD < BTC_MIN_FIAT_USD ($11) → INVALID_AMOUNT BTC_BELOW_MIN_FIAT", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        btcFiatAmount:         10,
        btcFiatCurrency:       "usd",
      })),
    ).rejects.toMatchObject({
      code:    "INVALID_AMOUNT",
      details: expect.objectContaining({ reason: "BTC_BELOW_MIN_FIAT", minFiatCurrency: "usd" }),
    });
  });

  // ── S07 — OK: fiat EUR al limite esatto ─────────────────────────────────

  it("S07 — OK: fiat esattamente €10 EUR = BTC_MIN_FIAT_EUR → accettato", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        btcFiatAmount:         10,
        btcFiatCurrency:       "eur",
      })),
    ).resolves.toBeDefined();
  });

  // ── S08 — OK: fiat USD al limite esatto ─────────────────────────────────

  it("S08 — OK: fiat esattamente $11 USD = BTC_MIN_FIAT_USD → accettato", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        btcFiatAmount:         11,
        btcFiatCurrency:       "usd",
      })),
    ).resolves.toBeDefined();
  });

  // ── S09 — FAIL: entrambe sotto soglia → errore sat (prima) ───────────────

  it("S09 — FAIL: sat 9 000 + €5 → errore soglia 1 (sat) per AND logic", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "9000",
        btcFiatAmount:         5,
        btcFiatCurrency:       "eur",
      })),
    ).rejects.toMatchObject({
      code:    "INVALID_AMOUNT",
      details: expect.objectContaining({ reason: "BTC_BELOW_MIN_NET_SAT" }),
    });
  });

  // ── S10 — OK: nessun btcFiatAmount → solo controllo sat ──────────────────

  it("S10 — OK: nessun btcFiatAmount fornito → solo soglia sat applicata (15 000 sat → OK)", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        // btcFiatAmount assente → soglia 2 non controllata
      })),
    ).resolves.toBeDefined();
  });

  // ── S11 — OK: btcFiatAmount senza btcFiatCurrency → solo controllo sat ───

  it("S11 — OK: btcFiatAmount presente ma btcFiatCurrency assente → solo soglia sat", async () => {
    await expect(
      createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        btcFiatAmount:         5,   // sotto soglia, ma currency mancante → non controllato
        // btcFiatCurrency assente
      })),
    ).resolves.toBeDefined();
  });

  // ── S12 — Env override: BTC_MIN_NET_SAT=5000 ─────────────────────────────
  //
  // NOTA: vi.resetModules() + process.env forza la re-lettura delle costanti
  // all'import del modulo config. Questo test è una best-effort demo:
  // in produzione, la costante è letta una volta all'avvio del processo.

  it("S12 — Env override BTC_MIN_NET_SAT=5000: 6 000 sat supera la soglia ridotta", async () => {
    process.env["BTC_MIN_NET_SAT"] = "5000";
    vi.resetModules();
    const svc2 = await import("../multichain-payment.service");

    const { MultiChainTransferModel } = await import("../../models/multichain-transfer.model");
    (MultiChainTransferModel.create as ReturnType<typeof vi.fn>).mockImplementation(
      (doc: Record<string, unknown>) => Promise.resolve({ ...doc, _id: new mongoose.Types.ObjectId() }),
    );

    await expect(
      svc2.createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "6000",  // < 10 000 default, ma > 5 000 override
        btcFiatAmount:         15,
        btcFiatCurrency:       "eur",
      })),
    ).resolves.toBeDefined();

    delete process.env["BTC_MIN_NET_SAT"];
  });

  // ── S13 — Env override: BTC_MIN_FIAT_EUR=5 ───────────────────────────────

  it("S13 — Env override BTC_MIN_FIAT_EUR=5: €7 supera la soglia ridotta", async () => {
    process.env["BTC_MIN_FIAT_EUR"] = "5";
    vi.resetModules();
    const svc3 = await import("../multichain-payment.service");

    const { MultiChainTransferModel } = await import("../../models/multichain-transfer.model");
    (MultiChainTransferModel.create as ReturnType<typeof vi.fn>).mockImplementation(
      (doc: Record<string, unknown>) => Promise.resolve({ ...doc, _id: new mongoose.Types.ObjectId() }),
    );

    await expect(
      svc3.createMultiChainTransfer(baseBtcParams({
        targetNetAmountUnits: "15000",
        btcFiatAmount:         7,   // < €10 default, ma > €5 override
        btcFiatCurrency:       "eur",
      })),
    ).resolves.toBeDefined();

    delete process.env["BTC_MIN_FIAT_EUR"];
  });
});
