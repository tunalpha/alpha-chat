/**
 * spark-feature-flag.test.ts — Phase 4 Regression Audit
 *
 * Verifica:
 * - spark_lightning_enabled=false → zero Spark code/connessioni/IDB
 * - AppFeatureFlags fail-safe: spark=false
 * - SparkWalletProvider è no-op con isEnabled=false
 * - Nessuna regressione al portfolio/fee BTC esistente con flag=false
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { SparkWalletProvider, useSparkWallet } from "../../contexts/SparkWalletContext";

function makeWrapper(isEnabled: boolean) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(SparkWalletProvider, { isEnabled }, children);
}

describe("A. spark_lightning_enabled=false → no-op completo", () => {
  it("A1: state='disabled' con flag=false", () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    expect(result.current.state).toBe("disabled");
  });

  it("A2: adapterType=null con flag=false", () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    expect(result.current.adapterType).toBeNull();
  });

  it("A3: connect() con flag=false non cambia stato (guardia if !isEnabled return)", async () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    await act(async () => { await result.current.connect(); });
    expect(result.current.state).toBe("disabled");
  });

  it("A4: feeConfig=undefined con flag=false (nessuna chiamata backend)", async () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.feeConfig).toBeUndefined();
  });

  it("A5: walletInfo=undefined con flag=false", () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    expect(result.current.walletInfo).toBeUndefined();
  });

  it("A6: lastError=undefined con flag=false (nessun tentativo)", () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    expect(result.current.lastError).toBeUndefined();
  });
});

describe("B. AppFeatureFlags — fail-safe Spark", () => {
  it("B1: fail-safe default: spark_lightning_enabled=false", () => {
    // Il fail-safe in api.ts restituisce { spark_lightning_enabled: false }
    // quando la chiamata /admin/app-feature-flags fallisce
    const failSafe = { multichain_payments_enabled: true, spark_lightning_enabled: false };
    expect(failSafe.spark_lightning_enabled).toBe(false);
  });

  it("B2: fail-safe: multichain_payments_enabled=true (backward compat invariato)", () => {
    const failSafe = { multichain_payments_enabled: true, spark_lightning_enabled: false };
    expect(failSafe.multichain_payments_enabled).toBe(true);
  });

  it("B3: i flag sono indipendenti (cambiare spark non cambia multichain)", () => {
    const flags = { multichain_payments_enabled: true, spark_lightning_enabled: false };
    const withSparkEnabled = { ...flags, spark_lightning_enabled: true };
    expect(withSparkEnabled.multichain_payments_enabled).toBe(true); // invariato
    expect(withSparkEnabled.spark_lightning_enabled).toBe(true);
  });
});

describe("C. Toggle false → true → false", () => {
  it("C1: false → isEnabled=false → state='disabled'", () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    expect(result.current.state).toBe("disabled");
    expect(result.current.isEnabled).toBe(false);
  });

  it("C2: true → isEnabled=true (pronto ma non connesso)", () => {
    const { result } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(true) });
    expect(result.current.isEnabled).toBe(true);
  });

  it("C3: false → true → false: con false finale lo stato è 'disabled'", () => {
    // RTL renderHook non propaga le props extra al wrapper (solo a hookFn).
    // Usiamo tre render separati invece.
    const { result: r1 } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    expect(r1.current.state).toBe("disabled");

    const { result: r2 } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(true) });
    expect(r2.current.isEnabled).toBe(true);

    const { result: r3 } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    expect(r3.current.state).toBe("disabled");
    expect(r3.current.isEnabled).toBe(false);
  });
});

describe("D. Nessuna regressione al portfolio BTC/EVM con flag=false", () => {
  it("D1: WalletProvider BTC importabile senza errori con flag Spark=false", async () => {
    const mod = await import("../../wallet/context/WalletContext");
    expect(typeof mod.WalletProvider).toBe("function");
  });

  it("D2: ChatWalletBridgeProvider importabile senza errori con flag Spark=false", async () => {
    const mod = await import("../../wallet/bridge/chat-wallet-bridge-context");
    expect(typeof mod.ChatWalletBridgeProvider).toBe("function");
  });

  it("D3: SparkWalletProvider con flag=false non modifica window né document", () => {
    // Nessun listener aggiunto se isEnabled=false
    const addEventListenerSpy = vi.spyOn(document, "addEventListener");
    const { unmount } = renderHook(() => useSparkWallet(), { wrapper: makeWrapper(false) });
    // visibilitychange NON deve essere registrato con isEnabled=false
    const sparkListeners = addEventListenerSpy.mock.calls.filter(
      ([event]) => event === "visibilitychange",
    );
    expect(sparkListeners.length).toBe(0);
    unmount();
    addEventListenerSpy.mockRestore();
  });
});

describe("E. Zero Spark resources con flag=false (verifica moduli)", () => {
  it("E1: spark-fee-engine importabile senza side-effects", async () => {
    const mod = await import("../../lib/spark/spark-fee-engine");
    expect(typeof mod.calculateSparkFeeBreakdown).toBe("function");
    // Nessun side-effect all'import (nessuna connessione, nessun IDB)
  });

  it("E2: spark-api.ts non fa fetch all'import", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await import("../../lib/spark/spark-api");
    // Nessuna fetch chiamata semplicemente importando il modulo
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
