/**
 * BuyProvider — interfaccia astratta per provider fiat→crypto.
 *
 * Implementazioni concrete (es. changenow-buy.service.ts) devono rispettare
 * questo contratto. La UI non dipende mai dall'implementazione specifica.
 *
 * Nuovi provider si aggiungono implementando questa interfaccia
 * senza toccare la UI o il buy-order.service.ts.
 */

export interface BuyQuoteParams {
  fiatCurrency:      string;   // "EUR" | "USD"
  fiatAmount:        number;
  cryptoAsset:       string;   // "BTC" | "ETH" | "USDT" | "MATIC"
  cryptoNetwork:     string;   // "polygon" | "ethereum" | "bitcoin" | "bsc"
  destinationAddress: string;  // wallet Alpha — mai modificabile dall'utente
}

export interface BuyQuote {
  estimatedCryptoAmount: number;
  providerFee:           number | null; // null se non disponibile separatamente
  networkFee:            number | null;
  totalFiat:             number;        // importo effettivo addebitato
  validUntilMs:          number | null; // epoch ms scadenza quote
  quoteId:               string | null; // opzionale — per lock rate
}

export interface CreateOrderParams {
  fiatCurrency:       string;
  fiatAmount:         number;
  cryptoAsset:        string;
  cryptoNetwork:      string;
  destinationAddress: string;
  paymentMethod:      string;   // "card" | "sepa" | "apple_pay" | "google_pay"
  quoteId?:           string;   // opzionale se il provider supporta quote lock
  userId:             string;   // solo per idempotency lato provider
}

export interface BuyOrderResult {
  externalOrderId: string;
  paymentUrl:      string | null;  // redirect per completare il pagamento
  paymentMethod:   string;
  status:          string;         // raw provider status
  estimatedCryptoAmount: number | null;
}

export interface BuyOrderStatusResult {
  externalOrderId:       string;
  providerStatus:        string;
  isCompleted:           boolean;   // true SOLO con destinationTxHash verificabile
  isFailed:              boolean;
  isRefunded:            boolean;
  destinationTxHash:     string | null;  // obbligatorio per isCompleted=true
  cryptoAmountReceived:  number | null;
  refundStatus:          string | null;
  refundTxHash:          string | null;
}

export interface PaymentMethod {
  id:              string;   // "card" | "sepa" | "apple_pay" | "google_pay"
  name:            string;   // nome visualizzato
  minFiatAmount:   number;
  maxFiatAmount:   number;
  currencies:      string[]; // fiat supportate
}

export interface RefundStatusResult {
  refundStatus:  string | null;
  refundTxHash:  string | null;
  refundAmount:  number | null;
}

/**
 * Interfaccia che ogni provider deve implementare.
 * NOTA: se la documentazione del provider non è sufficiente per implementare
 * un metodo, il metodo deve lanciare un errore esplicito (non silenzioso).
 */
export interface IBuyProvider {
  readonly providerId: string;

  /**
   * Restituisce una stima del payout crypto per un dato importo fiat.
   * MAI inventare fee: se il provider non le separa, providerFee=null.
   */
  getQuote(params: BuyQuoteParams): Promise<BuyQuote>;

  /**
   * Crea un ordine di acquisto. Restituisce paymentUrl per redirect.
   * Deve essere idempotente per lo stesso userId+fiatAmount+cryptoAsset.
   */
  createOrder(params: CreateOrderParams): Promise<BuyOrderResult>;

  /**
   * Polling dello stato ordine.
   * isCompleted=true SOLO quando destinationTxHash è presente e verificabile.
   */
  getOrderStatus(externalOrderId: string): Promise<BuyOrderStatusResult>;

  /**
   * Metodi di pagamento realmente disponibili.
   * NON restituire metodi se il provider non li conferma esplicitamente.
   */
  getPaymentMethods(fiatCurrency: string): Promise<PaymentMethod[]>;

  /**
   * Stato del refund per un ordine fallito/scaduto.
   */
  getRefundStatus(externalOrderId: string): Promise<RefundStatusResult>;
}
