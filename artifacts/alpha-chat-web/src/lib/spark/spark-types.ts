/**
 * Spark/Lightning — TypeScript interfaces (provider-agnostic)
 *
 * NESSUNA dipendenza da Breez SDK qui. Questo file è puro TypeScript.
 * Il LiveAdapter traduce le risposte SDK in questi tipi.
 * Il MockAdapter le implementa direttamente.
 */

// ── Fee ───────────────────────────────────────────────────────────────────────

/** Platform fee Spark caricata dal backend (/api/v1/spark/fee-config). */
export interface SparkFeeConfig {
  /** Alpha platform fee in basis points. 10 = 0.10%. */
  fee_bps: number;
  /** Fee minima Alpha in satoshi. */
  min_fee_sat: number;
  /** Secondi di validità della quote prima che scada. */
  quote_validity_sec: number;
}

/**
 * Fee breakdown completo per un pagamento Spark.
 *
 * INVARIANTI:
 * - alphaPlatformFeeSat: calcolata SOLO da SparkFeeConfig (NON da BTC config)
 * - estimatedProviderFeeSat: determinata dall'SDK (prepareSend), MAI dall'admin
 * - recipientAmountSat: MAI alterato silenziosamente
 * - totalDebitSat = recipientAmountSat + alphaPlatformFeeSat + estimatedProviderFeeSat
 */
export interface SparkFeeBreakdown {
  recipientAmountSat:      bigint;  // Sats che riceve il destinatario
  alphaPlatformFeeSat:     bigint;  // Alpha 0.10% (da SparkFeeConfig)
  estimatedProviderFeeSat: bigint;  // Breez/Spark routing (da SDK prepareSend)
  actualProviderFeeSat?:   bigint;  // Impostato dopo sendPayment() completato
  totalDebitSat:           bigint;  // Totale addebitato al mittente
  feeBps:                  number;  // BPS usati per il calcolo
  quoteExpiresAt:          number;  // Unix ms — scadenza quote
  providerFeeSource:       'estimated' | 'actual';
  /** Modalità: 'fee_excluded' = sender paga fee aggiuntive, 'recipient_exact' = destinatario riceve esatto */
  amountMode:              'fee_excluded' | 'recipient_exact';
}

// ── Wallet info ───────────────────────────────────────────────────────────────

export interface SparkWalletInfo {
  identityPubkey: string;
  /** Balance totale in satoshi (Lightning leaves + Spark leaves) */
  balanceSat:     bigint;
  tokenBalances?: Record<string, unknown>;
}

// ── Payment types ─────────────────────────────────────────────────────────────

export type SparkPaymentType =
  | 'btc_lightning_sent'
  | 'btc_lightning_received'
  | 'spark_sent'
  | 'spark_received';

export type SparkPaymentStatus = 'pending' | 'completed' | 'failed';

export interface SparkPayment {
  id:            string;
  paymentType:   SparkPaymentType;
  status:        SparkPaymentStatus;
  amountSat:     bigint;
  feeSat:        bigint;
  timestamp:     number;  // unix seconds
  bolt11?:       string;
  sparkAddress?: string;
  description?:  string;
}

// ── Send ──────────────────────────────────────────────────────────────────────

export interface SparkPrepareSendRequest {
  /** BOLT11, Spark address, Lightning Address (user@domain), LNURL, BOLT12 offer */
  paymentRequest: string;
  /** Importo in sat — solo se paymentRequest non include importo fisso */
  amountSat?:     bigint;
}

export interface SparkPrepareSendResult {
  /** Fee routing stimata dal provider (Breez/Spark) — NOT Alpha fee */
  estimatedProviderFeeSat: bigint;
  recipientAmountSat:      bigint;
  /** Unix ms */
  expiresAt:               number;
}

export interface SparkSendRequest {
  paymentRequest: string;
  amountSat?:     bigint;
}

export interface SparkSendResult {
  paymentId:  string;
  amountSat:  bigint;
  /** Fee effettiva provider (Breez/Spark routing) */
  feeSat:     bigint;
  status:     SparkPaymentStatus;
}

// ── Receive ───────────────────────────────────────────────────────────────────

export type SparkReceiveMethod = 'bolt11' | 'spark_address' | 'bitcoin_on_chain';

export interface SparkReceiveRequest {
  method:       SparkReceiveMethod;
  amountSat?:   bigint;
  description?: string;
}

export interface SparkReceiveResult {
  bolt11?:         string;
  sparkAddress?:   string;
  bitcoinAddress?: string;
  /** Unix ms — solo per BOLT11 */
  expiresAt?:      number;
}

// ── List payments ─────────────────────────────────────────────────────────────

export interface SparkListPaymentsRequest {
  limit?:         number;
  offset?:        number;
  fromTimestamp?: number;
  toTimestamp?:   number;
}

// ── Adapter state ─────────────────────────────────────────────────────────────

export type SparkAdapterState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error'
  | 'unavailable';

export interface SparkAdapterError {
  code:        string;
  message:     string;
  recoverable: boolean;
}

export interface SparkConnectConfig {
  storageDir: string;
  network:    'mainnet';  // solo mainnet nel JS SDK Spark
}
