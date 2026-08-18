/**
 * ChangeNowSwap — MongoDB model
 *
 * Persistenza completa per recovery/audit degli swap BTC→USDT via ChangeNOW.
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 *
 * REGOLA CRITICA:
 *   btcTxHash   = txid Bitcoin di deposito al deposit address ChangeNOW
 *   destinationTxHash = txid EVM di uscita verso l'utente
 *   I due campi NON sono mai intercambiabili (invariante di sistema).
 */

import mongoose, { Schema, type Document, type Model } from "mongoose";

export type CnSwapStatus =
  | "created"     // exchange creato su ChangeNOW, in attesa deposito BTC
  | "waiting"     // ChangeNOW in attesa del deposito
  | "confirming"  // deposito BTC rilevato, in conferma sulla chain Bitcoin
  | "exchanging"  // fondi ricevuti, conversione in corso
  | "sending"     // USDT in invio verso destinazione EVM
  | "finished"    // completato — destinationTxHash presente
  | "failed"      // exchange fallito
  | "refunded"    // rimborso eseguito
  | "expired"     // exchange scaduto
  | "verifying"   // verifica manuale da parte di ChangeNOW
  | "error";      // errore interno non classificato

export type CnToChain = "ethereum" | "polygon" | "bsc";

export interface IChangeNowSwap extends Document {
  userId:                string;
  provider:              "changenow";
  exchangeId:            string;
  fromChain:             "bitcoin";
  toChain:               CnToChain;
  fromAsset:             "BTC";
  toAsset:               "USDT";
  fromAmount:            number;        // in BTC (e.g. 0.001)
  estimatedToAmount:     number;        // in USDT al momento della creazione
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
  providerFeeEstimate:   number | null; // stima fee ChangeNOW in USDT
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

    fromChain: { type: String, enum: ["bitcoin"],                         required: true, default: "bitcoin" },
    toChain:   { type: String, enum: ["ethereum", "polygon", "bsc"],     required: true },
    fromAsset: { type: String, enum: ["BTC"],                            required: true, default: "BTC" },
    toAsset:   { type: String, enum: ["USDT"],                           required: true, default: "USDT" },

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
