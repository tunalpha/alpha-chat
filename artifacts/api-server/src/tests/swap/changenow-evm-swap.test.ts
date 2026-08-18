/**
 * Test — ChangeNOW EVM→EVM Swap Service
 *
 * NESSUN MOVIMENTO DI FONDI REALI. Tutte le chiamate esterne sono mockate.
 *
 * Suite:
 *   T1  — checkEvmPair: coppia disponibile
 *   T2  — checkEvmPair: stesso ticker → non disponibile
 *   T3  — checkEvmPair: API error → available=false (fail-safe)
 *   T4  — getEvmQuote: importo valido
 *   T5  — getEvmQuote: importo zero → errore
 *   T6  — createEvmExchange: crea ordine correttamente
 *   T7  — createEvmExchange: no destinationEvmAddress → errore
 *   T8  — createEvmExchange: swap attivo esiste → errore
 *   T9  — commitEvmFunds: salva depositTxHash
 *   T10 — commitEvmFunds: swap non trovato → errore
 *   T11 — getEvmSwapStatus: finished + payoutHash valido → isCompleted=true
 *   T12 — getEvmSwapStatus: finished senza payoutHash → isCompleted=false
 *   T13 — getEvmSwapStatus: finished con payoutHash === depositTxHash → isCompleted=false
 *   T14 — getEvmSwapStatus: confirming → isCompleted=false, isTerminal=false
 *   T15 — getEvmSwapStatus: failed → isTerminal=true, isCompleted=false
 *   T16 — getEvmSwapStatus: refunded → isTerminal=true
 *   T17 — getEvmSwapStatus: expired → isTerminal=true
 *   T18 — getEvmSwapStatus: API rete KO → usa stato DB (resilienza polling)
 *   T19 — getActiveEvmSwapForUser: swap attivo trovato
 *   T20 — getActiveEvmSwapForUser: nessuno swap → null
 *   T21 — checkEvmPair: ChangeNOW DISABLED → errore
 *   T22 — checkEvmPair: ticker FROM invalido → errore
 *   T23 — checkEvmPair: ticker TO invalido → errore
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
    cnGetExchangeAmount: vi.fn(),
    cnCreateTransaction: vi.fn(),
    cnGetTransactionStatus: vi.fn(),
  };
});

import { isProviderEnabled } from "../../services/swap/swap-provider-router.service.js";
import {
  cnGetExchangeAmount,
  cnCreateTransaction,
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

// ── T1: checkEvmPair — disponibile ────────────────────────────────────────────

describe("checkEvmPair", () => {
  it("T1 — coppia disponibile restituisce available=true e minAmount", async () => {
    vi.mocked(cnGetExchangeAmount).mockResolvedValueOnce({
      estimatedAmount: 3.2,
      minAmount: 11.4,
    });
    const result = await checkEvmPair("pol", "usdcmatic");
    expect(result.available).toBe(true);
    expect(result.minAmount).toBe(11.4);
    expect(result.from).toBe("pol");
    expect(result.to).toBe("usdcmatic");
  });

  it("T2 — stesso ticker → available=false (non chiama API)", async () => {
    const result = await checkEvmPair("pol", "pol");
    expect(result.available).toBe(false);
    expect(cnGetExchangeAmount).not.toHaveBeenCalled();
  });

  it("T3 — API error → available=false (fail-safe)", async () => {
    vi.mocked(cnGetExchangeAmount).mockRejectedValueOnce(new Error("Network error"));
    const result = await checkEvmPair("pol", "usdcmatic");
    expect(result.available).toBe(false);
  });

  it("T21 — ChangeNOW DISABLED → lancia errore", async () => {
    vi.mocked(isProviderEnabled).mockResolvedValueOnce(false);
    await expect(checkEvmPair("pol", "usdcmatic")).rejects.toThrow();
  });

  it("T22 — ticker FROM invalido → lancia errore", async () => {
    await expect(checkEvmPair("INVALID_TICKER", "usdcmatic")).rejects.toThrow();
  });

  it("T23 — ticker TO invalido → lancia errore", async () => {
    await expect(checkEvmPair("pol", "INVALID_TO")).rejects.toThrow();
  });
});

// ── T4-T5: getEvmQuote ────────────────────────────────────────────────────────

describe("getEvmQuote", () => {
  it("T4 — importo valido restituisce stima", async () => {
    vi.mocked(cnGetExchangeAmount).mockResolvedValueOnce({
      estimatedAmount: 3.2,
      minAmount: 11.4,
    });
    const quote = await getEvmQuote({ fromTicker: "pol", toTicker: "usdcmatic", fromAmount: 15 });
    expect(quote.estimatedToAmount).toBe(3.2);
    expect(quote.fromTicker).toBe("pol");
    expect(quote.toTicker).toBe("usdcmatic");
    expect(quote.fromAmount).toBe(15);
    expect(quote.minAmount).toBe(11.4);
  });

  it("T5 — importo zero → errore INVALID_AMOUNT", async () => {
    await expect(
      getEvmQuote({ fromTicker: "pol", toTicker: "usdcmatic", fromAmount: 0 })
    ).rejects.toThrow();
  });
});

// ── T6-T8: createEvmExchange ──────────────────────────────────────────────────

describe("createEvmExchange", () => {
  it("T6 — crea ordine correttamente", async () => {
    vi.mocked(cnCreateTransaction).mockResolvedValueOnce(MOCK_TX_RESPONSE as any);
    const result = await createEvmExchange({
      userId:                USER_ID + "_T6",
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
  });

  it("T7 — no destinationEvmAddress → errore EVM_DESTINATION_ADDRESS_REQUIRED", async () => {
    await expect(
      createEvmExchange({
        userId: USER_ID + "_T7", fromTicker: "pol", toTicker: "usdcmatic",
        fromAmount: 15, destinationEvmAddress: "", refundEvmAddress: REFUND,
      })
    ).rejects.toThrow();
  });

  it("T8 — swap attivo (fundsCommitted) già presente → errore ACTIVE_EVM_SWAP_EXISTS", async () => {
    // Prima crea uno swap e committa i fondi
    vi.mocked(cnCreateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE,
      id: "cn_exchange_T8",
    } as any);
    const created = await createEvmExchange({
      userId: USER_ID + "_T8", fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
    await commitEvmFunds(USER_ID + "_T8", created.swapId, "0x_deposit_hash_T8");

    // Secondo swap dovrebbe fallire
    await expect(
      createEvmExchange({
        userId: USER_ID + "_T8", fromTicker: "pol", toTicker: "usdcmatic",
        fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
      })
    ).rejects.toThrow();
  });
});

// ── T9-T10: commitEvmFunds ────────────────────────────────────────────────────

describe("commitEvmFunds", () => {
  it("T9 — salva depositTxHash e fundsCommitted=true", async () => {
    vi.mocked(cnCreateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_exchange_T9",
    } as any);
    const created = await createEvmExchange({
      userId: USER_ID + "_T9", fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
    // Non deve lanciare
    await expect(
      commitEvmFunds(USER_ID + "_T9", created.swapId, "0xdepositHash_T9")
    ).resolves.not.toThrow();
    // Verifica tramite getEvmSwapStatus
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_exchange_T9", status: "waiting",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T9", created.swapId);
    expect(status.fundsCommitted).toBe(true);
    expect(status.depositTxHash).toBe("0xdepositHash_T9");
  });

  it("T10 — swap non trovato → errore EVM_SWAP_NOT_FOUND", async () => {
    await expect(
      commitEvmFunds(USER_ID, new mongoose.Types.ObjectId().toString(), "0x_hash")
    ).rejects.toThrow();
  });
});

// ── T11-T18: getEvmSwapStatus ─────────────────────────────────────────────────

describe("getEvmSwapStatus — REGOLA COMPLETED ASSOLUTA", () => {
  async function makeSwap(userId: string, id: string) {
    vi.mocked(cnCreateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id,
    } as any);
    return createEvmExchange({
      userId, fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
  }

  it("T11 — finished + payoutHash valido + diverso da depositTxHash → isCompleted=true", async () => {
    const created = await makeSwap(USER_ID + "_T11", "cn_T11");
    await commitEvmFunds(USER_ID + "_T11", created.swapId, "0xDepositHash_T11");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T11", status: "finished",
      payinHash:  "0xDepositHash_T11",
      payoutHash: "0xPayoutHash_T11",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T11", created.swapId);
    expect(status.isCompleted).toBe(true);
    expect(status.cnStatus).toBe("finished");
    expect(status.destinationTxHash).toBe("0xPayoutHash_T11");
    expect(status.depositTxHash).toBe("0xDepositHash_T11");
    expect(status.isTerminal).toBe(true);
  });

  it("T12 — finished senza payoutHash → isCompleted=false (REGOLA ASSOLUTA)", async () => {
    const created = await makeSwap(USER_ID + "_T12", "cn_T12");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T12", status: "finished",
      payinHash: null, payoutHash: null,
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T12", created.swapId);
    expect(status.isCompleted).toBe(false);
    expect(status.cnStatus).toBe("finished");
    expect(status.destinationTxHash).toBeNull();
  });

  it("T13 — finished con payoutHash === depositTxHash → isCompleted=false (REGOLA ASSOLUTA)", async () => {
    const SAME_HASH = "0xSameHash_T13";
    const created = await makeSwap(USER_ID + "_T13", "cn_T13");
    await commitEvmFunds(USER_ID + "_T13", created.swapId, SAME_HASH);
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T13", status: "finished",
      payinHash: SAME_HASH, payoutHash: SAME_HASH,
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T13", created.swapId);
    // payoutHash è uguale al depositTxHash — MAI isCompleted=true
    expect(status.isCompleted).toBe(false);
  });

  it("T14 — confirming → isCompleted=false, isTerminal=false", async () => {
    const created = await makeSwap(USER_ID + "_T14", "cn_T14");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T14", status: "confirming",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T14", created.swapId);
    expect(status.isCompleted).toBe(false);
    expect(status.isTerminal).toBe(false);
    expect(status.cnStatus).toBe("confirming");
  });

  it("T15 — failed → isTerminal=true, isCompleted=false", async () => {
    const created = await makeSwap(USER_ID + "_T15", "cn_T15");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T15", status: "failed",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T15", created.swapId);
    expect(status.isTerminal).toBe(true);
    expect(status.isCompleted).toBe(false);
    expect(status.cnStatus).toBe("failed");
  });

  it("T16 — refunded → isTerminal=true", async () => {
    const created = await makeSwap(USER_ID + "_T16", "cn_T16");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T16", status: "refunded",
      refundHash: "0xRefundHash_T16",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T16", created.swapId);
    expect(status.isTerminal).toBe(true);
    expect(status.cnStatus).toBe("refunded");
    expect(status.refundDetails?.refundHash).toBe("0xRefundHash_T16");
  });

  it("T17 — expired → isTerminal=true, isCompleted=false", async () => {
    const created = await makeSwap(USER_ID + "_T17", "cn_T17");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_T17", status: "expired",
    } as any);
    const status = await getEvmSwapStatus(USER_ID + "_T17", created.swapId);
    expect(status.isTerminal).toBe(true);
    expect(status.isCompleted).toBe(false);
    expect(status.cnStatus).toBe("expired");
  });

  it("T18 — API rete KO → usa stato DB (resilienza polling)", async () => {
    const created = await makeSwap(USER_ID + "_T18", "cn_T18");
    // API lancia errore
    vi.mocked(cnGetTransactionStatus).mockRejectedValueOnce(new Error("Network timeout"));
    // Deve restituire il dato DB senza lanciare
    const status = await getEvmSwapStatus(USER_ID + "_T18", created.swapId);
    // Il mock cnCreateTransaction restituisce status="waiting" → DB ha "waiting"
    expect(["created","waiting"]).toContain(status.cnStatus);
    expect(status.swapId).toBe(created.swapId);
  });
});

// ── T19-T20: getActiveEvmSwapForUser ─────────────────────────────────────────

describe("getActiveEvmSwapForUser", () => {
  it("T19 — swap attivo trovato", async () => {
    vi.mocked(cnCreateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_active_T19",
    } as any);
    await createEvmExchange({
      userId: USER_ID + "_T19", fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
    const active = await getActiveEvmSwapForUser(USER_ID + "_T19");
    expect(active).not.toBeNull();
    expect(active?.fromTicker).toBe("pol");
    expect(active?.toTicker).toBe("usdcmatic");
  });

  it("T20 — nessuno swap → null", async () => {
    const active = await getActiveEvmSwapForUser("user_nonexistent_" + Date.now());
    expect(active).toBeNull();
  });
});

// ── CN_EVM_TOKENS: verifica integrità ticker ──────────────────────────────────

describe("CN_EVM_TOKENS — integrità ticker verificati", () => {
  it("contiene pol, usdcmatic, usdtmatic, eth, usdterc20, bnbbsc, usdtbsc", () => {
    const tickers = CN_EVM_TOKENS.map(t => t.ticker);
    expect(tickers).toContain("pol");
    expect(tickers).toContain("usdcmatic");
    expect(tickers).toContain("usdtmatic");
    expect(tickers).toContain("eth");
    expect(tickers).toContain("usdterc20");
    // BNB ticker verificato è "bnbbsc" (non "bnb" che è inactive su ChangeNOW)
    expect(tickers).toContain("bnbbsc");
    expect(tickers).toContain("usdtbsc");
  });

  it("ogni token ha chainId, decimals e isNative coerenti", () => {
    for (const t of CN_EVM_TOKENS) {
      expect([137, 1, 56]).toContain(t.chainId);
      expect(t.decimals).toBeGreaterThan(0);
      if (t.isNative) expect(t.contractAddress).toBeNull();
      else expect(t.contractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});

// ── Duplicate polling: getEvmSwapStatus idempotente ──────────────────────────

describe("Idempotenza polling", () => {
  it("polling duplicato non modifica stato terminale già raggiunto", async () => {
    vi.mocked(cnCreateTransaction).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_idem_001",
    } as any);
    const created = await createEvmExchange({
      userId: USER_ID + "_IDEM", fromTicker: "pol", toTicker: "usdcmatic",
      fromAmount: 15, destinationEvmAddress: DEST_EVM, refundEvmAddress: REFUND,
    });
    await commitEvmFunds(USER_ID + "_IDEM", created.swapId, "0xdep_idem");

    // Prima chiamata: finished + payoutHash → completed
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...MOCK_TX_RESPONSE, id: "cn_idem_001", status: "finished",
      payinHash: "0xdep_idem", payoutHash: "0xpayout_idem",
    } as any);
    const s1 = await getEvmSwapStatus(USER_ID + "_IDEM", created.swapId);
    expect(s1.isCompleted).toBe(true);

    // Seconda chiamata (stato già terminale) — NON chiama ChangeNOW
    const s2 = await getEvmSwapStatus(USER_ID + "_IDEM", created.swapId);
    expect(s2.isCompleted).toBe(true);
    // cnGetTransactionStatus dovrebbe essere stato chiamato solo 1 volta
    expect(cnGetTransactionStatus).toHaveBeenCalledTimes(1);
  });
});
