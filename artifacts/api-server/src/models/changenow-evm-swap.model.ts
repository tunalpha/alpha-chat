/**
 * ChangeNowEvmSwap — MongoDB model per swap EVM→EVM via ChangeNOW
 *
 * Separato dal modello BTC→USDT (ChangeNowSwapModel) per non rompere record esistenti.
 *
 * CAMPO SEPARATI (INVARIANTE):
 *   depositTxHash    = TX utente → depositEvmAddress (ChangeNOW)
 *   destinationTxHash = TX ChangeNOW → utente (payoutHash)
 *   Mai intercambiabili.
 *
 * REGOLA COMPLETED:
 *   isCompleted = cnStatus === "finished"
 *     && destinationTxHash !== null
 *     && destinationTxHash !== depositTxHash
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 */

import mongoose, { Schema, type Document, type Model } from "mongoose";

export type CnEvmSwapStatus =
  | "created"
  | "waiting"
  | "confirming"
  | "exchanging"
  | "sending"
  | "finished"
  | "failed"
  | "refunded"
  | "expired"
  | "verifying"
  | "error";

export const CN_EVM_TERMINAL_STATUSES: CnEvmSwapStatus[] = [
  "finished", "failed", "refunded", "expired", "error",
];

export interface IChangeNowEvmSwap extends Document {
  userId:               string;
  provider:             "changenow";
  exchangeId:           string;       // ID ChangeNOW (per reconciliazione)
  fromTicker:           string;       // ticker ChangeNOW, es. "pol", "matic"
  toTicker:             string;       // ticker ChangeNOW, es. "usdcmatic"
  fromAmount:           number;
  estimatedToAmount:    number;
  depositEvmAddress:    string;       // EVM address ChangeNOW — l'utente invia qui
  destinationEvmAddress: string;      // EVM address utente — automatico, mai da input
  refundEvmAddress:     string;       // EVM address per rimborso (source chain)
  cnStatus:             CnEvmSwapStatus;
  /** TX utente→payinAddress. NON è la destination TX. */
  depositTxHash:        string | null;
  /** TX payoutHash ChangeNOW→utente. Diverso da depositTxHash. */
  destinationTxHash:    string | null;
  /** true dopo il commit TX — blocca double-send */
  fundsCommitted:       boolean;
  refundDetails:        { refundHash?: string; refundAddress?: string } | null;
  error:                string | null;
  createdAt:            Date;
  updatedAt:            Date;
}

const schema = new Schema<IChangeNowEvmSwap>(
  {
    userId:    { type: String, required: true, index: true },
    provider:  { type: String, enum: ["changenow"], required: true, default: "changenow" },
    exchangeId:{ type: String, required: true },

    fromTicker:             { type: String, required: true },
    toTicker:               { type: String, required: true },
    fromAmount:             { type: Number, required: true },
    estimatedToAmount:      { type: Number, required: true },
    depositEvmAddress:      { type: String, required: true },
    destinationEvmAddress:  { type: String, required: true },
    refundEvmAddress:       { type: String, required: true },

    cnStatus: {
      type: String,
      enum: ["created","waiting","confirming","exchanging","sending","finished",
             "failed","refunded","expired","verifying","error"],
      required: true,
      default: "created",
    },

    depositTxHash:     { type: String, default: null },
    destinationTxHash: { type: String, default: null },
    fundsCommitted:    { type: Boolean, required: true, default: false },
    refundDetails:     { type: Schema.Types.Mixed, default: null },
    error:             { type: String, default: null },
  },
  {
    collection: "changenow_evm_swaps",
    timestamps: { updatedAt: "updatedAt", createdAt: "createdAt" },
  }
);

schema.index({ userId: 1, createdAt: -1 });
schema.index({ exchangeId: 1 }, { unique: true });
schema.index({ userId: 1, fundsCommitted: 1, cnStatus: 1 });

export const ChangeNowEvmSwapModel: Model<IChangeNowEvmSwap> =
  (mongoose.models["ChangeNowEvmSwap"] as Model<IChangeNowEvmSwap>) ??
  mongoose.model<IChangeNowEvmSwap>("ChangeNowEvmSwap", schema);
