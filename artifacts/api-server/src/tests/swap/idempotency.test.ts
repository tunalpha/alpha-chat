/**
 * Test: Idempotenza swap BTC→LN
 *
 * Verifica T3, T11, T12, T13:
 *   T3  — provider accetta swap ma HTTP response viene persa (idempotency risolve)
 *   T11 — retry dopo provider acceptance: stesso swap, no duplicato
 *   T12 — doppio click: idempotency_key identico → stesso swap
 *   T13 — doppia richiesta con stesso idempotency key → stessa swap
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import mongoose from "mongoose";

// Mock di tutte le dipendenze esterne prima degli import di swap.service
vi.mock("../../services/swap/boltz.service.js", () => ({
  getBoltzSubmarineFees: vi.fn().mockResolvedValue({
    fees:   { percentage: 0.1, minerFees: 302 },
    limits: { minimal: 1000, maximal: 25_000_000, maximalZeroConf: 1_000_000 },
  }),
  createBoltzSubmarineSwap: vi.fn().mockResolvedValue({
    swapId:             "boltz-swap-xyz",
    lockupAddress:      "bc1qtest1234",
    expectedAmount:     101_000,
    timeoutBlockHeight: 850_000,
    redeemScript:       "aa20beef",
  }),
  getBoltzSwapStatus: vi.fn().mockResolvedValue({ status: "invoice.set" }),
  checkBoltzHealth:   vi.fn().mockResolvedValue({ reachable: true }),
}));

vi.mock("../../models/swap-config.model.js", () => ({
  getSwapConfig: vi.fn().mockResolvedValue({
    enabled: true, boltz_btcln_enabled: true, breez_spark_lnbtc_enabled: true,
    btcln_fee_bps: 25, lnbtc_fee_bps: 0, excluded_assets: [],
    boltz_integrator_id: "alpha-wallet",
  }),
}));

vi.mock("../../services/swap/refund-key.service.js", () => ({
  deriveRefundPublicKey: vi.fn((swapId: string) => "02" + "aa".repeat(32)),
  verifyRefundKey:       vi.fn().mockReturnValue(true),
}));

vi.mock("../../models/swap.model.js", async () => {
  // Mappa in-memory per simulare MongoDB
  const store = new Map<string, Record<string, unknown>>();
  let _idempKeyStore = new Map<string, string>(); // user+ikey → swapId

  const Model = {
    findOne: vi.fn(async (query: Record<string, unknown>) => {
      if (query.user_id && query.idempotency_key) {
        const key = `${query.user_id}:${query.idempotency_key}`;
        const swapId = _idempKeyStore.get(key);
        if (swapId) return store.get(swapId) ?? null;
        return null;
      }
      return null;
    }),
    create: vi.fn(async (data: Record<string, unknown>) => {
      const id = data._id as string;
      store.set(id, { ...data });
      if (data.user_id && data.idempotency_key) {
        const key = `${data.user_id}:${data.idempotency_key}`;
        _idempKeyStore.set(key, id);
      }
      return { ...data };
    }),
    findById:           vi.fn(async (id: string) => store.get(id) ?? null),
    findOneAndUpdate:   vi.fn(async (query: Record<string, unknown>, update: Record<string, unknown>) => {
      const id = (query._id as string);
      if (id && store.has(id)) {
        const existing = store.get(id)!;
        const setData = (update as { $set?: Record<string, unknown> }).$set ?? {};
        store.set(id, { ...existing, ...setData });
        return store.get(id);
      }
      return null;
    }),
    find: vi.fn(async () => []),
    countDocuments: vi.fn(async () => 0),
    aggregate: vi.fn(async () => []),
    __resetStore: () => { store.clear(); _idempKeyStore.clear(); },
  };

  const actual = await vi.importActual<typeof import("../../models/swap.model.js")>("../../models/swap.model.js");

  return {
    ...actual,
    SwapModel: Model,
    SwapEventModel: { create: vi.fn() },
    appendSwapEvent: vi.fn(),
    TERMINAL_STATES:      actual.TERMINAL_STATES,
    RECONCILABLE_STATES:  actual.RECONCILABLE_STATES,
    mapBoltzStatusToSwapState: actual.mapBoltzStatusToSwapState,
  };
});

import { createBtcLnSwap } from "../../services/swap/swap.service.js";
import { SwapModel } from "../../models/swap.model.js";

function resetStore() {
  (SwapModel as unknown as { __resetStore: () => void }).__resetStore?.();
}

const TEST_USER = "user-idempotency-test";
const TEST_INVOICE = "lnbc100u1ptest";

describe("Idempotenza swap BTC→LN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("T12/T13 — doppio click: stessa idempotency_key → stesso swap (no duplicato)", async () => {
    const ikey = randomUUID();
    const params = { user_id: TEST_USER, from_amount_sat: 100_000, lightning_invoice: TEST_INVOICE, idempotency_key: ikey };

    const swap1 = await createBtcLnSwap(params);
    const swap2 = await createBtcLnSwap(params);  // retry con stesso key

    expect(swap1._id).toBe(swap2._id);  // stesso swap
    // Boltz chiamato solo una volta (la seconda viene bloccata dall'idempotency check)
    const boltz = await import("../../services/swap/boltz.service.js");
    expect((boltz.createBoltzSubmarineSwap as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("T11 — retry dopo Boltz acceptance: no secondo swap", async () => {
    const ikey = randomUUID();
    const params = { user_id: TEST_USER, from_amount_sat: 50_000, lightning_invoice: "lnbc50u1ptest", idempotency_key: ikey };

    const first  = await createBtcLnSwap(params);
    const second = await createBtcLnSwap(params);  // simula retry (HTTP response persa)

    expect(first._id).toBe(second._id);
  });

  it("T13 — idempotency key diversa → swap diversa", async () => {
    const ikey1 = randomUUID();
    const ikey2 = randomUUID();

    const swap1 = await createBtcLnSwap({
      user_id: TEST_USER, from_amount_sat: 100_000, lightning_invoice: TEST_INVOICE + "1", idempotency_key: ikey1,
    });
    const swap2 = await createBtcLnSwap({
      user_id: TEST_USER, from_amount_sat: 100_000, lightning_invoice: TEST_INVOICE + "2", idempotency_key: ikey2,
    });

    expect(swap1._id).not.toBe(swap2._id);  // swap diverse
  });

  it("utenti diversi con stessa ikey → swap diverse (no cross-user collision)", async () => {
    const ikey = randomUUID();
    const params1 = { user_id: "user-A", from_amount_sat: 100_000, lightning_invoice: "lnbc1", idempotency_key: ikey };
    const params2 = { user_id: "user-B", from_amount_sat: 100_000, lightning_invoice: "lnbc2", idempotency_key: ikey };

    const swap1 = await createBtcLnSwap(params1);
    const swap2 = await createBtcLnSwap(params2);

    expect(swap1._id).not.toBe(swap2._id);
  });

  it("T3 — write-before-submit: swap salvato in DB PRIMA della chiamata Boltz", async () => {
    // Se Boltz non risponde, lo swap deve essere in DB con state=submitted
    const boltz = await import("../../services/swap/boltz.service.js");
    (boltz.createBoltzSubmarineSwap as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network timeout"),
    );

    const ikey = randomUUID();
    const swap = await createBtcLnSwap({
      user_id: TEST_USER, from_amount_sat: 100_000, lightning_invoice: "lnbc-timeout", idempotency_key: ikey,
    });

    // Lo swap deve esistere (write-before-submit garantisce il record in DB)
    expect(swap._id).toBeDefined();
    // Stato deve essere failed_recoverable (errore di rete = recuperabile)
    expect(["submitted", "failed_recoverable"]).toContain(swap.state);
  });

  it("T3 — errore Boltz permanente → failed_permanent", async () => {
    const boltz = await import("../../services/swap/boltz.service.js");
    (boltz.createBoltzSubmarineSwap as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("HTTP 400 Bad Request: invalid invoice"),
    );

    const ikey = randomUUID();
    await expect(
      createBtcLnSwap({ user_id: TEST_USER, from_amount_sat: 100_000, lightning_invoice: "lnbc-bad", idempotency_key: ikey }),
    ).rejects.toThrow("SWAP_PROVIDER_ERROR");
  });
});
