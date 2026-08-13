/**
 * TX Monitor Hardening — Regression test suite
 *
 * Verifica che la classe di bug "silent checkpoint advancement" non possa
 * ripresentarsi su nessuna chain supportata.
 *
 * Test richiesti:
 *  1. Una chain con Alchemy error (throw) NON avanza il checkpoint.
 *  2. latestBlock="0x0" NON avanza il checkpoint (belt-and-suspenders frontend guard).
 *  3. Una chain in errore NON impedisce alle altre di avanzare.
 *  4. order:desc — le TX più recenti (blockNum alto) vengono processate.
 *  5. Resync manuale (reset + repoll) NON crea duplicati nel tx-store.
 *  6. Dedup: lo stesso txHash processato 2 volte ha un solo record nel tx-store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { closeWalletDB, getWalletDB, STORE_TX_MONITOR_STATE } from "../../wallet/core/wallet-db";
import {
  loadTxHistory,
  clearTxHistory,
} from "../../wallet/services/tx-store";

// ── Mock API ──────────────────────────────────────────────────────────────

vi.mock("../../lib/alpha-wallet-api", () => ({
  apiWalletGetEvmTransactions: vi.fn(),
  apiWalletGetBtcTransactions: vi.fn(),
  apiWalletGetEvmReceipt: vi.fn(),
}));

vi.mock("../../wallet/notifications/wallet-notification-store", () => ({
  dispatchWalletNotification:  vi.fn().mockResolvedValue(undefined),
  updateNotificationStatus:    vi.fn().mockResolvedValue(undefined),
}));

import { apiWalletGetEvmTransactions, apiWalletGetBtcTransactions } from "../../lib/alpha-wallet-api";
import { TxMonitor, POLL_INTERVAL_MS } from "../../wallet/monitoring/tx-monitor";

const mockGetEvmTx = apiWalletGetEvmTransactions as ReturnType<typeof vi.fn>;
const mockGetBtcTx = apiWalletGetBtcTransactions as ReturnType<typeof vi.fn>;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Legge lo stato del monitor direttamente dall'IDB (senza esporre API interne) */
async function readMonitorState(): Promise<{
  evmLastBlock: Record<number, string>;
  btcSeenTxids: string[];
} | undefined> {
  const db = await getWalletDB();
  return db.get(STORE_TX_MONITOR_STATE, "monitor-state");
}

function evmTxAt(blockNum: string, hash = "0xdeadbeef", chainId = 1) {
  return {
    hash,
    direction: "in" as const,
    from: "0xsender",
    to: "0xmyaddress",
    value: "1.00",
    asset: "USDT",
    blockNum,
    timestamp: Math.floor(Date.now() / 1000),
    status: "confirmed" as const,
    logIndex: undefined,
  };
}

function emptyEvm(latestBlock = "0x100") {
  return { transfers: [], latestBlock };
}

// SUPPORTED_CHAIN_IDS = [1, 137, 56]
// Mock che ritorna un valore diverso per chain
function perChainMock(chainResponses: Record<number, () => Promise<unknown>>) {
  return (chainId: number) => {
    const fn = chainResponses[chainId];
    return fn ? fn() : Promise.resolve(emptyEvm());
  };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();
  closeWalletDB();
  await clearTxHistory();
  await TxMonitor.resetState();
  mockGetBtcTx.mockResolvedValue({ txs: [] });
});

afterEach(() => {
  closeWalletDB();
});

// ─── 1. Alchemy error (throw) NON avanza il checkpoint ───────────────────

describe("Hardening — checkpoint non avanza su errore", () => {
  it("una chain che lancia errore NON salva evmLastBlock nel monitor state", async () => {
    // Chain 1: risposta valida → checkpoint avanza
    // Chain 137: throw (simula ALCHEMY_ERROR dal backend) → checkpoint NON avanza
    // Chain 56: risposta valida → checkpoint avanza
    mockGetEvmTx.mockImplementation(perChainMock({
      1:   () => Promise.resolve(emptyEvm("0xAAAA")),
      137: () => Promise.reject(new Error("ALCHEMY_ERROR: rate limit")),
      56:  () => Promise.resolve(emptyEvm("0xBBBB")),
    }));

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));
    monitor.stop();

    const state = await readMonitorState();
    // Chain 1 e 56 devono aver avanzato
    expect(state?.evmLastBlock[1]).toBe("0xAAAA");
    expect(state?.evmLastBlock[56]).toBe("0xBBBB");
    // Chain 137 ha throwato → checkpoint invariato (undefined)
    expect(state?.evmLastBlock[137]).toBeUndefined();
  });

  it("tutte le chain in errore → nessun evmLastBlock salvato", async () => {
    mockGetEvmTx.mockRejectedValue(new Error("network error"));

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));
    monitor.stop();

    const state = await readMonitorState();
    expect(state?.evmLastBlock[1]).toBeUndefined();
    expect(state?.evmLastBlock[137]).toBeUndefined();
    expect(state?.evmLastBlock[56]).toBeUndefined();
  });
});

// ─── 2. latestBlock="0x0" NON avanza il checkpoint ──────────────────────

describe("Hardening — latestBlock='0x0' soft-failure guard", () => {
  it("risposta con latestBlock='0x0' NON avanza il checkpoint", async () => {
    // Simula il caso in cui eth_blockNumber fallisce lato backend ma non genera throw
    // (es. risposta malformata che bypassa il guard backend)
    mockGetEvmTx.mockImplementation(perChainMock({
      1:   () => Promise.resolve({ transfers: [], latestBlock: "0x0" }),   // soft failure
      137: () => Promise.resolve(emptyEvm("0xCCCC")),                     // reale
      56:  () => Promise.resolve({ transfers: [], latestBlock: "" }),      // falsy
    }));

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));
    monitor.stop();

    const state = await readMonitorState();
    // Chain 1 e 56 avevano latestBlock falsy → NOT advanced
    expect(state?.evmLastBlock[1]).toBeUndefined();
    expect(state?.evmLastBlock[56]).toBeUndefined();
    // Chain 137 aveva latestBlock reale → avanzato
    expect(state?.evmLastBlock[137]).toBe("0xCCCC");
  });

  it("latestBlock='0x0' NON regredisce un checkpoint già avanzato", async () => {
    // Poll 1: chain 1 avanza a "0x500"
    mockGetEvmTx
      .mockResolvedValueOnce(emptyEvm("0x500"))  // chain-1
      .mockResolvedValue(emptyEvm("0x100"));      // chain-137, chain-56, ecc.

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));

    let state = await readMonitorState();
    expect(state?.evmLastBlock[1]).toBe("0x500");

    // Poll 2: chain 1 ritorna "0x0" (soft failure) → checkpoint deve restare "0x500"
    vi.clearAllMocks();
    mockGetBtcTx.mockResolvedValue({ txs: [] });
    mockGetEvmTx.mockImplementation((chainId: number) =>
      chainId === 1
        ? Promise.resolve({ transfers: [], latestBlock: "0x0" })
        : Promise.resolve(emptyEvm()),
    );
    await monitor.forcePoll();

    state = await readMonitorState();
    expect(state?.evmLastBlock[1]).toBe("0x500"); // invariato
    monitor.stop();
  });
});

// ─── 3. Chain parzialmente in errore — le altre chain avanzano ───────────

describe("Hardening — errore parziale non blocca le altre chain", () => {
  it("chain-137 in errore non impedisce chain-1 e chain-56 di avanzare", async () => {
    mockGetEvmTx.mockImplementation(perChainMock({
      1:   () => Promise.resolve(emptyEvm("0xDDDD")),
      137: () => Promise.reject(new Error("timeout")),
      56:  () => Promise.resolve(emptyEvm("0xEEEE")),
    }));

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));
    monitor.stop();

    const state = await readMonitorState();
    expect(state?.evmLastBlock[1]).toBe("0xDDDD");
    expect(state?.evmLastBlock[56]).toBe("0xEEEE");
    expect(state?.evmLastBlock[137]).toBeUndefined();
  });
});

// ─── 4. order:desc — le TX con blockNum maggiore vengono processate ──────

describe("Hardening — order:desc (tx più recenti incluse)", () => {
  it("TX con blockNum alto (recente) viene salvata nel tx-store", async () => {
    // Simula un poll che ritorna una TX con blockNum alto (comportamento order:desc)
    const recentTx = evmTxAt("0xFFFFFF", "0xrecent001");
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [recentTx], latestBlock: "0x1000000" })
      .mockResolvedValue(emptyEvm());

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));
    monitor.stop();

    const history = await loadTxHistory();
    const found = history.find(r => r.txHash === "0xrecent001");
    expect(found).toBeDefined();
    expect(found?.status).toBe("confirmed");
  });

  it("se il backend ritorna TX miste per blockNum, tutte vengono salvate", async () => {
    // order:desc idealmente le ordina, ma il frontend deve salvarle tutte
    const txOld  = evmTxAt("0x0001", "0xoldhash001");
    const txNew  = evmTxAt("0xFFFF", "0xnewhash999");
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [txNew, txOld], latestBlock: "0xFFFF" })
      .mockResolvedValue(emptyEvm());

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));
    monitor.stop();

    const history = await loadTxHistory();
    expect(history.some(r => r.txHash === "0xoldhash001")).toBe(true);
    expect(history.some(r => r.txHash === "0xnewhash999")).toBe(true);
  });
});

// ─── 5. Resync manuale (resetAndRepoll) NON crea duplicati ──────────────

describe("Hardening — dedup dopo resync manuale", () => {
  it("stessa TX processata in due poll successivi → un solo record nel tx-store", async () => {
    const tx = evmTxAt("0xABCD", "0xduphash001");
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [tx], latestBlock: "0xABCD" }) // poll 1 chain-1
      .mockResolvedValue(emptyEvm());

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));

    // Simula resync: reset stato e secondo poll con la stessa TX
    await TxMonitor.resetState();
    vi.clearAllMocks();
    mockGetBtcTx.mockResolvedValue({ txs: [] });
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [tx], latestBlock: "0xABCD" })
      .mockResolvedValue(emptyEvm());

    await monitor.forcePoll();
    monitor.stop();

    const history = await loadTxHistory();
    const matching = history.filter(r => r.txHash === "0xduphash001");
    // Stesso txHash + direction + chainId → stesso ID → un solo record
    expect(matching.length).toBe(1);
  });

  it("più poll con TX diverse → nessun ID duplicato nel tx-store", async () => {
    const tx1 = evmTxAt("0xA001", "0xhash_alpha");
    const tx2 = evmTxAt("0xA002", "0xhash_beta");
    const tx3 = evmTxAt("0xA003", "0xhash_gamma");

    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [tx1],       latestBlock: "0xA001" }) // poll-1 chain-1
      .mockResolvedValueOnce({ transfers: [tx1, tx2],  latestBlock: "0xA002" }) // poll-2 chain-1
      .mockResolvedValueOnce({ transfers: [tx2, tx3],  latestBlock: "0xA003" }) // poll-3 chain-1
      .mockResolvedValue(emptyEvm());

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtc");
    await new Promise(r => setTimeout(r, 60));
    await monitor.forcePoll();
    await monitor.forcePoll();
    monitor.stop();

    const history = await loadTxHistory();
    const ids = history.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // nessun ID duplicato
  });
});

// ─── 6. POLL_INTERVAL_MS è esportato (usato dai test esistenti) ──────────

describe("Hardening — esportazioni richieste", () => {
  it("POLL_INTERVAL_MS è un numero positivo", () => {
    expect(typeof POLL_INTERVAL_MS).toBe("number");
    expect(POLL_INTERVAL_MS).toBeGreaterThan(0);
  });
});
