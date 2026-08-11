/**
 * Phase F — Transaction Store Tests
 *
 * Verifica che il tx-store salvi, aggiorni e carichi correttamente
 * le TX in IndexedDB.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { closeWalletDB } from "../../wallet/core/wallet-db";
import {
  saveTxRecord,
  updateTxStatus,
  loadTxHistory,
  loadTxHistoryByChain,
  loadPendingTxRecords,
  getTxRecord,
  countTxRecords,
  clearTxHistory,
  type WalletTxRecord,
} from "../../wallet/services/tx-store";

// Helper: crea un record TX di test
function makeTx(overrides: Partial<WalletTxRecord> = {}): WalletTxRecord {
  return {
    id:        `test:0xabc:received:`,
    chainId:   137,
    network:   "Polygon",
    txHash:    "0xabc123",
    direction: "in",
    asset:     "USDT",
    amount:    "100.00",
    timestamp: Date.now() - 5000,
    status:    "confirmed",
    updatedAt: Date.now(),
    ...overrides,
  };
}

// Svuota lo store TX prima di ogni test per evitare contaminazione
beforeEach(async () => {
  closeWalletDB();
  await clearTxHistory();
});

afterEach(() => {
  closeWalletDB();
});

// ─── saveTxRecord ─────────────────────────────────────────────────────────

describe("saveTxRecord", () => {
  it("salva un record e lo recupera per id", async () => {
    const tx = makeTx();
    await saveTxRecord(tx);
    const result = await getTxRecord(tx.id);
    expect(result).toBeDefined();
    expect(result?.txHash).toBe("0xabc123");
    expect(result?.status).toBe("confirmed");
  });

  it("non fa downgrade di stato (confirmed → pending ignorato)", async () => {
    const tx = makeTx({ status: "confirmed" });
    await saveTxRecord(tx);
    // Prova a scrivere lo stesso con status pending
    await saveTxRecord({ ...tx, status: "pending" });
    const result = await getTxRecord(tx.id);
    expect(result?.status).toBe("confirmed"); // non degradato
  });

  it("aggiorna i campi se lo status è uguale o più alto", async () => {
    const tx = makeTx({ status: "pending", amount: "50.00" });
    await saveTxRecord(tx);
    await saveTxRecord({ ...tx, status: "confirmed", amount: "50.00", blockNumber: "0x123" });
    const result = await getTxRecord(tx.id);
    expect(result?.status).toBe("confirmed");
    expect(result?.blockNumber).toBe("0x123");
  });

  it("salva più record distinti", async () => {
    await saveTxRecord(makeTx({ id: "a:0x1:received:", chainId: 137 }));
    await saveTxRecord(makeTx({ id: "b:0x2:sent:", chainId: 1 }));
    await saveTxRecord(makeTx({ id: "btc:0x3:in:", chainId: 0 }));
    expect(await countTxRecords()).toBe(3);
  });
});

// ─── updateTxStatus ────────────────────────────────────────────────────────

describe("updateTxStatus", () => {
  it("aggiorna pending → confirmed e restituisce true", async () => {
    const tx = makeTx({ status: "pending" });
    await saveTxRecord(tx);
    const updated = await updateTxStatus(tx.id, "confirmed", { blockNumber: "0xABC" });
    expect(updated).toBe(true);
    const result = await getTxRecord(tx.id);
    expect(result?.status).toBe("confirmed");
    expect(result?.blockNumber).toBe("0xABC");
  });

  it("aggiorna pending → failed", async () => {
    const tx = makeTx({ status: "pending" });
    await saveTxRecord(tx);
    await updateTxStatus(tx.id, "failed");
    expect((await getTxRecord(tx.id))?.status).toBe("failed");
  });

  it("non fa downgrade confirmed → pending (restituisce false)", async () => {
    const tx = makeTx({ status: "confirmed" });
    await saveTxRecord(tx);
    const updated = await updateTxStatus(tx.id, "pending");
    expect(updated).toBe(false);
    expect((await getTxRecord(tx.id))?.status).toBe("confirmed");
  });

  it("restituisce false se il record non esiste", async () => {
    const updated = await updateTxStatus("nonexistent-id", "confirmed");
    expect(updated).toBe(false);
  });
});

// ─── loadTxHistory ────────────────────────────────────────────────────────

describe("loadTxHistory", () => {
  it("restituisce i record ordinati per timestamp DESC", async () => {
    const now = Date.now();
    await saveTxRecord(makeTx({ id: "old", timestamp: now - 10000 }));
    await saveTxRecord(makeTx({ id: "new", timestamp: now }));
    await saveTxRecord(makeTx({ id: "mid", timestamp: now - 5000 }));
    const history = await loadTxHistory();
    expect(history[0].id).toBe("new");
    expect(history[1].id).toBe("mid");
    expect(history[2].id).toBe("old");
  });

  it("rispetta limit e offset (paginazione)", async () => {
    for (let i = 0; i < 10; i++) {
      await saveTxRecord(makeTx({ id: `tx-${i}`, timestamp: Date.now() - i * 1000 }));
    }
    const page1 = await loadTxHistory(3, 0);
    const page2 = await loadTxHistory(3, 3);
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it("lista vuota se non ci sono TX", async () => {
    expect(await loadTxHistory()).toHaveLength(0);
  });
});

// ─── loadTxHistoryByChain ────────────────────────────────────────────────

describe("loadTxHistoryByChain", () => {
  it("filtra per chainId correttamente", async () => {
    await saveTxRecord(makeTx({ id: "poly-1", chainId: 137 }));
    await saveTxRecord(makeTx({ id: "eth-1",  chainId: 1 }));
    await saveTxRecord(makeTx({ id: "btc-1",  chainId: 0 }));
    const poly = await loadTxHistoryByChain(137);
    expect(poly).toHaveLength(1);
    expect(poly[0].chainId).toBe(137);
  });
});

// ─── loadPendingTxRecords ────────────────────────────────────────────────

describe("loadPendingTxRecords", () => {
  it("restituisce solo le TX in stato pending", async () => {
    await saveTxRecord(makeTx({ id: "pending-1", status: "pending" }));
    await saveTxRecord(makeTx({ id: "confirmed-1", status: "confirmed" }));
    await saveTxRecord(makeTx({ id: "pending-2", status: "pending" }));
    const pending = await loadPendingTxRecords();
    expect(pending).toHaveLength(2);
    expect(pending.every(r => r.status === "pending")).toBe(true);
  });

  it("lista vuota se tutte confirmed", async () => {
    await saveTxRecord(makeTx({ status: "confirmed" }));
    expect(await loadPendingTxRecords()).toHaveLength(0);
  });
});

// ─── clearTxHistory ──────────────────────────────────────────────────────

describe("clearTxHistory", () => {
  it("svuota tutto lo storico", async () => {
    await saveTxRecord(makeTx({ id: "a" }));
    await saveTxRecord(makeTx({ id: "b" }));
    await clearTxHistory();
    expect(await countTxRecords()).toBe(0);
  });
});

// ─── Invarianti di sicurezza ────────────────────────────────────────────

describe("Invarianti di sicurezza TX store", () => {
  it("un record non contiene mai parole chiave legate a seed/key", async () => {
    const tx = makeTx();
    await saveTxRecord(tx);
    const result = await getTxRecord(tx.id);
    const json = JSON.stringify(result);
    // Il record non deve mai contenere campi privati
    expect(json).not.toMatch(/seed|mnemonic|private.*key|pin|password|secret/i);
  });

  it("gli indirizzi EVM sono stringhe pubbliche (no 0x private key pattern)", async () => {
    const tx = makeTx({
      fromAddress: "0x1234567890abcdef1234567890abcdef12345678",
      toAddress:   "0xabcdef1234567890abcdef1234567890abcdef12",
    });
    await saveTxRecord(tx);
    const result = await getTxRecord(tx.id);
    // Gli indirizzi devono essere esattamente 42 chars (0x + 40 hex)
    if (result?.fromAddress) expect(result.fromAddress).toHaveLength(42);
    if (result?.toAddress)   expect(result.toAddress).toHaveLength(42);
  });
});
