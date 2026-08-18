/**
 * BuyOrder — ordine "Acquista con carta" (fiat → crypto).
 *
 * STATE MACHINE
 *   created → quoted → awaiting_payment → payment_processing → crypto_processing → completed
 *   Terminal: failed | refunded | expired
 *
 * COMPLETED solo con destinationTxHash verificabile e destinationAddress = wallet Alpha.
 */
import { model, Schema, Document } from "mongoose";

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

export interface IBuyOrder extends Document {
  userId:               string;
  provider:             string;         // es. "changenow_fiat"
  externalOrderId:      string | null;  // ID provider (null finché non creato)

  // Fiat
  fiatCurrency:         string;         // "EUR" | "USD"
  fiatAmount:           number;

  // Crypto
  cryptoAsset:          string;         // "BTC" | "ETH" | "USDT" | …
  cryptoNetwork:        string;         // "polygon" | "ethereum" | "bitcoin"
  estimatedCryptoAmount: number | null;

  // Destinazione — mai modificabile dall'utente
  destinationAddress:   string;         // wallet.meta.evmAddress (o btcAddress)
  destinationChain:     string;

  // Fee (dal provider, mai inventate)
  providerFee:          number | null;
  networkFee:           number | null;

  // Pagamento
  paymentMethod:        string | null;  // "card" | "sepa" | "apple_pay" | …
  paymentUrl:           string | null;  // redirect URL per il pagamento

  // Esito crypto
  destinationTxHash:    string | null;  // obbligatorio per completed
  cryptoAmountReceived: number | null;

  // Refund
  refundStatus:         string | null;
  refundTxHash:         string | null;

  // Stato
  status:               BuyOrderStatus;
  providerStatus:       string | null;  // raw status dal provider
  errorMessage:         string | null;

  createdAt:            Date;
  updatedAt:            Date;
}

const schema = new Schema<IBuyOrder>(
  {
    userId:                { type: String, required: true, index: true },
    provider:              { type: String, required: true },
    externalOrderId:       { type: String, default: null, index: true, sparse: true },

    fiatCurrency:          { type: String, required: true },
    fiatAmount:            { type: Number, required: true },

    cryptoAsset:           { type: String, required: true },
    cryptoNetwork:         { type: String, required: true },
    estimatedCryptoAmount: { type: Number, default: null },

    destinationAddress:    { type: String, required: true },
    destinationChain:      { type: String, required: true },

    providerFee:           { type: Number, default: null },
    networkFee:            { type: Number, default: null },

    paymentMethod:         { type: String, default: null },
    paymentUrl:            { type: String, default: null },

    destinationTxHash:     { type: String, default: null },
    cryptoAmountReceived:  { type: Number, default: null },

    refundStatus:          { type: String, default: null },
    refundTxHash:          { type: String, default: null },

    status:                { type: String, required: true, default: "created", index: true },
    providerStatus:        { type: String, default: null },
    errorMessage:          { type: String, default: null },
  },
  { timestamps: true },
);

export const BuyOrderModel = model<IBuyOrder>("BuyOrder", schema, "buy_orders");
