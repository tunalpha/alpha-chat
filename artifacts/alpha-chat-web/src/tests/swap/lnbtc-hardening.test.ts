/**
 * LN→BTC Hardening — Test Suite
 *
 * T1  – doppio click (module-level lock)
 * T2  – cross-tab lock (localStorage)
 * T3  – retry con risultato già in localStorage (idempotenza client)
 * T4  – idempotency key in localStorage, non sessionStorage
 * T5  – timeout → TIMEOUT_UNCERTAIN
 * T6  – timeout → NON pulisce lo stato (intent + lock uncertain rimangono)
 * T7  – errore definitivo → clearLnBtcState (retry permesso)
 * T8  – /record/lnbtc failure 3× → non lancia eccezione (risultato in localStorage)
 * T9  – /record/lnbtc: 2 fail poi successo al 3° tentativo
 * T10 – readLnBtcRecovery: "completed" (recorded=true)
 * T11 – readLnBtcRecovery: "completed_unrecorded" (recorded=false)
 * T12 – readLnBtcRecovery: "unknown" (lock.uncertain=true)
 * T13 – readLnBtcRecovery: "in_progress" (lock fresco, no risultato)
 * T14 – readLnBtcRecovery: "not_started" (localStorage vuoto)
 * T15 – clearLnBtcState: rimuove tutte le chiavi
 * T16 – idempotency_key inclusa nel body di POST /record/lnbtc
 * T17 – write-before-submit: intent salvato PRIMA di spark.send()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearLnBtcState,
  readLnBtcRecovery,
  LNBTC_IKEY,
  LNBTC_INTENT_KEY,
  LNBTC_RESULT_KEY,
  LNBTC_LOCK_KEY,
  BreezSparkBtcLnProvider,
  type SparkSwapExecutor,
  type LnBtcIntent,
  type LnBtcResult,
} from "../../swap/providers/BreezSparkBtcLnProvider.js";

// ── localStorage mock ─────────────────────────────────────────────────────────

const _store: Record<string, string> = {};
const localStorageMock = {
  getItem:    (k: string) => _store[k] ?? null,
  setItem:    (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear:      () => { Object.keys(_store).forEach(k => delete _store[k]); },
};
vi.stubGlobal("localStorage", localStorageMock);

// ── crypto mock ───────────────────────────────────────────────────────────────

let _uuidCounter = 0;
vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++_uuidCounter}` });

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockFetchOk(body: unknown = {}) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => body });
}
function mockFetchFail(body: unknown = { error: "Server error" }) {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => body });
}

// ── Executor helpers ──────────────────────────────────────────────────────────

function makeExecutor(opts?: {
  estimateError?: boolean;
  executeDelay?: number;
  executeError?: string;
  executeResult?: { paymentId: string; feeSat: bigint };
}): SparkSwapExecutor {
  return {
    estimateFee: async () => {
      if (opts?.estimateError) throw new Error("Estimate failed");
      return { estimatedProviderFeeSat: 300n };
    },
    executeSwap: async () => {
      if (opts?.executeDelay) await new Promise(r => setTimeout(r, opts.executeDelay));
      if (opts?.executeError) throw new Error(opts.executeError);
      return opts?.executeResult ?? { paymentId: "spark-pay-1", feeSat: 300n };
    },
  };
}

const TEST_QUOTE = {
  direction:        "lightning_to_btc" as const,
  provider:         "breez_spark_reverse",
  from_amount_sat:  10_000,
  to_amount_sat:    9_700,
  alpha_fee_sat:    0,
  alpha_fee_bps:    0,
  provider_fee_sat: 300,
  miner_fee_sat:    0,
  total_debit_sat:  10_000,
  expires_at:       Date.now() + 60_000,
};
const TEST_REQ = { quote: TEST_QUOTE, btc_address: "bc1qtest" };

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorageMock.clear();
  mockFetch.mockReset();
  _uuidCounter = 0;
  clearLnBtcState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LN→BTC Hardening", () => {

  // T1 – doppio click ──────────────────────────────────────────────────────────
  it("T1 — doppio click: secondo execute() rifiutato mentre il primo è in corso", async () => {
    // Usa una promise manuale controllabile — no fake timers necessari
    let resolveFirst!: (r: { paymentId: string; feeSat: bigint }) => void;
    const executor: SparkSwapExecutor = {
      estimateFee: async () => ({ estimatedProviderFeeSat: 300n }),
      executeSwap: async () => new Promise(resolve => { resolveFirst = resolve; }),
    };

    mockFetchOk({}); // /record/lnbtc

    const provider = new BreezSparkBtcLnProvider(executor);

    // Avvia il primo — rimane sospeso finché non chiamiamo resolveFirst
    const first = provider.execute(TEST_REQ);

    // Secondo deve essere rifiutato subito (lock module-level)
    await expect(provider.execute(TEST_REQ)).rejects.toThrow("Pagamento già in corso");

    // Risolvi il primo e verifica che completi normalmente
    resolveFirst({ paymentId: "pay-t1", feeSat: 300n });
    const result = await first;
    expect(result.state).toBe("completed");
  });

  // T2 – cross-tab lock ────────────────────────────────────────────────────────
  it("T2 — cross-tab: lock fresco in localStorage blocca execute()", async () => {
    const lock = { key: "existing-key", tab_id: "other-tab", ts: Date.now() };
    localStorageMock.setItem(LNBTC_LOCK_KEY, JSON.stringify(lock));

    const provider = new BreezSparkBtcLnProvider(makeExecutor());
    await expect(provider.execute(TEST_REQ)).rejects.toThrow("Pagamento già in corso in un'altra sessione");
  });

  // T3 – idempotenza client: risultato già in localStorage ─────────────────────
  it("T3 — result in localStorage: execute() non chiama spark.send()", async () => {
    const existingResult: LnBtcResult = {
      payment_id: "pay-existing",
      fee_sat:    300,
      completed:  true,
      recorded:   true,
    };
    localStorageMock.setItem(LNBTC_RESULT_KEY, JSON.stringify(existingResult));

    const executeSpy = vi.fn().mockResolvedValue({ paymentId: "NEW", feeSat: 0n });
    const provider = new BreezSparkBtcLnProvider({
      estimateFee: async () => ({ estimatedProviderFeeSat: 0n }),
      executeSwap: executeSpy,
    });

    const result = await provider.execute(TEST_REQ);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.swap_id).toBe("pay-existing");
    expect(result.state).toBe("completed");
  });

  // T4 – idempotency key in localStorage ────────────────────────────────────────
  it("T4 — idempotency key scritta in localStorage durante execute()", async () => {
    let keyDuringExecution: string | null = null;
    let intentDuringExecution: string | null = null;

    const executor: SparkSwapExecutor = {
      estimateFee: async () => ({ estimatedProviderFeeSat: 300n }),
      executeSwap: async () => {
        // Legge localStorage DURANTE spark.send()
        keyDuringExecution    = localStorageMock.getItem(LNBTC_IKEY);
        intentDuringExecution = localStorageMock.getItem(LNBTC_INTENT_KEY);
        return { paymentId: "pay-t4", feeSat: 300n };
      },
    };

    mockFetchOk({ swap_id: "sw-t4", state: "completed", alpha_fee_bps: 0 });

    const provider = new BreezSparkBtcLnProvider(executor);
    await provider.execute(TEST_REQ);

    // La key e l'intent devono essere in localStorage durante l'esecuzione
    expect(keyDuringExecution).not.toBeNull();
    expect(keyDuringExecution).toMatch(/^uuid-/);
    expect(intentDuringExecution).not.toBeNull();
    const intent = JSON.parse(intentDuringExecution!);
    expect(intent.amount_sat).toBe(10_000);
    expect(intent.btc_address).toBe("bc1qtest");
  });

  // T5 – timeout → TIMEOUT_UNCERTAIN ────────────────────────────────────────────
  it("T5 — timeout 60s → errore TIMEOUT_UNCERTAIN", async () => {
    vi.useFakeTimers();

    const provider = new BreezSparkBtcLnProvider(makeExecutor({ executeDelay: 120_000 }));

    // Attacca .catch PRIMA che il timer scatti — evita unhandled rejection
    let thrownError: Error | null = null;
    const exec = provider.execute(TEST_REQ).catch(e => { thrownError = e as Error; });

    await vi.advanceTimersByTimeAsync(61_000);
    await exec;

    expect(thrownError?.message).toMatch("TIMEOUT_UNCERTAIN");
  }, 15_000);

  // T6 – timeout → NON pulisce lo stato ─────────────────────────────────────────
  it("T6 — dopo timeout, intent rimane e lock.uncertain=true", async () => {
    vi.useFakeTimers();

    const provider = new BreezSparkBtcLnProvider(makeExecutor({ executeDelay: 120_000 }));
    // Attacca .catch subito — evita unhandled rejection
    const exec = provider.execute(TEST_REQ).catch(() => null);
    await vi.advanceTimersByTimeAsync(61_000);
    await exec;

    // Intent deve essere ancora presente
    expect(localStorageMock.getItem(LNBTC_INTENT_KEY)).not.toBeNull();
    // Lock con uncertain=true
    const lock = JSON.parse(localStorageMock.getItem(LNBTC_LOCK_KEY) ?? "{}");
    expect(lock.uncertain).toBe(true);
    // Nessun risultato (spark.send() non completato)
    expect(localStorageMock.getItem(LNBTC_RESULT_KEY)).toBeNull();
  }, 15_000);

  // T7 – errore definitivo → clearLnBtcState ────────────────────────────────────
  it("T7 — errore definitivo: localStorage pulito, retry possibile", async () => {
    const provider = new BreezSparkBtcLnProvider(makeExecutor({ executeError: "INSUFFICIENT_BALANCE" }));
    await expect(provider.execute(TEST_REQ)).rejects.toThrow("INSUFFICIENT_BALANCE");

    expect(localStorageMock.getItem(LNBTC_INTENT_KEY)).toBeNull();
    expect(localStorageMock.getItem(LNBTC_LOCK_KEY)).toBeNull();
    expect(localStorageMock.getItem(LNBTC_IKEY)).toBeNull();
  });

  // T8 – /record/lnbtc failure 3× ───────────────────────────────────────────────
  it("T8 — /record/lnbtc fallisce 3× → execute() non lancia eccezione", async () => {
    vi.useRealTimers(); // retry usa setTimeout reali (1s, 2s delay)

    mockFetchFail();
    mockFetchFail();
    mockFetchFail();

    const provider = new BreezSparkBtcLnProvider(makeExecutor());
    // Deve completare senza eccezione — il pagamento Spark è avvenuto
    await expect(provider.execute(TEST_REQ)).resolves.toMatchObject({ state: "completed" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 15_000);

  // T9 – /record/lnbtc: 2 fail poi successo ────────────────────────────────────
  it("T9 — /record/lnbtc: 2 fail poi successo al 3° tentativo", async () => {
    vi.useRealTimers();

    mockFetchFail();
    mockFetchFail();
    mockFetchOk({ swap_id: "sw-t9", state: "completed", alpha_fee_bps: 0 });

    const provider = new BreezSparkBtcLnProvider(makeExecutor());
    const result = await provider.execute(TEST_REQ);

    expect(result.state).toBe("completed");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 15_000);

  // T10 – recovery "completed" ──────────────────────────────────────────────────
  it("T10 — readLnBtcRecovery: 'completed' se recorded=true", () => {
    const intent: LnBtcIntent = { key: "k1", amount_sat: 10_000, btc_address: "bc1q...", ts: Date.now() };
    const result: LnBtcResult = { payment_id: "pay-1", fee_sat: 300, completed: true, recorded: true };
    localStorageMock.setItem(LNBTC_INTENT_KEY, JSON.stringify(intent));
    localStorageMock.setItem(LNBTC_RESULT_KEY, JSON.stringify(result));

    const rec = readLnBtcRecovery();
    expect(rec.state).toBe("completed");
    expect(rec.payment_id).toBe("pay-1");
    expect(rec.amount_sat).toBe(10_000);
  });

  // T11 – recovery "completed_unrecorded" ───────────────────────────────────────
  it("T11 — readLnBtcRecovery: 'completed_unrecorded' se recorded=false", () => {
    const intent: LnBtcIntent = { key: "k2", amount_sat: 5_000, btc_address: "bc1q...", ts: Date.now() };
    const result: LnBtcResult = { payment_id: "pay-2", fee_sat: 150, completed: true, recorded: false };
    localStorageMock.setItem(LNBTC_INTENT_KEY, JSON.stringify(intent));
    localStorageMock.setItem(LNBTC_RESULT_KEY, JSON.stringify(result));

    const rec = readLnBtcRecovery();
    expect(rec.state).toBe("completed_unrecorded");
    expect(rec.payment_id).toBe("pay-2");
  });

  // T12 – recovery "unknown" (lock.uncertain) ────────────────────────────────────
  it("T12 — readLnBtcRecovery: 'unknown' se lock.uncertain=true", () => {
    const intent: LnBtcIntent = { key: "k3", amount_sat: 8_000, btc_address: "bc1q...", ts: Date.now() - 90_000 };
    const lock = { key: "k3", tab_id: "t1", ts: Date.now() - 65_000, uncertain: true };
    localStorageMock.setItem(LNBTC_INTENT_KEY, JSON.stringify(intent));
    localStorageMock.setItem(LNBTC_LOCK_KEY, JSON.stringify(lock));

    const rec = readLnBtcRecovery();
    expect(rec.state).toBe("unknown");
    expect(rec.amount_sat).toBe(8_000);
  });

  // T13 – recovery "in_progress" (lock fresco) ──────────────────────────────────
  it("T13 — readLnBtcRecovery: 'in_progress' se lock fresco e no risultato", () => {
    const intent: LnBtcIntent = { key: "k4", amount_sat: 3_000, btc_address: "bc1q...", ts: Date.now() - 10_000 };
    const lock = { key: "k4", tab_id: "t2", ts: Date.now() - 10_000, uncertain: false };
    localStorageMock.setItem(LNBTC_INTENT_KEY, JSON.stringify(intent));
    localStorageMock.setItem(LNBTC_LOCK_KEY, JSON.stringify(lock));

    const rec = readLnBtcRecovery();
    expect(rec.state).toBe("in_progress");
  });

  // T14 – recovery "not_started" ────────────────────────────────────────────────
  it("T14 — readLnBtcRecovery: 'not_started' se localStorage vuoto", () => {
    expect(readLnBtcRecovery().state).toBe("not_started");
  });

  // T15 – clearLnBtcState ───────────────────────────────────────────────────────
  it("T15 — clearLnBtcState: rimuove tutte e 4 le chiavi", () => {
    localStorageMock.setItem(LNBTC_IKEY,       "k");
    localStorageMock.setItem(LNBTC_INTENT_KEY, '{}');
    localStorageMock.setItem(LNBTC_RESULT_KEY, '{}');
    localStorageMock.setItem(LNBTC_LOCK_KEY,   '{}');

    clearLnBtcState();

    expect(localStorageMock.getItem(LNBTC_IKEY)).toBeNull();
    expect(localStorageMock.getItem(LNBTC_INTENT_KEY)).toBeNull();
    expect(localStorageMock.getItem(LNBTC_RESULT_KEY)).toBeNull();
    expect(localStorageMock.getItem(LNBTC_LOCK_KEY)).toBeNull();
  });

  // T16 – idempotency_key inviata a /record/lnbtc ───────────────────────────────
  it("T16 — idempotency_key inclusa nel body di POST /record/lnbtc", async () => {
    mockFetchOk({ swap_id: "sw-t16", state: "completed", alpha_fee_bps: 0 });

    const provider = new BreezSparkBtcLnProvider(makeExecutor());
    await provider.execute(TEST_REQ);

    const recordCall = mockFetch.mock.calls.find((c: unknown[]) =>
      typeof c[0] === "string" && (c[0] as string).includes("/record/lnbtc"),
    );
    expect(recordCall).toBeDefined();
    const body = JSON.parse((recordCall![1] as RequestInit).body as string);
    expect(typeof body.idempotency_key).toBe("string");
    expect(body.idempotency_key.length).toBeGreaterThan(0);
    expect(body.spark_payment_id).toBe("spark-pay-1");
  });

  // T17 – write-before-submit ───────────────────────────────────────────────────
  it("T17 — write-before-submit: intent in localStorage PRIMA di spark.send()", async () => {
    let intentDuringExecution: string | null = null;

    const executor: SparkSwapExecutor = {
      estimateFee: async () => ({ estimatedProviderFeeSat: 300n }),
      executeSwap: async () => {
        intentDuringExecution = localStorageMock.getItem(LNBTC_INTENT_KEY);
        return { paymentId: "pay-t17", feeSat: 300n };
      },
    };

    mockFetchOk({});

    const provider = new BreezSparkBtcLnProvider(executor);
    await provider.execute(TEST_REQ);

    expect(intentDuringExecution).not.toBeNull();
    const parsed = JSON.parse(intentDuringExecution!);
    expect(parsed.amount_sat).toBe(10_000);
    expect(parsed.btc_address).toBe("bc1qtest");
    expect(typeof parsed.key).toBe("string");
  });

});
