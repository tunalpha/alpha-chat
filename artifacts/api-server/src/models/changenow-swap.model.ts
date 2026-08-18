/**
 * ChangeNowSwap — MongoDB model
 *
 * Persistenza completa per recovery/audit degli swap BTC→any via ChangeNOW.
 * Versione estesa: supporta tutti i 8 destination token verificati (non solo USDT).
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 *
 * REGOLE CRITICHE:
 *   btcTxHash        = txid Bitcoin di deposito al deposit address ChangeNOW
 *   destinationTxHash = txid EVM di uscita verso l'utente (payoutHash)
 *   I due campi NON sono mai intercambiabili.
 *
 * BACKWARD COMPAT:
 *   I record esistenti (BTC→USDT) hanno toAsset="USDT" e toTicker in CN_USDT_TICKERS.
 *   I nuovi record hanno toTicker esplicito e toAsset derivato.
 */

import mongoose, { Schema, type Document, type Model } from "mongoose";

export type CnSwapStatus =
  | "created"     // exchange creato su ChangeNOW, in attesa deposito BTC
  | "waiting"     // ChangeNOW in attesa del deposito
  | "confirming"  // deposito BTC rilevato, in conferma sulla chain Bitcoin
  | "exchanging"  // fondi ricevuti, conversione in corso
  | "sending"     // token in invio verso destinazione EVM
  | "finished"    // completato — destinationTxHash presente
  | "failed"      // exchange fallito
  | "refunded"    // rimborso eseguito
  | "expired"     // exchange scaduto
  | "verifying"   // verifica manuale da parte di ChangeNOW
  | "error";      // errore interno non classificato

// Kept for backward compat with existing BTC→USDT records
export type CnToChain = "ethereum" | "polygon" | "bsc";

export interface IChangeNowSwap extends Document {
  userId:                string;
  provider:              "changenow";
  exchangeId:            string;
  fromChain:             "bitcoin";
  /** ChangeNOW ticker del token destinazione (es. "usdtmatic", "eth", "pol") */
  toTicker:              string;
  /** Chain EVM di destinazione (per display / explorer) */
  toChain:               CnToChain;
  fromAsset:             "BTC";
  /** Asset display name (es. "USDT", "ETH", "POL", "BNB") */
  toAsset:               string;
  fromAmount:            number;        // in BTC (e.g. 0.001)
  estimatedToAmount:     number;        // in toAsset al momento della creazione
  btcDepositAddress:     string;        // indirizzo BTC fornito da ChangeNOW
  destinationEvmAddress: string;        // indirizzo EVM dell'utente
  cnStatus:              CnSwapStatus;
  /** txid Bitcoin di deposito — NON è la destination TX */
  btcTxHash:             string | null;
  /** txid EVM di destinazione (payoutHash ChangeNOW) — diverso da btcTxHash */
  destinationTxHash:     string | null;
  /** true dopo il broadcast BTC — BLOCCA fallback e double-send */
  fundsCommitted:        boolean;
  refundDetails: {
    refundHash?:    string;
    refundAddress?: string;
  } | null;
  providerFeeEstimate:   number | null;
  error:                 string | null;
  validUntil:            Date   | null;
  createdAt:             Date;
  updatedAt:             Date;
}

const changeNowSwapSchema = new Schema<IChangeNowSwap>(
  {
    userId:    { type: String, required: true, index: true },
    provider:  { type: String, enum: ["changenow"], required: true, default: "changenow" },
    exchangeId:{ type: String, required: true },

    fromChain: { type: String, enum: ["bitcoin"],             required: true, default: "bitcoin" },
    toChain:   { type: String, enum: ["ethereum","polygon","bsc"], required: true },
    fromAsset: { type: String, enum: ["BTC"],                required: true, default: "BTC" },
    // Flexible: USDT, USDC, ETH, POL, MATIC, BNB
    toAsset:   { type: String, required: true },
    // ChangeNOW ticker: usdterc20, usdtmatic, usdtbsc, usdcmatic, eth, pol, matic, bnbbsc
    toTicker:  { type: String, required: true },

    fromAmount:            { type: Number, required: true },
    estimatedToAmount:     { type: Number, required: true },
    btcDepositAddress:     { type: String, required: true },
    destinationEvmAddress: { type: String, required: true },

    cnStatus: {
      type: String,
      enum: ["created","waiting","confirming","exchanging","sending","finished",
             "failed","refunded","expired","verifying","error"],
      required: true,
      default: "created",
    },

    btcTxHash:         { type: String, default: null },
    destinationTxHash: { type: String, default: null },
    fundsCommitted:    { type: Boolean, required: true, default: false },
    refundDetails:     { type: Schema.Types.Mixed, default: null },
    providerFeeEstimate:{ type: Number, default: null },
    error:             { type: String, default: null },
    validUntil:        { type: Date,   default: null },
  },
  {
    collection: "changenow_swaps",
    timestamps: { updatedAt: "updatedAt", createdAt: "createdAt" },
  }
);

changeNowSwapSchema.index({ userId: 1, createdAt: -1 });
changeNowSwapSchema.index({ exchangeId: 1 }, { unique: true });
changeNowSwapSchema.index({ userId: 1, fundsCommitted: 1, cnStatus: 1 });

export const ChangeNowSwapModel: Model<IChangeNowSwap> =
  (mongoose.models["ChangeNowSwap"] as Model<IChangeNowSwap>) ??
  mongoose.model<IChangeNowSwap>("ChangeNowSwap", changeNowSwapSchema);
