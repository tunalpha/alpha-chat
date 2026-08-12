/**
 * SparkWalletContext — state machine React per Lightning/Spark
 *
 * FEATURE FLAG: `spark_lightning_enabled` (da /api/v1/admin/app-feature-flags).
 * Se false: provider è un no-op, zero inizializzazione SDK, zero WASM caricato.
 *
 * ISOLAMENTO:
 * - Non modifica WalletContext BTC.
 * - Non importa da ChatWalletBridgeProvider.
 * - Non ha dipendenze da EVM, USDA, MultiChain, Signal.
 *
 * STATO: disconnected → connecting → connected ↔ syncing → error
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createSparkAdapter, type BreezSparkAdapter } from "../lib/spark/spark-adapter";
import { apiGetSparkFeeConfig } from "../lib/spark/spark-api";
import type {
  SparkAdapterState,
  SparkAdapterError,
  SparkFeeConfig,
  SparkWalletInfo,
  SparkFeeBreakdown,
  SparkPrepareSendRequest,
  SparkSendRequest,
  SparkSendResult,
  SparkReceiveRequest,
  SparkReceiveResult,
  SparkListPaymentsRequest,
  SparkPayment,
} from "../lib/spark/spark-types";
import {
  calculateSparkFeeBreakdown,
  calculateSparkFeeBreakdownRecipientExact,
  resolveActualProviderFee,
} from "../lib/spark/spark-fee-engine";

// ── Context value ─────────────────────────────────────────────────────────────

export interface SparkWalletContextValue {
  /** Adapter type: "mock" | "live" | null (disabled) */
  adapterType:    "mock" | "live" | null;
  state:          SparkAdapterState | "disabled";
  lastError?:     SparkAdapterError;
  isEnabled:      boolean;

  /** Wallet info (set after connect + getInfo) */
  walletInfo?:    SparkWalletInfo;

  /** Platform fee config (loaded from backend) */
  feeConfig?:     SparkFeeConfig;

  // ── Actions ─────────────────────────────────────────────────────────────────
  connect():                         Promise<void>;
  disconnect():                      Promise<void>;
  syncWallet():                      Promise<void>;

  /**
   * Calcola fee breakdown PRIMA di inviare.
   * estimatedProviderFee viene da prepareSend (SDK).
   */
  calculateSendFee(
    req:        SparkPrepareSendRequest,
    amountMode: "fee_excluded" | "recipient_exact",
  ): Promise<SparkFeeBreakdown>;

  /** Invia e restituisce il breakdown con fee effettive. */
  send(
    req:       SparkSendRequest,
    breakdown: SparkFeeBreakdown,
  ): Promise<{ result: SparkSendResult; resolvedBreakdown: SparkFeeBreakdown }>;

  createReceiveInvoice(req: SparkReceiveRequest): Promise<SparkReceiveResult>;
  listPayments(req: SparkListPaymentsRequest):    Promise<SparkPayment[]>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const SparkWalletContext = createContext<SparkWalletContextValue | null>(null);

export function useSparkWallet(): SparkWalletContextValue {
  const ctx = useContext(SparkWalletContext);
  if (!ctx) throw new Error("useSparkWallet() chiamato fuori da SparkWalletProvider");
  return ctx;
}

/**
 * Versione safe di useSparkWallet — restituisce null se SparkWalletProvider
 * non è nell'albero (es. spark_lightning_enabled=false).
 * Portfolio e altri componenti opzionali usano questo.
 */
export function useSparkWalletOptional(): SparkWalletContextValue | null {
  return useContext(SparkWalletContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface Props {
  children:    ReactNode;
  /** Iniettato da App.tsx leggendo AppFeatureFlags */
  isEnabled:   boolean;
  /** storageDir per IndexedDB Spark — idealmente basato sull'userId */
  storageDir?: string;
  /**
   * Callback per ottenere il mnemonic dal keystore Alpha Wallet.
   * Iniettato da App.tsx — legge sessionStorage "aw_bio_pin" + decryptSeed().
   * NON modifica WalletContext BTC.
   * Se assente: LiveAdapter usa il proprio fallback (lancia errore).
   */
  getMnemonic?: () => Promise<string>;
}

export function SparkWalletProvider({ children, isEnabled, storageDir = "spark-wallet-v1", getMnemonic }: Props) {
  const adapterRef             = useRef<BreezSparkAdapter | null>(null);
  const [state, setState]      = useState<SparkAdapterState | "disabled">("disabled");
  const [lastError, setError]  = useState<SparkAdapterError | undefined>();
  const [walletInfo, setInfo]  = useState<SparkWalletInfo | undefined>();
  const [feeConfig, setFee]    = useState<SparkFeeConfig | undefined>();

  // Carica fee config una volta sola
  useEffect(() => {
    if (!isEnabled) return;
    apiGetSparkFeeConfig().then(setFee);
  }, [isEnabled]);

  // visibilitychange: syncWallet al ritorno in foreground (iOS background fix)
  useEffect(() => {
    if (!isEnabled) return;
    const handler = async () => {
      if (document.visibilityState === "visible" && adapterRef.current?.state === "connected") {
        try {
          setState("syncing");
          await adapterRef.current.syncWallet();
          const info = await adapterRef.current.getInfo();
          setInfo(info);
          setState("connected");
        } catch { setState("connected"); }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [isEnabled]);

  const connect = useCallback(async () => {
    // ── SPARK_DIAG ──────────────────────────────────────────────────────────
    console.log("[SPARK_DIAG] SparkWalletContext.connect() called, isEnabled:", isEnabled);
    // ────────────────────────────────────────────────────────────────────────
    if (!isEnabled) return;
    setState("connecting");
    setError(undefined);
    try {
      console.log("[SPARK_DIAG] createSparkAdapter() starting");
      const adapter = await createSparkAdapter();
      console.log("[SPARK_DIAG] adapter created, type:", adapter.adapterType);
      adapterRef.current = adapter;
      // getMnemonic iniettato da App.tsx — legge keystore Alpha Wallet via sessionStorage.
      // SECURITY: il plaintext mnemonic esiste in memoria solo durante connect().
      console.log("[SPARK_DIAG] adapter.connect() starting, storageDir:", storageDir);
      await adapter.connect({ storageDir, network: "mainnet", getMnemonic });
      console.log("[SPARK_DIAG] adapter.connect() OK — calling getInfo()");
      const info = await adapter.getInfo();
      console.log("[SPARK_DIAG] getInfo OK, balanceSat:", info.balanceSat?.toString());
      setInfo(info);
      setState("connected");
      console.log("[SPARK_DIAG] state → connected ✓");
    } catch (err) {
      console.log("[SPARK_DIAG] connect() CATCH:", err instanceof Error ? err.message : String(err));
      const e: SparkAdapterError = {
        code:        "CONNECT_FAILED",
        message:     err instanceof Error ? err.message : String(err),
        recoverable: true,
      };
      setError(e);
      setState("error");
    }
  }, [isEnabled, storageDir]);

  const disconnect = useCallback(async () => {
    await adapterRef.current?.disconnect().catch(() => {});
    adapterRef.current = null;
    setState("disconnected");
    setInfo(undefined);
  }, []);

  const syncWallet = useCallback(async () => {
    const adapter = adapterRef.current;
    if (!adapter || adapter.state !== "connected") return;
    setState("syncing");
    try {
      await adapter.syncWallet();
      const info = await adapter.getInfo();
      setInfo(info);
    } finally {
      setState("connected");
    }
  }, []);

  const calculateSendFee = useCallback(async (
    req:        SparkPrepareSendRequest,
    amountMode: "fee_excluded" | "recipient_exact",
  ): Promise<SparkFeeBreakdown> => {
    const adapter = adapterRef.current;
    if (!adapter) throw new Error("Adapter non inizializzato");
    const cfg = feeConfig ?? { fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 };
    const prepared = await adapter.prepareSend(req);
    if (amountMode === "recipient_exact") {
      return calculateSparkFeeBreakdownRecipientExact(
        prepared.recipientAmountSat,
        prepared.estimatedProviderFeeSat,
        cfg,
      );
    }
    return calculateSparkFeeBreakdown(
      prepared.recipientAmountSat,
      prepared.estimatedProviderFeeSat,
      cfg,
    );
  }, [feeConfig]);

  const send = useCallback(async (
    req:       SparkSendRequest,
    breakdown: SparkFeeBreakdown,
  ) => {
    const adapter = adapterRef.current;
    if (!adapter) throw new Error("Adapter non inizializzato");
    const result           = await adapter.send(req);
    const resolvedBreakdown = resolveActualProviderFee(breakdown, result.feeSat);
    // Refresh balance post-send
    const info = await adapter.getInfo().catch(() => walletInfo);
    if (info) setInfo(info);
    return { result, resolvedBreakdown };
  }, [walletInfo]);

  const createReceiveInvoice = useCallback(async (req: SparkReceiveRequest) => {
    const adapter = adapterRef.current;
    if (!adapter) throw new Error("Adapter non inizializzato");
    return adapter.createReceiveInvoice(req);
  }, []);

  const listPayments = useCallback(async (req: SparkListPaymentsRequest) => {
    const adapter = adapterRef.current;
    if (!adapter) throw new Error("Adapter non inizializzato");
    return adapter.listPayments(req);
  }, []);

  const value: SparkWalletContextValue = {
    adapterType:  isEnabled ? (adapterRef.current?.adapterType ?? null) : null,
    state:        isEnabled ? state : "disabled",
    lastError,
    isEnabled,
    walletInfo,
    feeConfig,
    connect,
    disconnect,
    syncWallet,
    calculateSendFee,
    send,
    createReceiveInvoice,
    listPayments,
  };

  return (
    <SparkWalletContext.Provider value={value}>
      {children}
    </SparkWalletContext.Provider>
  );
}
