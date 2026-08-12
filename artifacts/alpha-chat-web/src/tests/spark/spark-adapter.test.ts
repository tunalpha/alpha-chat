/**
 * MockSparkAdapter — unit tests
 *
 * Verifica che il MockAdapter:
 * - rispetti il contratto BreezSparkAdapter
 * - gestisca correttamente la state machine
 * - ritorni valori sensati per tutti i metodi
 * - lanci errore se usato senza connect()
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockSparkAdapter } from "../../lib/spark/adapters/mock";

describe("MockSparkAdapter", () => {
  let adapter: MockSparkAdapter;

  beforeEach(() => {
    adapter = new MockSparkAdapter();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it("stato iniziale: disconnected", () => {
    expect(adapter.state).toBe("disconnected");
    expect(adapter.adapterType).toBe("mock");
    expect(adapter.lastError).toBeUndefined();
  });

  // ── Connect ────────────────────────────────────────────────────────────────

  it("connect() porta lo stato a connected", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    expect(adapter.state).toBe("connected");
  });

  // ── getInfo ────────────────────────────────────────────────────────────────

  it("getInfo() restituisce identityPubkey e balanceSat", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const info = await adapter.getInfo();
    expect(typeof info.identityPubkey).toBe("string");
    expect(info.identityPubkey.length).toBeGreaterThan(0);
    expect(typeof info.balanceSat).toBe("bigint");
    expect(info.balanceSat).toBeGreaterThanOrEqual(0n);
  });

  it("getInfo() senza connect() solleva errore", async () => {
    await expect(adapter.getInfo()).rejects.toThrow();
  });

  // ── syncWallet ─────────────────────────────────────────────────────────────

  it("syncWallet() passa da connected → syncing → connected", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const syncPromise = adapter.syncWallet();
    // Durante il sync lo stato può essere syncing o connected (async)
    await syncPromise;
    expect(adapter.state).toBe("connected");
  });

  // ── prepareSend ────────────────────────────────────────────────────────────

  it("prepareSend() restituisce estimatedProviderFeeSat e recipientAmountSat", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const result = await adapter.prepareSend({
      paymentRequest: "lnbc1mock",
      amountSat:      1000n,
    });
    expect(typeof result.estimatedProviderFeeSat).toBe("bigint");
    expect(result.estimatedProviderFeeSat).toBeGreaterThanOrEqual(0n);
    expect(result.recipientAmountSat).toBe(1000n);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("prepareSend() provider fee NON include Alpha fee", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const result = await adapter.prepareSend({ paymentRequest: "lnbc1", amountSat: 1000n });
    // Il mock restituisce 3n come routing fee — questa NON è la Alpha fee
    expect(result.estimatedProviderFeeSat).toBe(3n);
  });

  // ── send ───────────────────────────────────────────────────────────────────

  it("send() restituisce paymentId e feeSat", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const result = await adapter.send({ paymentRequest: "lnbc1", amountSat: 500n });
    expect(result.paymentId).toBeTruthy();
    expect(result.status).toBe("completed");
    expect(typeof result.feeSat).toBe("bigint");
    expect(result.amountSat).toBe(500n);
  });

  it("send() senza connect() solleva errore", async () => {
    await expect(adapter.send({ paymentRequest: "lnbc1", amountSat: 1n })).rejects.toThrow();
  });

  // ── createReceiveInvoice ───────────────────────────────────────────────────

  it("createReceiveInvoice bolt11 restituisce bolt11 string", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const result = await adapter.createReceiveInvoice({
      method:    "bolt11",
      amountSat: 2000n,
    });
    expect(typeof result.bolt11).toBe("string");
    expect(result.bolt11?.startsWith("lnbc")).toBe(true);
    expect(result.expiresAt).toBeGreaterThan(0);
  });

  it("createReceiveInvoice spark_address restituisce sparkAddress", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const result = await adapter.createReceiveInvoice({ method: "spark_address" });
    expect(typeof result.sparkAddress).toBe("string");
    expect(result.sparkAddress?.startsWith("sp1")).toBe(true);
  });

  it("createReceiveInvoice bitcoin_on_chain restituisce bitcoinAddress", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const result = await adapter.createReceiveInvoice({ method: "bitcoin_on_chain" });
    expect(typeof result.bitcoinAddress).toBe("string");
  });

  // ── listPayments ───────────────────────────────────────────────────────────

  it("listPayments() restituisce array di pagamenti", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const payments = await adapter.listPayments({ limit: 10 });
    expect(Array.isArray(payments)).toBe(true);
    for (const p of payments) {
      expect(p.id).toBeTruthy();
      expect(typeof p.amountSat).toBe("bigint");
      expect(typeof p.feeSat).toBe("bigint");
      expect(["pending", "completed", "failed"]).toContain(p.status);
      expect(["btc_lightning_sent", "btc_lightning_received", "spark_sent", "spark_received"])
        .toContain(p.paymentType);
    }
  });

  it("listPayments() rispetta il limit", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    const payments = await adapter.listPayments({ limit: 1 });
    expect(payments.length).toBeLessThanOrEqual(1);
  });

  // ── disconnect ─────────────────────────────────────────────────────────────

  it("disconnect() porta lo stato a disconnected", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    await adapter.disconnect();
    expect(adapter.state).toBe("disconnected");
  });

  it("dopo disconnect(), getInfo() solleva errore", async () => {
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    await adapter.disconnect();
    await expect(adapter.getInfo()).rejects.toThrow();
  });
});
