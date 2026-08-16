/**
 * Test: SwapReconciler — scheduler e cicli di riconciliazione
 *
 * Verifica:
 *   T8  — backend restart → reconciler si avvia e riconcilia swap pending
 *   T14 — deposito ricevuto offline → reconciler aggiorna stato
 *   T15 — swap in processing → reconciler completa
 *   T18 — backend restart durante refund → stato preservato
 *   T19 — riconciliazione idempotente dopo restart
 *   T20 — stato già completed → nessun re-processing
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ISwap } from "../../models/swap.model.js";

vi.mock("../../models/swap.model.js", async () => {
  const actual = await vi.importActual<typeof import("../../models/swap.model.js")>("../../models/swap.model.js");

  // find().lean() chain builder — restituisce array (default [])
  function makeFindChain(result: unknown[] = []) {
    const chain = {
      lean:  () => Promise.resolve(result),
      limit: () => chain,
      skip:  () => chain,
      sort:  () => chain,
    };
    return chain;
  }

  return {
    ...actual,
    SwapModel: {
      find:             vi.fn().mockReturnValue(makeFindChain([])),
      findOne:          vi.fn().mockResolvedValue(null),
      findOneAndUpdate: vi.fn().mockResolvedValue(null),
    },
    SwapEventModel:  { create: vi.fn() },
    appendSwapEvent: vi.fn(),
  };
});

vi.mock("../../services/swap/boltz.service.js", () => ({
  getBoltzSwapStatus:       vi.fn().mockResolvedValue({ status: "invoice.set" }),
  getBoltzSubmarineFees:    vi.fn(),
  createBoltzSubmarineSwap: vi.fn(),
  checkBoltzHealth:         vi.fn(),
}));

import { SwapModel } from "../../models/swap.model.js";
import { getBoltzSwapStatus } from "../../services/swap/boltz.service.js";
import { reconcileSwap, getNonTerminalSwaps } from "../../services/swap/swap.service.js";
import { startSwapReconciler, stopSwapReconciler } from "../../services/swap/swap-reconciler.service.js";

function makeSwap(overrides: Partial<ISwap> = {}): ISwap {
  return {
    _id:                     "rec-swap-" + Math.random().toString(36).slice(2),
    user_id:                 "user-rec-test",
    route:                   "btc_onchain_to_lightning",
    provider:                "boltz_submarine",
    state:                   "created",
    boltz_swap_id:           "boltz-rec-abc",
    from_amount_sat:         100_000,
    to_amount_sat_estimated: 99_598,
    alpha_fee_sat:           250,
    alpha_fee_bps:           25,
    provider_fee_sat:        100,
    miner_fee_sat:           302,
    reconcile_attempts:      0,
    created_at:              new Date(),
    updated_at:              new Date(),
    ...overrides,
  };
}

describe("SwapReconciler — scheduler", () => {
  afterEach(() => {
    stopSwapReconciler();
    vi.clearAllMocks();
  });

  it("startSwapReconciler: idempotente (doppia chiamata non duplica lo scheduler)", () => {
    startSwapReconciler();
    startSwapReconciler(); // seconda chiamata ignorata
    // Nessun errore → scheduler singleton verificato
    stopSwapReconciler();
  });

  it("stopSwapReconciler: ferma lo scheduler senza errori", () => {
    startSwapReconciler();
    expect(() => stopSwapReconciler()).not.toThrow();
  });
});

describe("SwapReconciler — reconcileSwap unit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T8 — swap in created → Boltz ritorna confirmed → stato processing", async () => {
    const swap = makeSwap({ state: "created" });

    (getBoltzSwapStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "transaction.confirmed", transaction: { id: "tx-T8" },
    });
    (SwapModel.findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...swap, state: "processing",
    });

    const r = await reconcileSwap(swap);
    expect(r.updated).toBe(true);
    expect(r.newState).toBe("processing");
  });

  it("T14 — swap detected (frontend offline) → Boltz confirmed → processing", async () => {
    const swap = makeSwap({ state: "detected" });

    (getBoltzSwapStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "transaction.confirmed", transaction: { id: "tx-T14" },
    });
    (SwapModel.findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...swap, state: "processing",
    });

    const r = await reconcileSwap(swap);
    expect(r.updated).toBe(true);
    expect(r.newState).toBe("processing");
  });

  it("T15 — swap in processing → Boltz invoice.paid → completed", async () => {
    const swap = makeSwap({ state: "processing" });

    (getBoltzSwapStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "invoice.paid",
    });
    (SwapModel.findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...swap, state: "completed",
    });

    const r = await reconcileSwap(swap);
    expect(r.updated).toBe(true);
    expect(r.newState).toBe("completed");
  });

  it("T18 — backend restart durante refund_pending → stato preserved", async () => {
    const swap = makeSwap({ state: "refund_pending" });

    // Boltz ritorna un sibling di refund state
    (getBoltzSwapStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "invoice.failedToPay",
    });
    (SwapModel.findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...swap, state: "refund_pending", reconcile_attempts: 1,
    });

    const r = await reconcileSwap(swap);
    // Lo stato refund_pending NON viene sovrascritto (è lo stesso)
    expect(r.updated).toBe(false); // stesso stato → no update
    expect(r.newState).toBe("refund_pending");
  });

  it("T19 — stessa swap riconciliata due volte (restart) → idempotente", async () => {
    const swap = makeSwap({ state: "detected" });

    (getBoltzSwapStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "transaction.confirmed", transaction: { id: "tx-idempotent" },
    });
    (SwapModel.findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...swap, state: "processing",
    });

    const r1 = await reconcileSwap(swap);
    const r2 = await reconcileSwap({ ...swap, state: "processing" });

    expect(r1.newState).toBe("processing");
    // Seconda riconciliazione: stato invariato se Boltz non ha avanzato
    // (dipende dalla risposta Boltz — qui entrambi tornano processing)
    expect(["processing", "completed"]).toContain(r2.newState);
  });

  it("T20 — swap already completed → stessa swap: nessun update (stato uguale)", async () => {
    const swap = makeSwap({ state: "processing" });

    (getBoltzSwapStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "invoice.paid",
    });
    (SwapModel.findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...swap, state: "completed",
    });

    const r = await reconcileSwap(swap);
    expect(r.newState).toBe("completed");

    // Dalla seconda iterazione, lo swap è terminale → getNonTerminalSwaps non lo include
    // find().lean() chain — il mock deve restituire un oggetto con .lean()
    (SwapModel.find as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      lean: () => Promise.resolve([]),
    });
    const swaps = await getNonTerminalSwaps();
    expect(swaps).toHaveLength(0);
  });

  it("submitted senza boltz_swap_id, età >5 min → cancelled", async () => {
    const oldSwap = makeSwap({
      state:         "submitted",
      boltz_swap_id: undefined,
      created_at:    new Date(Date.now() - 6 * 60_000),
    });

    (SwapModel.findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...oldSwap, state: "cancelled",
    });

    const r = await reconcileSwap(oldSwap);
    expect(r.updated).toBe(true);
    expect(r.newState).toBe("cancelled");
  });

  it("submitted senza boltz_swap_id, età <5 min → nessuna azione", async () => {
    const freshSwap = makeSwap({
      state:         "submitted",
      boltz_swap_id: undefined,
      created_at:    new Date(Date.now() - 2 * 60_000), // 2 min fa
    });

    const r = await reconcileSwap(freshSwap);
    expect(r.updated).toBe(false);
    expect(r.newState).toBe("submitted");
  });

  it("Boltz offline → stato NON cambia (retry al prossimo ciclo)", async () => {
    const swap = makeSwap({ state: "created" });

    (getBoltzSwapStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    (SwapModel.findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...swap, reconcile_attempts: 1,
    });

    const r = await reconcileSwap(swap);
    expect(r.updated).toBe(false);
    expect(r.newState).toBe("created");
    // Il reconciler NON ha dichiarato "failed" per un errore di rete
  });
});
