/**
 * Collection: usda_payments
 *
 * Registra ogni transazione USDA originata da AlphaChat.
 * Separata dalla collection messages: il Core non conosce la logica USDA.
 * Il link è tramite message_id (opzionale) e system_metadata nel messaggio.
 *
 * Conforme al Principio di Isolamento del Wallet (04_Architecture.md §2.4).
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsdaPaymentStatus =
  | "preparing"
  | "signing"
  | "submitting"
  | "pending"
  | "confirmed"
  | "pending_claim"
  | "claimed"
  | "refunded"
  | "failed";

export type UsdaPaymentKind = "send" | "request" | "receipt";

export interface IUsdaPayment {
  _id: mongoose.Types.ObjectId;

  /** UUID v4 generato dal client — idempotenza */
  client_payment_id: string;

  kind: UsdaPaymentKind;

  sender_id: mongoose.Types.ObjectId;
  recipient_id: mongoose.Types.ObjectId;
  conversation_id: mongoose.Types.ObjectId;

  /** Link al messaggio AlphaChat (null finché il messaggio non è creato) */
  message_id: mongoose.Types.ObjectId | null;

  /** Importo in USDA (Decimal128 per precisione) */
  amount: mongoose.Types.Decimal128;
  fee: mongoose.Types.Decimal128;

  note: string | null;
  status: UsdaPaymentStatus;

  tx_hash: string | null;

  /** ID del pagamento nel backend USDA esterno (quando collegato) */
  external_payment_id: string | null;

  /** Link pubblico per pagare (solo kind="request") — generato da getusda.xyz */
  share_link: string | null;

  claim_expires_at: Date | null;
  claimed_at: Date | null;
  refunded_at: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type IUsdaPaymentDocument = IUsdaPayment & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const usdaPaymentSchema = new Schema<IUsdaPaymentDocument>(
  {
    client_payment_id: { type: String, required: true },
    kind: {
      type: String,
      enum: ["send", "request", "receipt"],
      required: true,
    },
    sender_id:     { type: Schema.Types.ObjectId, required: true, ref: "User" },
    recipient_id:  { type: Schema.Types.ObjectId, required: true, ref: "User" },
    conversation_id: { type: Schema.Types.ObjectId, required: true, ref: "Conversation" },
    message_id:    { type: Schema.Types.ObjectId, default: null, ref: "Message" },
    amount:        { type: Schema.Types.Decimal128, required: true },
    fee:           { type: Schema.Types.Decimal128, required: true, default: 0 },
    note:          { type: String, default: null },
    status: {
      type: String,
      enum: ["preparing", "signing", "submitting", "pending", "confirmed", "pending_claim", "claimed", "refunded", "failed"],
      required: true,
    },
    tx_hash:              { type: String, default: null },
    external_payment_id:  { type: String, default: null },
    share_link:           { type: String, default: null },
    claim_expires_at:     { type: Date, default: null },
    claimed_at:           { type: Date, default: null },
    refunded_at:          { type: Date, default: null },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici
// ---------------------------------------------------------------------------

usdaPaymentSchema.index({ client_payment_id: 1 }, { unique: true });
usdaPaymentSchema.index({ external_payment_id: 1 }, { sparse: true });
usdaPaymentSchema.index({ sender_id: 1, createdAt: -1 });
usdaPaymentSchema.index({ recipient_id: 1, createdAt: -1 });
usdaPaymentSchema.index({ conversation_id: 1, createdAt: -1 });
usdaPaymentSchema.index({ message_id: 1 }, { sparse: true });
usdaPaymentSchema.index({ status: 1 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const UsdaPaymentModel: Model<IUsdaPaymentDocument> =
  mongoose.models["UsdaPayment"] ??
  mongoose.model<IUsdaPaymentDocument>("UsdaPayment", usdaPaymentSchema);
