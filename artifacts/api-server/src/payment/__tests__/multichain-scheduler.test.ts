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
  mockReleaseMultiChainTransfer,
} = vi.hoisted(() => ({
  mockFind:                     vi.fn(),
  mockFindOneAndUpdate:         vi.fn(),
  mockAdapterGet:               vi.fn(),
  mockRefund:                   vi.fn(),
  mockRetryEVMFee:              vi.fn(),
  mockReleaseFromWaitingForGas: vi.fn(),
  mockReleaseMultiChainTransfer: vi.fn(),
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
  refundMultiChainTransfer:      mockRefund,
  retryEVMFeeTx:                 mockRetryEVMFee,
  releaseFromWaitingForGas:      mockReleaseFromWaitingForGas,
  releaseMultiChainTransfer:     mockReleaseMultiChainTransfer,
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
  processNewPendingTransfers,
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
  mockReleaseMultiChainTransfer.mockResolvedValue({ status: "released" });
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

  // ── SCHED-03 (aggiornato): TX1 failed on-chain + tx_hash_release SET → NON rollback ──
  // Questo test verifica il comportamento CORRETTO dopo il fix SCHED-03.
  // Prima del fix: rollback a "pending" (rischio double pay).
  // Dopo il fix: rinnova lock + logger.error strutturato. Nessun rollback.
  it("SCHED-03 (ex 'TX1 failed'): tx_hash_release SET + TX1 failed → NON rollback, rinnova lock", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: "0xTX1_HASH",
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

    // SCHED-03: NESSUN rollback a "pending"
    const rollbackCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(rollbackCalls).toHaveLength(0);

    // Deve rinnovare il lock (defer)
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { locked_at: expect.any(Date) } },
    );
  });
});

// ─── SCHED-03: Anti Double-Pay Tests ──────────────────────────────────────────
//
// Verifica che il fix SCHED-03 prevenga il rischio di double-pay in tutti
// i casi in cui TX1 risulta failed/unknown ma tx_hash_release è già in DB.
//
// Test A: txStatus=unknown + tx_hash_release=null → rollback consentito (pre-TX1 crash)
// Test B: txStatus=unknown + tx_hash_release=SET  → NO rollback (SCHED-03 hardening)
// Test C: txStatus=failed  + tx_hash_release=SET  → NO rollback (SCHED-03 hardening)
// Test D: nessun secondo TX1 — acquireMCLock non viene chiamato (nessun rollback a "pending")
// Test E: scenario RPC error (catch→unknown) + tx_hash_release=SET → NO rollback
// ─────────────────────────────────────────────────────────────────────────────

describe("SCHED-03 — Anti Double-Pay Hardening", () => {

  /**
   * Test A — txStatus=unknown + tx_hash_release=null
   *
   * Caso: crash prima che TX1 fosse firmata/broadcast → tx_hash_release=null.
   * Questo caso NON raggiunge il branch SCHED-03 (gestito in cima con `continue`).
   * Il rollback a "pending" è consentito: nessuna TX è stata inviata.
   */
  it("Test A: txStatus=unknown + tx_hash_release=null → rollback CONSENTITO (pre-TX1 crash)", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: null,          // ← hash assente: pre-TX1 crash
      tx_hash_fee:     null,
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    // Nessuna chiamata all'adapter necessaria: il caso null è gestito prima del check on-chain
    await processStuckReleasingTransfers();

    // Rollback a "pending" è safe
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { status: "pending" as any, locked_at: null } },
    );

    // Nessuna chiamata all'adapter: si esce con `continue` prima del getTransactionStatus
    expect(mockAdapterGet).not.toHaveBeenCalled();
  });

  /**
   * Test B — txStatus=unknown + tx_hash_release=SET
   *
   * Caso: getTransactionStatus restituisce "unknown" (RPC glitch, receipt non trovata).
   * tx_hash_release è in DB → TX1 potrebbe essere ancora in mempool.
   * SCHED-03: NON fare rollback. Rinnova lock + alert strutturato.
   */
  it("Test B: txStatus=unknown + tx_hash_release=SET → NO rollback (SCHED-03)", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: "0xTX1_STAGED",  // ← hash presente: TX inviata o staged
      tx_hash_fee:     null,
      fee_wallet:      null,
      project_fee:     "0",
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    // Simula getTransactionStatus che restituisce "unknown"
    mockAdapterGet.mockReturnValue({
      networkId:            "polygon",
      getTransactionStatus: vi.fn().mockResolvedValue("unknown"),
    });

    await processStuckReleasingTransfers();

    // SCHED-03: NESSUN rollback a "pending" (rischio double pay)
    const rollbackCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(rollbackCalls).toHaveLength(0);

    // Deve rinnovare il lock (safe defer)
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { locked_at: expect.any(Date) } },
    );
  });

  /**
   * Test C — txStatus=failed + tx_hash_release=SET
   *
   * Caso: getTransactionStatus restituisce "failed" (TX minata ma reverted, o RPC glitch).
   * tx_hash_release è in DB → TX1 potrebbe essere ancora in mempool o avere avuto problemi.
   * SCHED-03: NON fare rollback. Rinnova lock + alert strutturato.
   */
  it("Test C: txStatus=failed + tx_hash_release=SET → NO rollback (SCHED-03)", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: "0xTX1_FAILED",
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

    // SCHED-03: NESSUN rollback
    const rollbackCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(rollbackCalls).toHaveLength(0);

    // Solo rinnovo del lock
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { locked_at: expect.any(Date) } },
    );
  });

  /**
   * Test D — Nessun secondo TX1 possibile
   *
   * Verifica che, dopo il fix SCHED-03, il transfer NON torni mai a "pending"
   * quando tx_hash_release è SET. Se non torna a "pending", acquireMCLock
   * ("pending"→"releasing") non può mai essere acquisito per un secondo TX1.
   *
   * Simula il caso peggiore: 3 cicli dello scheduler con TX1 "unknown" ogni volta.
   * Il transfer deve restare in "releasing" con lock rinnovato — mai in "pending".
   */
  it("Test D: nessun secondo TX1 possibile — 3 cicli scheduler con TX1 unknown, transfer resta in releasing", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: "0xTX1_ORIGINAL",
      tx_hash_fee:     null,
      fee_wallet:      null,
      project_fee:     "0",
    };

    const getTransactionStatus = vi.fn().mockResolvedValue("unknown");
    mockAdapterGet.mockReturnValue({ networkId: "polygon", getTransactionStatus });

    // Simula 3 cicli del scheduler
    for (let cycle = 0; cycle < 3; cycle++) {
      mockFindChain([doc]);
      mockFindOneAndUpdate.mockResolvedValue(null);
      await processStuckReleasingTransfers();
    }

    // Il transfer non è MAI tornato a "pending"
    const allPendingRollbacks = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(allPendingRollbacks).toHaveLength(0);

    // Il transfer non è stato rilasciato (nessun "released")
    const releasedCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "released",
    );
    expect(releasedCalls).toHaveLength(0);

    // 3 rinnovi del lock — uno per ciclo
    const lockRenewals = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.locked_at instanceof Date &&
                    !(c[1] as any)?.$set?.status,
    );
    expect(lockRenewals).toHaveLength(3);

    // getTransactionStatus chiamato 3 volte (una per ciclo)
    expect(getTransactionStatus).toHaveBeenCalledTimes(3);

    // L'adapter per un nuovo TX1 NON deve essere chiamato con operazioni di firma
    // (la firma avverrebbe nel service, non nello scheduler — ma il rollback è
    // il prerequisito. Senza rollback, nessun nuovo TX1 è possibile.)
    expect(mockRetryEVMFee).not.toHaveBeenCalled();
  });

  /**
   * Test E — RPC error (catch → txStatus="unknown") + tx_hash_release=SET
   *
   * Il caso più pericoloso per SCHED-03: getTransactionStatus lancia un'eccezione
   * (RPC down, timeout, errore di rete). Il catch del scheduler imposta
   * txStatus = "unknown". Con tx_hash_release SET, NON deve essere fatto rollback.
   *
   * Questo è esattamente lo scenario che SCHED-03 protegge: l'RPC è intermittente,
   * la TX è in mempool, ma il catch porta a txStatus="unknown".
   */
  it("Test E: RPC throws (catch→txStatus=unknown) + tx_hash_release=SET → NO rollback", async () => {
    const doc = {
      ...baseReleasingDoc,
      tx_hash_release: "0xTX1_IN_MEMPOOL",  // TX inviata, potenzialmente in mempool
      tx_hash_fee:     null,
      fee_wallet:      null,
      project_fee:     "0",
    };
    mockFindChain([doc]);
    mockFindOneAndUpdate.mockResolvedValue(null);

    // RPC lancia eccezione → il catch del scheduler imposta txStatus="unknown"
    mockAdapterGet.mockReturnValue({
      networkId:            "polygon",
      getTransactionStatus: vi.fn().mockRejectedValue(new Error("RPC timeout: connection refused")),
    });

    // Non deve lanciare eccezioni (gestite internamente)
    await expect(processStuckReleasingTransfers()).resolves.not.toThrow();

    // SCHED-03: NESSUN rollback — TX1 potrebbe essere ancora in mempool!
    const rollbackCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: any[]) => (c[1] as any)?.$set?.status === "pending",
    );
    expect(rollbackCalls).toHaveLength(0);

    // Rinnova lock (safe defer)
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: doc.transfer_id, status: "releasing" as any },
      { $set: { locked_at: expect.any(Date) } },
    );

    // Nessun retry TX2 (TX1 non confermata, impossibile procedere)
    expect(mockRetryEVMFee).not.toHaveBeenCalled();
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

// ─── processNewPendingTransfers — S01/S02/S03/S05/S06/S07/S08 ────────────────

/**
 * S01-S08: Safety-net scheduler per auto-release transfer EVM pending.
 *
 * processNewPendingTransfers():
 *   - Cerca transfer status="pending" con tx_hash_release=null e expires_at > now
 *   - Chiama releaseMultiChainTransfer per ciascuno (idempotente via lock)
 *   - Non lancia eccezioni — logga gli errori e continua
 */

const basePendingDoc = {
  transfer_id:         "pending-001",
  status:              "pending",
  network:             "polygon",
  asset:               "USDT",
  tx_hash_release:     null,
  expires_at:          FUTURE_DATE,
  locked_at:           null,
};

describe("processNewPendingTransfers", () => {
  // S01: BSC USDT pending → auto-release
  it("S01 — BSC pending senza tx_hash_release → chiama releaseMultiChainTransfer", async () => {
    const bscDoc = { ...basePendingDoc, transfer_id: "bsc-pending-001", network: "bsc" };
    mockFindChain([bscDoc]);
    mockReleaseMultiChainTransfer.mockResolvedValue({ status: "released", transferId: "bsc-pending-001" });

    await processNewPendingTransfers();

    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledTimes(1);
    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledWith("bsc-pending-001");
  });

  // S02: ETH USDT pending → auto-release
  it("S02 — ETH pending senza tx_hash_release → chiama releaseMultiChainTransfer", async () => {
    const ethDoc = { ...basePendingDoc, transfer_id: "eth-pending-001", network: "ethereum" };
    mockFindChain([ethDoc]);

    await processNewPendingTransfers();

    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledWith("eth-pending-001");
  });

  // S03: Polygon USDT pending → auto-release
  it("S03 — Polygon pending senza tx_hash_release → chiama releaseMultiChainTransfer", async () => {
    const polyDoc = { ...basePendingDoc, transfer_id: "poly-pending-001", network: "polygon" };
    mockFindChain([polyDoc]);

    await processNewPendingTransfers();

    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledWith("poly-pending-001");
  });

  // S04 (via S06): se release ritorna "released" → log successo
  it("S04/S10 — release completata con successo → status released", async () => {
    mockFindChain([basePendingDoc]);
    mockReleaseMultiChainTransfer.mockResolvedValue({ status: "released" });

    await expect(processNewPendingTransfers()).resolves.not.toThrow();

    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledWith("pending-001");
  });

  // S05: recipient wallet assente → service lancia RECIPIENT_WALLET_REQUIRED → scheduler non propaga
  it("S05 — recipient_wallet assente → service lancia, scheduler non propaga (lascia pending)", async () => {
    mockFindChain([basePendingDoc]);

    const walletErr = Object.assign(new Error("wallet required"), { code: "RECIPIENT_WALLET_REQUIRED_FOR_RELEASE" });
    mockReleaseMultiChainTransfer.mockRejectedValue(walletErr);

    // Scheduler non deve lanciare — gestisce l'errore e lascia il transfer in pending
    await expect(processNewPendingTransfers()).resolves.not.toThrow();

    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledWith("pending-001");
  });

  // S06: nessun transfer pending → no-op
  it("S06/S08 — nessun transfer pending → no-op (nessuna chiamata al service)", async () => {
    mockFindChain([]);

    await processNewPendingTransfers();

    expect(mockReleaseMultiChainTransfer).not.toHaveBeenCalled();
  });

  // S07: detect + scheduler concorrenti → lock idempotente (acquireLock ritorna null dal service)
  it("S07 — detect e scheduler concorrenti → releaseMultiChainTransfer chiamato per ogni pending (lock interno è idempotente)", async () => {
    // Il service gestisce la concorrenza via acquireMCLock (atomic pending→releasing).
    // Lo scheduler chiama releaseMultiChainTransfer, che ritorna lo stato corrente
    // se il lock è già preso (idempotente — nessuna seconda TX).
    const twoDoc = [
      { ...basePendingDoc, transfer_id: "pending-001" },
      { ...basePendingDoc, transfer_id: "pending-002" },
    ];
    mockFindChain(twoDoc);

    // Simula: primo acquisisce il lock, secondo trova lock già preso → ritorna releasing
    mockReleaseMultiChainTransfer
      .mockResolvedValueOnce({ status: "released" })         // primo: completa
      .mockResolvedValueOnce({ status: "releasing" });       // secondo: lock già preso, idempotente

    await processNewPendingTransfers();

    // Scheduler ha tentato entrambi — il service gestisce idempotenza internamente
    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledTimes(2);
    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledWith("pending-001");
    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledWith("pending-002");
  });

  // S08: server restart con transfer pending → processNewPendingTransfers in _runAll li recupera
  it("S08 — batch di transfer pending (post-restart) → tutti processati senza eccezioni", async () => {
    const pending = [
      { ...basePendingDoc, transfer_id: "restart-001", network: "polygon" },
      { ...basePendingDoc, transfer_id: "restart-002", network: "bsc" },
      { ...basePendingDoc, transfer_id: "restart-003", network: "ethereum" },
    ];
    mockFindChain(pending);

    // Terzo: errore transitorio (es. RPC down) — scheduler non propaga
    mockReleaseMultiChainTransfer
      .mockResolvedValueOnce({ status: "released" })
      .mockResolvedValueOnce({ status: "released" })
      .mockRejectedValueOnce(new Error("RPC timeout"));

    await expect(processNewPendingTransfers()).resolves.not.toThrow();

    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledTimes(3);
  });

  // S13: cancel-stale NON cancella pending — già coperto da admin-routes, confermato per completezza
  it("S13 — processNewPendingTransfers non cancella mai i transfer: chiama solo releaseMultiChainTransfer", async () => {
    mockFindChain([basePendingDoc]);
    mockReleaseMultiChainTransfer.mockResolvedValue({ status: "released" });

    await processNewPendingTransfers();

    // Non chiama refund/cancel — solo release
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockReleaseMultiChainTransfer).toHaveBeenCalledWith("pending-001");
  });

  // Query correttezza: include solo pending senza tx_hash_release e non scaduti
  it("query correttezza — verifica campi status, tx_hash_release:null, expires_at", async () => {
    mockFindChain([]);

    await processNewPendingTransfers();

    // Verifica la query passata a find()
    const findCall = mockFind.mock.calls[0]?.[0];
    expect(findCall).toMatchObject({
      status:          "pending",
      tx_hash_release: null,
    });
    // expires_at deve avere $gt (non scaduti)
    expect(findCall?.expires_at?.$gt).toBeInstanceOf(Date);
  });
});
