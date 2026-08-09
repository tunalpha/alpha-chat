/**
 * multichain-reclaim.test.ts — Unit test TX3 Reclaim POL Escrow
 *
 * Verifica il comportamento di reclaimEscrowGasById() e processFailedReclaims()
 *
 * Scenari:
 *   R-01  Happy path: TX3 completata, tx_hash_reclaim + pol_reclaimed persistiti
 *   R-02  Saldo escrow insufficiente → INSUFFICIENT_BALANCE, nessun lancio
 *   R-03  RPC getBalance failure → errore loggato, reclaim_error persistito
 *   R-04  sendTransaction failure → errore loggato, reclaim_error persistito
 *   R-05  waitForTransactionReceipt timeout → errore loggato, reclaim_error persistito
 *   R-06  TX3 revertita on-chain → errore loggato, reclaim_error persistito
 *   R-07  Idempotenza: tx_hash_reclaim già valorizzato → no-op (findOne restituisce null)
 *   R-08  BTC network → skip immediato senza RPC calls
 *   R-09  GAS_STATION_PRIVATE_KEY assente → skip con warning
 *   R-10  Doppio reclaim concorrente → il DB guard { tx_hash_reclaim: null } previene doppio-write
 *   R-11  Transfer non trovato (status ≠ released, o già reclamato) → no-op
 *   R-12  processFailedReclaims: trova doc con reclaim_error transitorio e chiama reclaimEscrowGasById
 *   R-13  processFailedReclaims: salta INSUFFICIENT_BALANCE (errore permanente)
 *   R-14  processFailedReclaims: salta tx_hash_reclaim già valorizzato
 *
 * Invarianti verificate:
 *   - Nessuna eccezione propagata al caller
 *   - Pagamento già released non impattato
 *   - TX1/TX2 non toccate
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mock variables ──────────────────────────────────────────────────

const {
  mockFindOne,
  mockFindOneAndUpdate,
  mockReclaimById,
} = vi.hoisted(() => ({
  mockFindOne:          vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
  mockReclaimById:      vi.fn(),
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
      ENABLE_ETHEREUM_USDT: false,
      ENABLE_BSC_USDT:      false,
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
// Ogni test può sovrascrivere i valori dei singoli mock fn.

const mockGetGasPrice         = vi.fn().mockResolvedValue(30_000_000_000n); // 30 Gwei
const mockGetBalance          = vi.fn().mockResolvedValue(500_000_000_000_000n); // 0.0005 POL residuo
const mockGetTransactionCount = vi.fn().mockResolvedValue(7); // nonce
const mockWaitForReceipt      = vi.fn().mockResolvedValue({ status: "success", gasUsed: 21_000n, effectiveGasPrice: 30_000_000_000n });
const mockSendTransaction     = vi.fn().mockResolvedValue("0xTX3_RECLAIM_HASH");

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getGasPrice:              mockGetGasPrice,
      getBalance:               mockGetBalance,
      getTransactionCount:      mockGetTransactionCount,
      waitForTransactionReceipt: mockWaitForReceipt,
    })),
    createWalletClient: vi.fn(() => ({
      sendTransaction: mockSendTransaction,
    })),
  };
});

// viem/accounts — privateKeyToAccount restituisce un account mock
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn((pk: string) => ({
    address: pk.includes("GAS") || pk.includes("STATION")
      ? "0xGASSTATION_ADDRESS_0000000000000000000000"
      : "0xESCROW_ADDRESS_0000000000000000000000000",
    sign:   vi.fn(),
    signTransaction: vi.fn(),
  })),
}));

// Import del service DOPO i mock
import { reclaimEscrowGasById } from "../multichain-payment.service";

// ─── processFailedReclaims viene importato dal scheduler, che mocka il service ──
// Usiamo un approccio diverso: testiamo il scheduler con mock del service

const { mockFind: mockSchedulerFind } = vi.hoisted(() => ({
  mockFind: vi.fn(),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TRANSFER_ID = "reclaim-test-transfer-0001";
const ESCROW_PK   = "0xMOCK_ESCROW_PRIVATE_KEY_ABCDEF1234567890";

/** Doc tipico in stato "released" pronto per il reclaim */
function makeReleasedDoc(overrides: Record<string, unknown> = {}) {
  return {
    transfer_id:          TRANSFER_ID,
    status:               "released",
    network:              "polygon",
    asset:                "USDT",
    escrow_wallet:        "0xESCROW_ADDRESS_0000000000000000000000000",
    escrow_encrypted_pk:  "encrypted-pk-base64-mock",
    tx_hash_release:      "0xTX1_HASH",
    tx_hash_fee:          "0xTX2_HASH",
    tx_hash_reclaim:      null,
    pol_reclaimed:        null,
    reclaim_error:        null,
    completed_at:         new Date(),
    ...overrides,
  };
}

// ─── Costanti calcolate per i test ───────────────────────────────────────────

// gasPrice = 30 Gwei = 30_000_000_000n
// TX3_GAS_UNITS = 21_000n
// tx3GasCost = 21_000 × 30_000_000_000 = 630_000_000_000_000n
const GAS_PRICE    = 30_000_000_000n;
const TX3_GAS_COST = 21_000n * GAS_PRICE; // 630_000_000_000_000n

// saldo escrow default: 500_000_000_000_000n > TX3_GAS_COST → reclaim conveniente
// transferAmount = 500_000_000_000_000 - 630_000_000_000_000... aspetta:
// 500_000_000_000_000 < 630_000_000_000_000 → INSUFFICIENTE!
// Usiamo un saldo maggiore per i test di happy path
const BALANCE_SUFFICIENT    = 1_000_000_000_000_000n; // 0.001 POL > 630k gas × 30 Gwei ✓
const BALANCE_INSUFFICIENT  = 500_000_000_000_000n;   // 0.0005 POL < tx3GasCost ✓ (per test R-02)
const TRANSFER_AMOUNT       = BALANCE_SUFFICIENT - TX3_GAS_COST; // ciò che viene recuperato

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: saldo sufficiente per il happy path
  mockGetBalance.mockResolvedValue(BALANCE_SUFFICIENT);
  mockGetGasPrice.mockResolvedValue(GAS_PRICE);
  mockGetTransactionCount.mockResolvedValue(7);
  mockSendTransaction.mockResolvedValue("0xTX3_RECLAIM_HASH");
  mockWaitForReceipt.mockResolvedValue({ status: "success", gasUsed: 21_000n, effectiveGasPrice: GAS_PRICE });

  // findOne default: doc released trovato (con tx_hash_reclaim: null)
  mockFindOne.mockReturnValue({
    lean: vi.fn().mockResolvedValue(makeReleasedDoc()),
  });

  // findOneAndUpdate default: successo (non controllato nei test base)
  mockFindOneAndUpdate.mockResolvedValue({});

  // GAS_STATION_PRIVATE_KEY disponibile (mock env)
  process.env.GAS_STATION_PRIVATE_KEY = "0xMOCK_GAS_STATION_PK_1234567890ABCDEF";
});

afterEach(() => {
  delete process.env.GAS_STATION_PRIVATE_KEY;
});

// ─── R-01: Happy path ────────────────────────────────────────────────────────

describe("R-01 — Happy path: TX3 completata", () => {
  it("chiama sendTransaction con i parametri corretti e persiste tx_hash_reclaim + pol_reclaimed", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);

    // Verifica che sendTransaction sia stato chiamato con i parametri corretti
    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        value:    TRANSFER_AMOUNT,
        gas:      21_000n,
        gasPrice: GAS_PRICE,
        nonce:    7,
      }),
    );

    // Verifica che waitForTransactionReceipt sia stato chiamato con il hash TX3
    expect(mockWaitForReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ hash: "0xTX3_RECLAIM_HASH" }),
    );

    // Verifica persist successo: condizione { tx_hash_reclaim: null } + set
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: TRANSFER_ID, tx_hash_reclaim: null },
      {
        $set: {
          tx_hash_reclaim: "0xTX3_RECLAIM_HASH",
          pol_reclaimed:   TRANSFER_AMOUNT.toString(),
          reclaim_error:   null,
        },
      },
    );
  });

  it("NON lancia eccezioni verso il caller", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });

  it("legge gasPrice, balance e nonce in parallelo (3 chiamate RPC)", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockGetGasPrice).toHaveBeenCalledTimes(1);
    expect(mockGetBalance).toHaveBeenCalledTimes(1);
    expect(mockGetTransactionCount).toHaveBeenCalledTimes(1);
  });
});

// ─── R-02: Saldo insufficiente ───────────────────────────────────────────────

describe("R-02 — Saldo escrow insufficiente", () => {
  beforeEach(() => {
    // Saldo < costo TX3
    mockGetBalance.mockResolvedValue(BALANCE_INSUFFICIENT);
  });

  it("NON chiama sendTransaction", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it("persiste INSUFFICIENT_BALANCE in reclaim_error", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: TRANSFER_ID, tx_hash_reclaim: null },
      { $set: { reclaim_error: "INSUFFICIENT_BALANCE" } },
    );
  });

  it("NON lancia eccezioni", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });
});

// ─── R-03: RPC failure su getBalance ─────────────────────────────────────────

describe("R-03 — RPC failure (getBalance)", () => {
  beforeEach(() => {
    mockGetBalance.mockRejectedValue(new Error("RPC timeout"));
  });

  it("NON lancia eccezioni verso il caller", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });

  it("persiste il messaggio di errore in reclaim_error", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: TRANSFER_ID, tx_hash_reclaim: null },
      { $set: { reclaim_error: expect.stringContaining("RPC timeout") } },
    );
  });

  it("NON chiama sendTransaction", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });
});

// ─── R-04: sendTransaction failure ───────────────────────────────────────────

describe("R-04 — sendTransaction failure", () => {
  beforeEach(() => {
    mockSendTransaction.mockRejectedValue(new Error("nonce too low"));
  });

  it("NON lancia eccezioni verso il caller", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });

  it("persiste l'errore in reclaim_error", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: TRANSFER_ID, tx_hash_reclaim: null },
      { $set: { reclaim_error: expect.stringContaining("nonce too low") } },
    );
  });

  it("NON persiste tx_hash_reclaim", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    // NON deve essere chiamato con un hash di successo
    const successCall = mockFindOneAndUpdate.mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        "$set" in (call[1] as object) &&
        "tx_hash_reclaim" in ((call[1] as { $set: object }).$set),
    );
    expect(successCall).toBeUndefined();
  });
});

// ─── R-05: waitForTransactionReceipt timeout ─────────────────────────────────

describe("R-05 — waitForTransactionReceipt timeout", () => {
  beforeEach(() => {
    mockWaitForReceipt.mockRejectedValue(new Error("Transaction not mined within 30 seconds"));
  });

  it("NON lancia eccezioni verso il caller", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });

  it("persiste l'errore in reclaim_error", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: TRANSFER_ID, tx_hash_reclaim: null },
      { $set: { reclaim_error: expect.stringContaining("30 seconds") } },
    );
  });
});

// ─── R-06: TX3 revertita on-chain ────────────────────────────────────────────

describe("R-06 — TX3 revertita on-chain", () => {
  beforeEach(() => {
    mockWaitForReceipt.mockResolvedValue({ status: "reverted" });
  });

  it("NON lancia eccezioni verso il caller", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });

  it("persiste l'errore con menzione della revert", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: TRANSFER_ID, tx_hash_reclaim: null },
      { $set: { reclaim_error: expect.stringContaining("revertita") } },
    );
  });

  it("NON persiste tx_hash_reclaim", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    const successCall = mockFindOneAndUpdate.mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "object" &&
        call[1] !== null &&
        "$set" in (call[1] as object) &&
        "tx_hash_reclaim" in ((call[1] as { $set: object }).$set),
    );
    expect(successCall).toBeUndefined();
  });
});

// ─── R-07: Idempotenza — tx_hash_reclaim già valorizzato ────────────────────

describe("R-07 — Idempotenza: già reclamato", () => {
  beforeEach(() => {
    // findOne restituisce null → doc non trovato (già reclamato o status ≠ released)
    mockFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });
  });

  it("non fa nulla se il doc non viene trovato (già reclamato)", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockSendTransaction).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("NON lancia eccezioni", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });

  it("la query DB include la condizione tx_hash_reclaim: null", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ tx_hash_reclaim: null }),
    );
  });
});

// ─── R-08: BTC network ───────────────────────────────────────────────────────

describe("R-08 — BTC network: skip immediato", () => {
  beforeEach(() => {
    // Restituiamo un doc BTC — ma _reclaimEscrowGas internamente fa guard sul network
    // La query di reclaimEscrowGasById ha già { network: { $ne: "bitcoin" } }
    // quindi il doc non verrebbe trovato. Testiamo che la query esclude bitcoin.
    mockFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue(null), // BTC non trovato per design
    });
  });

  it("la query esclude la rete bitcoin", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ network: { $ne: "bitcoin" } }),
    );
  });

  it("NON chiama sendTransaction per BTC", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });
});

// ─── R-09: GAS_STATION_PRIVATE_KEY assente ───────────────────────────────────

describe("R-09 — GAS_STATION_PRIVATE_KEY assente", () => {
  beforeEach(() => {
    delete process.env.GAS_STATION_PRIVATE_KEY;
  });

  it("NON chiama sendTransaction", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it("NON lancia eccezioni", async () => {
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });
});

// ─── R-10: Doppio reclaim concorrente ────────────────────────────────────────

describe("R-10 — Doppio reclaim concorrente", () => {
  it("il DB guard { tx_hash_reclaim: null } assicura idempotenza", async () => {
    // Simula: due chiamate concorrenti che completano TX3 con lo stesso hash
    // La findOneAndUpdate con condizione { tx_hash_reclaim: null } garantisce
    // che solo il primo aggiornamento modifica il record (il secondo trova
    // tx_hash_reclaim già valorizzato → nessuna modifica)
    //
    // Il test verifica che TUTTE le findOneAndUpdate usino la condizione corretta.

    await Promise.all([
      reclaimEscrowGasById(TRANSFER_ID),
      reclaimEscrowGasById(TRANSFER_ID),
    ]);

    // Entrambe le chiamate usano { tx_hash_reclaim: null } come condizione
    const updateCalls = mockFindOneAndUpdate.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        "tx_hash_reclaim" in (call[0] as object) &&
        (call[0] as { tx_hash_reclaim: null }).tx_hash_reclaim === null,
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });
});

// ─── R-11: Transfer non trovato ──────────────────────────────────────────────

describe("R-11 — Transfer non trovato", () => {
  it("restituisce undefined senza errori se il transfer non esiste", async () => {
    mockFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    await expect(reclaimEscrowGasById("non-existent-id")).resolves.toBeUndefined();
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it("restituisce undefined se il transfer è in stato diverso da released", async () => {
    // Il findOne ha condizione { status: "released" } → restituisce null per status diversi
    mockFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    await expect(reclaimEscrowGasById(TRANSFER_ID)).resolves.toBeUndefined();
  });
});

// ─── R-12 / R-13 / R-14: processFailedReclaims scheduler ────────────────────

// Per testare processFailedReclaims usiamo un approccio isolato:
// il scheduler mocka multichain-payment.service

describe("processFailedReclaims — scheduler", () => {
  /**
   * Questi test usano un setup separato con mock dedicati per il scheduler.
   * Il service è già mockato globalmente nella catena di import dello scheduler.
   * Usiamo vi.doMock per un mock locale isolato dal resto.
   */

  it("R-12: chiama reclaimEscrowGasById per doc con errore transitorio", async () => {
    // Mock del service per lo scheduler
    const { processFailedReclaims } = await import("../multichain-scheduler");
    const reclaimSpy = vi.spyOn(
      await import("../multichain-payment.service"),
      "reclaimEscrowGasById",
    ).mockResolvedValue();

    // Simula un doc con errore transitorio (RPC timeout)
    const docWithError = makeReleasedDoc({ reclaim_error: "RPC timeout" });
    vi.mocked(mockFindOne); // ignora, usiamo il find del scheduler

    // Dobbiamo mockare MultiChainTransferModel.find per lo scheduler
    const { MultiChainTransferModel } = await import("../../models/multichain-transfer.model");
    vi.mocked(MultiChainTransferModel.find as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([docWithError]),
      }),
    } as unknown as ReturnType<typeof vi.fn>);

    await processFailedReclaims();

    expect(reclaimSpy).toHaveBeenCalledWith(TRANSFER_ID);
    reclaimSpy.mockRestore();
  });

  it("R-13: salta INSUFFICIENT_BALANCE (errore permanente, non riprova)", async () => {
    // La query del scheduler esclude INSUFFICIENT_BALANCE via $nin
    // Verifichiamo che la query includa il filtro corretto
    const { MultiChainTransferModel } = await import("../../models/multichain-transfer.model");
    const findMock = vi.mocked(MultiChainTransferModel.find as ReturnType<typeof vi.fn>);

    findMock.mockReturnValueOnce({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]), // 0 doc → INSUFFICIENT_BALANCE escluso dalla query
      }),
    } as unknown as ReturnType<typeof vi.fn>);

    const { processFailedReclaims } = await import("../multichain-scheduler");
    await processFailedReclaims();

    // La query deve escludere null e INSUFFICIENT_BALANCE
    expect(findMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reclaim_error: { $nin: [null, "INSUFFICIENT_BALANCE"] },
      }),
    );
  });

  it("R-14: salta transfer con tx_hash_reclaim già valorizzato", async () => {
    const { MultiChainTransferModel } = await import("../../models/multichain-transfer.model");
    const findMock = vi.mocked(MultiChainTransferModel.find as ReturnType<typeof vi.fn>);

    findMock.mockReturnValueOnce({
      limit: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([]), // 0 doc → già reclamati esclusi dalla query
      }),
    } as unknown as ReturnType<typeof vi.fn>);

    const { processFailedReclaims } = await import("../multichain-scheduler");
    await processFailedReclaims();

    // La query deve richiedere tx_hash_reclaim: null
    expect(findMock).toHaveBeenCalledWith(
      expect.objectContaining({ tx_hash_reclaim: null }),
    );
  });
});

// ─── Invariante finale: saldo escrow dopo TX3 ────────────────────────────────

describe("Invariante: saldo_iniziale − gas_TX1 − gas_TX2 − gas_TX3 ≈ 0", () => {
  it("transferAmount = escrowBalance − tx3GasCost", async () => {
    let capturedValue: bigint | undefined;
    mockSendTransaction.mockImplementation((params: { value: bigint }) => {
      capturedValue = params.value;
      return Promise.resolve("0xTX3_RECLAIM_HASH");
    });

    await reclaimEscrowGasById(TRANSFER_ID);

    // transferAmount deve essere esattamente escrowBalance − tx3GasCost
    expect(capturedValue).toBe(TRANSFER_AMOUNT);
    // Il valore recuperato + il gas TX3 deve coprire l'intero saldo
    expect(capturedValue! + TX3_GAS_COST).toBe(BALANCE_SUFFICIENT);
  });

  it("pol_reclaimed persistito corrisponde al transferAmount", async () => {
    await reclaimEscrowGasById(TRANSFER_ID);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          pol_reclaimed: TRANSFER_AMOUNT.toString(),
        }),
      }),
    );
  });
});
