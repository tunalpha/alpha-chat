/**
 * LiveSparkAdapter — wrapper attorno al Breez SDK WASM per produzione.
 *
 * SECURITY:
 * - apiKey letta SOLO da import.meta.env.VITE_BREEZ_API_KEY — mai hardcoded né loggata.
 * - mnemonic/seed mai trasmesso — ExternalSigner firma localmente.
 * - WASM caricato con dynamic import (lazy, 7.2MB) solo quando necessario.
 *
 * ISOLAMENTO:
 * - Nessun import da altri moduli Alpha (BTC, EVM, USDA, Signal).
 * - Traduce le risposte SDK in tipi locali (spark-types.ts).
 */

import type { BreezSparkAdapter } from "../spark-adapter";
import type {
  SparkAdapterState,
  SparkAdapterError,
  SparkConnectConfig,
  SparkWalletInfo,
  SparkPayment,
  SparkPaymentEvent,
  SparkPaymentType,
  SparkPrepareSendRequest,
  SparkPrepareSendResult,
  SparkSendRequest,
  SparkSendResult,
  SparkReceiveRequest,
  SparkReceiveResult,
  SparkListPaymentsRequest,
} from "../spark-types";

/** Tipo minimale per l'SDK Breez — evita import diretto del package. */
type SdkInstance = Record<string, unknown>;

export class LiveSparkAdapter implements BreezSparkAdapter {
  readonly adapterType = "live" as const;
  private _state: SparkAdapterState = "disconnected";
  private _lastError?: SparkAdapterError;
  private _sdk: SdkInstance | null = null;
  /** Callback iniettato da SparkWalletContext.connect() per accedere al keystore */
  private _getMnemonicFn?: () => Promise<string>;

  get state()     { return this._state;     }
  get lastError() { return this._lastError; }

  async connect(config: SparkConnectConfig): Promise<void> {
    // Salva il callback prima di tutto
    if (config.getMnemonic) this._getMnemonicFn = config.getMnemonic;
    this._state = "connecting";
    try {
      // Dynamic import — il WASM viene caricato qui (lazy).
      // L'SDK è servito come file statico da public/spark/ (non bundlato —
      // 7.2 MB WASM causerebbe OOM durante il build).
      // L'URL relativa si risolve correttamente con qualsiasi base path di deployment.
      const sparkBase = (import.meta.env.BASE_URL as string).replace(/\/$/, '');
      const sparkUrl  = `${sparkBase}/spark/index.js`;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const sdkModule = await import(/* @vite-ignore */ sparkUrl) as Record<string, unknown>;

      // initBreezSDK() imposta IndexedDB storage — obbligatorio prima di connect()
      if (typeof sdkModule["default"] === "function") {
        await (sdkModule["default"] as () => Promise<void>)();
      }

      const connectFn     = sdkModule["connect"] as (req: unknown) => Promise<unknown>;
      const defaultConfig = sdkModule["defaultConfig"] as (net: string) => Record<string, unknown>;

      const cfg = defaultConfig("mainnet");

      // SECURITY: apiKey mai loggata, mai in localStorage
      const apiKey = (import.meta.env as Record<string, string>)["VITE_BREEZ_API_KEY"];
      if (apiKey) cfg["apiKey"] = apiKey;

      // SECURITY: mnemonic usato solo per derivazione locale, non trasmesso
      const mnemonic = await this._getMnemonic();

      this._sdk = await Promise.race([
        connectFn({
          config:     cfg,
          seed:       { type: "mnemonic", mnemonic },
          storageDir: config.storageDir,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("SPARK_CONNECT_TIMEOUT")), 60_000),
        ),
      ]) as SdkInstance;

      this._state = "connected";
      this._lastError = undefined;
    } catch (err) {
      this._state = "error";
      this._lastError = {
        code:        "CONNECT_FAILED",
        message:     err instanceof Error ? err.message : String(err),
        recoverable: true,
      };
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this._sdk && typeof this._sdk["disconnect"] === "function") {
      await (this._sdk["disconnect"] as () => Promise<void>)().catch(() => {});
    }
    this._sdk   = null;
    this._state = "disconnected";
  }

  async getInfo(): Promise<SparkWalletInfo> {
    const sdk = this._assertSdk();
    const raw = await (sdk["getInfo"] as (r: { ensureSynced?: boolean }) => Promise<unknown>)(
      { ensureSynced: false },
    ) as Record<string, unknown>;
    return {
      identityPubkey: raw["identityPubkey"] as string,
      balanceSat:     BigInt((raw["balanceSats"] as number | bigint) ?? 0),
    };
  }

  async syncWallet(): Promise<void> {
    const sdk = this._assertSdk();
    this._state = "syncing";
    try {
      await (sdk["syncWallet"] as (r: Record<never, never>) => Promise<unknown>)({});
    } finally {
      this._state = "connected";
    }
  }

  async prepareSend(req: SparkPrepareSendRequest): Promise<SparkPrepareSendResult> {
    const sdk = this._assertSdk();
    const raw = await (sdk["prepareSendPayment"] as (r: unknown) => Promise<unknown>)({
      paymentRequest: req.paymentRequest,
      ...(req.amountSat !== undefined ? { amount: req.amountSat } : {}),
    }) as Record<string, unknown>;

    return {
      estimatedProviderFeeSat: BigInt((raw["fees"] as number | bigint) ?? 0),
      recipientAmountSat:      BigInt((raw["amount"] as number | bigint) ?? (req.amountSat ?? 0n)),
      expiresAt:               Date.now() + 30_000,
    };
  }

  async send(req: SparkSendRequest): Promise<SparkSendResult> {
    const sdk = this._assertSdk();
    const raw = await (sdk["sendPayment"] as (r: unknown) => Promise<unknown>)({
      paymentRequest: req.paymentRequest,
      ...(req.amountSat !== undefined ? { amount: req.amountSat } : {}),
    }) as Record<string, unknown>;

    const payment = (raw["payment"] ?? raw) as Record<string, unknown>;
    return {
      paymentId: payment["id"] as string ?? "unknown",
      amountSat: BigInt((payment["amount"] as number | bigint) ?? 0),
      feeSat:    BigInt((payment["fees"]   as number | bigint) ?? 0),
      status:    "completed",
    };
  }

  async createReceiveInvoice(req: SparkReceiveRequest): Promise<SparkReceiveResult> {
    const sdk = this._assertSdk();
    let paymentMethod: Record<string, unknown>;

    switch (req.method) {
      case "bolt11":
        paymentMethod = {
          type:        "bolt11Invoice",
          // amountSats è number nel WASM (non bigint); omesso → invoice "any amount"
          ...(req.amountSat !== undefined && req.amountSat > 0n
            ? { amountSats: Number(req.amountSat) }
            : {}),
          description: req.description ?? "",
          // expirySecs: passato esplicitamente per forzare 1 ora. Il default SDK è ~30 giorni.
          expirySecs:  req.expirySecs ?? 3600,
        };
        break;
      case "spark_address":
        paymentMethod = { type: "sparkAddress" };
        break;
      case "bitcoin_on_chain":
        paymentMethod = { type: "bitcoinAddress" };
        break;
    }

    const raw = await (sdk["receivePayment"] as (r: unknown) => Promise<unknown>)({
      paymentMethod,
    }) as Record<string, unknown>;

    return {
      // Il WASM restituisce ReceivePaymentResponse.paymentRequest (non "invoice")
      bolt11:          (raw["paymentRequest"] as string | undefined),
      sparkAddress:    (raw["sparkAddress"]   as string | undefined),
      bitcoinAddress:  (raw["address"]        as string | undefined),
      expiresAt:       raw["expiresAt"]        ? Number(raw["expiresAt"]) : undefined,
    };
  }

  async listPayments(req: SparkListPaymentsRequest): Promise<SparkPayment[]> {
    const sdk = this._assertSdk();
    const raw = await (sdk["listPayments"] as (r: unknown) => Promise<unknown>)({
      limit:         req.limit         ?? 50,
      offset:        req.offset        ?? 0,
      fromTimestamp: req.fromTimestamp,
      toTimestamp:   req.toTimestamp,
    }) as { payments?: unknown[] } | unknown[];

    const payments: unknown[] = Array.isArray(raw)
      ? raw
      : ((raw as { payments?: unknown[] }).payments ?? []);

    return payments.map((p) => {
      const payment = p as Record<string, unknown>;
      const type = payment["paymentType"] as string ?? "";
      return {
        id:          payment["id"] as string ?? "",
        paymentType: _mapPaymentType(type),
        status:      payment["status"] === "completed" ? "completed" : "pending",
        amountSat:   BigInt((payment["amount"] as number | bigint) ?? 0),
        feeSat:      BigInt((payment["fees"]   as number | bigint) ?? 0),
        timestamp:   Number(payment["timestamp"] ?? 0),
        // bolt11 può essere al top-level o in details.invoice (Lightning payments)
        bolt11: (() => {
          const top = payment["bolt11"] as string | undefined;
          if (top) return top;
          const det = payment["details"] as Record<string, unknown> | undefined;
          return det?.["type"] === "lightning"
            ? (det["invoice"] as string | undefined)
            : undefined;
        })(),
        description: payment["description"] as string | undefined,
      };
    });
  }

  /**
   * Iscriviti agli eventi SDK Breez (paymentSucceeded / paymentPending / paymentFailed).
   * Usa sdk.addEventListener → callback onEvent → mappa a SparkPaymentEvent.
   * Restituisce una funzione di cleanup che chiama sdk.removeEventListener.
   */
  subscribeToEvents(cb: (e: SparkPaymentEvent) => void): () => void {
    const sdk = this._sdk;
    if (!sdk) return () => {};
    let listenerId: string | null = null;
    const listener = {
      onEvent: (rawEvent: unknown) => {
        const ev   = rawEvent as Record<string, unknown>;
        const type = ev["type"] as string;
        if (type !== "paymentSucceeded" && type !== "paymentFailed" && type !== "paymentPending") return;
        const payment = ev["payment"] as Record<string, unknown> | undefined;
        if (!payment) return;
        const id     = (payment["id"] as string) ?? "";
        const amount = BigInt((payment["amount"] as number | bigint) ?? 0);
        const fees   = BigInt((payment["fees"]   as number | bigint) ?? 0);
        // bolt11 estratto da details.invoice per pagamenti Lightning
        const details = payment["details"] as Record<string, unknown> | undefined;
        const bolt11  = details?.["type"] === "lightning"
          ? (details["invoice"] as string | undefined)
          : undefined;
        cb({ type: type as SparkPaymentEvent["type"], paymentId: id, amountSat: amount, bolt11, feeSat: fees });
      },
    };
    void (sdk["addEventListener"] as (l: unknown) => Promise<string>)(listener)
      .then(id => { listenerId = id; })
      .catch((err: unknown) => {
        // Finding 11: log failure senza PII — il polling 15s in ReceiveView funge da fallback
        console.warn("[SparkLive] addEventListener fallito — eventi real-time non disponibili:", (err as Error)?.message ?? err);
      });
    return () => {
      if (listenerId !== null) {
        void (sdk["removeEventListener"] as (id: string) => Promise<boolean>)(listenerId).catch(() => {});
      }
    };
  }

  /**
   * Recupera il mnemonic dall'Alpha Wallet keystore tramite il callback iniettato.
   *
   * SECURITY:
   * - Il callback legge sessionStorage "aw_bio_pin" (già scritto da unlockWallet)
   *   e decifra il keystore IDB con AES-256-GCM via decryptSeed()
   * - Il plaintext mnemonic rimane in memoria JS solo per la durata di connect()
   * - NON viene mai loggato (nessun console.log/error sul plaintext)
   * - NON viene mai inviato al backend
   * - NON viene scritto in IDB Spark né in localStorage
   * - L'SDK lo usa esclusivamente per la derivazione locale (ExternalSigner)
   * - WalletContext BTC NON viene modificato
   */
  private async _getMnemonic(): Promise<string> {
    if (!this._getMnemonicFn) {
      throw new Error(
        "[SparkLive] getMnemonic callback non iniettato. " +
        "Assicurarsi che SparkWalletProvider riceva il prop getMnemonic da App.tsx.",
      );
    }
    const mnemonic = await this._getMnemonicFn();
    if (!mnemonic || typeof mnemonic !== "string") {
      throw new Error("[SparkLive] getMnemonic ha restituito un valore non valido");
    }
    // SECURITY: nessun log del plaintext mnemonic
    return mnemonic;
  }

  private _assertSdk(): SdkInstance {
    if (!this._sdk || this._state === "disconnected") {
      throw new Error("LiveSparkAdapter: non connesso. Chiamare connect() prima.");
    }
    return this._sdk;
  }
}

function _mapPaymentType(sdkType: string): SparkPaymentType {
  if (sdkType === "send") return "btc_lightning_sent";
  if (sdkType === "receive") return "btc_lightning_received";
  if (sdkType === "spark_send") return "spark_sent";
  if (sdkType === "spark_receive") return "spark_received";
  return "btc_lightning_sent"; // fallback
}
