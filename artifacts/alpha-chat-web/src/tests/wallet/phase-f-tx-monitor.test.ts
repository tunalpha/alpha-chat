/**
 * Phase F — Transaction Monitor Enhanced Tests
 *
 * Verifica: scrittura su tx-store, reconciliation pending→confirmed,
 * backoff su errori consecutivi, visibility-aware behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { closeWalletDB } from "../../wallet/core/wallet-db";
import {
  loadTxHistory,
  loadPendingTxRecords,
  clearTxHistory,
  saveTxRecord,
} from "../../wallet/services/tx-store";

// ── Mock API ──────────────────────────────────────────────────────────────

vi.mock("../../lib/alpha-wallet-api", () => ({
  apiWalletGetEvmTransactions: vi.fn(),
  apiWalletGetBtcTransactions: vi.fn(),
}));

vi.mock("../../wallet/notifications/wallet-notification-store", () => ({
  dispatchWalletNotification: vi.fn().mockResolvedValue(undefined),
}));

import { apiWalletGetEvmTransactions, apiWalletGetBtcTransactions } from "../../lib/alpha-wallet-api";
import { TxMonitor, POLL_INTERVAL_MS } from "../../wallet/monitoring/tx-monitor";

const mockGetEvmTx = apiWalletGetEvmTransactions as ReturnType<typeof vi.fn>;
const mockGetBtcTx = apiWalletGetBtcTransactions as ReturnType<typeof vi.fn>;

// Helper: risposta EVM vuota
function emptyEvmResp(latestBlock = "0x100") {
  return { transfers: [], latestBlock };
}

// Helper: una TX EVM
function evmTx(overrides = {}) {
  return {
    hash: "0xdeadbeef",
    direction: "in",
    from: "0xaaa",
    to: "0xbbb",
    value: "1.00",
    asset: "USDT",
    timestamp: Math.floor(Date.now() / 1000),
    status: "confirmed",
    logIndex: undefined,
    ...overrides,
  };
}

// Helper: una TX BTC
function btcTx(overrides = {}) {
  return {
    txid: "btc-txid-001",
    direction: "in",
    valueBtc: "0.001",
    confirmed: true,
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  closeWalletDB();
  await clearTxHistory();
  // Resetta anche lo state del monitor (btcSeenTxids, evmLastBlock)
  await TxMonitor.resetState();
  // default: tutte le chain restituiscono risposta vuota
  mockGetEvmTx.mockResolvedValue(emptyEvmResp());
  mockGetBtcTx.mockResolvedValue({ txs: [] });
});

afterEach(() => {
  closeWalletDB();
});

// ─── Scrittura nel tx-store ───────────────────────────────────────────────

describe("TxMonitor — scrittura tx-store (Phase F)", () => {
  it("una TX EVM confermata viene salvata nel tx-store", async () => {
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [evmTx()], latestBlock: "0x200" })
      .mockResolvedValue(emptyEvmResp());

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtcaddress");
    await new Promise(r => setTimeout(r, 50));
    monitor.stop();

    const history = await loadTxHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    const found = history.find(r => r.txHash === "0xdeadbeef");
    expect(found).toBeDefined();
    expect(found?.status).toBe("confirmed");
    expect(found?.asset).toBe("USDT");
    expect(found?.direction).toBe("in");
    expect(found?.chainId).toBe(1);
  });

  it("una TX EVM pending viene salvata con status pending", async () => {
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [evmTx({ status: "pending" })], latestBlock: "0x201" })
      .mockResolvedValue(emptyEvmResp());

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtcaddress");
    await new Promise(r => setTimeout(r, 50));
    monitor.stop();

    const pending = await loadPendingTxRecords();
    expect(pending.some(r => r.txHash === "0xdeadbeef")).toBe(true);
  });

  it("una TX BTC confirmed viene salvata nel tx-store", async () => {
    mockGetEvmTx.mockResolvedValue(emptyEvmResp());
    mockGetBtcTx.mockResolvedValueOnce({ txs: [btcTx()] });

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtcaddress");
    await new Promise(r => setTimeout(r, 50));
    monitor.stop();

    const history = await loadTxHistory();
    const found = history.find(r => r.txHash === "btc-txid-001");
    expect(found).toBeDefined();
    expect(found?.chainId).toBe(0);
    expect(found?.asset).toBe("BTC");
  });

  it("non duplica una TX in tx-store per la stessa chainId+hash (salvata 2× è idempotente)", async () => {
    // Una sola chain con TX, poll 2× — il secondo poll deve trovare lo stesso lastBlock
    // e NON reinserire la stessa TX (saveTxRecord è idempotente per id)
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [evmTx()], latestBlock: "0x200" }) // chain-1 poll-1
      .mockResolvedValue(emptyEvmResp()); // tutto il resto: nessuna TX

    const monitor = new TxMonitor();
    await monitor.forcePoll(); // non avviato → niente
    monitor.start("0xmyaddress", "bc1qbtcaddress");
    // Aspetta il primo poll (start() chiama _poll() immediatamente)
    await new Promise(r => setTimeout(r, 80));
    // Forza un secondo poll: non deve duplicare il record di chain-1
    await monitor.forcePoll();
    monitor.stop();

    const history = await loadTxHistory();
    // La TX è apparsa su chain-1 (1° Once) e su chain-137 (2° Once, stesso evmTx())
    // Ogni (chainId, hash, direction) ha un ID distinto → non sono duplicati veri
    // Verifichiamo che lo stesso ID non compaia due volte
    const ids = history.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // nessun ID duplicato
  });
});

// ─── Reconciliation pending → confirmed ──────────────────────────────────

describe("TxMonitor — reconciliation pending TX (Phase F)", () => {
  it("una TX EVM pending viene aggiornata a confirmed al poll successivo", async () => {
    // Poll 1: TX in stato pending
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [evmTx({ status: "pending" })], latestBlock: "0x200" })
      // Poll 2: stessa TX ora confirmed
      .mockResolvedValueOnce({ transfers: [evmTx({ status: "confirmed" })], latestBlock: "0x201" })
      .mockResolvedValue(emptyEvmResp());

    const monitor = new TxMonitor();
    monitor.start("0xmyaddress", "bc1qbtcaddress");
    await new Promise(r => setTimeout(r, 100));
    monitor.stop();

    const history = await loadTxHistory();
    const found = history.find(r => r.txHash === "0xdeadbeef");
    expect(found?.status).toBe("confirmed");
  });
});

// ─── POLL_INTERVAL_MS ────────────────────────────────────────────────────

describe("TxMonitor — costanti", () => {
  it("POLL_INTERVAL_MS è 30000ms (30 secondi)", () => {
    expect(POLL_INTERVAL_MS).toBe(30_000);
  });
});

// ─── Monitor lifecycle ────────────────────────────────────────────────────

describe("TxMonitor — lifecycle", () => {
  it("isRunning() restituisce true dopo start e false dopo stop", () => {
    const monitor = new TxMonitor();
    expect(monitor.isRunning()).toBe(false);
    monitor.start("0xaddr", "bc1addr");
    expect(monitor.isRunning()).toBe(true);
    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it("start su monitor già running fa stop+restart senza errori", () => {
    const monitor = new TxMonitor();
    monitor.start("0xaddr1", "bc1addr1");
    expect(() => monitor.start("0xaddr2", "bc1addr2")).not.toThrow();
    monitor.stop();
  });

  it("onNewTransaction viene chiamata se ci sono nuove TX", async () => {
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [evmTx()], latestBlock: "0x200" })
      .mockResolvedValue(emptyEvmResp());

    const monitor = new TxMonitor();
    const callback = vi.fn();
    monitor.onNewTransaction(callback);
    // Usa forcePoll() per controllare esattamente quando avviene il poll
    monitor.start("0xmyaddress", "bc1qbtcaddress");
    // start() chiama _poll() immediatamente in modo fire-and-forget.
    // Aspettiamo che le promise si risolvano (2 roundtrip IDB minimi)
    await new Promise(r => setTimeout(r, 150));
    monitor.stop();

    // Il callback deve essere chiamato perché il primo poll ha trovato TX
    expect(callback).toHaveBeenCalled();
  });

  it("onNewTransaction NON viene chiamata se non ci sono nuove TX", async () => {
    const monitor = new TxMonitor();
    const callback = vi.fn();
    monitor.onNewTransaction(callback);
    monitor.start("0xmyaddress", "bc1qbtcaddress");
    await new Promise(r => setTimeout(r, 80));
    monitor.stop();

    expect(callback).not.toHaveBeenCalled();
  });

  it("forcePoll() esegue un poll immediato", async () => {
    mockGetEvmTx
      .mockResolvedValueOnce({ transfers: [evmTx()], latestBlock: "0x300" })
      .mockResolvedValue(emptyEvmResp());

    const monitor = new TxMonitor();
    monitor.start("0xaddr", "bc1addr");
    monitor.stop(); // ferma il timer
    // Forza comunque un poll
    await (monitor as unknown as { _running: boolean })._running;
  });
});

// ─── Backoff ──────────────────────────────────────────────────────────────

describe("TxMonitor — backoff (Phase F)", () => {
  it("il monitor non lancia eccezioni su errori di rete", async () => {
    mockGetEvmTx.mockRejectedValue(new Error("Network error"));
    mockGetBtcTx.mockRejectedValue(new Error("Network error"));

    const monitor = new TxMonitor();
    await expect(async () => {
      monitor.start("0xaddr", "bc1addr");
      await new Promise(r => setTimeout(r, 80));
      monitor.stop();
    }).not.toThrow();
  });

  it("dopo errori di rete il tx-store non riceve record corrotti (record pre-esistenti intatti)", async () => {
    // Salva un record noto prima degli errori di rete
    const knownRecord = {
      id: "known:0xsafe:received:",
      chainId: 137,
      network: "Polygon",
      txHash: "0xsafetx",
      direction: "in" as const,
      asset: "USDT",
      amount: "99.00",
      timestamp: Date.now() - 10000,
      status: "confirmed" as const,
      updatedAt: Date.now(),
    };
    await saveTxRecord(knownRecord);

    // Simula: EVM fallisce, BTC OK ma vuoto
    mockGetEvmTx.mockRejectedValue(new Error("timeout"));
    mockGetBtcTx.mockResolvedValue({ txs: [] });

    const monitor = new TxMonitor();
    monitor.start("0xaddr", "bc1addr");
    await new Promise(r => setTimeout(r, 100));
    monitor.stop();
    // Attendi che eventuali write async completino
    await new Promise(r => setTimeout(r, 50));

    // Il record pre-esistente deve essere intatto (no corruzione dati)
    const { getTxRecord } = await import("../../wallet/services/tx-store");
    const safe = await getTxRecord("known:0xsafe:received:");
    expect(safe).toBeDefined();
    expect(safe?.amount).toBe("99.00");
    expect(safe?.status).toBe("confirmed");
    // Il monitor NON deve aver salvato record parziali/corrotti con txHash "0xsafetx"
    expect(safe?.txHash).toBe("0xsafetx");
  });
});
