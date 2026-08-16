/**
 * EvmSwap — MongoDB model
 *
 * Registra ogni EVM swap avviato tramite Li.Fi.
 * ISOLAMENTO: completamente separato da payment engine, USDA, MultiChain.
 */

import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IEvmSwap extends Document {
  userId:       string;
  routeId:      string;       // Li.Fi route ID (o auto-generato)
  fromChainId:  number;
  toChainId:    number;
  fromToken:    string;       // symbol
  fromAddress:  string;       // contract address (o "native")
  toToken:      string;       // symbol
  toAddress:    string;
  fromAmount:   string;       // in unità minime (stringa)
  toAmount?:    string;       // ricevuto effettivo (valorizzato al complete)
  alphaFeeUSD?: string;
  tool?:        string;       // bridge/dex usato (es. "across")
  state:        "pending" | "completed" | "failed";
  txHash?:      string;
  error?:       string;
  startedAt:    Date;
  completedAt?: Date;
  updatedAt:    Date;
}

const evmSwapSchema = new Schema<IEvmSwap>({
  userId:       { type: String, required: true, index: true },
  routeId:      { type: String, required: true },
  fromChainId:  { type: Number, required: true },
  toChainId:    { type: Number, required: true },
  fromToken:    { type: String, required: true },
  fromAddress:  { type: String, required: true },
  toToken:      { type: String, required: true },
  toAddress:    { type: String, required: true },
  fromAmount:   { type: String, required: true },
  toAmount:     { type: String },
  alphaFeeUSD:  { type: String },
  tool:         { type: String },
  state:        { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
  txHash:       { type: String },
  error:        { type: String },
  startedAt:    { type: Date, default: () => new Date() },
  completedAt:  { type: Date },
  updatedAt:    { type: Date, default: () => new Date() },
}, {
  collection: "evm_swaps",
  timestamps: { updatedAt: "updatedAt", createdAt: false },
});

evmSwapSchema.index({ userId: 1, startedAt: -1 });
evmSwapSchema.index({ routeId: 1 }, { unique: true, sparse: true });

export const EvmSwapModel: Model<IEvmSwap> =
  mongoose.models["EvmSwap"] as Model<IEvmSwap>
  ?? mongoose.model<IEvmSwap>("EvmSwap", evmSwapSchema);
