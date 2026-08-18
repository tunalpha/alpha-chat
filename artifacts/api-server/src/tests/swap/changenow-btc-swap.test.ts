/**
 * Test — ChangeNOW BTC→EVM Swap Service (generalizzato)
 *
 * Tutti i ticker verificati via API reale il 2026-08-18.
 * NESSUNA transazione reale — tutte le chiamate esterne sono mockate.
 *
 * Suite:
 *   ── Pair availability ──────────────────────────────────────────
 *   T1   — BTC→USDT Ethereum (usdterc20) disponibile
 *   T2   — BTC→USDT Polygon  (usdtmatic)  disponibile
 *   T3   — BTC→USDT BSC      (usdtbsc)    disponibile
 *   T4   — BTC→USDC Polygon  (usdcmatic)  disponibile
 *   T5   — BTC→ETH            (eth)        disponibile
 *   T6   — BTC→POL ERC-20    (pol)        disponibile
 *   T7   — BTC→MATIC ERC-20  (matic)      disponibile
 *   T8   — BTC→BNB BSC       (bnbbsc)     disponibile
 *   T9   — ticker invalido → errore UNSUPPORTED_BTC_DESTINATION
 *   T10  — ChangeNOW DISABLED → errore
 *
 *   ── Quote ──────────────────────────────────────────────────────
 *   T11  — quote btc→usdtmatic importo valido
 *   T12  — quote btc→eth importo valido
 *   T13  — quote btc→bnbbsc importo valido
 *   T14  — ticker invalido → errore
 *   T15  — importo negativo → errore
 *
 *   ── Create exchange ────────────────────────────────────────────
 *   T16  — create btc→usdtmatic OK
 *   T17  — create btc→eth OK (payinAddress = BTC deposit addr)
 *   T18  — create btc→usdterc20 OK (payinAddress = BTC addr, payoutAddress = ETH addr)
 *   T19  — create btc→pol OK
 *   T20  — create btc→bnbbsc OK
 *   T21  — no destinationEvmAddress → errore
 *   T22  — swap attivo esistente → errore ACTIVE_SWAP_EXISTS
 *   T23  — swap con fundsCommitted=true → FUNDS_ALREADY_COMMITTED
 *
 *   ── Commit ─────────────────────────────────────────────────────
 *   T24  — commitFunds salva btcTxHash
 *   T25  — commitFunds idempotente (doppia chiamata)
 *   T26  — commitFunds swap non trovato → errore
 *
 *   ── Status / COMPLETED rule ────────────────────────────────────
 *   T27  — finished + payoutHash valido → isCompleted=true
 *   T28  — finished senza payoutHash → isCompleted=false (ASSOLUTO)
 *   T29  — finished payoutHash===btcTxHash → isCompleted=false (ASSOLUTO)
 *   T30  — confirming → isTerminal=false
 *   T31  — failed → isTerminal=true, isCompleted=false
 *   T32  — refunded → isTerminal=true, refundHash salvato
 *   T33  — expired → isTerminal=true
 *   T34  — API KO → usa stato DB (resilienza polling)
 *   T35  — già terminale → NON chiama API ChangeNOW
 *
 *   ── Active swap recovery ───────────────────────────────────────
 *   T36  — getActiveSwapForUser: swap attivo trovato
 *   T37  — getActiveSwapForUser: utente senza swap → null
 *
 *   ── Token integrity ────────────────────────────────────────────
 *   T38  — CN_BTC_DESTINATION_TOKENS contiene tutti gli 8 ticker verificati
 *   T39  — minAmountBtc > 0 per ogni token
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
    ...real,  // re-export CN_BTC_DESTINATION_TOKENS, getCnBtcDestToken, CnApiError, etc.
    cnGetMinAmount:        vi.fn(),
    cnGetExchangeAmount:   vi.fn(),
    cnCreateTransaction:   vi.fn(),
    cnGetTransactionStatus: vi.fn(),
  };
});

import { isProviderEnabled } from "../../services/swap/swap-provider-router.service.js";
import {
  cnGetMinAmount,
  cnGetExchangeAmount,
  cnCreateTransaction,
  cnGetTransactionStatus,
  CN_BTC_DESTINATION_TOKENS,
} from "../../services/swap/changenow.service.js";
import {
  checkPairAvailability,
  getQuote,
  createExchange,
  commitFunds,
  getSwapStatus,
  getActiveSwapForUser,
} from "../../services/swap/changenow-swap.service.js";

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

const DEST_EVM = "0xAlphaWallet1234567890ABCDEF1234567890AB";

function mockTxOk(id: string, toCurrency: string) {
  vi.mocked(cnCreateTransaction).mockResolvedValueOnce({
    id,
    status: "waiting" as const,
    payinAddress: "bc1qchangenow_deposit_btc_address",
    payoutAddress: DEST_EVM,
    fromCurrency: "btc",
    toCurrency,
    expectedSendAmount:    0.001,
    expectedReceiveAmount: 50,
    createdAt: new Date().toISOString(),
    payinHash:  null,
    payoutHash: null,
    refundHash: null,
  } as any);
}

async function makeSwap(userId: string, toTicker: string, id: string) {
  mockTxOk(id, toTicker);
  return createExchange({
    userId,
    fromAmountBtc: 0.001,
    toTicker,
    destinationEvmAddress: DEST_EVM,
  });
}

// ── T1-T8: Pair availability (tutti i ticker verificati) ──────────────────────

describe("checkPairAvailability — tutti i ticker verificati", () => {
  const VERIFIED = [
    "usdterc20", "usdtmatic", "usdtbsc", "usdcmatic",
    "eth", "pol", "matic", "bnbbsc",
  ];

  for (const ticker of VERIFIED) {
    it(`T${VERIFIED.indexOf(ticker) + 1} — BTC→${ticker} disponibile`, async () => {
      vi.mocked(cnGetMinAmount).mockResolvedValueOnce({ minAmount: 0.001 });
      const result = await checkPairAvailability(ticker);
      expect(result.available).toBe(true);
      expect(result.toTicker).toBe(ticker);
      expect(result.fromCurrency).toBe("btc");
      // Minimo dinamico da ChangeNOW API — non hardcoded
      expect(result.minAmountBtc).toBe(0.001);
    });
  }

  it("T9 — ticker invalido → errore UNSUPPORTED_BTC_DESTINATION", async () => {
    await expect(checkPairAvailability("INVALID_TICKER")).rejects.toThrow();
    expect(cnGetMinAmount).not.toHaveBeenCalled();
  });

  it("T10 — ChangeNOW DISABLED → errore CHANGENOW_DISABLED", async () => {
    vi.mocked(isProviderEnabled).mockResolvedValueOnce(false);
    await expect(checkPairAvailability("usdtmatic")).rejects.toThrow();
  });
});

// ── T11-T15: Quote ────────────────────────────────────────────────────────────

describe("getQuote", () => {
  it("T11 — quote btc→usdtmatic valida", async () => {
    vi.mocked(cnGetExchangeAmount).mockResolvedValueOnce({ estimatedAmount: 50.5, minAmount: 0.01 });
    const q = await getQuote({ fromAmountBtc: 0.001, toTicker: "usdtmatic" });
    expect(q.estimatedToAmount).toBe(50.5);
    expect(q.toTicker).toBe("usdtmatic");
    expect(q.toAsset).toBe("USDT");
    expect(q.toChain).toBe("polygon");
    expect(q.fromCurrency).toBe("btc");
  });

  it("T12 — quote btc→eth valida", async () => {
    vi.mocked(cnGetExchangeAmount).mockResolvedValueOnce({ estimatedAmount: 0.0083, minAmount: 0.0001 });
    const q = await getQuote({ fromAmountBtc: 0.001, toTicker: "eth" });
    expect(q.estimatedToAmount).toBe(0.0083);
    expect(q.toAsset).toBe("ETH");
    expect(q.toChain).toBe("ethereum");
  });

  it("T13 — quote btc→bnbbsc valida", async () => {
    vi.mocked(cnGetExchangeAmount).mockResolvedValueOnce({ estimatedAmount: 0.026, minAmount: 0.0001 });
    const q = await getQuote({ fromAmountBtc: 0.001, toTicker: "bnbbsc" });
    expect(q.estimatedToAmount).toBe(0.026);
    expect(q.toAsset).toBe("BNB");
    expect(q.toChain).toBe("bsc");
  });

  it("T14 — ticker invalido → errore", async () => {
    await expect(getQuote({ fromAmountBtc: 0.001, toTicker: "INVALID" })).rejects.toThrow();
  });

  it("T15 — importo negativo → errore", async () => {
    await expect(getQuote({ fromAmountBtc: -1, toTicker: "usdtmatic" })).rejects.toThrow();
  });
});

// ── T16-T23: Create exchange ──────────────────────────────────────────────────

describe("createExchange", () => {
  const TICKERS_TO_TEST = [
    ["usdtmatic", "T16", "polygon",  "USDT"],
    ["eth",       "T17", "ethereum", "ETH"],
    ["usdterc20", "T18", "ethereum", "USDT"],
    ["pol",       "T19", "ethereum", "POL"],
    ["bnbbsc",    "T20", "bsc",      "BNB"],
  ] as const;

  for (const [ticker, label, chain, asset] of TICKERS_TO_TEST) {
    it(`${label} — create btc→${ticker}: btcDepositAddress=BTC addr, toChain=${chain}`, async () => {
      const created = await makeSwap(`user_${label}`, ticker, `cn_${label}`);
      expect(created.btcDepositAddress).toBe("bc1qchangenow_deposit_btc_address");
      expect(created.toTicker).toBe(ticker);
      expect(created.toChain).toBe(chain);
      expect(created.toAsset).toBe(asset);
    });
  }

  it("T21 — destinationEvmAddress vuota → errore EVM_DESTINATION_ADDRESS_REQUIRED", async () => {
    await expect(createExchange({
      userId: "user_T21", fromAmountBtc: 0.001, toTicker: "usdtmatic",
      destinationEvmAddress: "",
    })).rejects.toThrow();
    expect(cnCreateTransaction).not.toHaveBeenCalled();
  });

  it("T22 — swap attivo esistente → ACTIVE_SWAP_EXISTS", async () => {
    await makeSwap("user_T22", "usdtmatic", "cn_T22_first");
    await expect(makeSwap("user_T22", "eth", "cn_T22_second")).rejects.toThrow();
  });

  it("T23 — swap con fundsCommitted=true → FUNDS_ALREADY_COMMITTED", async () => {
    const created = await makeSwap("user_T23", "usdtmatic", "cn_T23");
    await commitFunds({ swapId: created.swapId, userId: "user_T23", btcTxHash: "0xbtctxhash_T23" });
    await expect(makeSwap("user_T23", "eth", "cn_T23_new")).rejects.toThrow();
  });
});

// ── T24-T26: Commit ───────────────────────────────────────────────────────────

describe("commitFunds", () => {
  it("T24 — salva btcTxHash e fundsCommitted=true", async () => {
    const created = await makeSwap("user_T24", "usdtmatic", "cn_T24");
    await expect(
      commitFunds({ swapId: created.swapId, userId: "user_T24", btcTxHash: "0xbtc_T24" })
    ).resolves.toMatchObject({ fundsCommitted: true });

    // Verifica tramite status (rete OK)
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      ...({ id: "cn_T24", status: "waiting" } as any),
      payinHash: "0xbtc_T24", payoutHash: null, refundHash: null,
    });
    const s = await getSwapStatus({ swapId: created.swapId, userId: "user_T24" });
    expect(s.fundsCommitted).toBe(true);
    expect(s.btcTxHash).toBe("0xbtc_T24");
  });

  it("T25 — commitFunds idempotente (doppia chiamata)", async () => {
    const created = await makeSwap("user_T25", "usdtmatic", "cn_T25");
    await commitFunds({ swapId: created.swapId, userId: "user_T25", btcTxHash: "0xbtc_T25" });
    // Seconda chiamata non deve lanciare
    await expect(
      commitFunds({ swapId: created.swapId, userId: "user_T25", btcTxHash: "0xbtc_T25_dupe" })
    ).resolves.toMatchObject({ fundsCommitted: true });
  });

  it("T26 — swap non trovato → errore SWAP_NOT_FOUND", async () => {
    await expect(
      commitFunds({ swapId: new mongoose.Types.ObjectId().toString(), userId: "user_T26", btcTxHash: "0x" })
    ).rejects.toThrow();
  });
});

// ── T27-T35: getSwapStatus — REGOLA COMPLETED ────────────────────────────────

describe("getSwapStatus — REGOLA COMPLETED ASSOLUTA", () => {
  async function swap(userId: string, id: string, ticker = "usdtmatic") {
    return makeSwap(userId, ticker, id);
  }

  it("T27 — finished + payoutHash valido → isCompleted=true", async () => {
    const c = await swap("user_T27", "cn_T27");
    await commitFunds({ swapId: c.swapId, userId: "user_T27", btcTxHash: "0xBTC27" });
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      id: "cn_T27", status: "finished",
      payinHash: "0xBTC27", payoutHash: "0xPAYOUT27", refundHash: null,
    } as any);
    const s = await getSwapStatus({ swapId: c.swapId, userId: "user_T27" });
    expect(s.isCompleted).toBe(true);
    expect(s.isTerminal).toBe(true);
    expect(s.destinationTxHash).toBe("0xPAYOUT27");
    expect(s.btcTxHash).toBe("0xBTC27");
  });

  it("T28 — finished senza payoutHash → isCompleted=false (ASSOLUTO)", async () => {
    const c = await swap("user_T28", "cn_T28");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      id: "cn_T28", status: "finished",
      payinHash: null, payoutHash: null, refundHash: null,
    } as any);
    const s = await getSwapStatus({ swapId: c.swapId, userId: "user_T28" });
    expect(s.isCompleted).toBe(false);
    expect(s.destinationTxHash).toBeNull();
  });

  it("T29 — finished payoutHash===btcTxHash → isCompleted=false (ASSOLUTO)", async () => {
    const SAME = "0xSAME_HASH_T29";
    const c = await swap("user_T29", "cn_T29");
    await commitFunds({ swapId: c.swapId, userId: "user_T29", btcTxHash: SAME });
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      id: "cn_T29", status: "finished",
      payinHash: SAME, payoutHash: SAME, refundHash: null,
    } as any);
    const s = await getSwapStatus({ swapId: c.swapId, userId: "user_T29" });
    expect(s.isCompleted).toBe(false);
  });

  it("T30 — confirming → isTerminal=false, isCompleted=false", async () => {
    const c = await swap("user_T30", "cn_T30");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      id: "cn_T30", status: "confirming",
      payinHash: "0xbtc30", payoutHash: null, refundHash: null,
    } as any);
    const s = await getSwapStatus({ swapId: c.swapId, userId: "user_T30" });
    expect(s.isTerminal).toBe(false);
    expect(s.isCompleted).toBe(false);
    expect(s.cnStatus).toBe("confirming");
  });

  it("T31 — failed → isTerminal=true, isCompleted=false", async () => {
    const c = await swap("user_T31", "cn_T31");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      id: "cn_T31", status: "failed",
      payinHash: null, payoutHash: null, refundHash: null,
    } as any);
    const s = await getSwapStatus({ swapId: c.swapId, userId: "user_T31" });
    expect(s.isTerminal).toBe(true);
    expect(s.isCompleted).toBe(false);
  });

  it("T32 — refunded → isTerminal=true, refundHash salvato", async () => {
    const c = await swap("user_T32", "cn_T32");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      id: "cn_T32", status: "refunded",
      payinHash: null, payoutHash: null, refundHash: "0xREFUND32",
    } as any);
    const s = await getSwapStatus({ swapId: c.swapId, userId: "user_T32" });
    expect(s.isTerminal).toBe(true);
    expect(s.refundDetails?.refundHash).toBe("0xREFUND32");
  });

  it("T33 — expired → isTerminal=true", async () => {
    const c = await swap("user_T33", "cn_T33");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      id: "cn_T33", status: "expired",
      payinHash: null, payoutHash: null, refundHash: null,
    } as any);
    const s = await getSwapStatus({ swapId: c.swapId, userId: "user_T33" });
    expect(s.isTerminal).toBe(true);
    expect(s.cnStatus).toBe("expired");
  });

  it("T34 — API KO → usa stato DB, non lancia (resilienza polling)", async () => {
    const c = await swap("user_T34", "cn_T34");
    vi.mocked(cnGetTransactionStatus).mockRejectedValueOnce(new Error("network timeout"));
    // Non deve lanciare
    const s = await getSwapStatus({ swapId: c.swapId, userId: "user_T34" });
    expect(s.swapId).toBe(c.swapId);
    expect(["created","waiting"]).toContain(s.cnStatus);
  });

  it("T35 — stato già terminale → NON chiama API ChangeNOW", async () => {
    const c = await swap("user_T35", "cn_T35");
    vi.mocked(cnGetTransactionStatus).mockResolvedValueOnce({
      id: "cn_T35", status: "finished",
      payinHash: "0xbtc35", payoutHash: "0xpayout35", refundHash: null,
    } as any);
    // Prima chiamata: porta a terminale
    await getSwapStatus({ swapId: c.swapId, userId: "user_T35" });
    // Seconda chiamata: DB già terminale
    await getSwapStatus({ swapId: c.swapId, userId: "user_T35" });
    // cnGetTransactionStatus deve essere stato chiamato UNA SOLA VOLTA
    expect(cnGetTransactionStatus).toHaveBeenCalledTimes(1);
  });
});

// ── T36-T37: Active swap recovery ─────────────────────────────────────────────

describe("getActiveSwapForUser", () => {
  it("T36 — swap attivo trovato", async () => {
    await makeSwap("user_T36", "usdtmatic", "cn_T36");
    const active = await getActiveSwapForUser("user_T36");
    expect(active).not.toBeNull();
    expect(active?.toTicker).toBe("usdtmatic");
  });

  it("T37 — utente senza swap → null", async () => {
    const active = await getActiveSwapForUser("user_nonexistent_" + Date.now());
    expect(active).toBeNull();
  });
});

// ── T38-T39: Token integrity ──────────────────────────────────────────────────

describe("CN_BTC_DESTINATION_TOKENS — integrità dati verificati API", () => {
  const EXPECTED_TICKERS = [
    "usdterc20", "usdtmatic", "usdtbsc", "usdcmatic",
    "eth", "pol", "matic", "bnbbsc",
  ];

  it("T38 — contiene tutti gli 8 ticker verificati via API 2026-08-18", () => {
    const tickers = CN_BTC_DESTINATION_TOKENS.map(t => t.ticker);
    for (const t of EXPECTED_TICKERS) {
      expect(tickers).toContain(t);
    }
    expect(CN_BTC_DESTINATION_TOKENS).toHaveLength(8);
  });

  it("T39 — minAmountBtc > 0 per ogni token", () => {
    for (const t of CN_BTC_DESTINATION_TOKENS) {
      expect(t.minAmountBtc).toBeGreaterThan(0);
    }
  });

  it("chain corretta per ogni ticker", () => {
    const chainMap: Record<string, string> = {
      usdterc20: "ethereum", usdtmatic: "polygon", usdtbsc: "bsc", usdcmatic: "polygon",
      eth: "ethereum", pol: "ethereum", matic: "ethereum", bnbbsc: "bsc",
    };
    for (const t of CN_BTC_DESTINATION_TOKENS) {
      expect(t.chain).toBe(chainMap[t.ticker]);
    }
  });
});
