/**
 * Buy Crypto — tipi frontend condivisi.
 *
 * REGOLA FEE: mai inventare fee. Mostrare solo i valori restituiti dal provider.
 * Se providerFee=null → mostrare solo il payout totale con dicitura generica.
 */

export type BuyOrderStatus =
  | "created"
  | "quoted"
  | "awaiting_payment"
  | "payment_processing"
  | "crypto_processing"
  | "completed"
  | "failed"
  | "refunded"
  | "expired";

export const BUY_TERMINAL_STATUSES: BuyOrderStatus[] = [
  "completed", "failed", "refunded", "expired",
];

export const BUY_STATUS_LABELS: Record<BuyOrderStatus, string> = {
  created:            "In preparazione",
  quoted:             "Preventivo ricevuto",
  awaiting_payment:   "In attesa di pagamento",
  payment_processing: "Pagamento in elaborazione",
  crypto_processing:  "Invio crypto in corso",
  completed:          "Completato",
  failed:             "Fallito",
  refunded:           "Rimborsato",
  expired:            "Scaduto",
};

export interface BuyAsset {
  asset:    string;   // "ETH" | "USDT" | "BTC" | "MATIC"
  network:  string;   // "polygon" | "ethereum" | "bitcoin"
  label:    string;   // "USDT (Polygon)"
  decimals: number;
}

export interface BuyQuote {
  estimatedCryptoAmount: number;
  providerFee:           number | null; // null se non disponibile dal provider
  networkFee:            number | null;
  totalFiat:             number;
  validUntilMs:          number | null;
  quoteId:               string | null;
}

export interface BuyPaymentMethod {
  id:            string;
  name:          string;
  minFiatAmount: number;
  maxFiatAmount: number;
  currencies:    string[];
}

export interface BuyOrder {
  id:                    string;
  provider:              string;
  externalOrderId:       string | null;
  fiatCurrency:          string;
  fiatAmount:            number;
  cryptoAsset:           string;
  cryptoNetwork:         string;
  estimatedCryptoAmount: number | null;
  destinationAddress:    string;
  destinationChain:      string;
  paymentMethod:         string | null;
  paymentUrl:            string | null;
  status:                BuyOrderStatus;
  providerStatus:        string | null;
  destinationTxHash:     string | null;
  cryptoAmountReceived:  number | null;
  refundStatus:          string | null;
  refundTxHash:          string | null;
  createdAt:             string;
  updatedAt:             string;
}

export interface BuyCryptoState {
  // Step corrente
  step: "select" | "quote" | "payment" | "processing" | "done" | "error";

  // Selezioni utente
  selectedAsset:   BuyAsset | null;
  selectedFiat:    string;          // "EUR" | "USD"
  fiatInput:       string;          // input grezzo
  selectedMethod:  string | null;   // "card" | "sepa" | …

  // Dati provenienti dall'API (mai inventati)
  quote:           BuyQuote | null;
  methods:         BuyPaymentMethod[];
  assets:          BuyAsset[];
  order:           BuyOrder | null;

  // Indirizzo wallet Alpha — auto-rilevato server-side
  destinationAddress: string | null;  // mostrato all'utente ma non modificabile

  // UI
  loading: boolean;
  error:   string | null;
}

// Errori umanizzati
export function humanizeBuyError(code: string | undefined): string {
  switch (code) {
    case "FIAT_BUY_NOT_ENABLED":           return "Il servizio acquisto con carta è temporaneamente non disponibile.";
    case "CHANGENOW_FIAT_NOT_IMPLEMENTED":  return "Il provider fiat è in fase di attivazione. Disponibile a breve.";
    case "ALPHA_WALLET_EVM_ADDRESS_MISSING":return "Nessun wallet EVM trovato. Crea prima il tuo Alpha Wallet.";
    case "ALPHA_WALLET_BTC_ADDRESS_MISSING":return "Nessun wallet Bitcoin trovato. Crea prima il tuo Alpha Wallet.";
    case "BUY_ORDER_ALREADY_ACTIVE":        return "Hai già un ordine in corso. Attendi che si concluda prima di crearne uno nuovo.";
    case "BUY_PROVIDER_NOT_FOUND":          return "Provider non disponibile.";
    default:                                return "Errore temporaneo. Riprova tra qualche istante.";
  }
}
