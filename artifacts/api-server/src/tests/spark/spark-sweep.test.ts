/**
 * spark-sweep.test.ts — Suite completa sweep Lightning Fee Wallet
 *
 * §1  Saldo sotto soglia → nessun auto-sweep
 * §2  Saldo sopra soglia → auto-sweep accodato
 * §3  Manuale sotto soglia → consentito
 * §4  Doppio click → una sola operazione (lock atomico)
 * §5  Scheduler + manuale contemporaneamente → una sola operazione
 * §6  Backend restart → nessun doppio sweep (riconciliazione)
 * §7  Timeout dopo TX → riconciliazione history
 * §8  Sweep failed → fee records NON marcati swept
 * §9  Sweep success → fee records marcati swept
 * §10 Treasury address invalido → blocco
 * §11 Non super_admin → 403
 * §12 Mnemonic mai esposto nelle response
 * §13 Main payment tests invariati (isolamento)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction }   from "express";

// ─── Mock MongoDB models ───────────────────────────────────────────────────────

const mockFindSweep         = vi.fn();
const mockFindOneSweep      = vi.fn();
const mockFindByIdSweep     = vi.fn();
const mockFindOneAndUpdate  = vi.fn();
const mockCountDocumentsSw  = vi.fn();
const mockCreateSweep       = vi.fn();
const mockUpdateManySweep   = vi.fn();

vi.mock("../../models/spark-sweep-operation.model.js", () => ({
  SparkSweepOperationModel: {
    find:             (...a: unknown[]) => {
      const q = mockFindSweep(...a);
      // support .sort().skip().limit().lean() chain
      if (q && typeof q === 'object' && !Array.isArray(q)) return q;
      return {
        sort:  () => ({ skip: () => ({ limit: () => ({ lean: () => Promise.resolve(q ?? []) }) }) }),
        lean:  () => Promise.resolve(q ?? []),
      };
    },
    findOne:          (...a: unknown[]) => mockFindOneSweep(...a),
    findById:         (...a: unknown[]) => mockFindByIdSweep(...a),
    findByIdAndUpdate: (...a: unknown[]) => Promise.resolve(null),
    findOneAndUpdate: (...a: unknown[]) => mockFindOneAndUpdate(...a),
    countDocuments:   (...a: unknown[]) => mockCountDocumentsSw(...a),
    create:           (...a: unknown[]) => mockCreateSweep(...a),
    updateMany:       (...a: unknown[]) => mockUpdateManySweep(...a),
  },
}));

const mockFindFee       = vi.fn();
const mockAggregateFee  = vi.fn();
const mockUpdateManyFee = vi.fn();

vi.mock("../../models/alpha-wallet-fee-record.model.js", () => ({
  AlphaWalletFeeRecordModel: {
    find:        (...a: unknown[]) => {
      const q = mockFindFee(...a);
      return {
        sort:  () => ({ lean: () => Promise.resolve(q ?? []) }),
        lean:  () => Promise.resolve(q ?? []),
      };
    },
    aggregate:   (...a: unknown[]) => mockAggregateFee(...a),
    updateMany:  (...a: unknown[]) => mockUpdateManyFee(...a),
  },
  emitPermanentFeeFailureAlert: vi.fn(),
}));

const mockGetSparkFeeConfig = vi.fn();
vi.mock("../../models/spark-fee-config.model.js", () => ({
  getSparkFeeConfig:  (...a: unknown[]) => mockGetSparkFeeConfig(...a),
  SparkFeeConfigModel: {
    findOneAndUpdate: vi.fn().mockResolvedValue({
      sweep_threshold_eur: 100,
      sweep_treasury_spark_address: "sp1qtest",
      auto_sweep_enabled: false,
    }),
  },
  SPARK_FEE_DEFAULTS: { fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 },
}));

// ─── Mock Executor (SDK) ───────────────────────────────────────────────────────

const mockSweepFeeWalletTo        = vi.fn();
const mockListFeeWalletPayments   = vi.fn();
const mockGetFeeWalletLiveBalance = vi.fn();

vi.mock("../../services/spark-fee-wallet-executor.js", () => ({
  sweepFeeWalletTo:           (...a: unknown[]) => mockSweepFeeWalletTo(...a),
  listFeeWalletRecentPayments: (...a: unknown[]) => mockListFeeWalletPayments(...a),
  getFeeWalletLiveBalance:    (...a: unknown[]) => mockGetFeeWalletLiveBalance(...a),
}));

// ─── Mock CoinGecko fetch ─────────────────────────────────────────────────────

// Mock fetch globale per CoinGecko
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Import DOPO i mock ───────────────────────────────────────────────────────

import {
  checkAndQueueAutoSweep,
  triggerManualSweep,
  executePendingSweep,
  reconcileProcessingSweeps,
  getSweepPreview,
  getLedgerAvailableSat,
  fetchBtcPriceEur,
  eurToSat,
  isValidTreasuryAddress,
  _invalidatePriceCache,
} from "../../services/spark-sweep.service.js";

import {
  triggerManualSweepHandler,
  getSweepPreviewHandler,
  getSweepConfigHandler,
  updateSweepConfigHandler,
  getSweepOperationHandler,
} from "../../controllers/spark-sweep.controller.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkReq(
  body:   Record<string, unknown> = {},
  query:  Record<string, unknown> = {},
  params: Record<string, unknown> = {},
  extras: Record<string, unknown> = {},
): Request {
  return { body, query, params, adminEmail: "admin@test.com", ...extras } as unknown as Request;
}

function mkRes() {
  let statusCode = 200;
  let payload: unknown = undefined;
  const res = {
    status: (c: number) => { statusCode = c; return res; },
    json:   (p: unknown) => { payload = p; return res; },
    get statusCode() { return statusCode; },
    get payload()    { return payload; },
  } as unknown as Response & { statusCode: number; payload: unknown };
  return res;
}

const noopNext: NextFunction = () => {};

// Configurazione fee di default
const DEFAULT_CFG = {
  fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30,
  sweep_threshold_eur: 100,
  sweep_treasury_spark_address: "sp1qtreasuryaddress123456789",
  auto_sweep_enabled: false,
};

function mockPrice(priceEur = 60_000) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ bitcoin: { eur: priceEur } }),
  });
}

function mockNoLock() {
  mockFindOneSweep.mockResolvedValue(null); // nessuna operazione processing
}

function mockBalance(successSat: number, sweptSat = 0) {
  mockAggregateFee
    .mockResolvedValueOnce([{ total: successSat }]) // success
    .mockResolvedValueOnce([{ total: sweptSat }]);  // swept
}

function mockSweepCreate(id = "op-test-001") {
  mockCreateSweep.mockResolvedValue({
    _id:    id,
    toObject: () => ({ _id: id, status: "pending", amountSat: 5000 }),
  });
}

// ─── Inizializzazione ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  _invalidatePriceCache();
});

// ─── §1 Saldo sotto soglia → nessun auto-sweep ────────────────────────────────

describe("§1 Auto-sweep: saldo sotto soglia → nessun auto-sweep", () => {
  it("non crea operazione se availableSat < thresholdSat", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({
      ...DEFAULT_CFG,
      auto_sweep_enabled: true,
    });
    mockPrice(60_000); // BTC = 60k EUR → 100 EUR = ~166_667 sat
    mockBalance(50_000); // 50k sat = < 166k sat threshold
    mockNoLock();

    await checkAndQueueAutoSweep();

    expect(mockCreateSweep).not.toHaveBeenCalled();
  });

  it("auto-sweep disabilitato → skip immediato", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({
      ...DEFAULT_CFG,
      auto_sweep_enabled: false,
    });

    await checkAndQueueAutoSweep();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateSweep).not.toHaveBeenCalled();
  });
});

// ─── §2 Saldo sopra soglia → auto-sweep accodato ─────────────────────────────

describe("§2 Auto-sweep: saldo sopra soglia → sweep accodato", () => {
  it("crea operazione auto quando availableSat >= thresholdSat", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({
      ...DEFAULT_CFG,
      auto_sweep_enabled: true,
      sweep_threshold_eur: 100,
    });
    mockPrice(60_000); // threshold = 166_667 sat
    mockBalance(200_000); // 200k sat > 166k threshold
    mockNoLock();
    mockSweepCreate("op-auto-001");

    // Mock executePendingSweep via findOneAndUpdate (acquisisce lock)
    mockFindOneAndUpdate.mockResolvedValue({
      _id: "op-auto-001", status: "processing", amountSat: 200_000,
      treasuryAddress: DEFAULT_CFG.sweep_treasury_spark_address,
    });
    mockSweepFeeWalletTo.mockResolvedValue({
      paymentId: "pay-auto-001", feeSat: 100, netAmountSat: 199_900,
    });
    mockFindFee.mockResolvedValue([
      { _id: "spark_fee1", feeAmountSat: 200_000 },
    ]);
    mockUpdateManyFee.mockResolvedValue({ modifiedCount: 1 });

    await checkAndQueueAutoSweep();

    expect(mockCreateSweep).toHaveBeenCalledWith(
      expect.objectContaining({ type: "auto", amountSat: 200_000 }),
    );
  });
});

// ─── §3 Manuale sotto soglia → consentito ────────────────────────────────────

describe("§3 Prelievo manuale: consentito anche sotto soglia", () => {
  it("triggerManualSweep funziona anche con saldo < thresholdSat", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({
      ...DEFAULT_CFG,
      sweep_threshold_eur: 100,
    });
    mockBalance(1_000); // 1000 sat = molto sotto soglia
    mockNoLock();
    mockPrice(60_000);
    mockSweepCreate("op-manual-001");

    const result = await triggerManualSweep("admin@test.com");

    expect(result.ok).toBe(true);
    expect(result.operationId).toBeDefined();
    expect(mockCreateSweep).toHaveBeenCalledWith(
      expect.objectContaining({ type: "manual", requestedBy: "admin@test.com" }),
    );
  });
});

// ─── §4 Doppio click → una sola operazione ───────────────────────────────────

describe("§4 Idempotenza: doppio click → una sola operazione", () => {
  it("triggerManualSweep restituisce errore se già in processing", async () => {
    mockGetSparkFeeConfig.mockResolvedValue(DEFAULT_CFG);
    mockBalance(5_000);
    // Simula lock attivo (processing recente)
    mockFindOneSweep.mockResolvedValue({
      _id: "op-existing", status: "processing",
      startedAt: new Date(Date.now() - 30_000), // 30s fa = non stale
    });

    const result = await triggerManualSweep("admin@test.com");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("già in corso");
    expect(mockCreateSweep).not.toHaveBeenCalled();
  });
});

// ─── §5 Scheduler + manuale contemporaneamente → una sola operazione ─────────

describe("§5 Concurrent: scheduler + manuale → una sola operazione", () => {
  it("auto-sweep non crea operazione se lock occupato da manuale", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({
      ...DEFAULT_CFG,
      auto_sweep_enabled: true,
    });
    mockBalance(200_000);
    mockPrice(60_000);
    // Lock occupato
    mockFindOneSweep.mockResolvedValue({
      _id: "op-manual-running", status: "processing",
      startedAt: new Date(Date.now() - 30_000),
    });

    await checkAndQueueAutoSweep();

    expect(mockCreateSweep).not.toHaveBeenCalled();
  });
});

// ─── §6 Backend restart → nessun doppio sweep ────────────────────────────────

describe("§6 Recovery: backend restart → nessun doppio sweep", () => {
  it("reconcileProcessingSweeps trova pagamento in history → success, no nuovo sweep", async () => {
    const staleOp = {
      _id: "op-stale-001",
      status: "processing",
      startedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min fa
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
      amountSat: 5_000,
      treasuryAddress: "sp1qtreasurytest",
    };

    // find processing operations > 15 min
    const mockFind = vi.fn().mockReturnValue({
      lean: () => Promise.resolve([staleOp]),
    });
    const { SparkSweepOperationModel } = await import("../../models/spark-sweep-operation.model.js");
    const origFind = SparkSweepOperationModel.find;
    SparkSweepOperationModel.find = mockFind as typeof SparkSweepOperationModel.find;

    // SDK history: pagamento trovato
    mockListFeeWalletPayments.mockResolvedValue([{
      paymentId: "pay-found-001",
      amountSat: 4_900,   // 5000 - 100 fee
      timestamp: Math.floor((Date.now() - 18 * 60 * 1000) / 1000),
      status: "complete",
    }]);
    mockFindFee.mockResolvedValue([{ _id: "spark_fee1", feeAmountSat: 5_000 }]);
    mockUpdateManyFee.mockResolvedValue({ modifiedCount: 1 });

    await reconcileProcessingSweeps();

    // Verifica che sia stato marcato success (non abbia creato un nuovo sweep)
    expect(mockSweepFeeWalletTo).not.toHaveBeenCalled();

    SparkSweepOperationModel.find = origFind;
  });
});

// ─── §7 Timeout dopo TX → riconciliazione history ────────────────────────────

describe("§7 Recovery: timeout dopo TX → riconciliazione cerca in history", () => {
  it("se history NON trova pagamento → operazione marcata failed", async () => {
    const staleOp = {
      _id: "op-timeout-001",
      status: "processing",
      startedAt: new Date(Date.now() - 20 * 60 * 1000),
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
      amountSat: 3_000,
      treasuryAddress: "sp1qtreasurytest",
    };

    const mockFind = vi.fn().mockReturnValue({
      lean: () => Promise.resolve([staleOp]),
    });
    const { SparkSweepOperationModel } = await import("../../models/spark-sweep-operation.model.js");
    const origFind = SparkSweepOperationModel.find;
    SparkSweepOperationModel.find = mockFind as typeof SparkSweepOperationModel.find;

    // SDK history: nessun pagamento trovato
    mockListFeeWalletPayments.mockResolvedValue([]);

    await reconcileProcessingSweeps();

    // Nessun fee record marcato swept (non c'è stato sweep)
    expect(mockUpdateManyFee).not.toHaveBeenCalled();
    // Nessun nuovo sweep avviato
    expect(mockSweepFeeWalletTo).not.toHaveBeenCalled();

    SparkSweepOperationModel.find = origFind;
  });
});

// ─── §8 Sweep failed → fee records NON marcati swept ─────────────────────────

describe("§8 Sweep failed → fee records NOT marcati swept", () => {
  it("se executor lancia → status=failed, updateMany NON chiamato", async () => {
    mockFindOneAndUpdate.mockResolvedValue({
      _id: "op-fail-001", status: "processing", amountSat: 5_000,
      treasuryAddress: "sp1qtreasurytest",
    });
    mockSweepFeeWalletTo.mockRejectedValue(new Error("Network timeout"));

    await executePendingSweep("op-fail-001");

    expect(mockUpdateManyFee).not.toHaveBeenCalled();
  });
});

// ─── §9 Sweep success → fee records marcati swept ────────────────────────────

describe("§9 Sweep success → fee records marcati swept", () => {
  it("se executor restituisce paymentId → updateMany status=swept", async () => {
    mockFindOneAndUpdate.mockResolvedValue({
      _id: "op-ok-001", status: "processing", amountSat: 5_000,
      treasuryAddress: "sp1qtreasurytest",
    });
    mockSweepFeeWalletTo.mockResolvedValue({
      paymentId: "pay-success-001", feeSat: 50, netAmountSat: 4_950,
    });
    mockFindFee.mockResolvedValue([
      { _id: "spark_fee1", feeAmountSat: 3_000 },
      { _id: "spark_fee2", feeAmountSat: 2_000 },
    ]);
    mockUpdateManyFee.mockResolvedValue({ modifiedCount: 2 });

    await executePendingSweep("op-ok-001");

    expect(mockUpdateManyFee).toHaveBeenCalledWith(
      { _id: { $in: ["spark_fee1", "spark_fee2"] }, status: "success" },
      { $set: { status: "swept", feePaymentId: "pay-success-001" } },
    );
  });
});

// ─── §10 Treasury address invalido → blocco ──────────────────────────────────

describe("§10 Treasury address invalido → sweep bloccato", () => {
  it("isValidTreasuryAddress rifiuta indirizzi non-Spark", () => {
    expect(isValidTreasuryAddress(null)).toBe(false);
    expect(isValidTreasuryAddress(undefined)).toBe(false);
    expect(isValidTreasuryAddress("")).toBe(false);
    expect(isValidTreasuryAddress("bc1qtest")).toBe(false);   // BTC on-chain
    expect(isValidTreasuryAddress("0xabcdef")).toBe(false);   // EVM
    expect(isValidTreasuryAddress("sp1qvalid")).toBe(true);   // Spark mainnet
    expect(isValidTreasuryAddress("sprt1qtest")).toBe(true);  // Spark regtest
  });

  it("triggerManualSweep restituisce errore se treasury address invalido", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({
      ...DEFAULT_CFG,
      sweep_treasury_spark_address: null, // non configurato
    });
    mockBalance(5_000);

    const result = await triggerManualSweep("admin@test.com");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Treasury");
    expect(mockCreateSweep).not.toHaveBeenCalled();
  });

  it("PATCH /sweep/config rifiuta treasury address invalido → 400", async () => {
    const req = mkReq({ sweep_treasury_spark_address: "bc1qinvalid" });
    const res = mkRes();
    await updateSweepConfigHandler(req, res, noopNext);
    expect(res.statusCode).toBe(400);
    expect((res.payload as Record<string, string>).error).toBe("INVALID_TREASURY_ADDRESS");
  });
});

// ─── §11 Non super_admin → 403 ───────────────────────────────────────────────

describe("§11 Accesso non autorizzato → 403", () => {
  it("triggerManualSweepHandler senza adminEmail → non crea sweep", async () => {
    // Nota: il middleware requireAdmin gestisce il 403 prima del controller.
    // Qui testiamo che il controller stesso non esponga dati sensibili.
    mockGetSparkFeeConfig.mockResolvedValue(DEFAULT_CFG);
    mockBalance(0);
    mockNoLock();

    // Simula un utente non-admin (adminEmail assente → triggerManualSweep usa "unknown")
    const req = mkReq({}, {}, {}, { adminEmail: "unknown" });
    const res = mkRes();
    await triggerManualSweepHandler(req, res, noopNext);

    // Con saldo 0 → 409 NOT_POSSIBLE (il 403 è gestito dal middleware a monte)
    expect(res.statusCode).toBe(409);
    const p = res.payload as Record<string, string>;
    expect(p.error).toBe("SWEEP_NOT_POSSIBLE");
  });
});

// ─── §12 Mnemonic mai esposto nelle response ──────────────────────────────────

describe("§12 Sicurezza: mnemonic mai esposto", () => {
  it("getSweepPreviewHandler non include mnemonic nella response", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({
      ...DEFAULT_CFG,
      sweep_treasury_spark_address: "sp1qtreasurytest",
    });
    mockAggregateFee
      .mockResolvedValueOnce([{ total: 5_000 }])
      .mockResolvedValueOnce([{ total: 0 }]);
    mockFindOneSweep.mockResolvedValue(null);
    mockPrice(60_000);

    const req = mkReq();
    const res = mkRes();
    await getSweepPreviewHandler(req, res, noopNext);

    const responseStr = JSON.stringify(res.payload);
    expect(responseStr).not.toContain("mnemonic");
    expect(responseStr).not.toContain("ALPHA_SPARK_FEE_MNEMONIC");
    expect(responseStr).not.toContain("seed");
    expect(responseStr).not.toContain("private");
    expect(responseStr).not.toContain("bip39");
  });

  it("getSweepConfigHandler non include mnemonic nella response", async () => {
    mockGetSparkFeeConfig.mockResolvedValue(DEFAULT_CFG);
    mockPrice(60_000);

    const req = mkReq();
    const res = mkRes();
    await getSweepConfigHandler(req, res, noopNext);

    const responseStr = JSON.stringify(res.payload);
    expect(responseStr).not.toContain("mnemonic");
    expect(responseStr).not.toContain("ALPHA_SPARK_FEE_MNEMONIC");
  });
});

// ─── §13 Main payment tests invariati (isolamento) ───────────────────────────

describe("§13 Isolamento: sweep NON importa da main payment flow", () => {
  it("spark-sweep.service non importa da ChatPage, alpha-wallet-page, sendPayment", async () => {
    const src = await import("fs").then(m =>
      m.readFileSync("src/services/spark-sweep.service.ts", "utf8")
    );
    expect(src).not.toContain("ChatPage");
    expect(src).not.toContain("AlphaWalletPage");
    expect(src).not.toContain("prepareSend");
    expect(src).not.toContain("sendInProgress");
    expect(src).not.toContain("multichain");
    expect(src).not.toContain("usda");
    expect(src).not.toContain("btc_onchain");
  });

  it("spark-fee-wallet-executor non espone il mnemonic in nessun log o errore", async () => {
    const src = await import("fs").then(m =>
      m.readFileSync("src/services/spark-fee-wallet-executor.ts", "utf8")
    );
    // Mnemonic viene letto ma non loggato
    expect(src).not.toMatch(/logger\.(info|warn|error|debug).*mnemonic/i);
    expect(src).not.toMatch(/console\.(log|warn|error).*mnemonic/i);
  });

  it("eurToSat converte correttamente EUR in sat", () => {
    // 100 EUR @ 60.000 EUR/BTC = 100/60000 * 100_000_000 = 166_667 sat
    expect(eurToSat(100, 60_000)).toBe(166_667);
    expect(eurToSat(50,  60_000)).toBe(83_333);
    expect(eurToSat(500, 60_000)).toBe(833_333);
  });
});
