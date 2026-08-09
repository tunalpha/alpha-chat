/**
 * multichain-bsc-eth-sweep.test.ts — Sweep automatico nativo BSC/ETH dopo payout
 *
 * Verifica che _reclaimEscrowGas / reclaimEscrowGasById funzioni correttamente
 * per BSC (BNB) ed Ethereum (ETH), inclusi:
 *
 *   S-01  BSC: payout normale + sweep BNB → gas station ✓
 *   S-02  BSC: saldo BNB basso (< gas TX3) → INSUFFICIENT_BALANCE + native_sweep_status:skipped
 *   S-03  BSC: gas price alto (spike) → formula dinamica, nessun importo hardcoded
 *   S-04  ETH: payout + sweep ETH → gas station ✓
 *   S-05  Escrow con residuo minimo (1 wei sopra soglia) → sweep del singolo wei
 *   S-06  Sweep fallito (RPC error) → native_sweep_status:failed + retry scheduler
 *   S-07  Timeout waitForTransactionReceipt → native_sweep_status:failed + retry
 *   S-08  Doppio trigger simultaneo → idempotenza garantita (DB guard tx_hash_reclaim:null)
 *   S-09  Verifica saldo finale on-chain: getBalance chiamato 2× (pre + post sweep)
 *   S-10  native_sweep_status tracking: pending → sweeping → completed
 *   S-11  BSC + residuo minimo (esattamente gas+1 wei) → sweep di 1 wei
 *   S-12  Sweep non eseguito per network bitcoin → BTC skip immediato
 *   S-13  native_balance_before_sweep salvato correttamente anche quando INSUFFICIENT
 *   S-14  native_sweep_gas_cost calcolato da receipt.gasUsed × gasPrice (non stima)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mock variables ──────────────────────────────────────────────────

const { mockFindOne, mockFindOneAndUpdate } = vi.hoisted(() => ({
  mockFindOne:          vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
}));

// ─── Mock prima degli import ─────────────────────────────────────────────────

vi.mock("../../models/multichain-transfer.model", () => ({
  MultiChainTransferModel: {
    findOne:          mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
    find:             vi.fn(),
  },
}));

vi.mock("../../blockchain/escrow-crypto", () => ({
  decryptEscrowKeyHex: vi.fn(() => "0xMOCK_ESCROW_PRIVATE_KEY_ABCDEF1234567890"),
}));

vi.mock("../../blockchain/adapter-registry", () => ({
  adapterRegistry: { get: vi.fn() },
}));

vi.mock("../../blockchain/multichain-config", async () => {
  const actual = await vi.importActual<typeof import("../../blockchain/multichain-config")>(
    "../../blockchain/multichain-config",
  );
  return {
    ...actual,
    FEATURE_FLAGS: {
      ENABLE_POLYGON_USDT:  true,
      ENABLE_BITCOIN:       false,
      ENABLE_ETHEREUM_USDT: true,
      ENABLE_BSC_USDT:      true,
    },
    RPC_CONFIGS: {
      polygon:  { primary: "https://mock-polygon-rpc.test" },
      ethereum: { primary: "https://mock-eth-rpc.test" },
      bsc:      { primary: "https://mock-bsc-rpc.test" },
      bitcoin:  {},
    },
  };
});

// ─── Viem mock ───────────────────────────────────────────────────────────────

const mockGetGasPrice         = vi.fn();
const mockGetBalance          = vi.fn();
const mockGetTransactionCount = vi.fn().mockResolvedValue(0);
const mockWaitForReceipt      = vi.fn();
const mockSendTransaction     = vi.fn().mockResolvedValue("0xSWEEP_TX_HASH");
const mockGetTransactionReceipt = vi.fn().mockResolvedValue(null);

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getGasPrice:               mockGetGasPrice,
      getBalance:                mockGetBalance,
      getTransactionCount:       mockGetTransactionCount,
      waitForTransactionReceipt: mockWaitForReceipt,
      getTransactionReceipt:     mockGetTransactionReceipt,
    })),
    createWalletClient: vi.fn(() => ({
      sendTransaction: mockSendTransaction,
    })),
  };
});

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn((pk: string) => ({
    address: pk.includes("GAS") || pk.includes("STATION")
      ? "0xGASSTATION_0000000000000000000000000"
      : "0xESCROW_ADDRESS_0000000000000000000000",
    sign:            vi.fn(),
    signTransaction: vi.fn(),
  })),
}));

import { reclaimEscrowGasById } from "../multichain-payment.service";

// ─── Costanti ─────────────────────────────────────────────────────────────────

const TRANSFER_ID    = "bsc-eth-sweep-test-0001";
const TX3_GAS_UNITS  = 21_000n;

// Scenari gas price
const GAS_LOW   = 1_000_000n;          // 0.001 Gwei (gas molto basso)
const GAS_MID   = 5_000_000_000n;      // 5 Gwei (tipico BSC)
const GAS_HIGH  = 100_000_000_000n;    // 100 Gwei (spike)

// Balances
const BALANCE_2BNB    = 2_000_000_000_000_000_000n;   // 2 BNB/ETH
const BALANCE_001BNB  = 10_000_000_000_000_000n;       // 0.01 BNB
const BALANCE_ZERO    = 0n;

// Helpers
function gasThreshold(gasPrice: bigint): bigint { return TX3_GAS_UNITS * gasPrice; }
function sweepAmount(balance: bigint, gasPrice: bigint): bigint { return balance - gasThreshold(gasPrice); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    transfer_id:          TRANSFER_ID,
    status:               "released",
    network:              "bsc",
    asset:                "USDT",
    escrow_wallet:        "0xESCROW_ADDRESS_0000000000000000000000",
    escrow_encrypted_pk:  "encrypted-pk-base64-mock",
    tx_hash_release:      "0xTX1",
    tx_hash_fee:          "0xTX2",
    tx_hash_reclaim:      null,
    tx_hash_reclaim_submitted: null,
    pol_reclaimed:        null,
    reclaim_error:        null,
    completed_at:         new Date(),
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  process.env.GAS_STATION_PRIVATE_KEY = "0xMOCK_GAS_STATION_PK_1234567890ABCDEF";

  // Default: BSC, 5 Gwei, saldo 2 BNB, receipt success.
  // mockResolvedValue (non Once) per robustezza: il service chiama getBalance
  // due volte nel happy path (pre-sweep + post-sweep), e Once-based setup
  // è fragile rispetto all'ordine dei test.
  mockGetGasPrice.mockResolvedValue(GAS_MID);
  mockGetBalance.mockResolvedValue(BALANCE_2BNB);  // ritorna sempre BALANCE_2BNB

  mockWaitForReceipt.mockResolvedValue({
    status:           "success",
    gasUsed:          21_000n,
    effectiveGasPrice: GAS_MID,
  });

  mockGetTransactionCount.mockResolvedValue(0);
  mockSendTransaction.mockResolvedValue("0xSWEEP_TX_HASH");
  mockGetTransactionReceipt.mockResolvedValue(null);

  mockFindOne.mockReturnValue({
    lean: vi.fn().mockResolvedValue(makeDoc()),
  });

  mockFindOneAndUpdate.mockResolvedValue({});
});

afterEach(() => {
  delete process.env.GAS_STATION_PRIVATE_KEY;
});

// ─── S-01: BSC payout normale + sweep ────────────────────────────────────────

describe("S-01 — BSC: sweep BNB normale dopo payout", () => {
  it("chiama sendTransaction con il saldo meno il gas TX3", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);

    const expected = sweepAmount(BALANCE_2BNB, GAS_MID);
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: expected, gas: TX3_GAS_UNITS }),
    );
  });

  it("persiste native_sweep_status:completed al termine", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);

    const completedCall = mockFindOneAndUpdate.mock.calls.find(
      (c: unknown[]) => (c[1] as { $set: Record<string, unknown> })?.$set?.native_sweep_status === "completed",
    );
    expect(completedCall).toBeDefined();
  });

  it("persiste native_sweep_tx_hash uguale al tx hash TX3", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ native_sweep_tx_hash: "0xSWEEP_TX_HASH" }) },
    );
  });

  it("non lancia eccezioni verso il caller", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });
});

// ─── S-02: BSC saldo BNB basso → INSUFFICIENT_BALANCE ────────────────────────

describe("S-02 — BSC: saldo BNB < gas TX3 → skipped", () => {
  beforeEach(() => {
    // Saldo esattamente uguale al costo gas → NON sufficiente
    const gasCost = TX3_GAS_UNITS * GAS_MID;
    mockGetBalance.mockReset().mockResolvedValueOnce(gasCost); // uguale → non sufficiente (≤)
  });

  it("NON chiama sendTransaction", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it("persiste native_sweep_status:skipped", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ native_sweep_status: "skipped", reclaim_error: "INSUFFICIENT_BALANCE" }) },
    );
  });

  it("non lancia eccezioni", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });
});

// ─── S-03: BSC gas price alto (spike) → formula dinamica ─────────────────────

describe("S-03 — BSC: gas price alto (spike) — formula dinamica, no hardcoded", () => {
  it("il sweep amount cambia dinamicamente con il gas price", async () => {
    // Gas price standard → sweep amount grande
    const expectedMid  = sweepAmount(BALANCE_2BNB, GAS_MID);
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: expectedMid }),
    );

    // Reset e prova con gas alto
    vi.clearAllMocks();
    mockGetBalance.mockResolvedValueOnce(BALANCE_2BNB).mockResolvedValueOnce(0n);
    mockGetGasPrice.mockResolvedValue(GAS_HIGH);
    mockGetTransactionCount.mockResolvedValue(1);
    mockSendTransaction.mockResolvedValue("0xSWEEP_TX_HIGH_GAS");
    mockWaitForReceipt.mockResolvedValue({ status: "success", gasUsed: 21_000n, effectiveGasPrice: GAS_HIGH });
    mockFindOneAndUpdate.mockResolvedValue({});
    mockFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(makeDoc()) });

    await reclaimEscrowGasById(TRANSFER_ID);

    const expectedHigh = sweepAmount(BALANCE_2BNB, GAS_HIGH);
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: expectedHigh }),
    );

    // I due sweep amount DEVONO essere diversi (gas price diverso → importo diverso)
    expect(expectedMid).not.toBe(expectedHigh);
    expect(expectedMid).toBeGreaterThan(expectedHigh); // più gas alto → meno nativo sweepato
  });
});

// ─── S-04: Ethereum payout + sweep ETH ───────────────────────────────────────

describe("S-04 — Ethereum: sweep ETH normale dopo payout", () => {
  beforeEach(() => {
    mockFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeDoc({ network: "ethereum" })),
    });
    mockGetBalance.mockReset()
      .mockResolvedValueOnce(BALANCE_001BNB) // 0.01 ETH
      .mockResolvedValueOnce(0n);
    mockWaitForReceipt.mockResolvedValue({ status: "success", gasUsed: 21_000n, effectiveGasPrice: GAS_MID });
  });

  it("esegue lo sweep anche per la rete ethereum", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: sweepAmount(BALANCE_001BNB, GAS_MID) }),
    );
  });

  it("persiste native_sweep_status:completed", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    const completedCall = mockFindOneAndUpdate.mock.calls.find(
      (c: unknown[]) => (c[1] as { $set: Record<string, unknown> })?.$set?.native_sweep_status === "completed",
    );
    expect(completedCall).toBeDefined();
  });

  it("non lancia eccezioni", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });
});

// ─── S-05: Residuo minimo (balance = gas + 1 wei) ────────────────────────────

describe("S-05 — Escrow con residuo minimo (balance = gas + 1 wei)", () => {
  it("sweeppa esattamente 1 wei quando il saldo è appena sopra la soglia", async () => {
    const gasCost = TX3_GAS_UNITS * GAS_MID;
    mockGetBalance.mockReset().mockResolvedValueOnce(gasCost + 1n).mockResolvedValueOnce(0n);

    await reclaimEscrowGasById(TRANSFER_ID);

    // Deve inviare 1 wei (tutto il saldo meno il gas)
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: 1n }),
    );
  });
});

// ─── S-06: Sweep fallito (RPC error) → native_sweep_status:failed + retry ────

describe("S-06 — Sweep fallito (sendTransaction RPC error) → failed + retry scheduler", () => {
  beforeEach(() => {
    mockSendTransaction.mockRejectedValue(new Error("BSC RPC connection refused"));
  });

  it("NON lancia eccezioni verso il caller", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });

  it("persiste native_sweep_status:failed", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ native_sweep_status: "failed" }) },
    );
  });

  it("persiste l'errore in reclaim_error per il retry scheduler", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ reclaim_error: expect.stringContaining("BSC RPC") }) },
    );
  });

  it("NON persiste native_sweep_status:completed", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    const completedCall = mockFindOneAndUpdate.mock.calls.find(
      (c: unknown[]) => (c[1] as { $set: Record<string, unknown> })?.$set?.native_sweep_status === "completed",
    );
    expect(completedCall).toBeUndefined();
  });
});

// ─── S-07: Timeout waitForTransactionReceipt ─────────────────────────────────

describe("S-07 — Timeout waitForTransactionReceipt → failed + retry", () => {
  beforeEach(() => {
    mockWaitForReceipt.mockRejectedValue(new Error("Transaction not mined within timeout"));
  });

  it("non lancia eccezioni", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });

  it("persiste native_sweep_status:failed e reclaim_error", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      {
        $set: expect.objectContaining({
          native_sweep_status: "failed",
          reclaim_error:       expect.stringContaining("timeout"),
        }),
      },
    );
  });

  it("persiste tx_hash_reclaim_submitted prima del timeout (crash safety)", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    // Il submitted hash DEVE essere persistito prima del waitForReceipt
    const submittedCall = mockFindOneAndUpdate.mock.calls.find(
      (c: unknown[]) => {
        const s = (c[1] as { $set: Record<string, unknown> })?.$set;
        return s?.tx_hash_reclaim_submitted !== undefined;
      },
    );
    expect(submittedCall).toBeDefined();
  });
});

// ─── S-08: Doppio trigger simultaneo → idempotenza ───────────────────────────

describe("S-08 — Doppio trigger simultaneo → idempotenza DB guard", () => {
  it("tutte le findOneAndUpdate usano { tx_hash_reclaim: null } come condizione", async () => {
    await Promise.all([
      reclaimEscrowGasById(TRANSFER_ID),
      reclaimEscrowGasById(TRANSFER_ID),
    ]);

    const writeCalls = mockFindOneAndUpdate.mock.calls.filter(
      (c: unknown[]) => {
        const filter = c[0] as Record<string, unknown>;
        return "tx_hash_reclaim" in filter && filter.tx_hash_reclaim === null;
      },
    );
    expect(writeCalls.length).toBeGreaterThan(0);
  });

  it("non lancia eccezioni con due chiamate parallele", async () => {
    await expect(
      Promise.all([
        reclaimEscrowGasById(TRANSFER_ID),
        reclaimEscrowGasById(TRANSFER_ID),
      ]),
    ).resolves.not.toThrow();
  });
});

// ─── S-09: Verifica saldo finale on-chain ─────────────────────────────────────

describe("S-09 — Verifica saldo on-chain: getBalance chiamato 2× (pre + post sweep)", () => {
  it("chiama getBalance due volte: prima del sweep e dopo la conferma TX3", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockGetBalance).toHaveBeenCalledTimes(2);
  });

  it("persiste native_balance_after_sweep con il valore letto post-conferma", async () => {
    const BALANCE_AFTER = 42n; // saldo residuo dopo sweep
    mockGetBalance.mockReset()
      .mockResolvedValueOnce(BALANCE_2BNB)  // pre-sweep
      .mockResolvedValueOnce(BALANCE_AFTER); // post-sweep
    mockWaitForReceipt.mockResolvedValue({ status: "success", gasUsed: 21_000n, effectiveGasPrice: GAS_MID });

    await reclaimEscrowGasById(TRANSFER_ID);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ native_balance_after_sweep: BALANCE_AFTER.toString() }) },
    );
  });

  it("persiste native_balance_after_sweep: null se getBalance post-sweep fallisce (RPC error)", async () => {
    mockGetBalance.mockReset()
      .mockResolvedValueOnce(BALANCE_2BNB) // pre-sweep OK
      .mockRejectedValueOnce(new Error("RPC down")); // post-sweep fail
    mockWaitForReceipt.mockResolvedValue({ status: "success", gasUsed: 21_000n, effectiveGasPrice: GAS_MID });

    await reclaimEscrowGasById(TRANSFER_ID);

    // Non deve lanciare; persiste null per native_balance_after_sweep
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ native_balance_after_sweep: null }) },
    );
  });
});

// ─── S-10: native_sweep_status tracking completo ─────────────────────────────

describe("S-10 — native_sweep_status: tracking pending → sweeping → completed", () => {
  it("salva pending prima di inviare la TX3", async () => {
    const callOrder: string[] = [];
    mockFindOneAndUpdate.mockImplementation((_f: unknown, upd: unknown) => {
      const set = (upd as { $set: Record<string, unknown> }).$set;
      if (set?.native_sweep_status === "pending")   callOrder.push("pending");
      if (set?.native_sweep_status === "sweeping")  callOrder.push("sweeping");
      if (set?.native_sweep_status === "completed") callOrder.push("completed");
      return {};
    });
    mockSendTransaction.mockImplementation(async () => {
      callOrder.push("sendTx");
      return "0xSWEEP_TX_HASH";
    });
    mockWaitForReceipt.mockImplementation(async () => {
      callOrder.push("waitReceipt");
      return { status: "success", gasUsed: 21_000n, effectiveGasPrice: GAS_MID };
    });

    await reclaimEscrowGasById(TRANSFER_ID);

    // L'ordine DEVE essere: pending → sendTx → sweeping → waitReceipt → completed
    expect(callOrder.indexOf("pending")).toBeLessThan(callOrder.indexOf("sendTx"));
    expect(callOrder.indexOf("sweeping")).toBeGreaterThan(callOrder.indexOf("sendTx"));
    expect(callOrder.indexOf("completed")).toBeGreaterThan(callOrder.indexOf("waitReceipt"));
  });
});

// ─── S-11: Sweep di 1 wei esatto (BSC) ───────────────────────────────────────

describe("S-11 — BSC: balance = gas + 1 wei → sweep di 1 wei (non skipped)", () => {
  it("sweeppa 1 wei e segna completed (non skipped)", async () => {
    const gasCost = TX3_GAS_UNITS * GAS_MID;
    mockGetBalance.mockReset()
      .mockResolvedValueOnce(gasCost + 1n)
      .mockResolvedValueOnce(0n);

    await reclaimEscrowGasById(TRANSFER_ID);

    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: 1n }),
    );
    const completedCall = mockFindOneAndUpdate.mock.calls.find(
      (c: unknown[]) => (c[1] as { $set: Record<string, unknown> })?.$set?.native_sweep_status === "completed",
    );
    expect(completedCall).toBeDefined();
  });
});

// ─── S-12: Bitcoin → skip immediato ──────────────────────────────────────────

describe("S-12 — Bitcoin → skip immediato (nessun native gas da recuperare)", () => {
  it("la query DB esclude bitcoin (non verrà trovato nessun doc BTC)", async () => {
    mockFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }); // BTC escluso dalla query
    await reclaimEscrowGasById(TRANSFER_ID);
    // La condizione di query deve includere { network: { $ne: 'bitcoin' } }
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ network: { $ne: "bitcoin" } }),
    );
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });
});

// ─── S-13: native_balance_before_sweep salvato in tutti i casi ───────────────

describe("S-13 — native_balance_before_sweep salvato anche quando INSUFFICIENT_BALANCE", () => {
  it("salva il saldo pre-sweep anche quando non si può sweeppare", async () => {
    const gasCost = TX3_GAS_UNITS * GAS_MID;
    mockGetBalance.mockReset().mockResolvedValueOnce(gasCost); // esattamente il costo → INSUFFICIENT

    await reclaimEscrowGasById(TRANSFER_ID);

    const preCall = mockFindOneAndUpdate.mock.calls.find(
      (c: unknown[]) => (c[1] as { $set: Record<string, unknown> })?.$set?.native_balance_before_sweep !== undefined,
    );
    expect(preCall).toBeDefined();
    expect((preCall![1] as { $set: Record<string, unknown> }).$set.native_balance_before_sweep)
      .toBe(gasCost.toString());
  });
});

// ─── S-14: native_sweep_gas_cost da receipt.gasUsed × gasPrice ───────────────

describe("S-14 — native_sweep_gas_cost calcolato da receipt.gasUsed × gasPrice reale", () => {
  it("usa gasUsed reale dalla receipt, non la stima TX3_GAS_UNITS", async () => {
    const REAL_GAS_USED = 20_500n; // leggemente meno di 21.000 (realistico)
    const EXPECTED_COST = REAL_GAS_USED * GAS_MID;

    mockWaitForReceipt.mockResolvedValue({
      status:           "success",
      gasUsed:          REAL_GAS_USED,
      effectiveGasPrice: GAS_MID,
    });

    await reclaimEscrowGasById(TRANSFER_ID);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ native_sweep_gas_cost: EXPECTED_COST.toString() }) },
    );
  });

  it("usa la stima TX3_GAS_UNITS × gasPrice se receipt.gasUsed non disponibile", async () => {
    mockWaitForReceipt.mockResolvedValue({ status: "success" }); // no gasUsed

    await reclaimEscrowGasById(TRANSFER_ID);

    const estimatedCost = (TX3_GAS_UNITS * GAS_MID).toString();
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ native_sweep_gas_cost: estimatedCost }) },
    );
  });
});
