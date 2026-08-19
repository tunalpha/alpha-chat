/**
 * EvmSwap — MongoDB model
 *
 * Registra ogni EVM swap avviato tramite Li.Fi.
 * ISOLAMENTO: completamente separato da payment engine, USDA, MultiChain.
 */

import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IEvmSwap extends Document {
  userId:       string;
  /** Identificatore interno stabile: collega journal, history e notifiche. */
  swapId:       string;
  provider:     "lifi";
  routeId:      string;       // Li.Fi route ID (o auto-generato)
  fromChainId:  number;
  toChainId:    number;
  fromToken:    string;       // symbol
  fromAddress:  string;       // contract address (o "native")
  toToken:      string;       // symbol
  toAddress:    string;
  fromAmount:   string;       // in unità minime (stringa)
  toAmount?:    string;       // ricevuto effettivo (valorizzato al complete)
  alphaFeeUSD?: string;       // commissione Alpha 25 bps in USD
  volumeUSD?:   string;       // volume in USD al momento dello swap
  tool?:        string;       // bridge/dex usato (es. "across")
  source?:      string;       // "user_flow" | "historical_import"
  /**
   * Stato autorevole del provider, aggiornato esclusivamente dal backend.
   * Il browser può registrare una source TX, mai decidere uno stato terminale.
   */
  state:        "pending" | "processing" | "completed" | "failed" | "refunded" | "expired";
  providerStatus?: string;
  /** TX sorgente proposta dal browser, resa write-once nel journal. */
  sourceTxHash?: string;
  txHash?:      string;
  /** BTC→EVM Li.FI: dati di correlazione, mai il PSBT o materiale di firma. */
  btcDepositAddress?: string;
  btcMemo?:           string;
  btcPsbtDigest?:     string;
  btcDepositTxHash?:  string;
  destinationTxHash?: string;
  error?:       string;
  startedAt:    Date;
  completedAt?: Date;
  updatedAt:    Date;
}

const evmSwapSchema = new Schema<IEvmSwap>({
  userId:       { type: String, required: true, index: true },
  swapId:       { type: String, required: true },
  provider:     { type: String, enum: ["lifi"], required: true, default: "lifi" },
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
  volumeUSD:    { type: String },
  tool:         { type: String },
  source:       { type: String },
  state:        { type: String, enum: ["pending", "processing", "completed", "failed", "refunded", "expired"], default: "pending" },
  providerStatus: { type: String },
  sourceTxHash: { type: String },
  txHash:       { type: String },
  btcDepositAddress: { type: String },
  btcMemo:           { type: String },
  btcPsbtDigest:     { type: String },
  btcDepositTxHash:  { type: String },
  destinationTxHash: { type: String },
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
// I journal legacy non hanno swapId; un unique semplice indicizzerebbe più
// valori null. L'unicità viene applicata solo quando l'ID è presente.
evmSwapSchema.index(
  { swapId: 1 },
  { unique: true, partialFilterExpression: { swapId: { $type: "string" } } },
);

export const EvmSwapModel: Model<IEvmSwap> =
  mongoose.models["EvmSwap"] as Model<IEvmSwap>
  ?? mongoose.model<IEvmSwap>("EvmSwap", evmSwapSchema);
