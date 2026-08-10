/**
 * Test suite — multichain-poll: isNetworkError + runPollDetect
 *
 * Verifica che:
 *  - errori di rete transitori (Load failed / Failed to fetch) non terminino il polling;
 *  - DEPOSIT_TX_NOT_DETECTED sia trattato come transitorio;
 *  - ADAPTER_NOT_FOUND e FEATURE_DISABLED siano fatali;
 *  - dopo un network error il polling rilevi correttamente il deposito.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isNetworkError, runPollDetect } from "../lib/multichain-poll";

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

/** Opzioni veloci per i test (evitano 10-60 s di attesa reale). */
const FAST = { intervalMs: 50, maxMs: 2_000, firstDelayMs: 50 };

// ─── isNetworkError ──────────────────────────────────────────────────────────

describe("isNetworkError", () => {
  it("riconosce iOS Safari 'Load failed'", () => {
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
  });

  it("riconosce Chrome 'Failed to fetch'", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("riconosce Firefox NetworkError", () => {
    expect(
      isNetworkError(new TypeError("NetworkError when attempting to fetch resource.")),
    ).toBe(true);
  });

  it("restituisce false per un Error generico con stesso messaggio (non TypeError)", () => {
    expect(isNetworkError(new Error("Load failed"))).toBe(false);
  });

  it("restituisce false per errore applicativo con .code", () => {
    expect(isNetworkError(appError("ADAPTER_NOT_FOUND"))).toBe(false);
  });

  it("restituisce false per TypeError con messaggio non noto", () => {
    expect(isNetworkError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });
});

// ─── runPollDetect ───────────────────────────────────────────────────────────

describe("runPollDetect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Test 1: "Load failed" → polling continua ──────────────────────────────
  it("continua il polling quando fetch() rifiuta con 'Load failed' (iOS Safari)", async () => {
    const detect = vi.fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce({ status: "pending" }); // deposito confermato al secondo tentativo

    const promise = runPollDetect("tx-btc-1", detect, undefined, FAST);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  // ── Test 2: "Failed to fetch" → polling continua ─────────────────────────
  it("continua il polling quando fetch() rifiuta con 'Failed to fetch' (Chrome)", async () => {
    const detect = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ status: "pending" });

    const promise = runPollDetect("tx-btc-2", detect, undefined, FAST);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  // ── Test 3: DEPOSIT_TX_NOT_DETECTED → polling continua ───────────────────
  it("continua il polling con DEPOSIT_TX_NOT_DETECTED", async () => {
    const detect = vi.fn()
      .mockRejectedValueOnce(appError("DEPOSIT_TX_NOT_DETECTED"))
      .mockResolvedValueOnce({ status: "pending" });

    const promise = runPollDetect("tx-btc-3", detect, undefined, FAST);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  // ── Test 4: ADAPTER_NOT_FOUND → polling termina con errore ───────────────
  it("termina con errore per ADAPTER_NOT_FOUND", async () => {
    const detect = vi.fn().mockRejectedValueOnce(appError("ADAPTER_NOT_FOUND"));

    const promise = runPollDetect("tx-btc-4", detect, undefined, FAST);
    // Agganciamo .rejects PRIMA di runAllTimersAsync per evitare unhandled rejection.
    const assertion = expect(promise).rejects.toMatchObject({ code: "ADAPTER_NOT_FOUND" });
    await vi.runAllTimersAsync();
    await assertion;
    expect(detect).toHaveBeenCalledTimes(1);
  });

  // ── Test 5: FEATURE_DISABLED → polling termina con errore ────────────────
  it("termina con errore per FEATURE_DISABLED", async () => {
    const detect = vi.fn().mockRejectedValueOnce(appError("FEATURE_DISABLED"));

    const promise = runPollDetect("tx-btc-5", detect, undefined, FAST);
    // Agganciamo .rejects PRIMA di runAllTimersAsync per evitare unhandled rejection.
    const assertion = expect(promise).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    await vi.runAllTimersAsync();
    await assertion;
    expect(detect).toHaveBeenCalledTimes(1);
  });

  // ── Test 6: network error → deposito rilevato correttamente ──────────────
  it("rileva il deposito correttamente dopo un network error transitorio", async () => {
    const detect = vi.fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))  // blip rete
      .mockResolvedValueOnce({ status: "awaiting_deposit" }) // deposito non ancora
      .mockResolvedValueOnce({ status: "pending" });          // deposito confermato ✓

    const promise = runPollDetect("tx-btc-6", detect, undefined, FAST);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(detect).toHaveBeenCalledTimes(3);
  });
});
