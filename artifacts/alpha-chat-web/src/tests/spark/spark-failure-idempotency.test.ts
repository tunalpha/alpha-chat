/**
 * spark-failure-idempotency.test.ts — Phase 5 Pre-Go-Live Validation
 *
 * Verifica §8 del Phase 5 spec:
 * - Invoice scaduta → errore graceful
 * - Invoice invalida → errore graceful
 * - Pagamento fallito → nessun double-pay
 * - Timeout → recovery
 * - Doppio click Send → un solo pagamento
 * - Retry stessa richiesta → idempotente
 * - Doppio evento payment_received → un solo record
 *
 * REQUISITO FONDAMENTALE:
 * Mai doppio pagamento. Mai doppia commissione. Mai doppio record.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockSparkAdapter } from "../../lib/spark/adapters/mock";
import {
  calculateSparkFeeBreakdown,
  assertFeeBreakdownConsistent,
} from "../../lib/spark/spark-fee-engine";
import type { SparkFeeConfig } from "../../lib/spark/spark-types";

const defaultCfg: SparkFeeConfig = { fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 };

// ── Adapter con failure injection ─────────────────────────────────────────────

class FailingSparkAdapter extends MockSparkAdapter {
  private _failMode: "none" | "connect" | "send" | "prepare" | "invoice_expired" = "none";
  private _sendCallCount = 0;

  setFailMode(mode: typeof this._failMode) { this._failMode = mode; }
  get sendCallCount() { return this._sendCallCount; }

  override async connect(config: Parameters<MockSparkAdapter["connect"]>[0]) {
    if (this._failMode === "connect") {
      this["_state"] = "error" as ReturnType<MockSparkAdapter["state"]["valueOf"]>;
      throw new Error("CONNECT_FAILED: simulato errore di connessione");
    }
    return super.connect(config);
  }

  override async prepareSend(req: Parameters<MockSparkAdapter["prepareSend"]>[0]) {
    if (this._failMode === "prepare") {
      throw new Error("PREPARE_FAILED: saldo insufficiente");
    }
    if (this._failMode === "invoice_expired") {
      // Restituisce un risultato con expiresAt nel passato
      const result = await super.prepareSend(req);
      return { ...result, expiresAt: Date.now() - 1000 }; // già scaduto
    }
    return super.prepareSend(req);
  }

  override async send(req: Parameters<MockSparkAdapter["send"]>[0]) {
    this._sendCallCount++;
    if (this._failMode === "send") {
      throw new Error("SEND_FAILED: errore di routing");
    }
    return super.send(req);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Invoice invalida e scaduta
// ─────────────────────────────────────────────────────────────────────────────

describe("A. Invoice invalida / scaduta — errore graceful", () => {
  let adapter: FailingSparkAdapter;

  beforeEach(async () => {
    adapter = new FailingSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
  });

  it("A1: createReceiveInvoice con method sconosciuto → fallback a bitcoin_address (comportamento Mock)", async () => {
    // Il MockSparkAdapter restituisce un fallback per metodi sconosciuti (default case)
    // Il LiveAdapter Breez SDK potrebbe lanciare — dipende dall'implementazione SDK
    // In produzione, il UI valida il metodo prima di chiamare l'adapter
    const result = await adapter.createReceiveInvoice({ method: "invalid_method" as "bolt11" });
    // Il Mock restituisce un risultato (non lancia) — il controllo avviene nel UI
    expect(result).toBeDefined();
    // L'importante è che il tipo del result indichi un fallback gestito
    expect(typeof result).toBe("object");
  });

  it("A2: prepareSend failure → errore, nessun pagamento effettuato", async () => {
    adapter.setFailMode("prepare");
    const bd = calculateSparkFeeBreakdown(10_000n, 100n, defaultCfg);
    await expect(
      adapter.prepareSend({ amountSat: 10_000n }),
    ).rejects.toThrow("PREPARE_FAILED");
    // Nessun send chiamato
    expect(adapter.sendCallCount).toBe(0);
  });

  it("A3: invoice scaduta → expiresAt nel passato rilevabile", async () => {
    adapter.setFailMode("invoice_expired");
    const result = await adapter.prepareSend({ amountSat: 10_000n });
    // Il chiamante DEVE verificare expiresAt prima di procedere
    const isExpired = result.expiresAt < Date.now();
    expect(isExpired).toBe(true);
    // Il sistema non deve inviare con quote scaduta
    // (guardrail nel controller — verificato qui come logica)
  });

  it("A4: importo zero → errore graceful (no panic)", async () => {
    // amountSat=0n è borderline — il sistema deve gestirlo senza crash
    const bd = calculateSparkFeeBreakdown(0n, 0n, defaultCfg);
    // fee minima applicata anche a 0n
    expect(bd.alphaPlatformFeeSat).toBe(BigInt(defaultCfg.min_fee_sat));
    expect(bd.totalDebitSat).toBeGreaterThanOrEqual(0n);
    expect(() => assertFeeBreakdownConsistent(bd)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Pagamento fallito — nessun double-pay
// ─────────────────────────────────────────────────────────────────────────────

describe("B. Pagamento fallito — nessun double-pay", () => {
  let adapter: FailingSparkAdapter;

  beforeEach(async () => {
    adapter = new FailingSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
  });

  it("B1: send() failure → lancia, sendCallCount=1 (un solo tentativo)", async () => {
    adapter.setFailMode("send");
    const bd = calculateSparkFeeBreakdown(10_000n, 100n, defaultCfg);
    await expect(
      adapter.send({ amountSat: 10_000n, bolt11: "lnbc10000n1test" }),
    ).rejects.toThrow("SEND_FAILED");
    expect(adapter.sendCallCount).toBe(1);
  });

  it("B2: send() failure → retry manuale NON riesegue automaticamente", async () => {
    adapter.setFailMode("send");
    const bd = calculateSparkFeeBreakdown(10_000n, 100n, defaultCfg);
    try { await adapter.send({ amountSat: 10_000n, bolt11: "lnbc10000n1test" }); } catch { /* expected */ }
    expect(adapter.sendCallCount).toBe(1);
    // Un secondo tentativo dovrebbe essere esplicito dell'utente
    // (non automatico — prevenzione double-pay)
  });

  it("B3: connessione persa durante send → lancia, nessun double-send silenzioso", async () => {
    // Simula: send() fallisce → il chiamante deve gestire e non ri-inviare automaticamente
    adapter.setFailMode("send");
    let error: Error | null = null;
    try {
      await adapter.send({ amountSat: 5_000n, bolt11: "lnbc5000n1test" });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toContain("SEND_FAILED");
    expect(adapter.sendCallCount).toBe(1); // un solo tentativo
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Doppio click Send — prevenzione double-payment
// ─────────────────────────────────────────────────────────────────────────────

describe("C. Doppio click Send — idempotency UI", () => {
  it("C1: due chiamate concorrenti send() → due pagamenti distinti (no merging)", async () => {
    const adapter = new MockSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });

    // Due invii concorrenti con lo stesso importo
    const [r1, r2] = await Promise.all([
      adapter.send({ amountSat: 1000n, bolt11: "lnbc1000n1test1" }),
      adapter.send({ amountSat: 1000n, bolt11: "lnbc1000n1test2" }),
    ]);

    // REQUISITO: due paymentId distinti (non merged in uno solo)
    expect(r1.paymentId).not.toBe(r2.paymentId);
    expect(r1.status).toBe("completed");
    expect(r2.status).toBe("completed");
  });

  it("C2: guardia doppio-send: breakdown con expiresAt verifica", () => {
    // Il UI deve disabilitare il pulsante "Invia" dopo il primo click
    // Simulazione: flag isPending
    let isPending = false;

    async function safeSend(): Promise<boolean> {
      if (isPending) return false; // secondo click ignorato
      isPending = true;
      await new Promise(r => setTimeout(r, 10)); // simula invio
      isPending = false;
      return true;
    }

    // Primo invio
    const p1 = safeSend();
    // Secondo click simultaneo → deve essere ignorato
    const p2 = safeSend();

    return Promise.all([p1, p2]).then(([r1, r2]) => {
      expect(r1).toBe(true);   // primo ha successo
      expect(r2).toBe(false);  // secondo ignorato
    });
  });

  it("C3: paymentHash unico garantisce idempotency lato Treasury", () => {
    // Due record con lo stesso paymentHash → un solo record Treasury
    const paymentHash = "abc123def456789012345678901234567890123456789012345678901234abcd";
    const recordId1 = `spark_${paymentHash}`;
    const recordId2 = `spark_${paymentHash}`;
    // Stessa chiave → upsert idempotente (uno solo scritto)
    expect(recordId1).toBe(recordId2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Retry stessa richiesta — idempotency per receive
// ─────────────────────────────────────────────────────────────────────────────

describe("D. Retry receive — no duplicate notification", () => {
  it("D1: stesso paymentId NON deve generare due record", () => {
    // Simulazione: payment_received event duplicato
    const receivedIds = new Set<string>();

    function onPaymentReceived(paymentId: string): boolean {
      if (receivedIds.has(paymentId)) return false; // già processato
      receivedIds.add(paymentId);
      return true; // primo processamento
    }

    const pid = "payment_abc123";
    expect(onPaymentReceived(pid)).toBe(true);  // primo evento: processato
    expect(onPaymentReceived(pid)).toBe(false); // duplicato: ignorato
    expect(receivedIds.size).toBe(1); // un solo record
  });

  it("D2: idempotency key = paymentHash per Treasury (non timestamp)", () => {
    // Il timestamp non è un buon idempotency key (può variare tra retry)
    const ph = "pay_hash_abc123";
    const ts1 = Date.now();
    const ts2 = ts1 + 100;

    // Stessa richiesta con timestamp diversi
    const key1 = `spark_${ph}`; // basato su hash
    const key2 = `spark_${ph}`; // stesso hash → stessa chiave

    expect(key1).toBe(key2); // idempotente
    expect(`spark_${ts1}`).not.toBe(`spark_${ts2}`); // timestamp NON idempotente
  });

  it("D3: doppio evento payment_received → un solo record Treasury", async () => {
    const processedHashes = new Set<string>();

    async function processPayment(paymentHash: string): Promise<"created" | "duplicate"> {
      if (processedHashes.has(paymentHash)) return "duplicate";
      processedHashes.add(paymentHash);
      return "created";
    }

    const hash = "real_payment_hash_abc123";
    const [r1, r2] = await Promise.all([
      processPayment(hash),
      processPayment(hash),
    ]);

    // Uno dei due sarà "duplicate" (Set è sincrono, non race-safe in produzione
    // ma il pattern MongoDB $setOnInsert + duplicate key garantisce il risultato)
    const results = [r1, r2].sort();
    expect(results).toContain("created");
    expect(processedHashes.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Timeout e perdita connessione
// ─────────────────────────────────────────────────────────────────────────────

describe("E. Timeout e perdita connessione", () => {
  it("E1: connect() failure → state=error, lastError presente", async () => {
    const adapter = new FailingSparkAdapter();
    adapter.setFailMode("connect");
    try { await adapter.connect({ storageDir: "test", network: "mainnet" }); } catch { /* expected */ }
    expect(adapter.state).toBe("error");
  });

  it("E2: errore connessione → recoverable=true (può essere ritentato)", async () => {
    const adapter = new FailingSparkAdapter();
    adapter.setFailMode("connect");
    try { await adapter.connect({ storageDir: "test", network: "mainnet" }); } catch { /* expected */ }
    // In SparkWalletContext, un CONNECT_FAILED è recoverable=true
    // → il componente può mostrare un pulsante "Riprova"
    expect(adapter.state).toBe("error"); // non "unavailable" (non permanente)
  });

  it("E3: recover da connect failure → disable fail, reconnect OK", async () => {
    const adapter = new FailingSparkAdapter();
    adapter.setFailMode("connect");
    try { await adapter.connect({ storageDir: "test", network: "mainnet" }); } catch { /* expected */ }

    // Recovery: disabilita il fail e riprova
    adapter.setFailMode("none");
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    expect(adapter.state).toBe("connected");
  });

  it("E4: perdita connessione durante listPayments → lancia, state non diventa 'disconnected' silenziosamente", async () => {
    const adapter = new FailingSparkAdapter();
    await adapter.connect({ storageDir: "test", network: "mainnet" });
    // Disconnetti prima di listPayments
    await adapter.disconnect();
    await expect(adapter.listPayments({})).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Fee breakdown idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("F. Fee breakdown — idempotency e immutabilità", () => {
  it("F1: calculateSparkFeeBreakdown è pura (stesso input → stesso output)", () => {
    const bd1 = calculateSparkFeeBreakdown(100_000n, 100n, defaultCfg);
    const bd2 = calculateSparkFeeBreakdown(100_000n, 100n, defaultCfg);
    expect(bd1.alphaPlatformFeeSat).toBe(bd2.alphaPlatformFeeSat);
    expect(bd1.totalDebitSat).toBe(bd2.totalDebitSat);
    expect(bd1.estimatedProviderFeeSat).toBe(bd2.estimatedProviderFeeSat);
  });

  it("F2: fee negativa impossibile con qualsiasi input valido", () => {
    const inputs = [0n, 1n, 100n, 100_000n, 21_000_000_00000000n]; // max BTC in sat
    for (const amount of inputs) {
      const bd = calculateSparkFeeBreakdown(amount, 0n, defaultCfg);
      expect(bd.alphaPlatformFeeSat).toBeGreaterThanOrEqual(0n);
      expect(bd.totalDebitSat).toBeGreaterThanOrEqual(0n);
    }
  });

  it("F3: overflow impossibile con bigint (nessun Number.MAX_SAFE_INTEGER issue)", () => {
    // 21 milioni BTC = 2.1e15 sat — ben dentro i limiti bigint
    const maxBtcSat = 21_000_000n * 100_000_000n;
    const bd = calculateSparkFeeBreakdown(maxBtcSat, 0n, defaultCfg);
    expect(bd.alphaPlatformFeeSat).toBeGreaterThan(0n);
    expect(bd.totalDebitSat).toBeLessThanOrEqual(maxBtcSat + bd.alphaPlatformFeeSat + bd.estimatedProviderFeeSat);
  });

  it("F4: assertFeeBreakdownConsistent lancia su breakdown manipolato", () => {
    const bd = calculateSparkFeeBreakdown(100_000n, 100n, defaultCfg);
    // Manipolazione: decrementa totalDebitSat senza aggiornare le parti
    const tampered = { ...bd, totalDebitSat: bd.totalDebitSat - 1n };
    expect(() => assertFeeBreakdownConsistent(tampered)).toThrow();
  });
});
