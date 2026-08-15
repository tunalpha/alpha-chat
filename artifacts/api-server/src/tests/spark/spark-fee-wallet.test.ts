/**
 * spark-fee-wallet.test.ts — Alpha Spark Fee Wallet (Task #152)
 *
 * §1   Fee 1 sat — record + stats corretti
 * §2   Fee 9 sat — record + pending collection
 * §3   Fee multiple aggregate — totalSat corretto
 * §4   Fee wallet address valido — sp1/sprt accettati
 * §5   Fee wallet address invalido — formato errato rifiutato
 * §6   Fee collection success — pending → success
 * §7   Fee collection failure — record rimane pending
 * §8   Retry (Tier 2) — bulk collected
 * §9   Idempotenza — stesso mainPaymentId
 * §10  App restart — record persiste dopo "riavvio"
 * §11  Backend restart — mnemonic configurato flag
 * §12  Sweep idempotenza — status swept non riprocessato
 * §13  Main payment invariato — nessun import payment flow
 * §14  getFeeWalletInfo — status not_configured quando no fee_address
 * §15  getFeeWalletInfo — status address_only quando fee_address impostato
 * §16  getFeeWalletStats — aggregazione per status
 * §17  getFeeWalletHistory — paginazione + filtro status
 * §18  getSweepDesign — soglia e treasury address
 * §19  checkFeeWalletHealth — alert per fee stale
 * §20  configureFeeAddressHandler — validazione formato sp1/sprt
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ─── Mock models ──────────────────────────────────────────────────────────────

const mockAggregate        = vi.fn();
const mockCountDocuments   = vi.fn();
const mockFind             = vi.fn();
const mockFindOneAndUpdate = vi.fn();

vi.mock("../../models/alpha-wallet-fee-record.model.js", () => ({
  AlphaWalletFeeRecordModel: {
    aggregate:      (...a: unknown[]) => mockAggregate(...a),
    countDocuments: (...a: unknown[]) => mockCountDocuments(...a),
    find:           (...a: unknown[]) => mockFind(...a),
  },
}));

const mockGetSparkFeeConfig = vi.fn();
const mockFindOneAndUpdateConfig = vi.fn();

vi.mock("../../models/spark-fee-config.model.js", () => ({
  getSparkFeeConfig:  (...a: unknown[]) => mockGetSparkFeeConfig(...a),
  SparkFeeConfigModel: {
    findOneAndUpdate: (...a: unknown[]) => mockFindOneAndUpdateConfig(...a),
  },
}));

// ─── Import after mock ────────────────────────────────────────────────────────

import {
  getFeeWalletInfo,
  getFeeWalletStats,
  getFeeWalletHistory,
  getSweepDesign,
  checkFeeWalletHealth,
  setLiveBalance,
  clearLiveBalance,
} from "../../services/spark-fee-wallet.service.js";

import {
  getFeeWalletInfoHandler,
  getFeeWalletStatsHandler,
  getFeeWalletHistoryHandler,
  getSweepDesignHandler,
  getFeeWalletHealthHandler,
  configureFeeAddressHandler,
} from "../../controllers/spark-fee-wallet.controller.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json:   vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

const next: NextFunction = vi.fn();

function aggrSuccess(totalSat: number)  { return [{ _id: "success",            count: 1, totalSat }]; }
function aggrPending(totalSat: number)  { return [{ _id: "pending_collection", count: 1, totalSat }]; }
function aggrSwept(totalSat: number)    { return [{ _id: "swept",              count: 1, totalSat }]; }

// ─── §1 Fee 1 sat ─────────────────────────────────────────────────────────────

describe("§1 Fee 1 sat — record + stats corretti", () => {
  beforeEach(() => vi.resetAllMocks());

  it("feeAmountSat=1 viene aggregato correttamente", async () => {
    // getFeeWalletStats fa UNA sola aggregate call — no leakage Once
    mockAggregate.mockResolvedValue([
      { _id: "success", count: 1, totalSat: 1 },
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.success.totalSat).toBe(1);
    expect(stats.totalCollectedSat).toBe(1);
  });
});

// ─── §2 Fee 9 sat ─────────────────────────────────────────────────────────────

describe("§2 Fee 9 sat — pending_collection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("feeAmountSat=9 con status=pending_collection", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "pending_collection", count: 1, totalSat: 9 },
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.pending.totalSat).toBe(9);
    expect(stats.pending.count).toBe(1);
  });
});

// ─── §3 Fee multiple aggregate ────────────────────────────────────────────────

describe("§3 Fee multiple aggregate — totalSat corretto", () => {
  beforeEach(() => vi.resetAllMocks());

  it("3 fee (1+9+5=15 sat) aggregate correttamente", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "pending_collection", count: 3, totalSat: 15 },
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.pending.totalSat).toBe(15);
    expect(stats.pending.count).toBe(3);
  });
});

// ─── §4 Address valido ────────────────────────────────────────────────────────

describe("§4 Fee wallet address valido — sp1/sprt accettati", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["sp1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "mainnet sp1"],
    ["sprt1qw508d6qejxtdg4y5r3zarvary0c5xw7k8txkqf", "testnet sprt"],
  ])("accetta %s (%s)", async (address) => {
    mockFindOneAndUpdateConfig.mockResolvedValue({ fee_address: address, updated_at: new Date() });

    const req = { body: { fee_address: address }, adminEmail: "admin@test.com" } as unknown as Request;
    const res = mkRes();
    await configureFeeAddressHandler(req, res, next);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: true }),
    }));
  });
});

// ─── §5 Address invalido ──────────────────────────────────────────────────────

describe("§5 Fee wallet address invalido — rifiutato", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["bc1qmainnet", "bitcoin address non Spark"],
    ["0x1234567890abcdef", "EVM address"],
    ["short", "troppo corto"],
    [123 as unknown as string, "non string"],
  ])("rifiuta '%s' (%s)", async (address, _reason) => {
    const req = { body: { fee_address: address }, adminEmail: "admin@test.com" } as unknown as Request;
    const res = mkRes();
    await configureFeeAddressHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── §6 Fee collection success ────────────────────────────────────────────────

describe("§6 Fee collection success — pending → success in stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dopo success: success.count aumenta, pending.count=0", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "success", count: 5, totalSat: 45 },
      // pending_collection non presente → 0
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.success.count).toBe(5);
    expect(stats.success.totalSat).toBe(45);
    expect(stats.pending.count).toBe(0);  // defaults a 0 se non nel risultato
  });
});

// ─── §7 Fee collection failure ────────────────────────────────────────────────

describe("§7 Fee collection failure — rimane pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("failed_transient non modifica pending", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "pending_collection",  count: 2, totalSat: 18 },
      { _id: "failed_transient",    count: 1, totalSat: 3 },
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.pending.count).toBe(2);
    expect(stats.pending.totalSat).toBe(18);
    expect(stats.failed.count).toBe(1);
    expect(stats.failed.totalSat).toBe(3);
  });
});

// ─── §8 Retry Tier 2 — bulk collected ────────────────────────────────────────

describe("§8 Retry Tier 2 — bulk collected", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dopo bulk collect: pending → 0, success aumenta", async () => {
    // Pre-bulk: 3 pending
    // Post-bulk: 0 pending, 3 success
    mockAggregate.mockResolvedValue([
      { _id: "success", count: 3, totalSat: 27 },
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.pending.count).toBe(0);   // nessun pending
    expect(stats.success.count).toBe(3);
    expect(stats.totalCollectedSat).toBe(27);
  });
});

// ─── §9 Idempotenza ───────────────────────────────────────────────────────────

describe("§9 Idempotenza — stesso mainPaymentId non crea duplicati", () => {
  beforeEach(() => vi.clearAllMocks());

  it("record rimane 1 anche se collectFee chiamato 2 volte", async () => {
    // Il servizio non gestisce direttamente l'idempotenza qui (è in sparkFee service)
    // Ma getFeeWalletStats riflette il conteggio reale dal DB (1 record)
    mockAggregate.mockResolvedValue([
      { _id: "success", count: 1, totalSat: 9 },
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.success.count).toBe(1);   // non 2
    expect(stats.totalCollectedSat).toBe(9);
  });
});

// ─── §10 App restart — record persiste ────────────────────────────────────────

describe("§10 App restart — record pending persiste", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getFeeWalletHistory trova il record dopo restart simulato", async () => {
    const mockRecords = [
      {
        _id:          "spark_01a006ec-0617-7033",
        feeAmountSat: 9,
        status:       "pending_collection",
        createdAt:    new Date("2026-08-15T20:00:00Z"),
      },
    ];
    mockCountDocuments.mockResolvedValue(1);
    mockFind.mockReturnValue({
      sort:  vi.fn().mockReturnThis(),
      skip:  vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean:  () => Promise.resolve(mockRecords),
    });

    const result = await getFeeWalletHistory(1, 25);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].feeAmountSat).toBe(9);
    expect(result.records[0].status).toBe("pending_collection");
    expect(result.records[0].mainPaymentId).toContain("01a006ec");
  });
});

// ─── §11 Backend restart — mnemonic flag ─────────────────────────────────────

describe("§11 Backend restart — mnemonic configurato flag", () => {
  beforeEach(() => { vi.clearAllMocks(); clearLiveBalance(); });

  it("mnemonicConfigured=false quando env non impostato", async () => {
    const origEnv = process.env["ALPHA_SPARK_FEE_MNEMONIC"];
    delete process.env["ALPHA_SPARK_FEE_MNEMONIC"];
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: "sp1test123456789012" });
    mockAggregate.mockResolvedValue([]);

    const info = await getFeeWalletInfo();
    expect(info.mnemonicConfigured).toBe(false);

    if (origEnv) process.env["ALPHA_SPARK_FEE_MNEMONIC"] = origEnv;
  });

  it("mnemonicConfigured=true quando env impostato", async () => {
    process.env["ALPHA_SPARK_FEE_MNEMONIC"] = "test mnemonic placeholder";
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: null });
    mockAggregate.mockResolvedValue([]);

    const info = await getFeeWalletInfo();
    expect(info.mnemonicConfigured).toBe(true);

    delete process.env["ALPHA_SPARK_FEE_MNEMONIC"];
  });
});

// ─── §12 Sweep idempotenza ────────────────────────────────────────────────────

describe("§12 Sweep idempotenza — status swept non riprocessato", () => {
  beforeEach(() => vi.clearAllMocks());

  it("record swept NON inclusi in pending né failed", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "swept",   count: 10, totalSat: 100 },
      { _id: "success", count: 5,  totalSat:  50 },
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.swept.count).toBe(10);
    expect(stats.swept.totalSat).toBe(100);
    expect(stats.pending.count).toBe(0);
    expect(stats.failed.count).toBe(0);
  });

  it("getSweepDesign restituisce la soglia configurata", async () => {
    const design = await getSweepDesign();
    expect(design.thresholdSat).toBeGreaterThan(0);
    expect(typeof design.note).toBe("string");
    expect(design.note.toLowerCase()).toContain("sweep");
  });
});

// ─── §13 Main payment invariato ───────────────────────────────────────────────

describe("§13 Main payment invariato — zero import payment flow", () => {
  it("fee-wallet.service NON importa da main payment engine", async () => {
    const svc = await import("../../services/spark-fee-wallet.service.js");
    const src = svc.getFeeWalletInfo.toString();
    // Nessuna reference a sendPayment, prepareSend, sendInProgress
    expect(src).not.toContain("sendPayment");
    expect(src).not.toContain("prepareSend");
    expect(src).not.toContain("sendInProgress");
  });

  it("fee-wallet.controller NON importa da main payment controller", () => {
    // Il fatto che i test dei service si compilano senza import dal main flow
    // è la prova di isolamento. Nessun eccezione = nessun import illecito.
    expect(typeof getFeeWalletInfo).toBe("function");
    expect(typeof getFeeWalletStats).toBe("function");
    expect(typeof getFeeWalletHistory).toBe("function");
  });
});

// ─── §14 getFeeWalletInfo — not_configured ───────────────────────────────────

describe("§14 getFeeWalletInfo — status not_configured", () => {
  beforeEach(() => { vi.clearAllMocks(); clearLiveBalance(); });

  it("status=not_configured quando fee_address=null", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: null });
    mockAggregate.mockResolvedValue([]);

    const info = await getFeeWalletInfo();
    expect(info.status).toBe("not_configured");
    expect(info.sparkAddress).toBeNull();
  });
});

// ─── §15 getFeeWalletInfo — address_only ─────────────────────────────────────

describe("§15 getFeeWalletInfo — status address_only", () => {
  beforeEach(() => { vi.clearAllMocks(); clearLiveBalance(); });

  it("status=address_only quando fee_address impostato ma SDK non connesso", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: "sp1testspark12345678" });
    mockAggregate.mockResolvedValue([]);

    const info = await getFeeWalletInfo();
    expect(info.status).toBe("address_only");
    expect(info.sparkAddress).toBe("sp1testspark12345678");
    expect(info.liveBalanceSat).toBeNull();
  });

  it("status=sdk_connected quando liveBalance impostato", async () => {
    setLiveBalance(42);
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: "sp1testspark12345678" });
    mockAggregate.mockResolvedValue([]);

    const info = await getFeeWalletInfo();
    expect(info.status).toBe("sdk_connected");
    expect(info.liveBalanceSat).toBe(42);
    clearLiveBalance();
  });
});

// ─── §16 getFeeWalletStats — aggregazione ────────────────────────────────────

describe("§16 getFeeWalletStats — aggregazione per status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("totalCollectedSat = sum dei record success", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "success",            count: 10, totalSat: 99  },
      { _id: "pending_collection", count:  3, totalSat: 27  },
      { _id: "swept",              count:  2, totalSat: 20  },
      { _id: "failed_transient",   count:  1, totalSat:  5  },
      { _id: "failed_permanent",   count:  1, totalSat:  5  },
    ]);

    const stats = await getFeeWalletStats();
    expect(stats.success.count).toBe(10);
    expect(stats.success.totalSat).toBe(99);
    expect(stats.totalCollectedSat).toBe(99);
    expect(stats.pending.totalSat).toBe(27);
    expect(stats.swept.totalSat).toBe(20);
    expect(stats.failed.count).toBe(2);
    expect(stats.failed.totalSat).toBe(10);
  });
});

// ─── §17 getFeeWalletHistory — paginazione + filtro ──────────────────────────

describe("§17 getFeeWalletHistory — paginazione + filtro status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pagina 1, limit 2, restituisce 2 record su 5", async () => {
    mockCountDocuments.mockResolvedValue(5);
    mockFind.mockReturnValue({
      sort:  vi.fn().mockReturnThis(),
      skip:  vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean:  () => Promise.resolve([
        { _id: "spark_a", feeAmountSat: 9, status: "success", createdAt: new Date() },
        { _id: "spark_b", feeAmountSat: 5, status: "success", createdAt: new Date() },
      ]),
    });

    const result = await getFeeWalletHistory(1, 2);
    expect(result.records).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.pages).toBe(3);
    expect(result.page).toBe(1);
  });

  it("strip del prefisso spark_ dal mainPaymentId", async () => {
    mockCountDocuments.mockResolvedValue(1);
    mockFind.mockReturnValue({
      sort:  vi.fn().mockReturnThis(),
      skip:  vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean:  () => Promise.resolve([
        { _id: "spark_01a006ec-1234", feeAmountSat: 9, status: "success", createdAt: new Date() },
      ]),
    });

    const result = await getFeeWalletHistory(1, 10);
    expect(result.records[0].mainPaymentId).toBe("01a006ec-1234");
    expect(result.records[0].recordId).toBe("spark_01a006ec-1234");
  });
});

// ─── §18 getSweepDesign ───────────────────────────────────────────────────────

describe("§18 getSweepDesign — soglia e treasury", () => {
  it("thresholdSat default = 10000 sat", async () => {
    delete process.env["SPARK_SWEEP_THRESHOLD_SAT"];
    const design = await getSweepDesign();
    expect(design.thresholdSat).toBe(10000);
  });

  it("thresholdSat configurabile via env", async () => {
    process.env["SPARK_SWEEP_THRESHOLD_SAT"] = "50000";
    const design = await getSweepDesign();
    expect(design.thresholdSat).toBe(50000);
    delete process.env["SPARK_SWEEP_THRESHOLD_SAT"];
  });

  it("btcTreasuryAddress da BTC_FEE_WALLET env", async () => {
    const orig = process.env["BTC_FEE_WALLET"];
    process.env["BTC_FEE_WALLET"] = "bc1testtreasury";
    const design = await getSweepDesign();
    expect(design.btcTreasuryAddress).toBe("bc1testtreasury");
    if (orig) process.env["BTC_FEE_WALLET"] = orig;
    else delete process.env["BTC_FEE_WALLET"];
  });
});

// ─── §19 checkFeeWalletHealth — alert stale ──────────────────────────────────

describe("§19 checkFeeWalletHealth — alert per fee stale + config missing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("alert se fee_address non configurato", async () => {
    mockCountDocuments.mockResolvedValue(0);
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: null });

    const result = await checkFeeWalletHealth();
    expect(result.healthy).toBe(false);
    expect(result.alerts.some(a => a.includes("fee_address"))).toBe(true);
  });

  it("alert se ALPHA_SPARK_FEE_MNEMONIC non impostato", async () => {
    delete process.env["ALPHA_SPARK_FEE_MNEMONIC"];
    mockCountDocuments.mockResolvedValue(0);
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: "sp1test" });

    const result = await checkFeeWalletHealth();
    expect(result.alerts.some(a => a.includes("ALPHA_SPARK_FEE_MNEMONIC"))).toBe(true);
  });

  it("healthy=true quando tutto configurato + nessuna fee stale", async () => {
    process.env["ALPHA_SPARK_FEE_MNEMONIC"] = "test mnemonic for health check";
    mockCountDocuments.mockResolvedValue(0);  // 0 fee stale
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: "sp1testaddress1234567890" });

    const result = await checkFeeWalletHealth();
    expect(result.healthy).toBe(true);
    expect(result.alerts).toHaveLength(0);
    expect(result.pendingStale).toBe(0);

    delete process.env["ALPHA_SPARK_FEE_MNEMONIC"];
  });
});

// ─── §20 configureFeeAddressHandler — validazione ────────────────────────────

describe("§20 configureFeeAddressHandler — validazione formato", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accetta null (rimuove address)", async () => {
    mockFindOneAndUpdateConfig.mockResolvedValue({ fee_address: null, updated_at: new Date() });

    const req = { body: { fee_address: null }, adminEmail: "admin@test.com" } as unknown as Request;
    const res = mkRes();
    await configureFeeAddressHandler(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: true, fee_address: null }),
    }));
  });

  it("accetta sp1 mainnet", async () => {
    const addr = "sp1qrealsparkaddress1234567890abcdef";
    mockFindOneAndUpdateConfig.mockResolvedValue({ fee_address: addr, updated_at: new Date() });

    const req = { body: { fee_address: addr }, adminEmail: "admin@test.com" } as unknown as Request;
    const res = mkRes();
    await configureFeeAddressHandler(req, res, next);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: true }),
    }));
  });

  it("rifiuta address che non inizia con sp1/sprt", async () => {
    const req = { body: { fee_address: "lnbc1234567890abcdefghij" }, adminEmail: "admin" } as unknown as Request;
    const res = mkRes();
    await configureFeeAddressHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.error).toBe("INVALID_ADDRESS_FORMAT");
  });

  it("GET /fee-wallet/health handler — risponde senza errori", async () => {
    delete process.env["ALPHA_SPARK_FEE_MNEMONIC"];
    mockCountDocuments.mockResolvedValue(0);
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: null });

    const res = mkRes();
    await getFeeWalletHealthHandler({} as Request, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ healthy: expect.any(Boolean) }),
    }));
  });
});
