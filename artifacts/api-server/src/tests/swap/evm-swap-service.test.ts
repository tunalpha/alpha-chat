/**
 * Test: EVM Swap Service
 *
 * Copre:
 *   T1  — startSwap crea record in stato pending
 *   T2  — startSwap è idempotente su routeId duplicato
 *   T3  — startSwap accetta toChainId=0 (Bitcoin cross-chain)
 *   T4  — startSwap rifiuta fromAmount=0
 *   T5  — completeSwap aggiorna stato a completed
 *   T6  — completeSwap ritorna null se routeId non esiste
 *   T7  — importHistorical inserisce record con fee calcolata
 *   T8  — importHistorical è idempotente su txHash duplicato
 *   T9  — importHistorical importa tutti gli 11 record storici senza errori
 *   T10 — adminGetAggregate aggrega per chain e token
 *   T11 — adminGetAggregate considera solo swap completed
 *   T12 — deduplicazione: due import dello stesso file non creano duplicati
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock mongoose per zero connessioni reali
vi.mock("../../models/EvmSwap.js", () => {
  // In-memory store per simulare MongoDB
  const store: Map<string, Record<string, unknown>> = new Map();
  let idCounter = 0;

  function makeDoc(data: Record<string, unknown>): Record<string, unknown> {
    const id = String(++idCounter);
    return { _id: id, ...data };
  }

  const EvmSwapModel = {
    _store: store,
    _reset() { store.clear(); idCounter = 0; },

    async findOne(query: Record<string, unknown>) {
      for (const doc of store.values()) {
        const routeMatch  = !query.routeId  || doc.routeId  === query.routeId;
        const userMatch   = !query.userId   || doc.userId   === query.userId;
        const stateMatch  = !query.state    || doc.state    === query.state;
        if (routeMatch && userMatch && stateMatch) return doc;
      }
      return null;
    },

    // Mongoose find() è sincrono — ritorna un query object chainabile.
    // NON async: il service chiama .lean() direttamente sul valore di ritorno.
    find(query: Record<string, unknown> = {}) {
      const results: Record<string, unknown>[] = [];
      for (const doc of store.values()) {
        const stateMatch = !("state" in query) || doc.state === query.state;
        if (stateMatch) results.push(doc);
      }
      const q = {
        sort:  () => q,
        limit: () => q,
        lean:  () => Promise.resolve(results),
        then:  undefined as unknown,   // non è thenable da solo
      };
      return q;
    },

    async create(data: Record<string, unknown>) {
      const doc = makeDoc({ ...data, startedAt: data.startedAt ?? new Date(), updatedAt: new Date() });
      store.set(doc.routeId as string, doc);
      return doc;
    },

    async findOneAndUpdate(
      query: Record<string, unknown>,
      update: Record<string, unknown>,
      opts: Record<string, unknown> = {},
    ) {
      for (const [key, doc] of store.entries()) {
        const routeMatch = !query.routeId || doc.routeId === query.routeId;
        const userMatch  = !query.userId  || doc.userId  === query.userId;
        if (routeMatch && userMatch) {
          const set = (update as { $set?: Record<string, unknown> }).$set ?? {};
          const updated = { ...doc, ...set, updatedAt: new Date() };
          store.set(key, updated);
          return opts.new ? updated : doc;
        }
      }
      return null;
    },
  };

  return { EvmSwapModel };
});

import { evmSwapService } from "../../services/swap/evm-swap.service.js";
import { EvmSwapModel   } from "../../models/EvmSwap.js";

// Helper: accede allo store interno del mock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = () => (EvmSwapModel as any)._store as Map<string, Record<string, unknown>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reset = () => (EvmSwapModel as any)._reset();

beforeEach(() => reset());
afterEach(() => vi.unstubAllGlobals());

// ── Base swap params ───────────────────────────────────────────────────────────

const BASE_START = {
  userId:      "user-001",
  routeId:     "route-abc-123",
  fromChainId: 137,
  toChainId:   137,
  fromToken:   "POL",
  fromAddress: "native",
  toToken:     "USDC",
  toAddress:   "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  fromAmount:  "5000000000000000000",
  toAmount:    "4990000",
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("EVM Swap Service", () => {

  // T1 — startSwap crea record in stato pending
  it("T1 — startSwap crea record pending", async () => {
    const doc = await evmSwapService.startSwap(BASE_START);
    expect(doc.state).toBe("pending");
    expect(doc.routeId).toBe("route-abc-123");
    expect(doc.source).toBe("user_flow");
    expect(store().size).toBe(1);
  });

  // T2 — startSwap è idempotente su routeId duplicato
  it("T2 — startSwap idempotente su routeId duplicato", async () => {
    await evmSwapService.startSwap(BASE_START);
    await evmSwapService.startSwap(BASE_START);   // secondo call
    expect(store().size).toBe(1);                 // ancora 1 record
  });

  // T3 — startSwap accetta toChainId=0 (Bitcoin cross-chain)
  it("T3 — startSwap accetta toChainId=0 (BTC)", async () => {
    const doc = await evmSwapService.startSwap({
      ...BASE_START,
      routeId:     "route-btc-001",
      toChainId:   0,
      toToken:     "BTC",
      toAddress:   "unknown",
    });
    expect(doc.toChainId).toBe(0);
    expect(doc.state).toBe("pending");
  });

  // T4 — startSwap rifiuta fromAmount=0
  it("T4 — startSwap rifiuta fromAmount zero", async () => {
    await expect(
      evmSwapService.startSwap({ ...BASE_START, fromAmount: "0" }),
    ).rejects.toThrow("fromAmount non può essere zero");
  });

  // T5 — solo il provider verificato può completare il journal
  it("T5 — reconcileSwap aggiorna a completed dopo verifica provider", async () => {
    await evmSwapService.startSwap(BASE_START);
    const source = `0x${"a".repeat(64)}`;
    const destination = `0x${"b".repeat(64)}`;
    await evmSwapService.recordSourceTransaction("route-abc-123", "user-001", source);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "DONE", sending: { chainId: 137, txHash: source }, receiving: { chainId: 137, txHash: destination } }),
    }));
    const result = await evmSwapService.reconcileSwap("route-abc-123", "user-001");
    expect(result?.swap.state).toBe("completed");
    expect(result?.swap.txHash).toBe(destination);
    expect(result?.swap.completedAt).toBeDefined();
  });

  // T6 — reconcileSwap ritorna null se routeId non esiste
  it("T6 — reconcileSwap null per routeId inesistente", async () => {
    expect(await evmSwapService.reconcileSwap("route-non-esistente", "user-001")).toBeNull();
  });

  it("T6a — journal BTC registra il deposito una sola volta", async () => {
    const btcTxid = "a".repeat(64);
    const doc = await evmSwapService.startSwap({
      ...BASE_START,
      routeId:           "route-lifi-btc-journal",
      fromChainId:       20_000_000_000_001,
      fromToken:         "BTC",
      fromAddress:       "bc1qsource",
      btcDepositAddress: "bc1qvault",
      btcMemo:           "=:ETH.ETH:0xrecipient",
      btcPsbtDigest:     "b".repeat(64),
    });
    expect(doc.btcPsbtDigest).toBe("b".repeat(64));

    const recorded = await evmSwapService.recordBtcDeposit(doc.routeId, "user-001", btcTxid);
    expect(recorded?.btcDepositTxHash).toBe(btcTxid);
    await expect(evmSwapService.recordBtcDeposit(doc.routeId, "user-001", btcTxid)).resolves.toBeDefined();
    await expect(evmSwapService.recordBtcDeposit(doc.routeId, "user-001", "c".repeat(64)))
      .rejects.toThrow("LIFI_SOURCE_TX_ALREADY_RECORDED");
  });

  it("T6b — source mismatch provider non può completare BTC→EVM", async () => {
    const sourceTxid = "a".repeat(64);
    const destinationTx = `0x${"b".repeat(64)}`;
    const doc = await evmSwapService.startSwap({
      ...BASE_START,
      routeId:           "route-lifi-btc-complete",
      fromChainId:       20_000_000_000_001,
      fromToken:         "BTC",
      fromAddress:       "bc1qsource",
      btcDepositAddress: "bc1qvault",
      btcMemo:           "=:ETH.ETH:0xrecipient",
      btcPsbtDigest:     "c".repeat(64),
    });
    await evmSwapService.recordBtcDeposit(doc.routeId, "user-001", sourceTxid);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "DONE",
        sending: { chainId: 20_000_000_000_001, txHash: "d".repeat(64) },
        receiving: { chainId: 137, txHash: destinationTx },
      }),
    }));
    const pending = await evmSwapService.reconcileSwap(doc.routeId, "user-001");
    expect(pending?.swap.state).toBe("processing");
    expect(pending?.swap.providerStatus).toBe("SOURCE_TX_MISMATCH");
  });

  it("T6c — payout Li.FI mancante non può completare BTC→EVM", async () => {
    const sourceTxid = "e".repeat(64);
    const doc = await evmSwapService.startSwap({
      ...BASE_START, routeId: "route-lifi-btc-mismatch", fromChainId: 20_000_000_000_001,
      fromToken: "BTC", fromAddress: "bc1qsource", btcDepositAddress: "bc1qvault",
      btcMemo: "=:ETH.ETH:0xrecipient", btcPsbtDigest: "1".repeat(64),
    });
    await evmSwapService.recordBtcDeposit(doc.routeId, "user-001", sourceTxid);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "DONE",
        sending: { chainId: 20_000_000_000_001, txHash: sourceTxid },
        receiving: { chainId: 137 },
      }),
    }));
    const pending = await evmSwapService.reconcileSwap(doc.routeId, "user-001");
    expect(pending?.swap.state).toBe("processing");
    expect(pending?.swap.providerStatus).toBe("PAYOUT_TX_MISSING");
  });

  it.each([
    ["FAILED", "failed"],
    ["REFUNDED", "refunded"],
    ["EXPIRED", "expired"],
  ] as const)("T6d — status provider %s termina il journal come %s", async (providerStatus, expectedState) => {
    const routeId = `route-terminal-${providerStatus}`;
    await evmSwapService.startSwap({ ...BASE_START, routeId });
    await evmSwapService.recordSourceTransaction(routeId, "user-001", `0x${"a".repeat(64)}`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: providerStatus }),
    }));
    const result = await evmSwapService.reconcileSwap(routeId, "user-001");
    expect(result?.swap.state).toBe(expectedState);
    expect(result?.swap.completedAt).toBeDefined();
  });

  // T7 — importHistorical inserisce record con fee calcolata correttamente
  it("T7 — importHistorical inserisce con fee 25 bps", async () => {
    const result = await evmSwapService.importHistorical([{
      txHash:      "0x72593e68aa5f412a935e7d89c7c3d3344ac6dc86bc15f1b9505caabbcc3579e9",
      fromChainId: 1,
      toChainId:   0,
      fromToken:   "USDT",
      toToken:     "BTC",
      volumeUSD:   14.97,
      tool:        "Layerswap",
      timestamp:   new Date("2026-08-17T15:57:00.000Z"),
    }]);

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(store().size).toBe(1);

    const doc = [...store().values()][0];
    expect(doc.source).toBe("historical_import");
    expect(doc.state).toBe("completed");
    expect(doc.alphaFeeUSD).toBe("0.037425");  // 14.97 × 0.0025
    expect(doc.volumeUSD).toBe("14.97");
  });

  // T8 — importHistorical è idempotente su txHash duplicato
  it("T8 — importHistorical skip su txHash duplicato", async () => {
    const rec = {
      txHash:      "0xbe37765dc7f9e9f64518d8da4dbb21eafde66b23f3bbacace7e8a1d69108c0e4",
      fromChainId: 56,
      toChainId:   56,
      fromToken:   "USDC",
      toToken:     "USDT",
      volumeUSD:   1.11,
      tool:        "Fly",
      timestamp:   new Date("2026-08-17T15:38:00.000Z"),
    };

    const r1 = await evmSwapService.importHistorical([rec]);
    const r2 = await evmSwapService.importHistorical([rec]);  // secondo import

    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(1);
    expect(store().size).toBe(1);  // ancora 1 record
  });

  // T9 — importHistorical importa tutti gli 11 record storici
  it("T9 — importa tutti gli 11 record storici senza errori", async () => {
    const ALL_RECORDS = [
      { txHash: "0x72593e68aa5f412a935e7d89c7c3d3344ac6dc86bc15f1b9505caabbcc3579e9", fromChainId: 1,   toChainId: 0,   fromToken: "USDT", toToken: "BTC",  volumeUSD: 14.97, tool: "Layerswap",   timestamp: new Date("2026-08-17T15:57:00.000Z") },
      { txHash: "0xfe5e5b281e8e8b640536a2734e6250e55aa2b8b2002fa142d731267a5552ed15", fromChainId: 1,   toChainId: 137, fromToken: "USDT", toToken: "POL",  volumeUSD: 4.99,  tool: "Near",        timestamp: new Date("2026-08-17T15:54:00.000Z") },
      { txHash: "0xbe37765dc7f9e9f64518d8da4dbb21eafde66b23f3bbacace7e8a1d69108c0e4", fromChainId: 56,  toChainId: 56,  fromToken: "USDC", toToken: "USDT", volumeUSD: 1.11,  tool: "Fly",         timestamp: new Date("2026-08-17T15:38:00.000Z") },
      { txHash: "0x385a49638cd50c7e5480f1e1c94613a461cb5ae53801b2a2a8b6845a6e387834", fromChainId: 56,  toChainId: 56,  fromToken: "BNB",  toToken: "USDC", volumeUSD: 1.16,  tool: "Nordstern",   timestamp: new Date("2026-08-17T12:08:00.000Z") },
      { txHash: "0xf61fc3fe54151e60370ea09c2a10bf3531d3bd616ad21bab9d3fffd9c3c90755", fromChainId: 137, toChainId: 137, fromToken: "POL",  toToken: "USDC", volumeUSD: 0.89,  tool: "Sushiswap",   timestamp: new Date("2026-08-17T11:44:00.000Z") },
      { txHash: "0x62779366cb8f050fc21650ecd99983b0b70ba95a9570684685e2e0c2b1aaaf67", fromChainId: 56,  toChainId: 137, fromToken: "BNB",  toToken: "POL",  volumeUSD: 1.16,  tool: "Gaszipbridge", timestamp: new Date("2026-08-17T08:36:00.000Z") },
      { txHash: "0x170b80f1ef2cb8eb5bcd1238192644ffeff47349de7b7229d747f037e7a831ea", fromChainId: 56,  toChainId: 56,  fromToken: "BNB",  toToken: "USDC", volumeUSD: 1.16,  tool: "Nordstern",   timestamp: new Date("2026-08-17T08:23:00.000Z") },
      { txHash: "0x13896d702a96a980b9263e9d430612d9b2c6fde76720d0732acef28ef67c9c31", fromChainId: 137, toChainId: 137, fromToken: "POL",  toToken: "USDC", volumeUSD: 0.13,  tool: "Sushiswap",   timestamp: new Date("2026-08-17T07:49:00.000Z") },
      { txHash: "0xbf69f30636013bf129743e194d3b0b5d6b9a946da78047d3c72bb6dbda20bd08", fromChainId: 56,  toChainId: 56,  fromToken: "BNB",  toToken: "USDC", volumeUSD: 1.16,  tool: "Nordstern",   timestamp: new Date("2026-08-17T07:44:00.000Z") },
      { txHash: "0xcda68c55207d06de46ac493ceb24880572ad86780526eb7f92c2b18d45cd9832", fromChainId: 56,  toChainId: 56,  fromToken: "BNB",  toToken: "USDC", volumeUSD: 1.00,  tool: "Nordstern",   timestamp: new Date("2026-08-17T07:10:00.000Z") },
      { txHash: "0x762189568ccbefdd9470bdf6298af1411463a2a36970bcf55dbf898864ce0112", fromChainId: 137, toChainId: 137, fromToken: "POL",  toToken: "USDC", volumeUSD: 0.04,  tool: "Sushiswap",   timestamp: new Date("2026-08-16T18:17:00.000Z") },
    ];

    const result = await evmSwapService.importHistorical(ALL_RECORDS);
    expect(result.inserted).toBe(11);
    expect(result.skipped).toBe(0);
    expect(store().size).toBe(11);
  });

  // T10 — adminGetAggregate aggrega per chain e token
  it("T10 — adminGetAggregate calcola aggregati corretti", async () => {
    await evmSwapService.importHistorical([
      { txHash: "0xaaa1", fromChainId: 137, toChainId: 137, fromToken: "POL",  toToken: "USDC", volumeUSD: 0.89, tool: "Sushi", timestamp: new Date() },
      { txHash: "0xaaa2", fromChainId: 56,  toChainId: 56,  fromToken: "BNB",  toToken: "USDC", volumeUSD: 1.16, tool: "Nord",  timestamp: new Date() },
      { txHash: "0xaaa3", fromChainId: 137, toChainId: 137, fromToken: "POL",  toToken: "USDC", volumeUSD: 0.13, tool: "Sushi", timestamp: new Date() },
    ]);

    const agg = await evmSwapService.adminGetAggregate();

    expect(agg.totalSwaps).toBe(3);
    // fee totale = (0.89 + 0.13) × 0.0025 + 1.16 × 0.0025 = 0.0025+0.0029 ≈ 0.005450
    expect(parseFloat(agg.totalFeeUSD)).toBeCloseTo(0.00545, 5);
    expect(agg.byChain["Polygon"]).toBeDefined();
    expect(agg.byChain["BSC"]).toBeDefined();
    expect(agg.byChain["Polygon"].count).toBe(2);
    expect(agg.byToken["POL"]).toBeDefined();
    expect(agg.byToken["BNB"]).toBeDefined();
  });

  // T11 — adminGetAggregate considera solo completed
  it("T11 — adminGetAggregate ignora swap non-completed", async () => {
    await evmSwapService.startSwap(BASE_START);  // stato pending
    const agg = await evmSwapService.adminGetAggregate();
    expect(agg.totalSwaps).toBe(0);
  });

  // T12 — deduplicazione: doppio import non crea duplicati
  it("T12 — doppio import non crea duplicati", async () => {
    const records = [
      { txHash: "0xdup1", fromChainId: 56, toChainId: 56, fromToken: "USDC", toToken: "USDT", volumeUSD: 1.11, tool: "Fly", timestamp: new Date() },
      { txHash: "0xdup2", fromChainId: 56, toChainId: 56, fromToken: "BNB",  toToken: "USDC", volumeUSD: 1.16, tool: "Nord", timestamp: new Date() },
    ];

    const r1 = await evmSwapService.importHistorical(records);
    const r2 = await evmSwapService.importHistorical(records);

    expect(r1.inserted).toBe(2);
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(2);
    expect(store().size).toBe(2);  // zero duplicati
  });
});
