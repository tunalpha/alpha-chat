/**
 * ChatWalletBridge — Contratto pubblico Chat ↔ Alpha Wallet
 *
 * Questo file è il confine ufficiale tra i due sistemi.
 * ChatPage importa SOLO da questo modulo — zero import da wallet/*.
 *
 * SICUREZZA:
 *   - Mai mnemonic, private key, keystore, derivation path
 *   - Mai signed transaction raw
 *   - Mai WalletPhase, WalletMeta, TokenConfig o qualsiasi tipo interno
 *   - sendPayment() non può essere chiamata da un evento WS/remoto
 *
 * ISOLAMENTO:
 *   - Completamente indipendente dal Payment Engine custodiale
 *   - (MultiChain, USDA, Gas Station, Escrow rimangono invariati)
 */

// ─── Network/Asset types ──────────────────────────────────────────────────

export type SupportedEvmNetwork = "ethereum" | "polygon" | "bsc";
export type SupportedNetwork    = SupportedEvmNetwork | "bitcoin";

export const NETWORK_LABELS: Record<SupportedNetwork, string> = {
  ethereum: "Ethereum",
  polygon:  "Polygon",
  bsc:      "BNB Smart Chain",
  bitcoin:  "Bitcoin",
};

export const NETWORK_COLORS: Record<SupportedNetwork, string> = {
  ethereum: "#627EEA",
  polygon:  "#8247E5",
  bsc:      "#F3BA2F",
  bitcoin:  "#F7931A",
};

export const NETWORK_CHAIN_IDS: Record<SupportedEvmNetwork, number> = {
  ethereum: 1,
  polygon:  137,
  bsc:      56,
};

// ─── Bridge Status ────────────────────────────────────────────────────────

/**
 * Stato del bridge dal punto di vista della Chat.
 * La Chat non conosce WalletPhase — vede solo BridgeStatus.
 */
export type BridgeStatus =
  | "unavailable"  // nessun wallet creato — pulsante nascosto
  | "locked"       // wallet bloccato — mostra "Sblocca per pagare"
  | "ready";       // wallet sbloccato — pulsante attivo

// ─── Capabilities ─────────────────────────────────────────────────────────

export interface AssetCapability {
  symbol:          string;
  name:            string;
  /** Saldo human-readable ("100.50") */
  balance:         string;
  /** Saldo raw — per validazione importo minimo */
  balanceRaw:      bigint;
  decimals:        number;
  /** null = token nativo */
  contractAddress: string | null;
  verified:        boolean;
  coingeckoId:     string | null;
}

export interface EvmNetworkCapability {
  network:     SupportedEvmNetwork;
  networkName: string;
  color:       string;
  assets:      AssetCapability[];
}

export interface BitcoinCapability {
  balance:    string;     // BTC human-readable
  balanceSat: bigint;
}

export interface WalletCapabilities {
  evmNetworks:       EvmNetworkCapability[];
  bitcoin:           BitcoinCapability | null;
  /** ms UTC dell'ultima sync balance */
  lastBalanceSyncAt: number | null;
}

// ─── Platform Fee ─────────────────────────────────────────────────────────

export interface PlatformFeeConfig {
  /** Basis points. 10 = 0.10% */
  feeBps:            number;
  /** Secondi di validità della quote */
  quoteValiditySec:  number;
  /** Timestamp di fetch (per scadenza locale) */
  fetchedAt:         number;
}

export interface PaymentQuote {
  /** Importo al destinatario (human-readable) */
  recipientAmount:  string;
  /** Platform fee (human-readable) */
  platformFee:      string;
  /** Network/gas fee (human-readable, in token nativo se EVM) */
  networkFee:       string;
  /** Symbol della network fee (può differire dall'asset inviato) */
  networkFeeSymbol: string;
  /** Totale a carico del mittente per l'asset principale */
  totalAsset:       string;
  /** Totale in token nativo (solo EVM native fee) */
  totalNetworkToken?: string;
  /** Timestamp freeze — dopo quoteValiditySec è scaduta */
  frozenAt:         number;
  quoteValiditySec: number;
}

// ─── Payment Request / Result ─────────────────────────────────────────────

export interface ChatPaymentRequest {
  network:              SupportedNetwork;
  /** Contract address ERC-20 o null per native / BTC */
  tokenContractAddress: string | null;
  assetSymbol:          string;
  /** Importo human-readable ("100.50") */
  amount:               string;
  /** EVM: "0x..." BTC: "bc1q..." */
  recipientAddress:     string;
  /** Quote congelata al momento della conferma */
  frozenQuote:          PaymentQuote;
  /** Metadata non finanziario */
  metadata?: {
    conversationId?: string;
    messageId?:      string;
    label?:          string;
  };
}

export type ChatPaymentStatus =
  | "sent"        // TX broadcast — non ancora confermata
  | "confirmed"   // TX confermata on-chain
  | "failed"      // TX fallita on-chain o rifiutata
  | "cancelled";  // annullata dall'utente prima della firma

export type ChatPaymentErrorCode =
  | "WALLET_LOCKED"
  | "WALLET_UNAVAILABLE"
  | "AUTHENTICATION_FAILED"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_RECIPIENT"
  | "INVALID_AMOUNT"
  | "NETWORK_ERROR"
  | "BROADCAST_REJECTED"
  | "DOUBLE_SEND_PREVENTED"
  | "FEE_CONFIG_UNAVAILABLE"
  | "QUOTE_EXPIRED"
  | "PLATFORM_FEE_TX_FAILED"
  | "UNKNOWN";

export interface ChatPaymentResult {
  status:       ChatPaymentStatus;
  txHash?:      string;
  explorerUrl?: string;
  network?:     SupportedNetwork;
  assetSymbol?: string;
  amountSent?:  string;
  fee?:         string;
  errorCode?:   ChatPaymentErrorCode;
  errorMessage?: string;
  /** Metadata passato nella request — restituito inalterato */
  metadata?:    ChatPaymentRequest["metadata"];
}

// ─── Bridge interface ─────────────────────────────────────────────────────

export interface ChatWalletBridge {
  /** Stato corrente — per decidere se mostrare il pulsante "Paga con Wallet" */
  readonly status: BridgeStatus;

  /**
   * True se un pagamento è in corso (mutex anti-double-send).
   * Il pulsante "Conferma" deve essere disabled quando true.
   */
  readonly sendInProgress: boolean;

  /**
   * Capabilities del wallet corrente.
   * Null se locked o unavailable.
   */
  getCapabilities(): WalletCapabilities | null;

  /**
   * Indirizzo di ricezione per la rete richiesta.
   * Null se wallet non disponibile o rete non supportata.
   * Non richiede autenticazione.
   */
  getReceiveAddress(network: SupportedNetwork): string | null;

  /**
   * Calcola la quote di pagamento (platform fee + network fee + totale).
   * La quote deve essere mostrata all'utente PRIMA della firma.
   * Richiede il wallet sbloccato per accedere al balance.
   */
  calculateQuote(
    network:             SupportedNetwork,
    tokenContractAddress: string | null,
    assetSymbol:         string,
    amount:              string,
  ): Promise<PaymentQuote | null>;

  /**
   * Avvia un pagamento dalla chat.
   *
   * SICUREZZA — Regole inviolabili:
   *   1. Richiede sempre autenticazione locale (PIN/Face ID) prima della firma
   *   2. Non può essere chiamata da un handler WS o evento remoto
   *   3. Non espone mai mnemonic, key, keystore o signed tx al chiamante
   *   4. Il mutex sendInProgress previene il doppio invio
   *
   * @param params  ChatPaymentRequest con quote già congelata
   * @param onAuthRequired  Callback chiamata per mostrare la UI di autenticazione.
   *        Deve restituire il PIN inserito dall'utente (o null se annullato).
   */
  sendPayment(
    params:        ChatPaymentRequest,
    onAuthRequired: () => Promise<string | null>,
  ): Promise<ChatPaymentResult>;
}
