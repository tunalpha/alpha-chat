/**
 * BREEZ SPARK — TYPE DEFINITIONS
 * PoC Isolato — nessun collegamento ad Alpha Wallet production.
 * Tutti i tipi qui definiti sono specifici del layer Spark e non modificano
 * BTC on-chain, EVM, USDA, Portfolio o qualsiasi altra funzionalità esistente.
 */

// ─── Stato connessione ────────────────────────────────────────────────────────

export type SparkConnectionState =
  | 'disconnected'   // mai connesso o disconnesso esplicitamente
  | 'connecting'     // tentativo di connessione in corso
  | 'connected'      // connesso e operativo
  | 'syncing'        // sincronizzazione in corso (post-connessione)
  | 'unavailable'    // API key mancante — connessione non possibile
  | 'error';         // errore irreversibile (vedere SparkError)

export interface SparkError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type SparkNetwork = 'mainnet' | 'regtest';

// ─── Informazioni wallet ──────────────────────────────────────────────────────

export interface SparkInfo {
  identityPubkey: string;
  /** Saldo in satoshi (confermato) */
  balanceSats: bigint;
  /** Token balances (USDA, ecc.) */
  tokenBalances?: Record<string, bigint>;
  network: SparkNetwork;
  synced: boolean;
  sparkAddress: string;
}

export interface SparkBalance {
  /** Saldo totale in satoshi */
  totalSats: bigint;
  /** Saldo confermato */
  confirmedSats: bigint;
  /** Saldo in attesa (incoming non ancora confermato) */
  pendingSats: bigint;
}

// ─── Ricezione ────────────────────────────────────────────────────────────────

export type ReceiveMethod =
  | 'bolt11Invoice'
  | 'sparkAddress';
  // NOTA: bolt12 NON supportato in ReceivePaymentMethod v0.15.1

export interface ReceiveRequest {
  method: ReceiveMethod;
  /** Solo per bolt11Invoice */
  amountSats?: number;
  /** Solo per bolt11Invoice */
  description?: string;
  /** Scadenza in secondi (default 3600) */
  expirySecs?: number;
}

export interface ReceiveResponse {
  /** BOLT11 invoice o Spark address */
  paymentRequest: string;
  /** Fee di ricezione in satoshi */
  feeSats: bigint;
  /** Metodo utilizzato */
  method: ReceiveMethod;
  /** QR string (= paymentRequest) */
  qrData: string;
}

export type PaymentStatus = 'pending' | 'complete' | 'failed' | 'refunded';

// ─── Invio ────────────────────────────────────────────────────────────────────

export type SendMethod =
  | 'bolt11'            // BOLT11 invoice
  | 'bolt12'            // BOLT12 offer (send only)
  | 'lightningAddress'  // user@domain.com
  | 'lnurlPay'          // LNURL-Pay
  | 'bip353'            // BIP353 DNS address
  | 'sparkAddress'      // Spark-to-Spark
  | 'sparkInvoice';     // Spark invoice

/** Input parsato da parse() */
export interface ParsedInput {
  type: SendMethod;
  rawInput: string;
  /** Importo nell'invoice (se presente) */
  amountSats?: bigint;
  /** Descrizione (se presente) */
  description?: string;
  /** Destination (pubkey, address, ecc.) */
  destination?: string;
}

export interface PrepareSendRequest {
  /** Input grezzo (invoice, indirizzo, ecc.) */
  paymentRequest: string;
  /** Modalità fee: recipient riceve esattamente l'importo, mittente paga fee extra */
  feePolicy: 'feesExcluded';
  /** Importo manuale (per LNURL-Pay o Lightning Address senza importo fisso) */
  amountSats?: bigint;
}

export interface PrepareSendResponse {
  /** Importo da inviare al destinatario */
  recipientSats: bigint;
  /** Fee di rete Spark/Lightning (SCONOSCIUTA fino a conferma Breez) */
  networkFeeSats: bigint;
  /** Alpha platform fee (0.10% di recipientSats) */
  alphaFeeSats: bigint;
  /** Totale che il mittente paga */
  totalSenderSats: bigint;
  /** Input originale */
  paymentRequest: string;
  /** Tipo di pagamento */
  sendMethod: SendMethod;
  /** Risposta SDK interna (opaco — per passarla a send()) */
  _sdkPrepareResponse?: unknown;
}

export interface SendRequest {
  prepareResponse: PrepareSendResponse;
}

export interface SendResponse {
  /** ID pagamento */
  paymentId: string;
  /** Stato */
  status: PaymentStatus;
  /** Fee effettiva pagata */
  feePaidSats: bigint;
  /** Hash preimage (BOLT11) */
  paymentHash?: string;
  /** Timestamp */
  timestamp: number;
}

// ─── Listato pagamenti ────────────────────────────────────────────────────────

/** Tipo transazione — SEPARATO da BTC on-chain (btc_sent/btc_received) */
export type SparkTxType =
  | 'btc_lightning_sent'     // inviato via Lightning (BOLT11/BOLT12)
  | 'btc_lightning_received' // ricevuto via Lightning
  | 'spark_sent'             // inviato via Spark-to-Spark
  | 'spark_received';        // ricevuto via Spark

export interface SparkPayment {
  id: string;
  type: SparkTxType;
  amountSats: bigint;
  feeSats: bigint;
  status: PaymentStatus;
  timestamp: number;
  description?: string;
  paymentHash?: string;
  sparkAddress?: string;
  bolt11?: string;
}

export interface ListPaymentsRequest {
  typeFilter?: ('sent' | 'received')[];
  statusFilter?: PaymentStatus[];
  fromTimestamp?: number;
  toTimestamp?: number;
  offset?: number;
  limit?: number;
}

// ─── Fee model ────────────────────────────────────────────────────────────────

/** Separazione concettuale delle fee — NON ancora definitiva */
export interface FeeBreakdown {
  /** Alpha platform fee: 0.10% dell'importo inviato */
  alphaPlatformFeeSats: bigint;
  /** Fee Spark/Lightning degli operatori (sconosciuta fino a risposta Breez) */
  sparkNetworkFeeSats: bigint | null;
  /** Fee on-chain swap (se applicabile) */
  onchainSwapFeeSats?: bigint;
  /** Fee totale (null se sparkNetworkFee non nota) */
  totalFeeSats: bigint | null;
}

/** Struttura portfolio — separata da BTC on-chain */
export interface SparkPortfolioEntry {
  network: 'btc_lightning' | 'spark';
  balanceSats: bigint;
  /** Valore in USD (placeholder — calcolato dal prezzo BTC) */
  valueUsd?: number;
}

// ─── Status network ───────────────────────────────────────────────────────────

export interface SparkNetworkStatus {
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  lastUpdated: number;
  /** CORS blocca questa chiamata dal browser — deve essere proxied dal backend */
  corsBlocked: boolean;
}

// ─── Webhook / Push ───────────────────────────────────────────────────────────

export interface WebhookConfig {
  /** URL del backend Alpha che riceve gli eventi Spark */
  url: string;
  /** Bearer token per autenticare il webhook (generato dal backend) */
  token?: string;
}

// ─── Sicurezza ────────────────────────────────────────────────────────────────

export interface SecurityAuditResult {
  check: string;
  passed: boolean;
  detail: string;
}

// ─── Test status ─────────────────────────────────────────────────────────────

export type TestReadiness =
  | 'PASS'              // confermato empiricamente
  | 'FAIL'              // fallisce
  | 'PENDING_API_KEY'   // richiede API key Breez
  | 'PENDING_MAINNET'   // richiede test su mainnet con fondi
  | 'PENDING_BREEZ'     // richiede risposta Breez (costi, policy, ecc.)
  | 'NOT_TESTED'        // non ancora testato
  | 'NOT_APPLICABLE';   // non applicabile in questa fase

export interface TestCheckItem {
  id: string;
  label: string;
  readiness: TestReadiness;
  detail?: string;
}
