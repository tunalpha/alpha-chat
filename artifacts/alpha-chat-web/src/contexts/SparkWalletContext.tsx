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
 *
 * ARCHITETTURA C2+A (fee collection):
 * - collectFee(mainPaymentId, feeAmountSat):
 *     Tier 1 — registra fee come pending + tenta invio immediato verso Alpha Spark.
 *     Chiamato da AlphaWalletPage.persistLnSuccess dopo ogni main payment.
 *     SCOPE LOCK: NON modifica prepareSend/send/sendInProgress/reconciliation.
 * - Tier 2 (on-connect): all'avvio/login legge fee pendenti dal backend e le
 *     aggrega in un unico pagamento Spark. Fire-and-forget, non blocca la UI.
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
import {
  apiGetSparkUserFeeConfig,
  apiSparkRecordFee,
  apiSparkMarkFeeCollected,
  apiSparkMarkFeesBulkCollected,
  apiSparkGetPendingFees,
} from "../lib/spark/spark-api";
import type {
  SparkAdapterState,
  SparkAdapterError,
  SparkFeeConfig,
  SparkWalletInfo,
  SparkFeeBreakdown,
  SparkPaymentEvent,
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

  /**
   * Alpha Spark Fee Wallet address (identity pubkey).
   * Null finché non configurato dall'admin (wallet non ancora creato).
   * Quando null: fee registrata come pending, invio skippato.
   */
  feeAddress:     string | null;

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

  /**
   * Iscriviti agli eventi Lightning/Spark (pagamenti ricevuti/inviati/falliti).
   * Restituisce una funzione di cleanup da chiamare al dismount.
   * Delegato direttamente all'adapter tramite ref — stabile, nessun re-render.
   */
  subscribeToEvents(cb: (e: SparkPaymentEvent) => void): () => void;

  /**
   * C2+A Tier 1: registra la fee come pending + tenta l'invio immediato verso Alpha Spark.
   *
   * SCOPE LOCK: non modifica il main Lightning payment flow.
   * - NON tocca prepareSend, sendPayment, sendInProgress, reconciliation, history.
   * - Se fallisce: il main payment resta SUCCESS, la fee resta pending_collection.
   * - L'invio Spark fee è completamente separato dall'invio principale.
   * - Se fee_address è null: registra solo il pending, nessun invio Spark.
   *
   * @param mainPaymentId — paymentId del main payment (idempotency key)
   * @param feeAmountSat  — fee Alpha in satoshi (bigint)
   */
  collectFee(mainPaymentId: string, feeAmountSat: bigint): Promise<void>;
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

  /** Ref per il fee address — stabile, nessun re-render nelle callback */
  const feeAddressRef = useRef<string | null>(null);

  // Carica user fee config (include fee_address) — accessibile a utenti normali
  useEffect(() => {
    if (!isEnabled) return;
    apiGetSparkUserFeeConfig()
      .then(cfg => {
        setFee(cfg);
        feeAddressRef.current = cfg.fee_address ?? null;
      })
      .catch(() => {
        console.warn("[SparkWallet] Impossibile caricare fee config dal backend — uso defaults");
      });
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

  // ── C2+A Tier 2: raccolta pending fees all'avvio/connect ──────────────────
  // Funzione interna — non esposta nel context, chiamata dopo connect().
  // Aggrega N fee pendenti in un unico pagamento Spark verso Alpha.
  // Fire-and-forget: errori non bloccano la UI né il main payment flow.

  const _collectPendingFees = async (): Promise<void> => {
    const addr = feeAddressRef.current;
    if (!addr) return; // fee_address non configurato → skip (fee restano pending)

    const adapter = adapterRef.current;
    if (!adapter || adapter.state !== "connected") return;

    try {
      const { pendingFees, totalSat } = await apiSparkGetPendingFees();
      if (!pendingFees.length || totalSat <= 0) return;

      const totalSatBig = BigInt(totalSat);

      // prepareSend imposta _lastPrepareResponse nell'adapter
      await adapter.prepareSend({ paymentRequest: addr, amountSat: totalSatBig });
      const result = await adapter.send({ paymentRequest: addr, amountSat: totalSatBig });

      // Refresh balance post fee collection
      const info = await adapter.getInfo().catch(() => undefined);
      if (info) setInfo(info);

      // Marca tutte le fee come raccolte con il singolo feePaymentId
      await apiSparkMarkFeesBulkCollected({
        mainPaymentIds: pendingFees.map(f => f.mainPaymentId),
        feePaymentId:   result.paymentId,
      });

      console.info(`[SparkFee] Tier 2: raccolte ${pendingFees.length} fee pendenti (${totalSat} sat) → ${result.paymentId}`);
    } catch (err) {
      // Non bloccare il flusso — le fee restano pending_collection e verranno
      // ritentate al prossimo connect/visibilitychange.
      console.warn("[SparkFee] Tier 2 pending collection fallita (non bloccante):", err);
    }
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (!isEnabled) return;
    // Finding 5: guard contro doppia chiamata — evita SDK orfani
    if (
      state === "connecting" ||
      state === "connected"  ||
      state === "syncing"
    ) return;
    setState("connecting");
    setError(undefined);
    try {
      const adapter = await createSparkAdapter();
      adapterRef.current = adapter;
      // getMnemonic iniettato da App.tsx — legge keystore Alpha Wallet via sessionStorage.
      // SECURITY: il plaintext mnemonic esiste in memoria solo durante connect().
      await adapter.connect({ storageDir, network: "mainnet", getMnemonic });
      const info = await adapter.getInfo();
      setInfo(info);
      setState("connected");

      // C2+A Tier 2: raccoglie fee pendenti da sessioni precedenti.
      // Fire-and-forget — errori non bloccano il connect né la UI.
      void _collectPendingFees().catch(() => {});
    } catch (err) {
      const e: SparkAdapterError = {
        code:        "CONNECT_FAILED",
        message:     err instanceof Error ? err.message : String(err),
        recoverable: true,
      };
      setError(e);
      setState("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled, storageDir, state]);

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

  // ── Send ──────────────────────────────────────────────────────────────────

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
    const result            = await adapter.send(req);
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

  // Stabile tramite ref — non causa re-render, sempre aggiornato
  const subscribeToEvents = useCallback((cb: (e: SparkPaymentEvent) => void): (() => void) => {
    return adapterRef.current?.subscribeToEvents(cb) ?? (() => {});
  }, []); // dipendenze vuote: adapterRef è un ref, sempre attuale

  // ── C2+A Tier 1: collectFee ───────────────────────────────────────────────

  /**
   * Tier 1: registra fee pending + tenta invio immediato verso Alpha Spark.
   *
   * SCOPE LOCK: non tocca prepareSend/send/sendInProgress/reconciliation/history.
   * Se l'invio Spark fallisce → fee resta pending_collection (Tier 2 la recupera).
   * Se fee_address è null → registra solo il pending, nessun invio.
   *
   * IDEMPOTENZA: mainPaymentId è la chiave — lo stesso pagamento non può generare
   * due riscossioni anche se collectFee viene chiamata più volte.
   */
  const collectFee = useCallback(async (
    mainPaymentId: string,
    feeAmountSat:  bigint,
  ): Promise<void> => {
    if (feeAmountSat <= 0n) return; // fee zero → skip

    // 1. Registra come pending_collection nel backend (idempotente)
    try {
      await apiSparkRecordFee({
        paymentId:           mainPaymentId,
        alphaPlatformFeeSat: Number(feeAmountSat),
      });
    } catch (err) {
      console.warn("[SparkFee] Impossibile registrare fee pending nel backend:", err);
      return; // Senza record non possiamo procedere in modo idempotente
    }

    // 2. Tier 1: tenta invio immediato se fee_address configurato
    const addr    = feeAddressRef.current;
    const adapter = adapterRef.current;
    if (!addr || !adapter || adapter.state !== "connected") {
      // fee_address non ancora configurato (wallet non ancora creato)
      // oppure adapter non connesso → fee resta pending, Tier 2 la raccoglierà
      return;
    }

    try {
      // prepareSend imposta _lastPrepareResponse nell'adapter (eseguito dopo il main payment)
      await adapter.prepareSend({ paymentRequest: addr, amountSat: feeAmountSat });
      const feeResult = await adapter.send({ paymentRequest: addr, amountSat: feeAmountSat });

      // Refresh balance post fee send
      const info = await adapter.getInfo().catch(() => undefined);
      if (info) setInfo(info);

      // Marca come raccolta (idempotente su feePaymentId)
      await apiSparkMarkFeeCollected({
        mainPaymentId,
        feePaymentId: feeResult.paymentId,
      });

      console.info(`[SparkFee] Tier 1: fee raccolta → ${feeResult.paymentId} (${feeAmountSat} sat)`);
    } catch (err) {
      // Tier 1 fallito → fee resta pending_collection
      // Tier 2 la raccoglierà al prossimo connect/avvio
      console.warn("[SparkFee] Tier 1 fee send fallito — sarà ritentato al prossimo avvio:", err);
    }
  }, []); // dipendenze vuote: chiude su refs stabili

  // ── Context value ─────────────────────────────────────────────────────────

  const value: SparkWalletContextValue = {
    adapterType:  isEnabled ? (adapterRef.current?.adapterType ?? null) : null,
    state:        isEnabled ? state : "disabled",
    lastError,
    isEnabled,
    walletInfo,
    feeConfig,
    feeAddress:   feeAddressRef.current,
    connect,
    disconnect,
    syncWallet,
    calculateSendFee,
    send,
    createReceiveInvoice,
    listPayments,
    subscribeToEvents,
    collectFee,
  };

  return (
    <SparkWalletContext.Provider value={value}>
      {children}
    </SparkWalletContext.Provider>
  );
}
