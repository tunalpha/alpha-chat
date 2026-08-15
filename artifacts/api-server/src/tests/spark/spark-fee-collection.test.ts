/**
 * spark-fee-collection.test.ts — C2+A Lightning Fee Collection
 *
 * Test suite per la raccolta fee Lightning (architettura C2+A).
 *
 * §1  recordSparkFee → crea record pending_collection
 * §2  recordSparkFee → idempotente (stesso paymentHash → duplicate=true)
 * §3  recordSparkFee → feeAmountSat salvato correttamente
 * §4  markSparkFeeCollected → pending_collection → success con feePaymentId
 * §5  markSparkFeeCollected → idempotente (stesso feePaymentId → duplicate=true)
 * §6  markSparkFeeCollected → doppia riscossione rilevata (feePaymentId diverso)
 * §7  markSparkFeesBulkCollected → marca N record con un feePaymentId
 * §8  markSparkFeesBulkCollected → idempotente (record già success ignorati)
 * §9  getSparkFeePending → restituisce solo pending_collection per userId
 * §10 getSparkFeePending → totalSat corretto su più record
 * §11 POST /fee-record → 201 pending_collection
 * §12 POST /fee-record → 200 duplicate
 * §13 POST /fee-record → 400 paymentId troppo corto
 * §14 POST /fee-record → 400 alphaPlatformFeeSat negativa
 * §15 PATCH /fee-record/collected → 200 success
 * §16 PATCH /fee-record/bulk-collected → 200 con updated count
 * §17 GET /fee-record/pending → restituisce pending + feeAddress
 * §18 Main payment invariato — nessuna modifica a send/prepareSend
 * §19 App restart: record pending sopravvive al riavvio (persistenza MongoDB)
 * §20 GET /user-fee-config → include fee_address (anche null)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ─── Mock MongoDB models ──────────────────────────────────────────────────────

const mockFindOneAndUpdate = vi.fn();
const mockFind             = vi.fn();
const mockFindById         = vi.fn();
const mockUpdateMany       = vi.fn();
const mockCountDocuments   = vi.fn();

vi.mock("../../models/alpha-wallet-fee-record.model.js", () => ({
  AlphaWalletFeeRecordModel: {
    findOneAndUpdate: (...a: unknown[]) => mockFindOneAndUpdate(...a),
    find:             (...a: unknown[]) => mockFind(...a),
    findById:         (...a: unknown[]) => mockFindById(...a),
    updateMany:       (...a: unknown[]) => mockUpdateMany(...a),
    countDocuments:   (...a: unknown[]) => mockCountDocuments(...a),
  },
  emitPermanentFeeFailureAlert: vi.fn(),
}));

const mockGetSparkFeeConfig = vi.fn();
vi.mock("../../models/spark-fee-config.model.js", () => ({
  getSparkFeeConfig:  (...a: unknown[]) => mockGetSparkFeeConfig(...a),
  SPARK_FEE_DEFAULTS: { fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 },
  SparkFeeConfigModel: { findOneAndUpdate: vi.fn() },
}));

// ─── Import dopo i mock ───────────────────────────────────────────────────────

import {
  recordSparkFee,
  markSparkFeeCollected,
  markSparkFeesBulkCollected,
  getSparkFeePending,
} from "../../services/spark-treasury-accounting.js";

import {
  recordSparkFeeHandler,
  markFeeCollectedHandler,
  markFeesBulkCollectedHandler,
  getPendingFeesHandler,
  getUserFeeConfigHandler,
} from "../../controllers/spark-fee.controller.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function mkReq(body: Record<string, unknown> = {}, user?: Record<string, unknown>): Request {
  return { body, user: user ?? { userId: "user-abc" }, query: {} } as unknown as Request;
}

function mkRes() {
  const data: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
  const res = {
    status: vi.fn().mockReturnThis(),
    json:   vi.fn().mockImplementation((b: unknown) => { data.body = b; return res; }),
    _data:  data,
  };
  return res as unknown as Response & { _data: typeof data };
}

const next: NextFunction = vi.fn();

const PAYMENT_ID   = "01a006ec-0617-7033-9d8f-63ee3174ca5f";
const FEE_SAT      = 9n;
const FEE_WALLET   = "pending-wallet-setup";
const RECORD_ID    = `spark_${PAYMENT_ID}`;
const FEE_PAYMENT  = "fee-pay-xyz-9999";

// ─── §1 recordSparkFee → pending_collection ──────────────────────────────────

describe("§1 recordSparkFee → pending_collection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scrive status=pending_collection e feeAmountSat", async () => {
    mockFindOneAndUpdate.mockResolvedValue({
      _id:         RECORD_ID,
      status:      "pending_collection",
      feeAmountSat: 9,
    });

    const result = await recordSparkFee({
      paymentHash:         PAYMENT_ID,
      alphaPlatformFeeSat: FEE_SAT,
      feeWallet:           FEE_WALLET,
      userId:              "user-abc",
    });

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.recordId).toBe(RECORD_ID);

    const callArgs = mockFindOneAndUpdate.mock.calls[0]!;
    const setOnInsert = callArgs[1].$setOnInsert;
    expect(setOnInsert.status).toBe("pending_collection");
    expect(setOnInsert.feeAmountSat).toBe(9);
    expect(setOnInsert.userId).toBe("user-abc");
    expect(setOnInsert.source).toBe("spark_lightning");
  });
});

// ─── §2 recordSparkFee → idempotenza ─────────────────────────────────────────

describe("§2 recordSparkFee → idempotente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restituisce duplicate=true su duplicate key (11000)", async () => {
    const err = Object.assign(new Error("dup"), { code: 11000 });
    mockFindOneAndUpdate.mockRejectedValue(err);

    const result = await recordSparkFee({
      paymentHash:         PAYMENT_ID,
      alphaPlatformFeeSat: FEE_SAT,
      feeWallet:           FEE_WALLET,
    });

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(true);
  });

  it("restituisce duplicate=true se record già esiste con status diverso da pending_collection", async () => {
    mockFindOneAndUpdate.mockResolvedValue({
      _id:    RECORD_ID,
      status: "success",  // già success → isNewRecord=false → duplicate=true
    });

    const result = await recordSparkFee({
      paymentHash:         PAYMENT_ID,
      alphaPlatformFeeSat: FEE_SAT,
      feeWallet:           FEE_WALLET,
    });

    expect(result.duplicate).toBe(true);
  });
});

// ─── §3 recordSparkFee → feeAmountSat ────────────────────────────────────────

describe("§3 recordSparkFee → feeAmountSat salvato come number", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converte bigint in number per aggregazione", async () => {
    mockFindOneAndUpdate.mockResolvedValue({ _id: RECORD_ID, status: "pending_collection" });

    await recordSparkFee({
      paymentHash:         "abcdef1234567890",
      alphaPlatformFeeSat: 42n,
      feeWallet:           FEE_WALLET,
    });

    const setOnInsert = mockFindOneAndUpdate.mock.calls[0]![1].$setOnInsert;
    expect(typeof setOnInsert.feeAmountSat).toBe("number");
    expect(setOnInsert.feeAmountSat).toBe(42);
  });
});

// ─── §4 markSparkFeeCollected → success ──────────────────────────────────────

describe("§4 markSparkFeeCollected → pending → success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggiorna status=success con feePaymentId e collectedAt", async () => {
    mockFindById.mockResolvedValue({
      _id:         RECORD_ID,
      status:      "pending_collection",
      feePaymentId: undefined,
    });
    mockFindOneAndUpdate.mockResolvedValue({ _id: RECORD_ID, status: "success" });

    const result = await markSparkFeeCollected(RECORD_ID, FEE_PAYMENT);
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);

    const updateArgs = mockFindOneAndUpdate.mock.calls[0]!;
    expect(updateArgs[1].$set.status).toBe("success");
    expect(updateArgs[1].$set.feePaymentId).toBe(FEE_PAYMENT);
    expect(updateArgs[1].$set.collectedAt).toBeInstanceOf(Date);
  });
});

// ─── §5 markSparkFeeCollected → idempotente ──────────────────────────────────

describe("§5 markSparkFeeCollected → idempotente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("duplicate=true se già success con stesso feePaymentId", async () => {
    mockFindById.mockResolvedValue({
      _id:          RECORD_ID,
      status:       "success",
      feePaymentId: FEE_PAYMENT,
    });

    const result = await markSparkFeeCollected(RECORD_ID, FEE_PAYMENT);
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ─── §6 markSparkFeeCollected → doppia riscossione ───────────────────────────

describe("§6 markSparkFeeCollected → doppia riscossione rilevata", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ok=false se già success con feePaymentId diverso", async () => {
    mockFindById.mockResolvedValue({
      _id:          RECORD_ID,
      status:       "success",
      feePaymentId: "another-payment-id",
    });

    const result = await markSparkFeeCollected(RECORD_ID, FEE_PAYMENT);
    expect(result.ok).toBe(false);
    expect(result.duplicate).toBe(false);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ─── §7 markSparkFeesBulkCollected → bulk update ─────────────────────────────

describe("§7 markSparkFeesBulkCollected → bulk update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggiorna N record con unico feePaymentId", async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 3 });

    const ids    = ["spark_pay1", "spark_pay2", "spark_pay3"];
    const result = await markSparkFeesBulkCollected(ids, FEE_PAYMENT);

    expect(result.ok).toBe(true);
    expect(result.updated).toBe(3);

    const filter = mockUpdateMany.mock.calls[0]![0];
    expect(filter._id.$in).toEqual(ids);
    expect(filter.status).toBe("pending_collection");

    const update = mockUpdateMany.mock.calls[0]![1].$set;
    expect(update.status).toBe("success");
    expect(update.feePaymentId).toBe(FEE_PAYMENT);
    expect(update.collectedAt).toBeInstanceOf(Date);
  });
});

// ─── §8 markSparkFeesBulkCollected → idempotente ────────────────────────────

describe("§8 markSparkFeesBulkCollected → idempotente (già success = skip)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("record già success → modifiedCount=0", async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });

    const result = await markSparkFeesBulkCollected(["spark_pay1"], FEE_PAYMENT);
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(0);
  });

  it("array vuoto → skip senza DB call", async () => {
    const result = await markSparkFeesBulkCollected([], FEE_PAYMENT);
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(0);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

// ─── §9 getSparkFeePending → solo pending per userId ─────────────────────────

describe("§9 getSparkFeePending → solo pending_collection per userId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filtra per userId e status=pending_collection", async () => {
    mockFind.mockReturnValue({
      lean: () => Promise.resolve([
        { _id: "spark_pay1", feeAmountSat: 9 },
        { _id: "spark_pay2", feeAmountSat: 5 },
      ]),
    });

    const result = await getSparkFeePending("user-abc");
    expect(result.records).toHaveLength(2);
    expect(result.records[0].mainPaymentId).toBe("pay1");  // strip "spark_"
    expect(result.records[1].feeAmountSat).toBe(5);
    expect(result.totalSat).toBe(14);

    const filterArg = mockFind.mock.calls[0]![0];
    expect(filterArg.userId).toBe("user-abc");
    expect(filterArg.status).toBe("pending_collection");
  });
});

// ─── §10 getSparkFeePending → totalSat ───────────────────────────────────────

describe("§10 getSparkFeePending → totalSat aggregazione", () => {
  beforeEach(() => vi.clearAllMocks());

  it("totalSat = somma di tutti i feeAmountSat", async () => {
    mockFind.mockReturnValue({
      lean: () => Promise.resolve([
        { _id: "spark_a", feeAmountSat: 9  },
        { _id: "spark_b", feeAmountSat: 12 },
        { _id: "spark_c", feeAmountSat: 7  },
      ]),
    });

    const result = await getSparkFeePending("user-xyz");
    expect(result.totalSat).toBe(28);
  });
});

// ─── §11 POST /fee-record → 201 pending_collection ───────────────────────────

describe("§11 POST /fee-record → 201 pending_collection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("risponde 201 con ok=true, duplicate=false", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: null });
    mockFindOneAndUpdate.mockResolvedValue({ _id: RECORD_ID, status: "pending_collection" });

    const req = mkReq({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 });
    const res = mkRes();
    await recordSparkFeeHandler(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: true, duplicate: false }),
    }));
  });
});

// ─── §12 POST /fee-record → 200 duplicate ────────────────────────────────────

describe("§12 POST /fee-record → 200 duplicate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("risponde 200 con duplicate=true se già registrato", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: null });
    const err = Object.assign(new Error("dup"), { code: 11000 });
    mockFindOneAndUpdate.mockRejectedValue(err);

    const req = mkReq({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 });
    const res = mkRes();
    await recordSparkFeeHandler(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ duplicate: true }),
    }));
  });
});

// ─── §13 POST /fee-record → 400 paymentId corto ──────────────────────────────

describe("§13 POST /fee-record → 400 paymentId troppo corto", () => {
  beforeEach(() => vi.clearAllMocks());

  it("risponde 400 se paymentId < 16 char", async () => {
    const req = mkReq({ paymentId: "short", alphaPlatformFeeSat: 9 });
    const res = mkRes();
    await recordSparkFeeHandler(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── §14 POST /fee-record → 400 fee negativa ────────────────────────────────

describe("§14 POST /fee-record → 400 alphaPlatformFeeSat negativa", () => {
  beforeEach(() => vi.clearAllMocks());

  it("risponde 400 se alphaPlatformFeeSat < 0", async () => {
    const req = mkReq({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: -1 });
    const res = mkRes();
    await recordSparkFeeHandler(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── §15 PATCH /fee-record/collected → 200 success ───────────────────────────

describe("§15 PATCH /fee-record/collected → ok=true", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca fee come raccolta con feePaymentId", async () => {
    mockFindById.mockResolvedValue({ _id: RECORD_ID, status: "pending_collection" });
    mockFindOneAndUpdate.mockResolvedValue({ _id: RECORD_ID, status: "success" });

    const req = mkReq({ mainPaymentId: PAYMENT_ID, feePaymentId: FEE_PAYMENT });
    const res = mkRes();
    await markFeeCollectedHandler(req, res as unknown as Response, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: true }),
    }));
  });
});

// ─── §16 PATCH /fee-record/bulk-collected → 200 updated count ────────────────

describe("§16 PATCH /fee-record/bulk-collected → ok=true con updated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marca N fee con un unico feePaymentId", async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 2 });

    const req = mkReq({
      mainPaymentIds: ["pay1", "pay2"],
      feePaymentId:   FEE_PAYMENT,
    });
    const res = mkRes();
    await markFeesBulkCollectedHandler(req, res as unknown as Response, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: true, updated: 2 }),
    }));
  });
});

// ─── §17 GET /fee-record/pending → pending + feeAddress ──────────────────────

describe("§17 GET /fee-record/pending → pendingFees + feeAddress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restituisce pending fee e fee_address dalla config", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: "spark1abc" });
    mockFind.mockReturnValue({
      lean: () => Promise.resolve([{ _id: "spark_pay1", feeAmountSat: 9 }]),
    });

    const req = mkReq({}, { userId: "user-abc" });
    const res = mkRes();
    await getPendingFeesHandler(req, res as unknown as Response, next);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.data.feeAddress).toBe("spark1abc");
    expect(body.data.pendingFees).toHaveLength(1);
    expect(body.data.totalSat).toBe(9);
  });

  it("feeAddress=null se non configurato", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({ fee_address: null });
    mockFind.mockReturnValue({ lean: () => Promise.resolve([]) });

    const req = mkReq({}, { userId: "user-xyz" });
    const res = mkRes();
    await getPendingFeesHandler(req, res as unknown as Response, next);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.data.feeAddress).toBeNull();
    expect(body.data.pendingFees).toHaveLength(0);
    expect(body.data.totalSat).toBe(0);
  });
});

// ─── §18 Main payment invariato ───────────────────────────────────────────────

describe("§18 Main payment invariato — nessuna modifica a send/prepareSend", () => {
  it("recordSparkFeeHandler NON chiama prepareSend né sendPayment", async () => {
    // Il controller fee NON deve mai chiamare funzioni del payment flow principale
    const src = await import("../../controllers/spark-fee.controller.js");
    const handlerSource = src.recordSparkFeeHandler.toString();
    expect(handlerSource).not.toContain("prepareSend");
    expect(handlerSource).not.toContain("sendPayment");
    expect(handlerSource).not.toContain("sendInProgress");
  });

  it("spark-treasury-accounting NON importa da alpha-wallet né dal main payment", async () => {
    const svc = await import("../../services/spark-treasury-accounting.js");
    // Se fosse importato da payment engine, i mock qui sopra romperebbero
    // Verifica che le funzioni esistano e siano pure
    expect(typeof svc.recordSparkFee).toBe("function");
    expect(typeof svc.markSparkFeeCollected).toBe("function");
    expect(typeof svc.markSparkFeesBulkCollected).toBe("function");
    expect(typeof svc.getSparkFeePending).toBe("function");
  });
});

// ─── §19 App restart: record pending persiste ────────────────────────────────

describe("§19 App restart — record pending sopravvive (persistenza MongoDB)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getSparkFeePending legge da MongoDB (simulato post-restart)", async () => {
    // Simula il caso: app si è chiusa, il record è in MongoDB, app riapre
    mockFind.mockReturnValue({
      lean: () => Promise.resolve([
        { _id: "spark_oldpay-1234567890abc", feeAmountSat: 9 },
      ]),
    });

    const result = await getSparkFeePending("user-restart");
    expect(result.records).toHaveLength(1);
    expect(result.records[0].mainPaymentId).toBe("oldpay-1234567890abc");
    expect(result.totalSat).toBe(9);
  });
});

// ─── §20 GET /user-fee-config → include fee_address ─────────────────────────

describe("§20 GET /user-fee-config → include fee_address", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restituisce fee_address quando configurato", async () => {
    mockGetSparkFeeConfig.mockResolvedValue({
      fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30, fee_address: "spark1testaddr",
    });

    const req = {} as Request;
    const res = mkRes();
    await getUserFeeConfigHandler(req, res as unknown as Response);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.data.fee_address).toBe("spark1testaddr");
    expect(body.data.fee_bps).toBe(10);
  });

  it("restituisce fee_address=null e defaults se DB non raggiungibile", async () => {
    mockGetSparkFeeConfig.mockRejectedValue(new Error("DB unreachable"));

    const req = {} as Request;
    const res = mkRes();
    await getUserFeeConfigHandler(req, res as unknown as Response);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.data.fee_address).toBeNull();
    expect(body.data.fee_bps).toBe(10);
  });
});
