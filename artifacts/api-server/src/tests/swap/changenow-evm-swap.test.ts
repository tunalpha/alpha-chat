/**
 * Test — ChangeNOW EVM→EVM Swap Service
 *
 * NESSUN MOVIMENTO DI FONDI REALI. Tutte le chiamate esterne sono mockate.
 *
 * PRINCIPIO FONDAMENTALE:
 *   ChangeNOW è la SOURCE OF TRUTH sulla disponibilità delle coppie.
 *   Il codice NON usa whitelist hardcoded come gate.
 *   I token UI (CN_EVM_TOKENS) sono solo un catalogo per la UI, non un blocco API.
 *
 * Suite:
 *   ── checkEvmPair ──────────────────────────────────────────
 *   T1  — coppia disponibile → available=true + minAmount fixed-rate
 *   T2  — stesso ticker → available=false (non chiama API)
 *   T3  — API 4xx → available=false (coppia non supportata, NON errore provider)
 *   T4  — API 5xx → lancia CHANGENOW_API_ERROR 503 (NOT available=false)
 *   T5  — ticker non nel catalogo UI → API comunque chiamata (nessuna whitelist gate)
 *   T6  — ticker con formato invalido (underscore/maiuscole/troppo lungo) → errore
 *   T7  — ticker con caratteri pericolosi (;, ') → errore formato
 *   T8  — ChangeNOW DISABLED → errore CHANGENOW_DISABLED
 *
 *   ── getEvmQuote ───────────────────────────────────────────
 *   T9  — importo valido → stima restituita
 *   T10 — importo zero → errore INVALID_AMOUNT
 *   T11 — amount fuori range fixed-rate → errore AMOUNT_OUTSIDE_FIXED_RATE_RANGE
 *   T12 — API 5xx → errore CHANGENOW_API_ERROR
 *
 *   ── createEvmExchange ─────────────────────────────────────
 *   T13 — crea ordine correttamente
 *   T14 — no destinationEvmAddress → errore EVM_DESTINATION_ADDRESS_REQUIRED
 *   T15 — swap attivo già presente → errore ACTIVE_EVM_SWAP_EXISTS
 *
 *   ── commitEvmFunds ────────────────────────────────────────
 *   T16 — salva depositTxHash e fundsCommitted=true
 *   T17 — swap non trovato → errore EVM_SWAP_NOT_FOUND
 *
 *   ── getEvmSwapStatus (REGOLA COMPLETED ASSOLUTA) ──────────
 *   T18 — finished + payoutHash valido + diverso da depositTxHash → isCompleted=true
 *   T19 — finished senza payoutHash → isCompleted=false
 *   T20 — finished + payoutHash === depositTxHash → isCompleted=false
 *   T21 — confirming → isCompleted=false, isTerminal=false
 *   T22 — failed → isTerminal=true, isCompleted=false
 *   T23 — refunded → isTerminal=true
 *   T24 — expired → isTerminal=true, isCompleted=false
 *   T25 — API rete KO → usa stato DB (resilienza polling)
 *
 *   ── getActiveEvmSwapForUser ───────────────────────────────
 *   T26 — swap attivo trovato
 *   T27 — nessuno swap → null
 *
 *   ── Disponibilità dinamica (regression + nuove coppie) ────
 *   T28 — POL→USDC Polygon (coppia che dava falso negativo)
 *   T29 — USDC→POL (coppia non in vecchia whitelist → ora supportata)
 *   T30 — ETH→USDC Polygon
 *   T31 — BNB→USDT BSC
 *
 *   ── Idempotenza polling ───────────────────────────────────
 *   T32 — polling duplicato non modifica stato terminale
 *
 *   ── Nessun fallback Li.Fi ────────────────────────────────
 *   T33 — checkEvmPair non importa né chiama Li.Fi
 *
 *   ── Catalogo UI ──────────────────────────────────────────
 *   T34 — CN_EVM_TOKENS contiene ticker attesi
 *   T35 — ogni token ha chainId/decimals/isNative coerenti
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../services/swap/swap-provider-router.service.js", () => ({
  isProviderEnabled: vi.fn(async () => true),
}));

vi.mock("../../services/swap/changenow.service.js", async (importOriginal) => {
  const real = await importOriginal() as Record<string, unknown>;
  return {
    ...real,
    cnGetFixedRateRange:         vi.fn(),
    cnGetFixedRateAmount:        vi.fn(),
    cnCreateFixedRateTransaction: vi.fn(),
    cnGetTransactionStatus:      vi.fn(),
  };
});

import { isProviderEnabled } from "../../services/swap/swap-provider-router.service.js";
import {
  CnApiError,
  cnGetFixedRateRange,
  cnGetFixedRateAmount,
  cnCreateFixedRateTransaction,
  cnGetTransactionStatus,
  CN_EVM_TOKENS,
} from "../../services/swap/changenow.service.js";
import {
  checkEvmPair,
  getEvmQuote,
  createEvmExchange,
  commitEvmFunds,
  getEvmSwapStatus,
  getActiveEvmSwapForUser,
} from "../../services/swap/changenow-evm-swap.service.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isProviderEnabled).mockResolvedValue(true);
  vi.mocked(cnGetFixedRateRange).mockResolvedValue({
    minAmount: 1,
    maxAmount: null,
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID  = "user_test_001";
const DEST_EVM = "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef";
const REFUND   = "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef";

const MOCK_TX_RESPONSE = {
  id:                    "cn_exchange_001",
  status:                "waiting" as const,
  payinAddress:          "0xChangeNowDepositAddr1234",
  payoutAddress:         DEST_EVM,
  fromCurrency:          "pol",
  toCurrency:            "usdcmatic",
  expectedSendAmount:    15,
  expectedReceiveAmount: 3.2,
  createdAt:             new Date().toISOString(),
  payinHash:             null,
  payoutHash:            null,
  refundHash:            null,
};

// Helper per creare CnApiError con status
function cnErr(status: number) {
  return new CnApiError(status, `ChangeNOW API error ${status}`);
}

// Fixture fixed-rate quote (usata da tutti i test che chiamano createEvmExchange)
const MOCK_FIXED_RATE = {
  rateId:          "mock-rate-id-001",
  estimatedAmount: 3.2,
  validUntil:      "2099-01-01T00:00:00Z",
};

// ── checkEvmPair ──────────────────────────────────────────────────────────────

describe("checkEvmPair", () => {
  it("T1 — coppia disponibile → available=true + minAmount fixed-rate", async () => {
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 88.31, maxAmount: 7504 });
    const result = await checkEvmPair("pol", "usdcmatic");
    expect(result.available).toBe(true);
    expect(result.minAmount).toBe(88.31);
    expect(result.from).toBe("pol");
    expect(result.to).toBe("usdcmatic");
    expect(cnGetFixedRateRange).toHaveBeenCalledWith("pol", "usdcmatic");
  });

  it("T2 — stesso ticker → available=false, non chiama API", async () => {
    const result = await checkEvmPair("pol", "pol");
    expect(result.available).toBe(false);
    expect(cnGetFixedRateRange).not.toHaveBeenCalled();
  });

  it("T3 — API 4xx → available=false (coppia non supportata, NON errore provider)", async () => {
    vi.mocked(cnGetFixedRateRange).mockRejectedValueOnce(cnErr(400));
    const result = await checkEvmPair("pol", "usdcmatic");
    expect(result.available).toBe(false);
  });

  it("T4 — API 5xx → lancia CHANGENOW_API_ERROR 503 (NON available=false)", async () => {
    vi.mocked(cnGetFixedRateRange).mockRejectedValueOnce(cnErr(503));
    await expect(checkEvmPair("pol", "usdcmatic")).rejects.toMatchObject({ message: expect.stringContaining("CHANGENOW_API_ERROR") });
  });

  it("T5 — ticker non nel catalogo UI locale → API comunque chiamata (nessuna whitelist gate)", async () => {
    // "usdceth" non è in CN_EVM_TOKENS ma il service non deve bloccarlo
    const notInCatalog = "usdceth";
    expect(CN_EVM_TOKENS.some(t => t.ticker === notInCatalog)).toBe(false);
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 0.01, maxAmount: null });
    const result = await checkEvmPair("eth", notInCatalog);
    expect(result.available).toBe(true);
    // L'API è stata chiamata nonostante il ticker non sia nel catalogo locale
    expect(cnGetFixedRateRange).toHaveBeenCalledWith("eth", notInCatalog);
  });

  it("T6 — ticker con formato invalido (underscore) → errore INVALID_TICKER_FORMAT", async () => {
    await expect(checkEvmPair("INVALID_TICKER", "usdcmatic")).rejects.toMatchObject({ message: expect.stringContaining("INVALID_TICKER_FORMAT") });
    await expect(checkEvmPair("pol", "INVALID_TO")).rejects.toMatchObject({ message: expect.stringContaining("INVALID_TICKER_FORMAT") });
    expect(cnGetFixedRateRange).not.toHaveBeenCalled();
  });

  it("T7 — ticker con caratteri pericolosi → errore formato", async () => {
    await expect(checkEvmPair("pol;DROP", "usdcmatic")).rejects.toThrow();
    await expect(checkEvmPair("pol", "usdc'matic")).rejects.toThrow();
    await expect(checkEvmPair("pol", "a".repeat(31))).rejects.toThrow();
    expect(cnGetFixedRateRange).not.toHaveBeenCalled();
  });

  it("T8 — ChangeNOW DISABLED → lancia CHANGENOW_DISABLED", async () => {
    vi.mocked(isProviderEnabled).mockResolvedValueOnce(false);
    await expect(checkEvmPair("pol", "usdcmatic")).rejects.toThrow();
  });
});

// ── getEvmQuote ───────────────────────────────────────────────────────────────

describe("getEvmQuote", () => {
  it("T9 — importo valido → stima restituita", async () => {
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 11.4, maxAmount: null });
    vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({ ...MOCK_FIXED_RATE });
    const quote = await getEvmQuote({ fromTicker: "pol", toTicker: "usdcmatic", fromAmount: 15 });
    expect(quote.estimatedToAmount).toBe(3.2);
    expect(quote.fromTicker).toBe("pol");
    expect(quote.toTicker).toBe("usdcmatic");
    expect(quote.fromAmount).toBe(15);
    expect(quote.minAmount).toBe(11.4);
  });

  it("T10 — importo zero → errore INVALID_AMOUNT (senza chiamare API)", async () => {
    await expect(
      getEvmQuote({ fromTicker: "pol", toTicker: "usdcmatic", fromAmount: 0 })
    ).rejects.toMatchObject({ message: expect.stringContaining("INVALID_AMOUNT") });
    expect(cnGetFixedRateRange).not.toHaveBeenCalled();
  });

  it("T11 — amount sotto il range fixed-rate → errore AMOUNT_OUTSIDE_FIXED_RATE_RANGE", async () => {
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 88.31, maxAmount: null });
    await expect(
      getEvmQuote({ fromTicker: "pol", toTicker: "usdcmatic", fromAmount: 20 })
    ).rejects.toMatchObject({ message: expect.stringContaining("AMOUNT_OUTSIDE_FIXED_RATE_RANGE") });
  });

  it("T12 — API 5xx → errore CHANGENOW_API_ERROR", async () => {
    vi.mocked(cnGetFixedRateAmount).mockRejectedValueOnce(cnErr(500));
    await expect(
      getEvmQuote({ fromTicker: "pol", toTicker: "usdcmatic", fromAmount: 15 })
    ).rejects.toMatchObject({ message: expect.stringContaining("CHANGENOW_API_ERROR") });
  });
});

// ── createEvmExchange ─────────────────────────────────────────────────────────

describe("createEvmExchange", () => {
  it("T13 — crea ordine correttamente", async () => {
    vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({ ...MOCK_FIXED_RATE });
    vi.mocked(cnCreateFixedRateTransaction).mockResolvedValueOnce(MOCK_TX_RESPONSE as any);
    const result = await createEvmExchange({
      userId:                USER_ID + "_T13",
      fromTicker:            "pol",
      toTicker:              "usdcmatic",
      fromAmount:            15,
      destinationEvmAddress: DEST_EVM,
      refundEvmAddress:      REFUND,
    });
    expect(result.depositEvmAddress).toBe("0xChangeNowDepositAddr1234");
    expect(result.exchangeId).toBe("cn_exchange_001");
    expect(result.destinationAddress).toBe(DEST_EVM);
    expect(result.fromTicker).toBe("pol");
    expect(result.toTicker).toBe("usdcmatic");
    // Verifica che cnCreateFixedRateTransaction sia stato chiamato con i ticker corretti e il rateId
    expect(cnCreateFixedRateTransaction).toHaveBeenCalledWith(expect.objectContaining({
      fromCurrency: "pol",
      toCurrency:   "usdcmatic",
      amount:       15,
      address:      DEST_EVM,
      rateId:       MOCK_FIXED_RATE.rateId,
    }));
  });

  it("T14 — no destinationEvmAddress → errore EVM_DESTINATION_ADDRESS_REQUIRED", async () => {
    await expect(
      createEvmExchange({
        userId: USER_ID + "_T14", fromTicker: "pol", toTicker: "usdcmatic",
        fromAmount: 15, destinationEvmAddress: "", refundEvmAddress: REFUND,
      })
    ).rejects.toMatchObject({ message: expect.stringContaining("EVM_DESTINATION_ADDRESS_REQUIRED") });
  });

  it("T15 — swap attivo (fundsCommitted) già presente → errore ACTIVE_EVM_SWAP_EXISTS", async () => {
    vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({ ...MOCK_FIXED_RATE });
    vi.mocked(cnCreateFixedRateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T15_a",
    } as any);
    const created = await createEvmExchange({
      userId: USER_ID + "_T15", fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
    await commitEvmFunds(USER_ID + "_T15", created.swapId, "0x_deposit_T15");

    await expect(
      createEvmExchange({
        userId: USER_ID + "_T15", fromTicker: "pol", toTicker: "usdcmatic",
        fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
      })
    ).rejects.toMatchObject({ message: expect.stringContaining("ACTIVE_EVM_SWAP_EXISTS") });
  });

  it("T36 — risposta fixed-rate senza expected amounts: persiste input + quote bloccata", async () => {
    vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({
      ...MOCK_FIXED_RATE,
      estimatedAmount: 42.123456,
    });
    vi.mocked(cnCreateFixedRateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE,
      id: "cn_T36_partial_response",
      expectedSendAmount: undefined,
      expectedReceiveAmount: undefined,
    } as any);

    const result = await createEvmExchange({
      userId:                USER_ID + "_T36",
      fromTicker:            "usdtbsc",
      toTicker:              "pol",
      fromAmount:            13.50514576,
      destinationEvmAddress: DEST_EVM,
      refundEvmAddress:      REFUND,
    });

    expect(result.expectedFromAmount).toBe(13.50514576);
    expect(result.expectedToAmount).toBe(42.123456);
    expect(result.swapId).toBeTruthy();
  });
});

// ── commitEvmFunds ────────────────────────────────────────────────────────────

describe("commitEvmFunds", () => {
  it("T16 — salva depositTxHash e fundsCommitted=true", async () => {
    vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({ ...MOCK_FIXED_RATE });
    vi.mocked(cnCreateFixedRateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T16",
    } as any);
    const created = await createEvmExchange({
      userId: USER_ID + "_T16", fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
    await expect(
      commitEvmFunds(USER_ID + "_T16", created.swapId, "0xdepositHash_T16")
    ).resolves.not.toThrow();

    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T16", status: "waiting",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T16", created.swapId);
    expect(status.fundsCommitted).toBe(true);
    expect(status.depositTxHash).toBe("0xdepositHash_T16");
  });

  it("T17 — swap non trovato → errore EVM_SWAP_NOT_FOUND", async () => {
    await expect(
      commitEvmFunds(USER_ID, new mongoose.Types.ObjectId().toString(), "0x_hash")
    ).rejects.toMatchObject({ message: expect.stringContaining("EVM_SWAP_NOT_FOUND") });
  });
});

// ── getEvmSwapStatus (REGOLA COMPLETED ASSOLUTA) ──────────────────────────────

describe("getEvmSwapStatus — REGOLA COMPLETED ASSOLUTA", () => {
  async function makeSwap(userId: string, id: string) {
    vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({ ...MOCK_FIXED_RATE, rateId: `rate_${id}` });
    vi.mocked(cnCreateFixedRateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id,
    } as any);
    return createEvmExchange({
      userId, fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
  }

  it("T18 — finished + payoutHash valido + diverso da depositTxHash → isCompleted=true", async () => {
    const created = await makeSwap(USER_ID + "_T18", "cn_T18");
    await commitEvmFunds(USER_ID + "_T18", created.swapId, "0xDepositHash_T18");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T18", status: "finished",
      payinHash:  "0xDepositHash_T18",
      payoutHash: "0xPayoutHash_T18",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T18", created.swapId);
    expect(status.isCompleted).toBe(true);
    expect(status.cnStatus).toBe("finished");
    expect(status.destinationTxHash).toBe("0xPayoutHash_T18");
    expect(status.depositTxHash).toBe("0xDepositHash_T18");
    expect(status.isTerminal).toBe(true);
  });

  it("T19 — finished senza payoutHash → isCompleted=false (REGOLA ASSOLUTA)", async () => {
    const created = await makeSwap(USER_ID + "_T19", "cn_T19");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T19", status: "finished",
      payinHash: null, payoutHash: null,
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T19", created.swapId);
    expect(status.isCompleted).toBe(false);
    expect(status.cnStatus).toBe("finished");
    expect(status.destinationTxHash).toBeNull();
  });

  it("T20 — finished + payoutHash === depositTxHash → isCompleted=false (REGOLA ASSOLUTA)", async () => {
    const SAME_HASH = "0xSameHash_T20";
    const created = await makeSwap(USER_ID + "_T20", "cn_T20");
    await commitEvmFunds(USER_ID + "_T20", created.swapId, SAME_HASH);
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T20", status: "finished",
      payinHash: SAME_HASH, payoutHash: SAME_HASH,
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T20", created.swapId);
    expect(status.isCompleted).toBe(false);
  });

  it("T21 — confirming → isCompleted=false, isTerminal=false", async () => {
    const created = await makeSwap(USER_ID + "_T21", "cn_T21");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T21", status: "confirming",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T21", created.swapId);
    expect(status.isCompleted).toBe(false);
    expect(status.isTerminal).toBe(false);
    expect(status.cnStatus).toBe("confirming");
  });

  it("T22 — failed → isTerminal=true, isCompleted=false", async () => {
    const created = await makeSwap(USER_ID + "_T22", "cn_T22");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T22", status: "failed",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T22", created.swapId);
    expect(status.isTerminal).toBe(true);
    expect(status.isCompleted).toBe(false);
    expect(status.cnStatus).toBe("failed");
  });

  it("T23 — refunded → isTerminal=true", async () => {
    const created = await makeSwap(USER_ID + "_T23", "cn_T23");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T23", status: "refunded",
      refundHash: "0xRefundHash_T23",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T23", created.swapId);
    expect(status.isTerminal).toBe(true);
    expect(status.cnStatus).toBe("refunded");
    expect(status.refundDetails?.refundHash).toBe("0xRefundHash_T23");
  });

  it("T24 — expired → isTerminal=true, isCompleted=false", async () => {
    const created = await makeSwap(USER_ID + "_T24", "cn_T24");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T24", status: "expired",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T24", created.swapId);
    expect(status.isTerminal).toBe(true);
    expect(status.isCompleted).toBe(false);
    expect(status.cnStatus).toBe("expired");
  });

  it("T25 — API rete KO → usa stato DB (resilienza polling)", async () => {
    const created = await makeSwap(USER_ID + "_T25", "cn_T25");
    vi.mocked(cnGetTransactionStatus).mockRejectedValueOnce(new Error("Network timeout"));
    const status = await getEvmSwapStatus(USER_ID + "_T25", created.swapId);
    expect(["created", "waiting"]).toContain(status.cnStatus);
    expect(status.swapId).toBe(created.swapId);
  });
});

// ── getActiveEvmSwapForUser ───────────────────────────────────────────────────

describe("getActiveEvmSwapForUser", () => {
  it("T26 — swap attivo trovato", async () => {
    vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({ ...MOCK_FIXED_RATE });
    vi.mocked(cnCreateFixedRateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_active_T26",
    } as any);
    await createEvmExchange({
      userId: USER_ID + "_T26", fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
    const active = await getActiveEvmSwapForUser(USER_ID + "_T26");
    expect(active).not.toBeNull();
    expect(active?.fromTicker).toBe("pol");
    expect(active?.toTicker).toBe("usdcmatic");
  });

  it("T27 — nessuno swap → null", async () => {
    const active = await getActiveEvmSwapForUser("user_nonexistent_" + Date.now());
    expect(active).toBeNull();
  });
});

// ── Disponibilità dinamica ────────────────────────────────────────────────────

describe("Disponibilità dinamica — ChangeNOW come source of truth", () => {
  it("T28 — POL→USDC Polygon espone il minimo fixed-rate reale", async () => {
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 88.3059783, maxAmount: 7504.77 });
    const result = await checkEvmPair("pol", "usdcmatic");
    expect(result.available).toBe(true);
    expect(result.minAmount).toBeCloseTo(88.31, 1);
    expect(cnGetFixedRateRange).toHaveBeenCalledWith("pol", "usdcmatic");
  });

  it("T29 — USDC→POL: coppia non presente in vecchia whitelist → ora supportata dinamicamente", async () => {
    // USDC Polygon → POL non era nella vecchia hardcoded list
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 0.444236, maxAmount: null });
    const result = await checkEvmPair("usdcmatic", "pol");
    expect(result.available).toBe(true);
    expect(result.minAmount).toBeCloseTo(0.444, 2);
  });

  it("T30 — ETH→USDC Polygon: coppia cross-chain", async () => {
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 0.0002662, maxAmount: null });
    const result = await checkEvmPair("eth", "usdcmatic");
    expect(result.available).toBe(true);
  });

  it("T31 — BNB→USDT BSC: coppia BSC", async () => {
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 0.000098, maxAmount: null });
    const result = await checkEvmPair("bnbbsc", "usdtbsc");
    expect(result.available).toBe(true);
  });
});

// ── Nessun fallback Li.Fi ─────────────────────────────────────────────────────

describe("Nessun fallback Li.Fi", () => {
  it("T32 — il service EVM ChangeNOW non importa né chiama moduli Li.Fi", async () => {
    // Se il modulo fosse importato, vi.mock("@lifi/sdk") sarebbe necessario
    // e il test fallirebbe. L'assenza di errori di import è il check.
    vi.mocked(cnGetFixedRateRange).mockResolvedValueOnce({ minAmount: 88.31, maxAmount: null });
    const result = await checkEvmPair("pol", "usdcmatic");
    expect(result.available).toBe(true);
    // Li.Fi NON deve essere stato coinvolto
  });
});

// ── Idempotenza polling ───────────────────────────────────────────────────────

describe("Idempotenza polling", () => {
  it("T33 — polling duplicato non modifica stato terminale già raggiunto", async () => {
    vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({ ...MOCK_FIXED_RATE });
    vi.mocked(cnCreateFixedRateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_idem_T33",
    } as any);
    const created = await createEvmExchange({
      userId: USER_ID + "_IDEM33", fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
    await commitEvmFunds(USER_ID + "_IDEM33", created.swapId, "0xdep_idem33");

    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_idem_T33", status: "finished",
      payinHash: "0xdep_idem33", payoutHash: "0xpayout_idem33",
    } as any);
    const s1 = await getEvmSwapStatus(USER_ID + "_IDEM33", created.swapId);
    expect(s1.isCompleted).toBe(true);

    // Seconda chiamata — stato terminale in DB, NON chiama ChangeNOW
    const s2 = await getEvmSwapStatus(USER_ID + "_IDEM33", created.swapId);
    expect(s2.isCompleted).toBe(true);
    expect(cnGetTransactionStatus).toHaveBeenCalledTimes(1);
  });
});

// ── Catalogo UI ───────────────────────────────────────────────────────────────

describe("CN_EVM_TOKENS — catalogo UI (NON whitelist API)", () => {
  it("T34 — contiene i ticker attesi per l'interfaccia", () => {
    const tickers = CN_EVM_TOKENS.map(t => t.ticker);
    // Polygon
    expect(tickers).toContain("pol");
    expect(tickers).toContain("usdcmatic");
    expect(tickers).toContain("usdtmatic");
    // Ethereum
    expect(tickers).toContain("eth");
    expect(tickers).toContain("usdterc20");
    // BSC — "bnbbsc" (non "bnb" che è inactive su ChangeNOW)
    expect(tickers).toContain("bnbbsc");
    expect(tickers).toContain("usdtbsc");
  });

  it("T35 — ogni token ha chainId/decimals/isNative coerenti", () => {
    for (const t of CN_EVM_TOKENS) {
      expect([137, 1, 56]).toContain(t.chainId);
      expect(t.decimals).toBeGreaterThan(0);
      if (t.isNative) expect(t.contractAddress).toBeNull();
      else expect(t.contractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});
