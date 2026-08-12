/**
 * BreezSparkAdapter — interfaccia provider-agnostic per Lightning/Spark.
 *
 * Questo file definisce il contratto che qualsiasi provider Lightning
 * deve rispettare. In futuro è possibile sostituire Breez Spark con
 * un altro provider senza modificare UI, fee engine, portfolio, storico.
 *
 * Implementazioni:
 *   MockSparkAdapter  → src/lib/spark/adapters/mock.ts
 *   LiveSparkAdapter  → src/lib/spark/adapters/live.ts
 *
 * Selezione: basata su VITE_BREEZ_API_KEY (env).
 *   - Presente → LiveSparkAdapter (Breez SDK WASM, mainnet)
 *   - Assente  → MockSparkAdapter (in-memory, per sviluppo/test)
 */

import type {
  SparkAdapterState,
  SparkAdapterError,
  SparkWalletInfo,
  SparkPayment,
  SparkPrepareSendRequest,
  SparkPrepareSendResult,
  SparkSendRequest,
  SparkSendResult,
  SparkReceiveRequest,
  SparkReceiveResult,
  SparkListPaymentsRequest,
  SparkConnectConfig,
} from "./spark-types";

export interface BreezSparkAdapter {
  readonly state:        SparkAdapterState;
  readonly lastError?:   SparkAdapterError;
  /** "mock" | "live" — per debug e test */
  readonly adapterType:  "mock" | "live";

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  connect(config: SparkConnectConfig):    Promise<void>;
  disconnect():                           Promise<void>;

  // ── Wallet state ───────────────────────────────────────────────────────────
  getInfo():                              Promise<SparkWalletInfo>;
  syncWallet():                           Promise<void>;

  // ── Send ───────────────────────────────────────────────────────────────────
  /** Calcola la fee stimata PRIMA di inviare. Provider fee — non Alpha fee. */
  prepareSend(req: SparkPrepareSendRequest): Promise<SparkPrepareSendResult>;
  /** Invia il pagamento. Deve essere preceduto da prepareSend. */
  send(req: SparkSendRequest):            Promise<SparkSendResult>;

  // ── Receive ────────────────────────────────────────────────────────────────
  createReceiveInvoice(req: SparkReceiveRequest): Promise<SparkReceiveResult>;

  // ── History ────────────────────────────────────────────────────────────────
  listPayments(req: SparkListPaymentsRequest): Promise<SparkPayment[]>;
}

/**
 * Factory asincrona: seleziona l'adapter corretto basandosi su VITE_BREEZ_API_KEY.
 * Dynamic import: il WASM Breez (7.2MB) viene caricato SOLO se Live è selezionato.
 */
export async function createSparkAdapter(): Promise<BreezSparkAdapter> {
  const apiKey = (import.meta.env as Record<string, string>)["VITE_BREEZ_API_KEY"];
  if (apiKey) {
    const { LiveSparkAdapter } = await import("./adapters/live");
    return new LiveSparkAdapter();
  }
  const { MockSparkAdapter } = await import("./adapters/mock");
  return new MockSparkAdapter();
}
