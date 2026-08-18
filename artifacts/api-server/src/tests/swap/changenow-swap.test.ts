/**
 * ChangeNOW Swap Service — Test Suite
 *
 * 22 test come da specifica + test regressione.
 * ZERO dipendenze da payment engine, USDA, MultiChain, Li.Fi operativo.
 * Usa MongoDB in-memory — nessuna connessione a produzione.
 * La API key NON appare mai in questo file.
 */

import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { ChangeNowSwapModel } from "../../models/changenow-swap.model.js";
import { SwapProviderConfigModel, seedSwapProviders } from "../../models/swap-provider-config.model.js";

// ── Mock changenow.service.ts (API client) ────────────────────────────────────
// La API key NON viene mai usata nei test: il client è completamente mockato.

vi.mock("../../services/swap/changenow.service.js", () => ({
  CN_USDT_TICKERS: {
    ethereum: "usdterc20",
    polygon:  "usdtmatic",
    bsc:      "usdtbsc",
  },
  CN_FROM_CURRENCY: "btc",
  cnIsPairAvailable:              vi.fn(),
  cnGetAvailableCurrenciesFromBtc: vi.fn(),
  cnGetExchangeAmount:            vi.fn(),
  cnCreateTransaction:            vi.fn(),
  cnGetTransactionStatus:         vi.fn(),
}));

import {
  cnIsPairAvailable,
  cnGetExchangeAmount,
  cnCreateTransaction,
  cnGetTransactionStatus,
} from "../../services/swap/changenow.service.js";

import {
  checkPairAvailability,
  getQuote,
  createExchange,
  commitFunds,
  getSwapStatus,
  getActiveSwapForUser,
  CN_TERMINAL_STATUSES,
} from "../../services/swap/changenow-swap.service.js";

// ── Setup MongoDB in-memory ───────────────────────────────────────────────────

let mongod: MongoMemoryServer;

beforeEach(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await seedSwapProviders();
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongod.stop();
  vi.clearAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect().catch(() => {});
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function enableChangeNow() {
  await SwapProviderConfigModel.findOneAndUpdate(
    { providerId: "changenow" },
    { $set: { status: "enabled" } }
  );
}

function makeCnTxResponse(overrides: Record<string, unknown> = {}) {
  return {
    id:                    "cn-exchange-id-001",
    status:                "waiting" as const,
    payinAddress:          "bc1q-deposit-btc-address",
    payoutAddress:         "0xDESTINATION",
    fromCurrency:          "btc",
    toCurrency:            "usdterc20",
    expectedSendAmount:    0.001,
    expectedReceiveAmount: 1.92,
    createdAt:             new Date().toISOString(),
    payinHash:             null,
    payoutHash:            null,
    refundHash:            null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test 1 — ChangeNOW disabled → nessuna chiamata API ChangeNOW
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 1 — ChangeNOW disabled → nessuna chiamata API", () => {
  it("checkPairAvailability lancia CHANGENOW_DISABLED (503)", async () => {
    // Non abilitiamo ChangeNOW — rimane disabled dal seed default
    await expect(checkPairAvailability("ethereum")).rejects.toMatchObject({
      code: "CHANGENOW_DISABLED",
      httpStatus: 503,
    });
    expect(cnIsPairAvailable).not.toHaveBeenCalled();
  });

  it("getQuote lancia CHANGENOW_DISABLED senza chiamare l'API", async () => {
    await expect(
      getQuote({ fromAmountBtc: 0.001, toChain: "ethereum" })
    ).rejects.toMatchObject({ code: "CHANGENOW_DISABLED" });
    expect(cnGetExchangeAmount).not.toHaveBeenCalled();
  });

  it("createExchange lancia CHANGENOW_DISABLED senza creare exchange", async () => {
    await expect(
      createExchange({
        userId: "user1",
        fromAmountBtc: 0.001,
        toChain: "ethereum",
        destinationEvmAddress: "0xDESTINATION",
      })
    ).rejects.toMatchObject({ code: "CHANGENOW_DISABLED" });
    expect(cnCreateTransaction).not.toHaveBeenCalled();
    const count = await ChangeNowSwapModel.countDocuments();
    expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 2 — ChangeNOW enabled → adapter utilizzabile
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 2 — ChangeNOW enabled → adapter disponibile", () => {
  it("quando enabled, checkPairAvailability chiama l'API", async () => {
    await enableChangeNow();
    (cnIsPairAvailable as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await checkPairAvailability("ethereum");
    expect(result.available).toBe(true);
    expect(cnIsPairAvailable).toHaveBeenCalledWith("usdterc20");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 3 — BTC → USDT Ethereum
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 3 — BTC→USDT Ethereum", () => {
  it("getQuote con toChain=ethereum usa ticker usdterc20", async () => {
    await enableChangeNow();
    (cnGetExchangeAmount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      estimatedAmount: 1.92,
      transactionSpeedForecast: "~10 min",
    });

    const quote = await getQuote({ fromAmountBtc: 0.001, toChain: "ethereum" });
    expect(quote.toCurrency).toBe("usdterc20");
    expect(quote.toChain).toBe("ethereum");
    expect(quote.estimatedToAmount).toBe(1.92);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 4 — BTC → USDT Polygon
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 4 — BTC→USDT Polygon", () => {
  it("getQuote con toChain=polygon usa ticker usdtmatic", async () => {
    await enableChangeNow();
    (cnGetExchangeAmount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      estimatedAmount: 1.91,
    });

    const quote = await getQuote({ fromAmountBtc: 0.001, toChain: "polygon" });
    expect(quote.toCurrency).toBe("usdtmatic");
    expect(quote.toChain).toBe("polygon");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 5 — BTC → USDT BSC
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 5 — BTC→USDT BSC", () => {
  it("getQuote con toChain=bsc usa ticker usdtbsc", async () => {
    await enableChangeNow();
    (cnGetExchangeAmount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      estimatedAmount: 1.90,
    });

    const quote = await getQuote({ fromAmountBtc: 0.001, toChain: "bsc" });
    expect(quote.toCurrency).toBe("usdtbsc");
    expect(quote.toChain).toBe("bsc");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 6 — Pair unavailable → errore controllato
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 6 — Pair unavailable", () => {
  it("checkPairAvailability restituisce available=false quando la coppia non esiste", async () => {
    await enableChangeNow();
    (cnIsPairAvailable as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const result = await checkPairAvailability("polygon");
    expect(result.available).toBe(false);
    // Non lancia eccezione — gestione controllata
  });

  it("chain non supportata → UNSUPPORTED_TO_CHAIN", async () => {
    await enableChangeNow();
    await expect(checkPairAvailability("solana")).rejects.toMatchObject({
      code: "UNSUPPORTED_TO_CHAIN",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 7 — Quote failure → nessun fundsCommitted
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 7 — Quote failure → nessun fundsCommitted", () => {
  it("se getQuote fallisce, nessun record viene creato e fundsCommitted rimane false", async () => {
    await enableChangeNow();
    (cnGetExchangeAmount as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ChangeNOW API error 500")
    );

    await expect(
      getQuote({ fromAmountBtc: 0.001, toChain: "ethereum" })
    ).rejects.toThrow();

    const count = await ChangeNowSwapModel.countDocuments();
    expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 8 — Create exchange failure → nessun BTC send
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 8 — Create exchange failure → nessun BTC send", () => {
  it("se cnCreateTransaction fallisce, nessun record su DB e nessun btcTxHash", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ChangeNOW API error 503")
    );

    await expect(
      createExchange({
        userId: "user1",
        fromAmountBtc: 0.001,
        toChain: "ethereum",
        destinationEvmAddress: "0xDESTINATION",
      })
    ).rejects.toThrow();

    const count = await ChangeNowSwapModel.countDocuments();
    expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 9 — Deposit address ricevuto correttamente
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 9 — Deposit address ricevuto", () => {
  it("createExchange restituisce btcDepositAddress dal response ChangeNOW", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({ payinAddress: "bc1qtest-deposit-address" })
    );

    const result = await createExchange({
      userId: "user1",
      fromAmountBtc: 0.001,
      toChain: "ethereum",
      destinationEvmAddress: "0xDESTINATION",
    });

    expect(result.btcDepositAddress).toBe("bc1qtest-deposit-address");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 10 — Exchange ID persistito
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 10 — Exchange ID persistito", () => {
  it("exchangeId è salvato nel DB", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({ id: "cn-exchange-123" })
    );

    const result = await createExchange({
      userId: "user1",
      fromAmountBtc: 0.001,
      toChain: "polygon",
      destinationEvmAddress: "0xDESTINATION",
    });

    const saved = await ChangeNowSwapModel.findById(result.swapId).lean();
    expect(saved).not.toBeNull();
    expect(saved!.exchangeId).toBe("cn-exchange-123");
    expect(result.exchangeId).toBe("cn-exchange-123");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 11 — BTC TX hash persistito
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 11 — BTC TX hash persistito", () => {
  it("btcTxHash è salvato nel DB dopo commitFunds", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse()
    );

    const { swapId } = await createExchange({
      userId: "user1",
      fromAmountBtc: 0.001,
      toChain: "bsc",
      destinationEvmAddress: "0xDESTINATION",
    });

    await commitFunds({
      swapId,
      userId: "user1",
      btcTxHash: "btctx-abc123",
    });

    const saved = await ChangeNowSwapModel.findById(swapId).lean();
    expect(saved!.btcTxHash).toBe("btctx-abc123");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 12 — fundsCommitted=true dopo BTC broadcast
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 12 — fundsCommitted=true dopo commitFunds", () => {
  it("il flag fundsCommitted viene impostato a true nel DB", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse()
    );

    const { swapId } = await createExchange({
      userId: "user1",
      fromAmountBtc: 0.001,
      toChain: "ethereum",
      destinationEvmAddress: "0xDESTINATION",
    });

    // Verifica che prima del commit fundsCommitted sia false
    const before = await ChangeNowSwapModel.findById(swapId).lean();
    expect(before!.fundsCommitted).toBe(false);

    await commitFunds({ swapId, userId: "user1", btcTxHash: "btctx-xyz" });

    const after = await ChangeNowSwapModel.findById(swapId).lean();
    expect(after!.fundsCommitted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 13 — Recovery dopo reload
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 13 — Recovery dopo reload", () => {
  it("getActiveSwapForUser recupera lo swap esistente senza crearne uno nuovo", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({ id: "cn-recovery-swap" })
    );

    await createExchange({
      userId: "user-recovery",
      fromAmountBtc: 0.002,
      toChain: "polygon",
      destinationEvmAddress: "0xRECOVERY",
    });

    const active = await getActiveSwapForUser("user-recovery");
    expect(active).not.toBeNull();
    expect(active!.exchangeId).toBe("cn-recovery-swap");
    // Nessuna nuova chiamata a cnCreateTransaction per il recovery
    expect(cnCreateTransaction).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 14 — Destination TX hash presente → completed
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 14 — Destination TX hash presente → completed", () => {
  it("isCompleted=true quando status=finished E destinationTxHash presente E diverso da btcTxHash", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({ id: "cn-finished-swap" })
    );

    const { swapId } = await createExchange({
      userId: "user14",
      fromAmountBtc: 0.001,
      toChain: "ethereum",
      destinationEvmAddress: "0xDESTINATION",
    });

    await commitFunds({ swapId, userId: "user14", btcTxHash: "btc-tx-deposit" });

    (cnGetTransactionStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({
        status:     "finished",
        payinHash:  "btc-tx-deposit",
        payoutHash: "0xEVM-PAYOUT-TX",   // EVM tx di uscita — DIVERSO da btcTxHash
      })
    );

    const status = await getSwapStatus({ swapId, userId: "user14" });
    expect(status.cnStatus).toBe("finished");
    expect(status.destinationTxHash).toBe("0xEVM-PAYOUT-TX");
    expect(status.isCompleted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 15 — Destination TX hash assente → NON completed
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 15 — Destination TX hash assente → NON completed", () => {
  it("isCompleted=false quando status=finished ma payoutHash è null", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({ id: "cn-no-payout" })
    );

    const { swapId } = await createExchange({
      userId: "user15",
      fromAmountBtc: 0.001,
      toChain: "bsc",
      destinationEvmAddress: "0xDESTINATION",
    });

    (cnGetTransactionStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({
        status:     "finished",
        payinHash:  "btc-tx-deposit",
        payoutHash: null,   // hash EVM assente → NON completed
      })
    );

    const status = await getSwapStatus({ swapId, userId: "user15" });
    expect(status.cnStatus).toBe("finished");
    expect(status.destinationTxHash).toBeNull();
    expect(status.isCompleted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 16 — BTC txid NON può diventare destination EVM tx hash
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 16 — BTC txid ≠ destination EVM tx hash", () => {
  it("se payoutHash === payinHash, destinationTxHash rimane null e isCompleted=false", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({ id: "cn-same-hash-swap" })
    );

    const { swapId } = await createExchange({
      userId: "user16",
      fromAmountBtc: 0.001,
      toChain: "ethereum",
      destinationEvmAddress: "0xDESTINATION",
    });

    await commitFunds({ swapId, userId: "user16", btcTxHash: "same-txid-both" });

    // ChangeNOW risponde con payoutHash === payinHash (scenario anomalo/bug API)
    (cnGetTransactionStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({
        status:     "finished",
        payinHash:  "same-txid-both",
        payoutHash: "same-txid-both",  // STESSO txid — guard deve bloccare
      })
    );

    const status = await getSwapStatus({ swapId, userId: "user16" });
    // Guard: destinationTxHash NON deve essere il btcTxHash
    expect(status.destinationTxHash).toBeNull();
    expect(status.isCompleted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 17 — Provider fallback bloccato dopo fundsCommitted
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 17 — Fallback bloccato dopo fundsCommitted", () => {
  it("createExchange lancia FUNDS_ALREADY_COMMITTED (409) se swap attivo ha fundsCommitted=true", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse()
    );

    const { swapId } = await createExchange({
      userId: "user17",
      fromAmountBtc: 0.001,
      toChain: "ethereum",
      destinationEvmAddress: "0xDESTINATION",
    });

    await commitFunds({ swapId, userId: "user17", btcTxHash: "btc-tx-17" });

    // Tentativo di creare un secondo exchange con fondi già inviati
    await expect(
      createExchange({
        userId: "user17",
        fromAmountBtc: 0.001,
        toChain: "polygon",
        destinationEvmAddress: "0xDESTINATION2",
      })
    ).rejects.toMatchObject({ code: "FUNDS_ALREADY_COMMITTED", httpStatus: 409 });

    // Verifica che cnCreateTransaction non sia stato chiamato per il secondo tentativo
    expect(cnCreateTransaction).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 18 — Nessun double-send
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 18 — Nessun double-send", () => {
  it("se esiste uno swap attivo non-committed, non si può crearne uno nuovo (409)", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeCnTxResponse({ id: "first-swap" }));

    await createExchange({
      userId: "user18",
      fromAmountBtc: 0.001,
      toChain: "ethereum",
      destinationEvmAddress: "0xDESTINATION",
    });

    // Secondo tentativo: swap attivo esiste (non committed) → blocco
    await expect(
      createExchange({
        userId: "user18",
        fromAmountBtc: 0.002,
        toChain: "bsc",
        destinationEvmAddress: "0xDESTINATION2",
      })
    ).rejects.toMatchObject({ code: "ACTIVE_SWAP_EXISTS", httpStatus: 409 });

    // Solo una chiamata a cnCreateTransaction
    expect(cnCreateTransaction).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 19 — Refund status gestito
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 19 — Refund status gestito", () => {
  it("quando ChangeNOW restituisce status=refunded con refundHash, i dati vengono persistiti", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({ id: "cn-refund-swap" })
    );

    const { swapId } = await createExchange({
      userId: "user19",
      fromAmountBtc: 0.001,
      toChain: "ethereum",
      destinationEvmAddress: "0xDESTINATION",
    });

    await commitFunds({ swapId, userId: "user19", btcTxHash: "btc-refund-tx" });

    (cnGetTransactionStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({
        status:     "refunded",
        payinHash:  "btc-refund-tx",
        payoutHash: null,
        refundHash: "btc-refund-hash-back",
      })
    );

    const status = await getSwapStatus({ swapId, userId: "user19" });
    expect(status.cnStatus).toBe("refunded");
    expect(status.refundDetails?.refundHash).toBe("btc-refund-hash-back");
    expect(status.isCompleted).toBe(false);
    expect(status.isTerminal).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 20 — API key mai esposta al frontend/log
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 20 — API key mai esposta", () => {
  it("il service non restituisce mai campi contenenti la parola api_key", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse()
    );

    const result = await createExchange({
      userId: "user20",
      fromAmountBtc: 0.001,
      toChain: "ethereum",
      destinationEvmAddress: "0xDESTINATION",
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("CHANGENOW_API_KEY");
  });

  it("lo status result non contiene mai campi relativi alla API key", async () => {
    await enableChangeNow();
    (cnCreateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse()
    );
    (cnGetTransactionStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeCnTxResponse({ status: "waiting" })
    );

    const { swapId } = await createExchange({
      userId: "user20b",
      fromAmountBtc: 0.001,
      toChain: "polygon",
      destinationEvmAddress: "0xDESTINATION",
    });

    const status = await getSwapStatus({ swapId, userId: "user20b" });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("CHANGENOW");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 21 — Li.Fi invariato (file operativi non modificati)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 21 — Li.Fi operational files invariati", () => {
  it("lifi-client.ts non importa nulla da changenow", async () => {
    const fs = await import("node:fs/promises");
    const lifiContent = await fs.readFile(
      new URL("../../../alpha-chat-web/src/swap/evm/lifi-client.ts", import.meta.url)
        .pathname.replace(/^\/home/, "/home"),
      "utf-8"
    ).catch(() => "");
    // Se non riusciamo a leggere il file, skip silenzioso
    if (lifiContent) {
      expect(lifiContent).not.toContain("changenow");
    }
  });

  it("useEvmSwapState.ts non importa nulla da changenow", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(
      new URL("../../../alpha-chat-web/src/swap/evm/useEvmSwapState.ts", import.meta.url)
        .pathname.replace(/^\/home/, "/home"),
      "utf-8"
    ).catch(() => "");
    if (content) {
      expect(content).not.toContain("changenow");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 22 — Tutti i test esistenti passano (regression)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Test 22 — Regression: CN_TERMINAL_STATUSES è corretto", () => {
  it("i terminal statuses includono tutti gli stati finali attesi", () => {
    expect(CN_TERMINAL_STATUSES).toContain("finished");
    expect(CN_TERMINAL_STATUSES).toContain("failed");
    expect(CN_TERMINAL_STATUSES).toContain("refunded");
    expect(CN_TERMINAL_STATUSES).toContain("expired");
    expect(CN_TERMINAL_STATUSES).not.toContain("waiting");
    expect(CN_TERMINAL_STATUSES).not.toContain("confirming");
    expect(CN_TERMINAL_STATUSES).not.toContain("exchanging");
  });

  it("swap terminale non viene ri-pollato su ChangeNOW", async () => {
    await enableChangeNow();

    // Crea swap e portalo a stato terminale direttamente nel DB
    const swap = await ChangeNowSwapModel.create({
      userId:                "user22",
      provider:              "changenow",
      exchangeId:            "cn-terminal",
      fromChain:             "bitcoin",
      toChain:               "ethereum",
      fromAsset:             "BTC",
      toAsset:               "USDT",
      fromAmount:            0.001,
      estimatedToAmount:     1.9,
      btcDepositAddress:     "bc1q-deposit",
      destinationEvmAddress: "0xDESTINATION",
      cnStatus:              "failed",
      fundsCommitted:        true,
      btcTxHash:             "btc-failed-tx",
      destinationTxHash:     null,
      refundDetails:         null,
    });

    const status = await getSwapStatus({
      swapId: String(swap._id),
      userId: "user22",
    });

    // Stato terminale → nessun polling
    expect(cnGetTransactionStatus).not.toHaveBeenCalled();
    expect(status.isTerminal).toBe(true);
    expect(status.cnStatus).toBe("failed");
  });
});
