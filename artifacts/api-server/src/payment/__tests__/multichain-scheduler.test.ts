/**
 * multichain-scheduler.test.ts — Unit test Multi-Chain Scheduler
 *
 * Verifica:
 *   C-2: NON rollback se tx_hash_release è impostato (anche con feature flag disabilitata)
 *   H-3: processExpiredPendingTransfers → rimborso transfer pending scaduti
 *   M-2: startMultiChainScheduler() singleton guard — seconda chiamata ignorata
 *   processStuckReleasingTransfers: rollback se tx_hash assente; defer se TX pending
 *   processExpiredMCTransfers: marca "expired" i transfer awaiting_deposit scaduti
 *
 * NOTA: vi.hoisted() è obbligatorio per le variabili usate nei factory di vi.mock,
 *       perché vi.mock() viene hoistato in cima al file da Vitest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mock variables ────────────────────────────────────────────────────
// Le variabili usate dentro vi.mock() devono essere create con vi.hoisted().

const {
  mockFind,
  mockFindOneAndUpdate,
  mockAdapterGet,
  mockRefund,
  mockRetryEVMFee,
  mockReleaseFromWaitingForGas,
} = vi.hoisted(() => ({
  mockFind:                    vi.fn(),
  mockFindOneAndUpdate:        vi.fn(),
  mockAdapterGet:              vi.fn(),
  mockRefund:                  vi.fn(),
  mockRetryEVMFee:             vi.fn(),
  mockReleaseFromWaitingForGas: vi.fn(),
}));

// ─── Mock prima degli import ───────────────────────────────────────────────────

vi.mock("../../models/multichain-transfer.model", () => ({
  MultiChainTransferModel: {
    find:             mockFind,
    findOneAndUpdate: mockFindOneAndUpdate,
  },
}));

vi.mock("../../blockchain/adapter-registry", () => ({
  adapterRegistry: { get: mockAdapterGet },
}));

vi.mock("../../blockchain/multichain-config", async () => {
  const actual = await vi.importActual<typeof import("../../blockchain/multichain-config")>(
    "../../blockchain/multichain-config",
  );
  return {
    ...actual,
    FEATURE_FLAGS: {
      ENABLE_POLYGON_USDT:  true,
      ENABLE_BITCOIN:       true,
      ENABLE_ETHEREUM_USDT: false,
      ENABLE_BSC_USDT:      false,
    },
  };
});

// Mock del service importato dinamicamente dal scheduler
vi.mock("../multichain-payment.service", () => ({
  refundMultiChainTransfer:  mockRefund,
  retryEVMFeeTx:             mockRetryEVMFee,
  releaseFromWaitingForGas:  mockReleaseFromWaitingForGas,
  GasReserveDepletedError:   class GasReserveDepletedError extends Error {
    code = "GAS_RESERVE_DEPLETED" as const;
    constructor(public network: string, public escrowAddress: string, public required: bigint, public available: bigint) {
      super(`gas depleted: required ${required}, available ${available}`);
      this.name = "GasReserveDepletedError";
    }
  },
}));

// Import dopo i mock
import {
  processStuckReleasingTransfers,
  processStuckRefundingTransfers,
  processExpiredMCTransfers,
  processExpiredPendingTransfers,
  processWaitingForGasTransfers,
  startMultiChainScheduler,
  _resetSchedulerForTesting,
} from "../multichain-scheduler";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simula la chain Mongoose: find().limit().lean() → results
 * Il scheduler chiama `.find(...).limit(N).lean()` — il mock deve supportare il chain.
 */
function mockFindChain(results: unknown[]) {
  mockFind.mockReturnValueOnce({
    limit: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(results),
    }),
  });
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const STALE_DATE  = new Date(Date.now() - 15 * 60_000);  // 15 min fa (stale)
const FUTURE_DATE = new Date(Date.now() + 24 * 3_600_000);
const PAST_DATE   = new Date(Date.now() - 1 * 60_000);   // scaduto 1 min fa

const baseReleasingDoc = {
  transfer_id:         "test-transfer-001",
  status:              "releasing",
  locked_at:           STALE_DATE,
  network:             "polygon",
  asset:               "USDT",
  tx_hash_release:     null as string | null,
  tx_hash_fee:         null as string | null,
  tx_hash_refund:      null as string | null,
  project_fee:         "100000",
  fee_wallet:          "0xFEEWALLET" as string | null,
  network_fee:         "0",
  asset_address:       "0xTOKEN",
  escrow_encrypted_pk: "enc-pk",
  expires_at:          FUTURE_DATE,
};

// ─── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRefund.mockResolvedValue({ status: "refunded" });
  mockRetryEVMFee.mockResolvedValue(undefined);
  _resetSchedulerForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── processStuckReleasingTransfers ───────────────────────────────────────────

describe("processStuckReleasingTransfers", () => {

  it("rollback a pending se tx_hash_release è null (crash pre-TX1)", async () => {
    const doc = { ...baseReleasingDoc, tx_hash_release: null };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    await processStuckReleasingTransfers();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { status: "pending" as any, locked_at: null } },
    );
  });

  it("non chiama findOneAndUpdate se non ci sono doc bloccati", async () => {
    mockFindChain([]);

    await processStuckReleasingTransfers();

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  // ── C-2: tx_hash_release impostato + feature flag disabilitata → DEFER, mai rollback ──

  it("C-2: NON fa rollback se tx_hash_release impostato e rete disabilitata (ethereum)", async () => {
    // ENABLE_ETHEREUM_USDT = false nel mock
    const doc = {
      ...baseReleasingDoc,
      network:         "ethereum",
      tx_hash_release: "0xEXISTING_TX1",
      tx_hash_fee:     null,
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    await processStuckReleasingTransfers();

    // Deve rinnovare il lock (defer)
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { locked_at: expect.any(Date) } },
    );

    // NESSUN rollback a pending
    const rollbackCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(rollbackCalls).toHaveLength(0);
  });

  it("C-2: NON fa rollback se tx_hash_release impostato e rete disabilitata (bsc)", async () => {
    // ENABLE_BSC_USDT = false nel mock
    const doc = {
      ...baseReleasingDoc,
      network:         "bsc",
      tx_hash_release: "0xBSC_TX",
      tx_hash_fee:     "0xBSC_TX",
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    await processStuckReleasingTransfers();

    const rollbackCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(rollbackCalls).toHaveLength(0);
  });

  it("TX1 confermata on-chain → mark released (BTC, tx_hash_fee già impostato)", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: "0xTX1",
      tx_hash_fee:     "0xTX1",  // BTC: stessa TX, entrambi impostati
      fee_wallet:      null,
      project_fee:     "0",
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    mockAdapterGet.mockReturnValue({
      networkId:            "polygon",
      getTransactionStatus: vi.fn().mockResolvedValue("confirmed"),
    });

    await processStuckReleasingTransfers();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { status: "released" as any, completed_at: expect.any(Date), locked_at: null } },
    );
  });

  it("C-1 recovery: TX1 confermata + tx_hash_fee null + fee_wallet → chiama retryEVMFeeTx", async () => {
    // Stato post-crash C-1: TX1 in DB, TX2 (fee) non ancora inviata
    const doc = {
      ...baseReleasingDoc,
      network:         "polygon",
      tx_hash_release: "0xTX1",
      tx_hash_fee:     null,           // TX2 non inviata
      fee_wallet:      "0xFEEWALLET",
      project_fee:     "100000",
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    mockAdapterGet.mockReturnValue({
      networkId:            "polygon",
      getTransactionStatus: vi.fn().mockResolvedValue("confirmed"),
    });

    await processStuckReleasingTransfers();

    // retryEVMFeeTx deve essere chiamato per inviare solo TX2
    expect(mockRetryEVMFee).toHaveBeenCalledWith(doc.transfer_id);

    // NON deve marcare released direttamente (delega a retryEVMFeeTx)
    const releasedCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "released",
    );
    expect(releasedCalls).toHaveLength(0);
  });

  it("TX1 pending on-chain → rinova lock, non fa rollback", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: "0xTX1",
      tx_hash_fee:     null,
      project_fee:     "0",    // project_fee=0 → needsFeeTx=false
      fee_wallet:      null,
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    mockAdapterGet.mockReturnValue({
      networkId:            "polygon",
      getTransactionStatus: vi.fn().mockResolvedValue("pending"),
    });

    await processStuckReleasingTransfers();

    // Solo rinnovo del lock
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { locked_at: expect.any(Date) } },
    );

    // Nessun rollback
    const rollbackCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(rollbackCalls).toHaveLength(0);
  });

  it("TX1 failed on-chain → rollback a pending per retry", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: "0xTX1",
      tx_hash_fee:     null,
      fee_wallet:      null,
      project_fee:     "0",
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    mockAdapterGet.mockReturnValue({
      networkId:            "polygon",
      getTransactionStatus: vi.fn().mockResolvedValue("failed"),
    });

    await processStuckReleasingTransfers();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { status: "pending" as any, locked_at: null } },
    );
  });
});

// ─── H-3: processExpiredPendingTransfers ───────────────────────────────────────

describe("processExpiredPendingTransfers — H-3", () => {
  it("chiama refundMultiChainTransfer per ogni transfer pending scaduto", async () => {
    const expiredDoc1 = { transfer_id: "expired-001", status: "pending", expires_at: PAST_DATE, tx_hash_release: null, tx_hash_fee: null };
    const expiredDoc2 = { transfer_id: "expired-002", status: "pending", expires_at: PAST_DATE, tx_hash_release: null, tx_hash_fee: null };

    mockFindChain([expiredDoc1, expiredDoc2]);

    await processExpiredPendingTransfers();

    expect(mockRefund).toHaveBeenCalledTimes(2);
    expect(mockRefund).toHaveBeenCalledWith("expired-001");
    expect(mockRefund).toHaveBeenCalledWith("expired-002");
  });

  it("non rimborsa se non ci sono transfer pending scaduti", async () => {
    mockFindChain([]);

    await processExpiredPendingTransfers();

    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("continua con gli altri transfer se uno fallisce", async () => {
    const expiredDoc1 = { transfer_id: "expired-err", status: "pending", expires_at: PAST_DATE, tx_hash_release: null, tx_hash_fee: null };
    const expiredDoc2 = { transfer_id: "expired-ok",  status: "pending", expires_at: PAST_DATE, tx_hash_release: null, tx_hash_fee: null };

    mockFindChain([expiredDoc1, expiredDoc2]);

    // Il primo rimborso fallisce
    mockRefund
      .mockRejectedValueOnce(new Error("Saldo insufficiente"))
      .mockResolvedValueOnce({ status: "refunded" });

    // Non deve lanciare — l'errore è gestito internamente
    await expect(processExpiredPendingTransfers()).resolves.not.toThrow();

    // Il secondo trasferimento viene comunque rimborsato
    expect(mockRefund).toHaveBeenCalledWith("expired-ok");
  });

  it("la query include tx_hash_release:null per sicurezza anti-double-pay", async () => {
    mockFindChain([]);

    await processExpiredPendingTransfers();

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        status:          "pending",
        tx_hash_release: null,
        tx_hash_fee:     null,
      }),
    );
  });
});

// ─── M-2: startMultiChainScheduler singleton guard ────────────────────────────

describe("startMultiChainScheduler — M-2 singleton guard", () => {
  it("la seconda chiamata NON crea nuovi setInterval", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startMultiChainScheduler(); // prima chiamata — crea interval
    const callsAfterFirst = setIntervalSpy.mock.calls.length;

    startMultiChainScheduler(); // seconda chiamata — IGNORATA
    const callsAfterSecond = setIntervalSpy.mock.calls.length;

    // Nessun nuovo interval dopo la seconda chiamata
    expect(callsAfterSecond).toBe(callsAfterFirst);

    setIntervalSpy.mockRestore();
  });

  it("_resetSchedulerForTesting() permette di re-avviare lo scheduler nei test", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startMultiChainScheduler();
    const callsAfterFirst = setIntervalSpy.mock.calls.length;

    _resetSchedulerForTesting(); // reset del singleton

    startMultiChainScheduler(); // seconda chiamata dopo reset — crea nuovi interval
    const callsAfterReset = setIntervalSpy.mock.calls.length;

    // Dopo reset, nuovi interval creati
    expect(callsAfterReset).toBeGreaterThan(callsAfterFirst);

    setIntervalSpy.mockRestore();
  });
});

// ─── processExpiredMCTransfers ────────────────────────────────────────────────

describe("processExpiredMCTransfers", () => {
  it("marca 'expired' i transfer awaiting_deposit scaduti", async () => {
    const expiredDoc = {
      transfer_id: "mc-expired-001",
      status:      "awaiting_deposit",
      expires_at:  PAST_DATE,
    };
    mockFindChain([expiredDoc]);
    mockFindOneAndUpdate.mockResolvedValue(expiredDoc);

    await processExpiredMCTransfers();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: "mc-expired-001", status: "awaiting_deposit" as any },
      { $set: { status: "expired" as any, completed_at: expect.any(Date) } },
    );
  });

  it("non fa nulla se non ci sono transfer scaduti", async () => {
    mockFindChain([]);

    await processExpiredMCTransfers();

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ─── processStuckRefundingTransfers ──────────────────────────────────────────

describe("processStuckRefundingTransfers", () => {
  it("rollback a pending se tx_hash_refund è null (crash pre-TX)", async () => {
    const doc = {
      transfer_id:    "refunding-001",
      status:         "refunding",
      locked_at:      STALE_DATE,
      network:        "polygon",
      tx_hash_refund: null,
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    await processStuckRefundingTransfers();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: "refunding-001", status: "refunding" as any },
      { $set: { status: "pending" as any, locked_at: null } },
    );
  });

  it("non chiama findOneAndUpdate se non ci sono doc bloccati", async () => {
    mockFindChain([]);

    await processStuckRefundingTransfers();

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("C-2: NON fa rollback se tx_hash_refund è impostato e rete è disabilitata", async () => {
    const doc = {
      transfer_id:    "refunding-c2",
      status:         "refunding",
      locked_at:      STALE_DATE,
      network:        "ethereum", // disabilitato nel mock
      tx_hash_refund: "0xREFUND_TX",
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    await processStuckRefundingTransfers();

    // Defer (rinnovo lock), no rollback
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "refunding" as any },
      { $set: { locked_at: expect.any(Date) } },
    );

    const rollbackCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(rollbackCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gas Reserve Protection — processWaitingForGasTransfers (Tests C e G)
// ─────────────────────────────────────────────────────────────────────────────

describe("processWaitingForGasTransfers", () => {

  const baseWaitingDoc = {
    transfer_id:     "waiting-gas-001",
    status:          "waiting_for_gas",
    network:         "polygon",
    asset:           "USDT",
    gas_retry_count: 1,
  };

  /**
   * TEST C — Gas station ripristinato → processWaitingForGasTransfers → release completata.
   *
   * Simula: gas station rifornito → releaseFromWaitingForGas() ha successo → status = "released".
   * Verifica che lo scheduler chiami releaseFromWaitingForGas per ogni waiting_for_gas transfer.
   */
  it("TEST C: gas ripristinato → scheduler chiama releaseFromWaitingForGas → status released", async () => {
    mockFindChain([baseWaitingDoc]);

    // Gas station ripristinato → release ha successo
    mockReleaseFromWaitingForGas.mockResolvedValue({
      transferId:       "waiting-gas-001",
      status:           "released",
      gasRetryCount:    1,
      network:          "polygon",
      asset:            "USDT",
      grossAmount:      "100000000",
      projectFee:       "100000",
      netAmount:        "99900000",
      networkFeeCharged: "500000",
      networkFeeActual: "2000",
      networkFeeAsset:  "POL",
    });

    await processWaitingForGasTransfers();

    expect(mockReleaseFromWaitingForGas).toHaveBeenCalledWith("waiting-gas-001");
    expect(mockReleaseFromWaitingForGas).toHaveBeenCalledTimes(1);
  });

  /**
   * TEST G — Gas station ancora vuoto → scheduler lascia il transfer in waiting_for_gas.
   *
   * Simula: gas station ancora insufficiente → releaseFromWaitingForGas() ritorna
   * status "waiting_for_gas" (GasReserveDepletedError intercettata internamente dal service).
   * Lo scheduler NON lancia eccezioni e NON cambia status a "failed".
   */
  it("TEST G: gas ancora insufficiente → transfer rimane in waiting_for_gas (retry al prossimo ciclo)", async () => {
    mockFindChain([baseWaitingDoc]);

    // Gas ancora insufficiente → service ritorna waiting_for_gas (non lancia)
    mockReleaseFromWaitingForGas.mockResolvedValue({
      transferId:    "waiting-gas-001",
      status:        "waiting_for_gas",
      gasRetryCount: 2,  // incrementato
      network:       "polygon",
    });

    await processWaitingForGasTransfers();

    // Lo scheduler ha tentato il release
    expect(mockReleaseFromWaitingForGas).toHaveBeenCalledWith("waiting-gas-001");

    // NON ha cambiato status a failed (findOneAndUpdate non chiamato con "failed")
    const failedCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "failed",
    );
    expect(failedCalls).toHaveLength(0);
  });

  /**
   * TEST G2 — Nessun transfer in waiting_for_gas → funzione è no-op.
   */
  it("TEST G2: nessun transfer waiting_for_gas → no-op (nessuna chiamata al service)", async () => {
    mockFindChain([]);

    await processWaitingForGasTransfers();

    expect(mockReleaseFromWaitingForGas).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  /**
   * TEST C2 — Errore inatteso nel service → scheduler logga e continua (non propaga).
   *
   * Se releaseFromWaitingForGas lancia per un errore non previsto (RPC, DB),
   * lo scheduler deve continuare a processare gli altri transfer.
   */
  it("TEST C2: errore imprevisto nel service → scheduler logga ma non propaga", async () => {
    const multiDoc = [
      { ...baseWaitingDoc, transfer_id: "waiting-001" },
      { ...baseWaitingDoc, transfer_id: "waiting-002" },
    ];
    mockFindChain(multiDoc);

    // Primo: lancia errore imprevisto; Secondo: successo
    mockReleaseFromWaitingForGas
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce({ status: "released", gasRetryCount: 1 });

    // Non deve lanciare
    await expect(processWaitingForGasTransfers()).resolves.not.toThrow();

    // Deve aver tentato entrambi i transfer
    expect(mockReleaseFromWaitingForGas).toHaveBeenCalledTimes(2);
    expect(mockReleaseFromWaitingForGas).toHaveBeenCalledWith("waiting-001");
    expect(mockReleaseFromWaitingForGas).toHaveBeenCalledWith("waiting-002");
  });
});
