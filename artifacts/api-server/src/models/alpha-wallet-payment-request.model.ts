/**
 * AlphaWalletPaymentRequest — richiesta di pagamento self-custodial (Phase G — Richiedi)
 *
 * Nessun escrow: il backend traccia solo lo stato della richiesta.
 * Il pagamento avviene direttamente on-chain dal payer all'indirizzo del requester.
 */

import mongoose, { Document, Schema } from "mongoose";

export type AWPaymentRequestStatus = "pending" | "paid" | "cancelled" | "expired";

export interface IAlphaWalletPaymentRequest {
  requester_id:      mongoose.Types.ObjectId;
  payer_id:          mongoose.Types.ObjectId;
  conversation_id:   mongoose.Types.ObjectId;
  network:           string;
  asset_symbol:      string;
  amount:            string;
  requester_address: string;   // indirizzo pubblico su cui il payer deve inviare
  status:            AWPaymentRequestStatus;
  tx_hash?:          string;   // compilato da payer al pagamento
  created_at:        Date;
  expires_at:        Date;     // TTL 24h; MongoDB TTL index la rimuove dopo
}

export interface IAlphaWalletPaymentRequestDocument
  extends IAlphaWalletPaymentRequest, Document {}

const schema = new Schema<IAlphaWalletPaymentRequestDocument>(
  {
    requester_id:      { type: Schema.Types.ObjectId, required: true, ref: "User" },
    payer_id:          { type: Schema.Types.ObjectId, required: true, ref: "User" },
    conversation_id:   { type: Schema.Types.ObjectId, required: true },
    network:           { type: String, required: true },
    asset_symbol:      { type: String, required: true },
    amount:            { type: String, required: true },
    requester_address: { type: String, required: true },
    status:            {
      type:    String,
      enum:    ["pending", "paid", "cancelled", "expired"],
      default: "pending",
    },
    tx_hash:    { type: String },
    created_at: { type: Date, default: () => new Date() },
    expires_at: { type: Date, required: true },
  },
  { timestamps: false },
);

// Indici
schema.index({ requester_id: 1, status: 1 });
schema.index({ payer_id: 1, status: 1 });
// TTL index: MongoDB elimina il documento quando expires_at è trascorso
schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const AlphaWalletPaymentRequestModel =
  mongoose.model<IAlphaWalletPaymentRequestDocument>(
    "AlphaWalletPaymentRequest",
    schema,
  );
