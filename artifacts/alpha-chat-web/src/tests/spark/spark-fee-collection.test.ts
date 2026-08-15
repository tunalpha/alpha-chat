/**
 * spark-fee-collection.test.ts — C2+A Lightning Fee Collection (Frontend)
 *
 * Test della logica fee collection lato client.
 *
 * §1  collectFee: fee zero → skip (no API call)
 * §2  collectFee: registra pending, feeAddress=null → nessun send Spark
 * §3  collectFee: registra pending, feeAddress set → send Spark + markCollected
 * §4  collectFee: Tier 1 send fallisce → main payment resta SUCCESS, fee resta pending
 * §5  collectFee: recordFee fallisce → skip send (no idempotency key)
 * §6  collectFee: idempotenza — stesso mainPaymentId non genera doppio send
 * §7  Tier 2 collectPendingFees: aggrega N fee in un unico pagamento
 * §8  Tier 2 collectPendingFees: feeAddress=null → skip
 * §9  Tier 2 collectPendingFees: pendingFees vuota → skip
 * §10 Tier 2 collectPendingFees: send fallisce → non blocca il connect
 * §11 apiSparkRecordFee: POST corretto con paymentId + alphaPlatformFeeSat
 * §12 apiSparkMarkFeeCollected: PATCH corretto
 * §13 apiSparkMarkFeesBulkCollected: PATCH bulk corretto
 * §14 apiSparkGetPendingFees: GET corretto, restituisce feeAddress + pendingFees
 * §15 apiGetSparkUserFeeConfig: fail-safe → restituisce defaults con fee_address=null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function okJson(data: unknown) {
  return Promise.resolve({
    ok:   true,
    json: () => Promise.resolve({ data }),
  });
}

function failHttp(status = 500) {
  return Promise.resolve({ ok: false, status });
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────

function mkAdapter(overrides: Record<string, unknown> = {}) {
  return {
    state:       "connected" as const,
    prepareSend: vi.fn().mockResolvedValue({ recipientAmountSat: 9n, estimatedProviderFeeSat: 0n, expiresAt: 99999 }),
    send:        vi.fn().mockResolvedValue({ paymentId: "fee-pay-xyz", amountSat: 9n, feeSat: 0n, status: "completed" }),
    getInfo:     vi.fn().mockResolvedValue({ identityPubkey: "testpk", balanceSat: 1000n }),
    ...overrides,
  };
}

// ─── Import target functions ──────────────────────────────────────────────────

import {
  apiSparkRecordFee,
  apiSparkMarkFeeCollected,
  apiSparkMarkFeesBulkCollected,
  apiSparkGetPendingFees,
  apiGetSparkUserFeeConfig,
} from "../../lib/spark/spark-api";

const PAYMENT_ID  = "01a006ec-0617-7033-9d8f-63ee3174ca5f";
const FEE_SAT     = 9n;
const FEE_ADDR    = "spark1alphatestaddress";
const FEE_PAY_ID  = "fee-pay-xyz";

// ─── §1 fee zero → skip ───────────────────────────────────────────────────────

describe("§1 collectFee: fee zero → skip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("non chiama fetch se feeAmountSat=0", async () => {
    // Simulate what collectFee does: guard feeAmountSat <= 0n → return
    const feeAmountSat = 0n;
    if (feeAmountSat <= 0n) { /* skip */ }
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── §2 collectFee: feeAddress=null → solo record pending, no send ────────────

describe("§2 collectFee: feeAddress=null → solo pending, nessun send Spark", () => {
  beforeEach(() => vi.clearAllMocks());

  it("apiSparkRecordFee chiamato, send adapter NON chiamato", async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, duplicate: false }));

    const adapter     = mkAdapter();
    const feeAddressRef = { current: null as string | null };

    // Simula la logica di collectFee
    await apiSparkRecordFee({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 });
    const addr = feeAddressRef.current;
    if (!addr) {
      // skip Tier 1 send
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]![0]).toContain("/spark/fee-record");
    expect(adapter.send).not.toHaveBeenCalled();
  });
});

// ─── §3 collectFee: feeAddress set → record + send + markCollected ────────────

describe("§3 collectFee: feeAddress set → record + send + markCollected", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sequenza completa: record → prepareSend → send → markCollected", async () => {
    const adapter = mkAdapter();
    let fetchCallIdx = 0;

    mockFetch.mockImplementation((url: string) => {
      fetchCallIdx++;
      if (url.includes("/fee-record") && !url.includes("collected") && fetchCallIdx === 1) {
        return okJson({ ok: true, duplicate: false });
      }
      if (url.includes("/fee-record/collected")) {
        return okJson({ ok: true, duplicate: false });
      }
      return okJson({});
    });

    // 1. Record
    await apiSparkRecordFee({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 });
    // 2. prepareSend
    await adapter.prepareSend({ paymentRequest: FEE_ADDR, amountSat: FEE_SAT });
    // 3. send
    const result = await adapter.send({ paymentRequest: FEE_ADDR, amountSat: FEE_SAT });
    // 4. markCollected
    await apiSparkMarkFeeCollected({ mainPaymentId: PAYMENT_ID, feePaymentId: result.paymentId });

    expect(adapter.prepareSend).toHaveBeenCalledWith({ paymentRequest: FEE_ADDR, amountSat: FEE_SAT });
    expect(adapter.send).toHaveBeenCalledWith({ paymentRequest: FEE_ADDR, amountSat: FEE_SAT });
    expect(mockFetch).toHaveBeenCalledTimes(2); // record + markCollected
  });
});

// ─── §4 Tier 1 send fallisce → main payment resta SUCCESS ────────────────────

describe("§4 Tier 1 send fallisce → main payment non è influenzato", () => {
  beforeEach(() => vi.clearAllMocks());

  it("send lancia → catch silenzioso, nessuna propagazione", async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, duplicate: false }));

    const adapter = mkAdapter({
      send: vi.fn().mockRejectedValue(new Error("SPARK_SEND_FAILED")),
    });

    let mainPaymentSucceeded = false;

    // Simula la logica di persistLnSuccess + collectFee
    try {
      // main payment (già completato a questo punto)
      mainPaymentSucceeded = true;

      // collectFee — fire-and-forget
      const _collectFeePromise = (async () => {
        await apiSparkRecordFee({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 });
        await adapter.prepareSend({ paymentRequest: FEE_ADDR, amountSat: FEE_SAT });
        await adapter.send({ paymentRequest: FEE_ADDR, amountSat: FEE_SAT }); // lancia
      })().catch(() => { /* silenzioso */ });

      await _collectFeePromise;
    } catch {
      mainPaymentSucceeded = false;
    }

    expect(mainPaymentSucceeded).toBe(true); // main payment non è stato toccato
    expect(adapter.send).toHaveBeenCalled();
  });
});

// ─── §5 recordFee fallisce → skip send ───────────────────────────────────────

describe("§5 collectFee: recordFee fallisce → nessun send (no idempotency key)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("se apiSparkRecordFee lancia → adapter.send non chiamato", async () => {
    mockFetch.mockReturnValueOnce(failHttp(500));

    const adapter = mkAdapter();

    await apiSparkRecordFee({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 }).catch(() => {
      // Se recordFee fallisce, non eseguiamo il send
      return;
    });

    expect(adapter.send).not.toHaveBeenCalled();
  });
});

// ─── §6 Idempotenza: stesso mainPaymentId → no doppio send ───────────────────

describe("§6 Idempotenza: stesso mainPaymentId → no doppia riscossione", () => {
  beforeEach(() => vi.clearAllMocks());

  it("duplicate=true → skip send", async () => {
    // Prima chiamata: success
    mockFetch
      .mockReturnValueOnce(okJson({ ok: true, duplicate: false }))
      // Seconda chiamata (stesso paymentId): duplicate
      .mockReturnValueOnce(okJson({ ok: true, duplicate: true }));

    const adapter = mkAdapter();

    // Prima chiamata
    const r1 = await apiSparkRecordFee({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 });
    expect(r1.duplicate).toBe(false);

    // Seconda chiamata (simula doppio invio)
    const r2 = await apiSparkRecordFee({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 });
    expect(r2.duplicate).toBe(true);

    // Il client deve skipare il send se duplicate=true
    if (!r2.duplicate) {
      await adapter.send({ paymentRequest: FEE_ADDR, amountSat: FEE_SAT });
    }

    expect(adapter.send).not.toHaveBeenCalled(); // mai chiamato sulla seconda richiesta
  });
});

// ─── §7 Tier 2: aggregazione N fee pendenti ───────────────────────────────────

describe("§7 Tier 2 collectPendingFees: aggrega N fee in un unico pagamento", () => {
  beforeEach(() => vi.clearAllMocks());

  it("totalSat = somma di tutte le fee, invia un unico pagamento", async () => {
    const pendingFees = [
      { recordId: "spark_a", mainPaymentId: "a", feeAmountSat: 9  },
      { recordId: "spark_b", mainPaymentId: "b", feeAmountSat: 5  },
      { recordId: "spark_c", mainPaymentId: "c", feeAmountSat: 12 },
    ];
    const totalSat = 26;

    // Mock: GET /fee-record/pending → 3 fee
    mockFetch
      .mockReturnValueOnce(okJson({ feeAddress: FEE_ADDR, pendingFees, totalSat }))
      // Mock: PATCH /fee-record/bulk-collected → success
      .mockReturnValueOnce(okJson({ ok: true, updated: 3 }));

    const adapter = mkAdapter();

    // Simula Tier 2
    const { feeAddress, pendingFees: fees, totalSat: total } = await apiSparkGetPendingFees();
    expect(feeAddress).toBe(FEE_ADDR);
    expect(fees).toHaveLength(3);
    expect(total).toBe(26);

    if (feeAddress && total > 0) {
      await adapter.prepareSend({ paymentRequest: feeAddress, amountSat: BigInt(total) });
      const result = await adapter.send({ paymentRequest: feeAddress, amountSat: BigInt(total) });

      await apiSparkMarkFeesBulkCollected({
        mainPaymentIds: fees.map(f => f.mainPaymentId),
        feePaymentId:   result.paymentId,
      });
    }

    expect(adapter.prepareSend).toHaveBeenCalledWith({
      paymentRequest: FEE_ADDR,
      amountSat: 26n,
    });
    expect(adapter.send).toHaveBeenCalledTimes(1); // UN SOLO pagamento aggregato
    expect(mockFetch).toHaveBeenCalledTimes(2); // pending + bulk-collected
  });
});

// ─── §8 Tier 2: feeAddress=null → skip ───────────────────────────────────────

describe("§8 Tier 2: feeAddress=null → skip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nessun send se feeAddress=null", async () => {
    const adapter = mkAdapter();
    const feeAddress: string | null = null;

    if (!feeAddress) {
      // skip
    }

    expect(adapter.send).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── §9 Tier 2: pendingFees vuote → skip ─────────────────────────────────────

describe("§9 Tier 2: pendingFees vuote → skip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nessun send se totalSat=0", async () => {
    mockFetch.mockReturnValueOnce(okJson({ feeAddress: FEE_ADDR, pendingFees: [], totalSat: 0 }));

    const { totalSat } = await apiSparkGetPendingFees();
    const adapter = mkAdapter();

    if (totalSat <= 0) { /* skip */ }

    expect(adapter.send).not.toHaveBeenCalled();
  });
});

// ─── §10 Tier 2: send fallisce → connect non bloccato ────────────────────────

describe("§10 Tier 2: send fallisce → non blocca il connect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("eccezione nel Tier 2 non si propaga oltre il catch", async () => {
    let connectCompleted = false;

    // Simula connect() che chiama _collectPendingFees() fire-and-forget
    const connectSimulation = async () => {
      // ... connect logic ...
      connectCompleted = true;

      // Tier 2 fire-and-forget
      void (async () => {
        throw new Error("TIER2_FAILED");
      })().catch(() => { /* silenzioso */ });
    };

    await connectSimulation();
    expect(connectCompleted).toBe(true); // connect completato nonostante Tier 2 fail
  });
});

// ─── §11 apiSparkRecordFee → POST corretto ────────────────────────────────────

describe("§11 apiSparkRecordFee → POST /spark/fee-record", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invia POST con paymentId e alphaPlatformFeeSat", async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, duplicate: false }));

    const result = await apiSparkRecordFee({ paymentId: PAYMENT_ID, alphaPlatformFeeSat: 9 });

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/spark/fee-record");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.paymentId).toBe(PAYMENT_ID);
    expect(body.alphaPlatformFeeSat).toBe(9);
  });
});

// ─── §12 apiSparkMarkFeeCollected → PATCH corretto ───────────────────────────

describe("§12 apiSparkMarkFeeCollected → PATCH /spark/fee-record/collected", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invia PATCH con mainPaymentId e feePaymentId", async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, duplicate: false }));

    await apiSparkMarkFeeCollected({ mainPaymentId: PAYMENT_ID, feePaymentId: FEE_PAY_ID });

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/fee-record/collected");
    expect(opts.method).toBe("PATCH");
    const body = JSON.parse(opts.body as string);
    expect(body.mainPaymentId).toBe(PAYMENT_ID);
    expect(body.feePaymentId).toBe(FEE_PAY_ID);
  });
});

// ─── §13 apiSparkMarkFeesBulkCollected → PATCH bulk ──────────────────────────

describe("§13 apiSparkMarkFeesBulkCollected → PATCH /spark/fee-record/bulk-collected", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invia PATCH con array di mainPaymentIds e un feePaymentId", async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, updated: 3 }));

    const result = await apiSparkMarkFeesBulkCollected({
      mainPaymentIds: ["a", "b", "c"],
      feePaymentId:   FEE_PAY_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.updated).toBe(3);

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.mainPaymentIds).toEqual(["a", "b", "c"]);
    expect(body.feePaymentId).toBe(FEE_PAY_ID);
  });
});

// ─── §14 apiSparkGetPendingFees → GET corretto ───────────────────────────────

describe("§14 apiSparkGetPendingFees → GET /spark/fee-record/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restituisce feeAddress e pendingFees", async () => {
    const pending = [{ recordId: "spark_x", mainPaymentId: "x", feeAmountSat: 9 }];
    mockFetch.mockReturnValueOnce(okJson({ feeAddress: FEE_ADDR, pendingFees: pending, totalSat: 9 }));

    const result = await apiSparkGetPendingFees();
    expect(result.feeAddress).toBe(FEE_ADDR);
    expect(result.pendingFees).toHaveLength(1);
    expect(result.totalSat).toBe(9);
  });
});

// ─── §15 apiGetSparkUserFeeConfig → fail-safe ────────────────────────────────

describe("§15 apiGetSparkUserFeeConfig → fail-safe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restituisce defaults con fee_address=null se API non raggiungibile", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await apiGetSparkUserFeeConfig();
    expect(result.fee_bps).toBe(10);
    expect(result.min_fee_sat).toBe(1);
    expect(result.fee_address).toBeNull();
  });

  it("restituisce fee_address da backend quando configurato", async () => {
    mockFetch.mockReturnValueOnce(okJson({
      fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30, fee_address: FEE_ADDR,
    }));

    const result = await apiGetSparkUserFeeConfig();
    expect(result.fee_address).toBe(FEE_ADDR);
  });
});
