/**
 * ChangeNOW Fiat Buy — implementazione stub.
 *
 * ╔════════════════════════════════════════════════════════════════╗
 * ║  STATO: STUB — NON connesso a endpoint reali                  ║
 * ║                                                                ║
 * ║  ChangeNOW Fiat richiede KYB/Partner Agreement prima che      ║
 * ║  gli endpoint API vengano forniti.                             ║
 * ║                                                                ║
 * ║  Quando il KYB sarà completato:                               ║
 * ║  1. Aggiungere CHANGENOW_FIAT_API_KEY come Replit Secret      ║
 * ║  2. Sostituire i metodi stub con le chiamate HTTP reali        ║
 * ║  3. Impostare FIAT_BUY_ENABLED=true nel SwapProviderConfig     ║
 * ║     o in un env dedicato                                       ║
 * ║                                                                ║
 * ║  API key: ESCLUSIVAMENTE process.env.CHANGENOW_FIAT_API_KEY   ║
 * ║  MAI frontend, MAI log, MAI response.                         ║
 * ╚════════════════════════════════════════════════════════════════╝
 *
 * Endpoint attesi (da confermare con ChangeNOW dopo KYB):
 *   GET  /fiat/v1/currencies           — valute supportate
 *   GET  /fiat/v1/payment-methods      — metodi di pagamento
 *   POST /fiat/v1/quote                — preventivo
 *   POST /fiat/v1/orders               — crea ordine
 *   GET  /fiat/v1/orders/:id           — stato ordine
 *   GET  /fiat/v1/orders/:id/refund    — stato refund
 *
 * Documentazione fiat: https://changenow.io/for-partners/fiat-onramp
 * (accesso completo riservato ai partner KYB approvati)
 */

import type {
  IBuyProvider,
  BuyQuoteParams,
  BuyQuote,
  CreateOrderParams,
  BuyOrderResult,
  BuyOrderStatusResult,
  PaymentMethod,
  RefundStatusResult,
} from "./buy-provider.interface.js";

/**
 * Verifica che FIAT_BUY_ENABLED sia true.
 * Usato come guard su ogni metodo pubblico.
 */
function assertFiatBuyEnabled(): void {
  if (process.env.FIAT_BUY_ENABLED !== "true") {
    throw Object.assign(new Error("FIAT_BUY_NOT_ENABLED"), { code: "FIAT_BUY_NOT_ENABLED", httpStatus: 503 });
  }
}

export class ChangeNowBuyProvider implements IBuyProvider {
  readonly providerId = "changenow_fiat";

  /**
   * STUB — da implementare dopo approvazione KYB.
   *
   * Endpoint atteso: POST /fiat/v1/quote
   * Body: { from_currency, to_currency, from_amount, to_network, payment_method }
   * Response: { to_amount, provider_fee, network_fee, expires_at, quote_id }
   *
   * REGOLA FEE: usare solo valori restituiti dal provider.
   * MAI applicare un markup Alpha su estimatedCryptoAmount.
   */
  async getQuote(_params: BuyQuoteParams): Promise<BuyQuote> {
    assertFiatBuyEnabled();
    throw Object.assign(
      new Error("CHANGENOW_FIAT_NOT_IMPLEMENTED"),
      { code: "CHANGENOW_FIAT_NOT_IMPLEMENTED", httpStatus: 503 },
    );
  }

  /**
   * STUB — da implementare dopo approvazione KYB.
   *
   * Endpoint atteso: POST /fiat/v1/orders
   * Body: { from_currency, to_currency, from_amount, to_address, to_network,
   *         payment_method, quote_id?, partner_id }
   * Response: { order_id, payment_url, status, estimated_to_amount }
   *
   * CRITICO: to_address deve essere l'indirizzo Alpha Wallet verificato server-side.
   * NON accettare address forniti liberamente dal client.
   */
  async createOrder(_params: CreateOrderParams): Promise<BuyOrderResult> {
    assertFiatBuyEnabled();
    throw Object.assign(
      new Error("CHANGENOW_FIAT_NOT_IMPLEMENTED"),
      { code: "CHANGENOW_FIAT_NOT_IMPLEMENTED", httpStatus: 503 },
    );
  }

  /**
   * STUB — da implementare dopo approvazione KYB.
   *
   * Endpoint atteso: GET /fiat/v1/orders/:id
   * Response: { status, to_hash (destinationTxHash), to_amount_received, ... }
   *
   * CRITICO: isCompleted=true SOLO quando to_hash è presente e non null.
   * NON segnare completed se il provider dice solo "finished" senza TX hash.
   */
  async getOrderStatus(_externalOrderId: string): Promise<BuyOrderStatusResult> {
    assertFiatBuyEnabled();
    throw Object.assign(
      new Error("CHANGENOW_FIAT_NOT_IMPLEMENTED"),
      { code: "CHANGENOW_FIAT_NOT_IMPLEMENTED", httpStatus: 503 },
    );
  }

  /**
   * STUB — da implementare dopo approvazione KYB.
   *
   * Endpoint atteso: GET /fiat/v1/payment-methods?currency=EUR
   * Response: [{ id, name, min_amount, max_amount, currencies }]
   *
   * REGOLA: MAI restituire metodi non confermati dal provider.
   */
  async getPaymentMethods(_fiatCurrency: string): Promise<PaymentMethod[]> {
    assertFiatBuyEnabled();
    throw Object.assign(
      new Error("CHANGENOW_FIAT_NOT_IMPLEMENTED"),
      { code: "CHANGENOW_FIAT_NOT_IMPLEMENTED", httpStatus: 503 },
    );
  }

  /**
   * STUB — da implementare dopo approvazione KYB.
   *
   * Endpoint atteso: GET /fiat/v1/orders/:id/refund
   */
  async getRefundStatus(_externalOrderId: string): Promise<RefundStatusResult> {
    assertFiatBuyEnabled();
    throw Object.assign(
      new Error("CHANGENOW_FIAT_NOT_IMPLEMENTED"),
      { code: "CHANGENOW_FIAT_NOT_IMPLEMENTED", httpStatus: 503 },
    );
  }
}

export const changeNowBuyProvider = new ChangeNowBuyProvider();
