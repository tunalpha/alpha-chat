/**
 * BREEZ SPARK — ABSTRACT ADAPTER INTERFACE
 *
 * Isola completamente Alpha Wallet dalle API Breez SDK.
 * Il codice production non dipende MAI direttamente da @breeztech/breez-sdk-spark.
 * Solo LiveBreezAdapter importa l'SDK; MockBreezAdapter gira senza dipendenze esterne.
 */

import type {
  SparkInfo,
  SparkBalance,
  ReceiveRequest,
  ReceiveResponse,
  PrepareSendRequest,
  PrepareSendResponse,
  SendRequest,
  SendResponse,
  ListPaymentsRequest,
  SparkPayment,
  ParsedInput,
  SparkNetworkStatus,
  WebhookConfig,
} from './types';

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface BreezSparkAdapter {
  readonly adapterType: 'mock' | 'live';

  /**
   * Connetti al network Spark.
   * @param apiKey - Breez API key (null → MockAdapter, non null → LiveAdapter)
   * @param mnemonic - BIP39 mnemonic (mai inviato al backend)
   * @param network - 'mainnet' | 'regtest'
   */
  connect(apiKey: string | null, mnemonic: string, network: 'mainnet' | 'regtest'): Promise<void>;

  /** Disconnetti e libera risorse */
  disconnect(): Promise<void>;

  /**
   * Informazioni wallet (identity pubkey, balance, spark address)
   * @param ensureSynced - se true, attende sync completo prima di rispondere
   */
  getInfo(ensureSynced?: boolean): Promise<SparkInfo>;

  /** Saldo corrente */
  getBalance(): Promise<SparkBalance>;

  /**
   * Genera invoice/indirizzo per ricevere pagamento.
   * BOLT12 receive: NON supportato in SDK v0.15.1 — ReceivePaymentMethod non include bolt12.
   */
  receive(req: ReceiveRequest): Promise<ReceiveResponse>;

  /**
   * Prepara un pagamento (calcola fee, non esegue il pagamento).
   * Mostrare sempre la fee all'utente prima di chiamare send().
   */
  prepareSend(req: PrepareSendRequest): Promise<PrepareSendResponse>;

  /**
   * Esegue il pagamento preparato da prepareSend().
   * NESSUNA transazione reale in MockAdapter.
   */
  send(req: SendRequest): Promise<SendResponse>;

  /** Lista pagamenti con filtri */
  listPayments(req?: ListPaymentsRequest): Promise<SparkPayment[]>;

  /**
   * Forza sincronizzazione con gli operatori Spark.
   * Necessario al ritorno in foreground su iOS (WebSocket chiusa in background).
   */
  sync(): Promise<void>;

  /**
   * Registra webhook per notifiche server-side.
   * Usare con Web Push VAPID per notifiche iOS in background.
   * NOTA: getSparkStatus() è bloccato da CORS nel browser — deve essere proxied.
   */
  registerWebhook(config: WebhookConfig): Promise<void>;

  /**
   * Parsa un input (BOLT11, Lightning Address, LNURL, Spark address, ecc.)
   * e determina il tipo di pagamento.
   */
  parse(input: string): Promise<ParsedInput>;

  /**
   * Stato del network Spark.
   * ATTENZIONE: spark.money/api/v1/status ha CORS blocked nel browser.
   * Questa chiamata deve essere proxied dal backend Alpha in produzione.
   */
  getNetworkStatus(): Promise<SparkNetworkStatus>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Crea l'adapter appropriato in base alla disponibilità dell'API key.
 * - API key presente → LiveBreezAdapter (SDK reale)
 * - API key assente → MockBreezAdapter (simulazione locale)
 *
 * Importazione lazy per evitare di caricare l'SDK WASM se non necessario.
 */
export async function createBreezAdapter(apiKey: string | null): Promise<BreezSparkAdapter> {
  if (apiKey) {
    const { LiveBreezAdapter } = await import('./adapters/live');
    return new LiveBreezAdapter();
  } else {
    const { MockBreezAdapter } = await import('./adapters/mock');
    return new MockBreezAdapter();
  }
}
