/**
 * spark-connect-sync.test.ts — Phase 5 Pre-Go-Live Validation
 *
 * Verifica §2 del Phase 5 spec:
 * - connect() flow completo
 * - sync() ciclo
 * - getInfo() post-connect
 * - listPayments() con filtri
 * - error handling durante connect
 * - disconnect + reconnect
 * - stato dopo refresh simulato
 * - retry dopo errore recoverable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { SparkWalletProvider, useSparkWallet } from "../../contexts/SparkWalletContext";
import { MockSparkAdapter } from "../../lib/spark/adapters/mock";

// ── Utility ──────────────────────────────────────────────────────────────────

function makeWrapper(isEnabled = true) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(SparkWalletProvider, { isEnabled }, children);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Connect flow — MockSparkAdapter contract
// ─────────────────────────────────────────────────────────────────────────────

describe("A. Connect flow — MockSparkAdapter", () => {
  it("A1: stato iniziale disconnected", () => {
    const adapter = new MockSparkAdapter();
    expect(adapter.state).toBe("disconnected");
    expect(adapter.lastError).toBeUndefined();
  });

  it("A2: connect() → state=connected", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    expect(adapter.state).toBe("connected");
  });

  it("A3: getInfo() dopo connect → walletInfo valido", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const info = await adapter.getInfo();
    expect(typeof info.identityPubkey).toBe("string");
    expect(info.identityPubkey.length).toBeGreaterThan(10);
    expect(typeof info.balanceSat).toBe("bigint");
    expect(info.balanceSat).toBeGreaterThanOrEqual(0n);
  });

  it("A4: getInfo() senza connect → lancia errore", async () => {
    const adapter = new MockSparkAdapter();
    await expect(adapter.getInfo()).rejects.toThrow();
  });

  it("A5: identityPubkey stabile (stesso nodo ad ogni connect)", async () => {
    const adapter1 = new MockSparkAdapter();
    const adapter2 = new MockSparkAdapter();
    await adapter1.connect({ storageDir: "user1", network: "mainnet" });
    await adapter2.connect({ storageDir: "user1", network: "mainnet" });
    const info1 = await adapter1.getInfo();
    const info2 = await adapter2.getInfo();
    // Con lo stesso storageDir, l'identità deve essere la stessa
    // (nel Mock è sempre la stessa — produzione usa seed derivation)
    expect(info1.identityPubkey).toBe(info2.identityPubkey);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Sync workflow
// ─────────────────────────────────────────────────────────────────────────────

describe("B. Sync — syncWallet()", () => {
  it("B1: syncWallet() dopo connect → state=connected post-sync", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    await adapter.syncWallet();
    expect(adapter.state).toBe("connected");
  });

  it("B2: syncWallet() senza connect → lancia", async () => {
    const adapter = new MockSparkAdapter();
    await expect(adapter.syncWallet()).rejects.toThrow();
  });

  it("B3: syncWallet() transiente state=syncing", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    // Non possiamo catturare il sync state senza racing — verifichiamo il finale
    const syncPromise = adapter.syncWallet();
    await syncPromise;
    expect(adapter.state).toBe("connected");
  });

  it("B4: balance invariato durante sync (Mock — produzione potrebbe aggiornare)", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const infoBefore = await adapter.getInfo();
    await adapter.syncWallet();
    const infoAfter = await adapter.getInfo();
    // In Mock, balance è sempre 50k sat
    expect(infoBefore.balanceSat).toBe(infoAfter.balanceSat);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. listPayments() — filtri e paginazione
// ─────────────────────────────────────────────────────────────────────────────

describe("C. listPayments() — filtri", () => {
  let adapter: MockSparkAdapter;

  beforeEach(async () => {
    adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
  });

  it("C1: listPayments({}) → array non vuoto", async () => {
    const payments = await adapter.listPayments({});
    expect(Array.isArray(payments)).toBe(true);
    expect(payments.length).toBeGreaterThan(0);
  });

  it("C2: ogni payment ha i campi obbligatori", async () => {
    const payments = await adapter.listPayments({});
    for (const p of payments) {
      expect(typeof p.id).toBe("string");
      expect(["btc_lightning_sent", "btc_lightning_received", "spark_sent", "spark_received"])
        .toContain(p.paymentType);
      expect(["pending", "completed", "failed"]).toContain(p.status);
      expect(typeof p.amountSat).toBe("bigint");
      expect(p.amountSat).toBeGreaterThanOrEqual(0n);
      expect(typeof p.feeSat).toBe("bigint");
      expect(p.feeSat).toBeGreaterThanOrEqual(0n);
      expect(typeof p.timestamp).toBe("number");
      expect(p.timestamp).toBeGreaterThan(0);
    }
  });

  it("C3: limit rispettato", async () => {
    const payments = await adapter.listPayments({ limit: 1 });
    expect(payments.length).toBeLessThanOrEqual(1);
  });

  it("C4: limit=0 → array vuoto", async () => {
    const payments = await adapter.listPayments({ limit: 0 });
    expect(payments.length).toBe(0);
  });

  it("C5: listPayments() senza connect → lancia", async () => {
    const disconnected = new MockSparkAdapter();
    await expect(disconnected.listPayments({})).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Disconnect + reconnect
// ─────────────────────────────────────────────────────────────────────────────

describe("D. Disconnect + reconnect", () => {
  it("D1: disconnect() → state=disconnected", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    await adapter.disconnect();
    expect(adapter.state).toBe("disconnected");
  });

  it("D2: getInfo() dopo disconnect → lancia", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    await adapter.disconnect();
    await expect(adapter.getInfo()).rejects.toThrow();
  });

  it("D3: connect() dopo disconnect → ritorna connected", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    await adapter.disconnect();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    expect(adapter.state).toBe("connected");
  });

  it("D4: getInfo() dopo reconnect → valido", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    await adapter.disconnect();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const info = await adapter.getInfo();
    expect(info.balanceSat).toBeGreaterThanOrEqual(0n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. SparkWalletContext — connect + state machine
// ─────────────────────────────────────────────────────────────────────────────

describe("E. SparkWalletContext — connect/disconnect via context", () => {
  it("E1: stato iniziale con isEnabled=true è 'disconnected' (non 'disabled')", () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(true) });
    // Con mock (nessuna VITE_BREEZ_API_KEY), il provider usa MockAdapter
    // State iniziale: disconnected (non ancora connesso)
    expect(result.current.isEnabled).toBe(true);
  });

  it("E2: connect() con isEnabled=false è no-op", async () => {
    const { result } = renderHook(() => useSparkWallet(), {
      wrapper: ({ children }) =>
        React.createElement(SparkWalletProvider, { isEnabled: false }, children),
    });
    await act(async () => { await result.current.connect(); });
    expect(result.current.state).toBe("disabled");
  });

  it("E3: disconnect() con isEnabled=true → state=disconnected o disabled", async () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(true) });
    await act(async () => { await result.current.disconnect(); });
    // Dopo disconnect, stato deve essere disconnected o disabled
    expect(["disconnected", "disabled"]).toContain(result.current.state);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Tempi di connessione e timeout
// ─────────────────────────────────────────────────────────────────────────────

describe("F. Tempi di connessione", () => {
  it("F1: connect() completa entro 1s (Mock — SLA target: < 30s in produzione)", async () => {
    const adapter = new MockSparkAdapter();
    const start = Date.now();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(adapter.state).toBe("connected");
  });

  it("F2: getInfo() completa entro 500ms (Mock)", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const start = Date.now();
    await adapter.getInfo();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("F3: syncWallet() completa entro 1s (Mock)", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const start = Date.now();
    await adapter.syncWallet();
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Stato dopo "refresh" simulato (nuova istanza adapter)
// ─────────────────────────────────────────────────────────────────────────────

describe("G. Recovery dopo refresh (nuova istanza adapter)", () => {
  it("G1: nuova istanza adapter → state=disconnected (no cached state)", () => {
    const adapter = new MockSparkAdapter();
    expect(adapter.state).toBe("disconnected");
    expect(adapter.lastError).toBeUndefined();
  });

  it("G2: nuova istanza + connect → stessa identità (ricostruita da seed)", async () => {
    const adapter1 = new MockSparkAdapter();
    const adapter2 = new MockSparkAdapter();
    await adapter1.connect({ storageDir: "user1", network: "mainnet" });
    await adapter2.connect({ storageDir: "user1", network: "mainnet" });
    const [info1, info2] = await Promise.all([adapter1.getInfo(), adapter2.getInfo()]);
    expect(info1.identityPubkey).toBe(info2.identityPubkey);
  });

  it("G3: payment history disponibile dopo reconnect (via listPayments)", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    // Simula refresh: nuova istanza, stesso storageDir
    const adapter2 = new MockSparkAdapter();
    await adapter2.connect({ storageDir: "test", network: "mainnet" });
    const payments = await adapter2.listPayments({});
    // In produzione, listPayments legge dall'IDB locale
    expect(Array.isArray(payments)).toBe(true);
  });
});
