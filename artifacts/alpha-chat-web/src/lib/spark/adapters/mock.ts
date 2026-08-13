/**
 * MockSparkAdapter — implementazione in-memory per sviluppo e unit test.
 *
 * Nessuna dipendenza da Breez SDK, nessuna rete, nessun WASM.
 * Tutti i metodi ritornano dati simulati plausibili.
 * Usato automaticamente quando VITE_BREEZ_API_KEY non è configurata.
 */

import type { BreezSparkAdapter } from "../spark-adapter";
import type {
  SparkAdapterState,
  SparkAdapterError,
  SparkConnectConfig,
  SparkWalletInfo,
  SparkPayment,
  SparkPaymentEvent,
  SparkPrepareSendRequest,
  SparkPrepareSendResult,
  SparkSendRequest,
  SparkSendResult,
  SparkReceiveRequest,
  SparkReceiveResult,
  SparkListPaymentsRequest,
} from "../spark-types";

/** Delay simulato per operazioni mock (ms). */
const MOCK_DELAY = 300;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

let _paymentCounter = 0;

export class MockSparkAdapter implements BreezSparkAdapter {
  readonly adapterType = "mock" as const;
  private _state: SparkAdapterState = "disconnected";
  private _lastError?: SparkAdapterError;

  get state()     { return this._state;     }
  get lastError() { return this._lastError; }

  async connect(_config: SparkConnectConfig): Promise<void> {
    this._state = "connecting";
    await sleep(MOCK_DELAY);
    this._state = "connected";
  }

  async disconnect(): Promise<void> {
    await sleep(100);
    this._state = "disconnected";
  }

  async getInfo(): Promise<SparkWalletInfo> {
    this._assertConnected();
    await sleep(200);
    return {
      identityPubkey: "mock_identity_pubkey_0000000000000000000000000000000000000000000000000000000000000000",
      balanceSat:     50000n,  // 50k sats mock
    };
  }

  async syncWallet(): Promise<void> {
    this._assertConnected();
    this._state = "syncing";
    await sleep(MOCK_DELAY);
    this._state = "connected";
  }

  async prepareSend(req: SparkPrepareSendRequest): Promise<SparkPrepareSendResult> {
    this._assertConnected();
    await sleep(200);
    const amount = req.amountSat ?? 1000n;
    return {
      estimatedProviderFeeSat: 3n,   // 3 sat routing mock
      recipientAmountSat:      amount,
      expiresAt:               Date.now() + 30_000,
    };
  }

  async send(req: SparkSendRequest): Promise<SparkSendResult> {
    this._assertConnected();
    await sleep(MOCK_DELAY);
    const amount = req.amountSat ?? 1000n;
    _paymentCounter++;
    return {
      paymentId: `mock_payment_${_paymentCounter}`,
      amountSat: amount,
      feeSat:    3n,
      status:    "completed",
    };
  }

  async createReceiveInvoice(req: SparkReceiveRequest): Promise<SparkReceiveResult> {
    this._assertConnected();
    await sleep(200);
    if (req.method === "bolt11") {
      return {
        bolt11:    `lnbc${req.amountSat ?? 0}n1pmock_invoice_placeholder`,
        expiresAt: Date.now() + 3_600_000,
      };
    }
    if (req.method === "spark_address") {
      return { sparkAddress: "sp1mock_spark_address_0000000000000000000" };
    }
    return { bitcoinAddress: "tb1qmock_bitcoin_address_00000000000000000" };
  }

  async listPayments(req: SparkListPaymentsRequest): Promise<SparkPayment[]> {
    this._assertConnected();
    await sleep(200);
    const limit = req.limit ?? 20;
    const payments: SparkPayment[] = [];
    for (let i = 0; i < Math.min(limit, 3); i++) {
      payments.push({
        id:          `mock_payment_history_${i}`,
        paymentType: i % 2 === 0 ? "btc_lightning_sent" : "btc_lightning_received",
        status:      "completed",
        amountSat:   BigInt(1000 + i * 100),
        feeSat:      3n,
        timestamp:   Math.floor(Date.now() / 1000) - i * 86400,
        description: `Mock payment ${i}`,
      });
    }
    return payments;
  }

  /** Mock stub — nessun evento reale in sviluppo. */
  subscribeToEvents(_cb: (e: SparkPaymentEvent) => void): () => void {
    return () => {}; // no-op cleanup
  }

  private _assertConnected(): void {
    if (this._state !== "connected" && this._state !== "syncing") {
      throw new Error("MockSparkAdapter: non connesso. Chiamare connect() prima.");
    }
  }
}
