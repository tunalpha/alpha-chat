/**
 * UsdaAdapter — interfaccia astratta per il backend USDA.
 *
 * Dependency Injection: nessun componente di AlphaChat dipende
 * da dettagli blockchain, RPC o wallet custodiali.
 * Quando il backend USDA sarà disponibile, basterà implementare
 * questa interfaccia e iniettare l'adapter concreto in usda.service.ts.
 *
 * Attualmente: MockUsdaAdapter (dati simulati, senza chain reale).
 */

// ---------------------------------------------------------------------------
// Tipi di stato
// ---------------------------------------------------------------------------

export type UsdaPaymentStatus =
  | "preparing"       // ottimistico pre-firma
  | "signing"         // firma ThirdWeb in corso
  | "submitting"      // tx inviata all'RPC
  | "pending"         // in attesa conferma blockchain
  | "confirmed"       // confermato on-chain
  | "pending_claim"   // richiesta di pagamento in attesa
  | "claimed"         // riscosso dal destinatario
  | "refunded"        // rimborsato al mittente
  | "failed";         // fallito

export type UsdaPaymentKind = "send" | "request" | "receipt";

// ---------------------------------------------------------------------------
// Wallet Multi-Chain
// ---------------------------------------------------------------------------

export type WalletChain = "usda" | "polygon" | "ethereum" | "bitcoin" | "lightning";

export interface WalletEntry {
  address: string;
  verifiedAt: string | null;
}

export interface WalletInfo {
  address: string | null;         // shortcut → wallets.usda?.address
  chain_id: number | null;
  balance_usda: string;           // stringa per precisione decimale
  wallet_enabled: boolean;
  wallets: Partial<Record<WalletChain, WalletEntry>>;
}

// ---------------------------------------------------------------------------
// USDA Backend Info (Network metadata — nessun valore hardcoded nel client)
// ---------------------------------------------------------------------------

export interface UsdaBackendInfo {
  name:        string;   // "USDA Backend"
  version:     string;   // "1.3.2"
  environment: string;   // "production" | "staging" | "development"
  network:     string;   // "Polygon Mainnet"
  chainId:     number;   // 137
  explorer:    string;   // "https://polygonscan.com"
  apiVersion:  string;   // "v1"
}

// ---------------------------------------------------------------------------
// USDA Backend Capabilities (Capability Test)
// ---------------------------------------------------------------------------

export interface UsdaCapabilities {
  version: string;
  supports: {
    prepare: boolean;
    claim: boolean;
    refund: boolean;
    webhook: boolean;
    polling: boolean;
    multi_chain: boolean;
  };
}

// ---------------------------------------------------------------------------
// Payment preparation
// ---------------------------------------------------------------------------

export interface PreparePaymentParams {
  from_user_id: string;
  to_user_id: string;
  amount: string;
  note?: string;
  client_payment_id: string;
}

export interface PreparedPayment {
  client_payment_id: string;
  amount: string;
  fee: string;
  total: string;
  /** Opaque data da passare a submitPayment dopo la firma */
  prepared_data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Payment submission
// ---------------------------------------------------------------------------

export interface SubmitPaymentParams {
  client_payment_id: string;
  from_user_id: string;
  to_user_id: string;
  conversation_id: string;
  amount: string;
  fee: string;
  note?: string;
  prepared_data: Record<string, unknown>;
  /** Firma ThirdWeb o altro wallet provider */
  signature?: string;
}

// ---------------------------------------------------------------------------
// Payment result (ritornato da tutte le operazioni)
// ---------------------------------------------------------------------------

export interface PaymentResult {
  payment_id: string;
  kind: UsdaPaymentKind;
  status: UsdaPaymentStatus;
  amount: string;
  fee: string;
  note: string | null;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  message_id: string | null;
  tx_hash: string | null;
  external_payment_id: string | null;
  claim_expires_at: string | null;
  claimed_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
  /** Link pubblico per pagare la richiesta (solo kind="request") */
  share_link?: string | null;
}

// ---------------------------------------------------------------------------
// Payment request
// ---------------------------------------------------------------------------

export interface RequestPaymentParams {
  from_user_id: string;         // chi richiede il pagamento (AlphaChat userId)
  to_user_id: string;           // chi deve pagare (AlphaChat userId)
  requester_wallet: string;     // wallet Polygon del richiedente (obbligatorio per USDA API)
  amount: string;
  note?: string;
  conversation_id: string;
  client_payment_id: string;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryFilters {
  type?: "sent" | "received" | "pending" | "claimed" | "refunded";
  limit?: number;
  skip?: number;
}

export interface HistoryResult {
  payments: PaymentResult[];
  total: number;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface UsdaAdapter {
  /** Restituisce metadati di rete — nessun valore hardcoded nel client */
  getInfo(): Promise<UsdaBackendInfo>;

  /** Capability Test — verifica versione e funzionalità del backend USDA */
  checkCapabilities(): Promise<UsdaCapabilities>;

  /** Recupera info wallet (saldo, indirizzo) dell'utente */
  getWallet(userId: string): Promise<WalletInfo>;

  /** Configura/aggiorna l'indirizzo wallet dell'utente per una chain specifica */
  setWalletAddress(userId: string, address: string, chain?: WalletChain): Promise<WalletInfo>;

  /** Prepara una transazione per la firma (calcola fee, costruisce calldata) */
  preparePayment(params: PreparePaymentParams): Promise<PreparedPayment>;

  /** Invia la transazione firmata alla blockchain */
  submitPayment(params: SubmitPaymentParams): Promise<PaymentResult>;

  /** Recupera stato e dettagli di un pagamento */
  getPayment(paymentId: string, userId: string): Promise<PaymentResult>;

  /** Crea una richiesta di pagamento */
  requestPayment(params: RequestPaymentParams): Promise<PaymentResult>;

  /** Il destinatario paga una richiesta ricevuta */
  payRequest(
    requestId: string,
    payerId: string,
    prepared_data?: Record<string, unknown>,
  ): Promise<PaymentResult>;

  /** Il destinatario riscuote un pagamento pending */
  claimPayment(paymentId: string, userId: string): Promise<PaymentResult>;

  /** Rimborso del mittente (manuale o dopo scadenza) */
  refundPayment(paymentId: string, userId: string): Promise<PaymentResult>;

  /** Storico pagamenti con filtri */
  getHistory(userId: string, filters: HistoryFilters): Promise<HistoryResult>;

  /** Aggiorna lo stato di un pagamento (usato internamente per hook/webhook) */
  updatePaymentStatus(
    paymentId: string,
    status: UsdaPaymentStatus,
    txHash?: string,
  ): Promise<PaymentResult>;
}
