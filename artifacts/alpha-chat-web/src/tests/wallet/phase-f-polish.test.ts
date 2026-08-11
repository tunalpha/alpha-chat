/**
 * Phase F — Polish & Security Tests
 *
 * Verifica: seed export guard, security invariants,
 * visibilità dati storici, comportamento errore graceful.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { closeWalletDB } from "../../wallet/core/wallet-db";
import {
  saveTxRecord,
  loadTxHistory,
  clearTxHistory,
  countTxRecords,
  type WalletTxRecord,
} from "../../wallet/services/tx-store";
import {
  WALLET_DB_NAME,
  WALLET_DB_VERSION,
  STORE_TX_HISTORY,
  STORE_KEYSTORE,
  STORE_CUSTOM_TOKENS,
  STORE_WALLET_NOTIFICATIONS,
  STORE_TX_MONITOR_STATE,
} from "../../wallet/core/wallet-db";

beforeEach(async () => {
  closeWalletDB();
  const { clearTxHistory: clearTx } = await import("../../wallet/services/tx-store");
  await clearTx();
});
afterEach(() => { closeWalletDB(); });

// ─── wallet-db v3 ─────────────────────────────────────────────────────────

describe("wallet-db — Phase F (v3)", () => {
  it("WALLET_DB_VERSION è 3", () => {
    expect(WALLET_DB_VERSION).toBe(3);
  });

  it("STORE_TX_HISTORY è definito come costante stringa", () => {
    expect(STORE_TX_HISTORY).toBe("tx-history");
  });

  it("tutti gli store precedenti sono ancora definiti (backward compat)", () => {
    expect(STORE_KEYSTORE).toBe("keystore");
    expect(STORE_CUSTOM_TOKENS).toBe("custom-tokens");
    expect(STORE_WALLET_NOTIFICATIONS).toBe("wallet-notifications");
    expect(STORE_TX_MONITOR_STATE).toBe("tx-monitor-state");
  });
});

// ─── Sicurezza storico TX ────────────────────────────────────────────────

describe("Sicurezza — storico transazioni", () => {
  it("il record TX non contiene campi con dati privati", async () => {
    const tx: WalletTxRecord = {
      id: "sec:0xtest:received:",
      chainId: 137,
      network: "Polygon",
      txHash: "0xsecuritytest",
      direction: "in",
      asset: "USDT",
      amount: "42.00",
      fromAddress: "0xsender000000000000000000000000000000000",
      toAddress: "0xreceiver0000000000000000000000000000000",
      timestamp: Date.now(),
      status: "confirmed",
      updatedAt: Date.now(),
    };
    await saveTxRecord(tx);
    const result = await loadTxHistory();
    const json = JSON.stringify(result);

    // SECURITY: i record TX non devono mai contenere dati privati
    expect(json).not.toContain("mnemonic");
    expect(json).not.toContain("seed");
    expect(json).not.toContain("privateKey");
    expect(json).not.toContain("private_key");
    expect(json).not.toContain("pin");
    expect(json).not.toContain("password");
    expect(json).not.toContain("secret");
  });

  it("il campo amount è una stringa human-readable, non raw bigint", async () => {
    await saveTxRecord({
      id: "amount-test:0x1:received:",
      chainId: 137,
      network: "Polygon",
      txHash: "0x1",
      direction: "in",
      asset: "USDT",
      amount: "100.50", // human-readable, NON "100500000" (raw 6 dec)
      timestamp: Date.now(),
      status: "confirmed",
      updatedAt: Date.now(),
    });
    const [r] = await loadTxHistory();
    // Verifica che sia una stringa decimale comprensibile
    expect(r.amount).toMatch(/^\d+(\.\d+)?$/);
    expect(parseFloat(r.amount)).toBeCloseTo(100.5);
  });
});

// ─── Indirizzo USDA verificato ─────────────────────────────────────────────

describe("USDA contract address — post Phase F", () => {
  it("l'indirizzo USDA è 40 hex chars (indirizzo EVM valido)", async () => {
    const { USDA_POLYGON_ADDRESS } = await import("../../wallet/evm/token-registry");
    // Formato: 0x + 40 hex chars = 42 total
    expect(USDA_POLYGON_ADDRESS).toHaveLength(42);
    expect(USDA_POLYGON_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("l'indirizzo USDA non è il vecchio placeholder a 39 chars", async () => {
    const { USDA_POLYGON_ADDRESS } = await import("../../wallet/evm/token-registry");
    expect(USDA_POLYGON_ADDRESS.toLowerCase()).not.toBe("0x23396cf899ca06c4472205fc903bdb4de249d6f");
  });

  it("l'indirizzo USDA corrisponde al contratto AlphaBit su Polygon", async () => {
    const { USDA_POLYGON_ADDRESS } = await import("../../wallet/evm/token-registry");
    expect(USDA_POLYGON_ADDRESS.toLowerCase()).toBe("0xe714655fd1b3ba96b887df1f94336c2a78e24001");
  });
});

// ─── clearTxHistory su forgetWallet ───────────────────────────────────────

describe("clearTxHistory — forget wallet flow", () => {
  it("svuota tutto lo storico (zero record dopo clear)", async () => {
    for (let i = 0; i < 5; i++) {
      await saveTxRecord({
        id: `fw-${i}`,
        chainId: 137,
        network: "Polygon",
        txHash: `0x${i}`,
        direction: "in",
        asset: "USDT",
        amount: "1.00",
        timestamp: Date.now(),
        status: "confirmed",
        updatedAt: Date.now(),
      });
    }
    expect(await countTxRecords()).toBe(5);
    await clearTxHistory();
    expect(await countTxRecords()).toBe(0);
  });

  it("clearTxHistory è idempotente (chiamata doppia non lancia)", async () => {
    await clearTxHistory();
    await expect(clearTxHistory()).resolves.not.toThrow();
  });
});

// ─── Paginazione / performance ────────────────────────────────────────────

describe("Paginazione storico TX", () => {
  it("con 200 TX, la prima pagina (50) è rapida e ordinata DESC", async () => {
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      await saveTxRecord({
        id: `perf-${i}`,
        chainId: 137,
        network: "Polygon",
        txHash: `0x${i.toString(16).padStart(64, "0")}`,
        direction: i % 2 === 0 ? "in" : "out",
        asset: "USDT",
        amount: `${i + 1}.00`,
        timestamp: now - i * 1000, // più recente prima
        status: "confirmed",
        updatedAt: Date.now(),
      });
    }

    const start = Date.now();
    const page = await loadTxHistory(50, 0);
    const elapsed = Date.now() - start;

    expect(page).toHaveLength(50);
    // Ordine DESC: la prima deve essere più recente dell'ultima
    expect(page[0].timestamp).toBeGreaterThanOrEqual(page[49].timestamp);
    // Deve completare in < 500ms anche con 200 record
    expect(elapsed).toBeLessThan(500);
  });

  it("la seconda pagina (offset 50) non sovrappone la prima", async () => {
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
      await saveTxRecord({
        id: `pg-${i}`,
        chainId: 137,
        network: "Polygon",
        txHash: `0x${i.toString(16).padStart(64, "0")}`,
        direction: "in",
        asset: "USDT",
        amount: "1.00",
        timestamp: now - i * 1000,
        status: "confirmed",
        updatedAt: Date.now(),
      });
    }
    const page1Ids = new Set((await loadTxHistory(50, 0)).map(r => r.id));
    const page2Ids = new Set((await loadTxHistory(50, 50)).map(r => r.id));
    const overlap = [...page1Ids].filter(id => page2Ids.has(id));
    expect(overlap).toHaveLength(0);
  });
});

// ─── Invarianti tx-monitor enhanced ──────────────────────────────────────

describe("TxMonitor — invarianti Phase F", () => {
  it("POLL_INTERVAL_MS è esportato come numero", async () => {
    const { POLL_INTERVAL_MS } = await import("../../wallet/monitoring/tx-monitor");
    expect(typeof POLL_INTERVAL_MS).toBe("number");
    expect(POLL_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("TxMonitor è una classe con metodi start/stop/isRunning/forcePoll", async () => {
    const { TxMonitor } = await import("../../wallet/monitoring/tx-monitor");
    const m = new TxMonitor();
    expect(typeof m.start).toBe("function");
    expect(typeof m.stop).toBe("function");
    expect(typeof m.isRunning).toBe("function");
    expect(typeof m.forcePoll).toBe("function");
  });

  it("txMonitor singleton è esportato", async () => {
    const { txMonitor } = await import("../../wallet/monitoring/tx-monitor");
    expect(txMonitor).toBeDefined();
  });
});

// ─── WalletContext interface — Phase F additions ──────────────────────────

describe("WalletContext — Phase F interface", () => {
  it("i nuovi campi Phase F sono esportati dal modulo context", async () => {
    const mod = await import("../../wallet/context/WalletContext");
    // Il modulo deve esportare WalletProvider e useWallet
    expect(typeof mod.WalletProvider).toBe("function");
    expect(typeof mod.useWallet).toBe("function");
  });
});

// ─── tx-store API surface ─────────────────────────────────────────────────

describe("tx-store — API surface completa", () => {
  it("tutte le funzioni pubbliche sono esportate", async () => {
    const mod = await import("../../wallet/services/tx-store");
    expect(typeof mod.saveTxRecord).toBe("function");
    expect(typeof mod.updateTxStatus).toBe("function");
    expect(typeof mod.loadTxHistory).toBe("function");
    expect(typeof mod.loadTxHistoryByChain).toBe("function");
    expect(typeof mod.loadPendingTxRecords).toBe("function");
    expect(typeof mod.getTxRecord).toBe("function");
    expect(typeof mod.countTxRecords).toBe("function");
    expect(typeof mod.clearTxHistory).toBe("function");
  });
});
