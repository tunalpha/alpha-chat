/**
 * chat-transfer.model.ts — Chat Payment Engine (Sprint 1)
 *
 * Collection: chat_transfers
 * Asset-agnostico (ADR sezione 16): asset_address + asset_symbol come parametri,
 * non hardcoded. MVP supporta solo ERC-20 (USDA).
 *
 * ADR-004: recipient_wallet può essere null al momento della create
 * (wallet provisioning on accept).
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import type { ChatTransferStatus } from "../payment/state-machine";

// ---------------------------------------------------------------------------
// Interfacce TypeScript
// ---------------------------------------------------------------------------

export interface IChatTransfer {
  transfer_id:         string;              // UUID — PK logica, idempotenza

  sender_id:           mongoose.Types.ObjectId;
  recipient_id:        mongoose.Types.ObjectId;
  conversation_id:     mongoose.Types.ObjectId;
  message_id:          mongoose.Types.ObjectId | null;  // impostato dopo la create del messaggio
  request_payment_id:  mongoose.Types.ObjectId | null;  // se il transfer soddisfa una usda_request in chat

  // Asset (multi-asset ready — Sezione 16)
  asset_type:          "ERC-20";            // estendibile a ERC-721, ERC-1155
  asset_address:       string;              // indirizzo contratto on-chain
  asset_symbol:        string;              // "USDA", "USDC", ecc.
  token_id:            string | null;       // null per ERC-20, usato per NFT

  // Importi
  amount:              mongoose.Types.Decimal128;
  amount_units:        string;              // BigInt come stringa (18 decimali USDA)
  fee:                 mongoose.Types.Decimal128;
  note:                string | null;

  // Wallet — snapshot al momento della create
  sender_wallet:       string;
  recipient_wallet:    string | null;       // ADR-004: può essere null
  escrow_wallet:       string;
  escrow_encrypted_pk: string;             // AES-256-GCM — mai esposto via API

  // Stato
  status:              ChatTransferStatus;

  // Blockchain
  tx_hash_deposit:      string | null;
  tx_hash_release:      string | null;
  deposit_block_number: number | null;   // block number Polygon del deposito
  release_block_number: number | null;   // block number Polygon del rilascio

  // Timing
  expires_at:          Date;
  locked_at:           Date | null;        // per recovery: stato bloccato da > 10min
  confirmed_at:        Date | null;        // deposito verificato on-chain
  responded_at:        Date | null;        // accettazione/rifiuto/cancellazione
  completed_at:        Date | null;        // terminale raggiunto
}

export interface ChatTransferDocument extends IChatTransfer, Document {
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatTransferModel extends Model<ChatTransferDocument> {}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ChatTransferSchema = new Schema<ChatTransferDocument>(
  {
    transfer_id:         { type: String, required: true },

    sender_id:           { type: Schema.Types.ObjectId, ref: "User", required: true },
    recipient_id:        { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversation_id:     { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    message_id:          { type: Schema.Types.ObjectId, ref: "Message", default: null },
    request_payment_id:  { type: Schema.Types.ObjectId, ref: "UsdaPayment", default: null },

    // Asset
    asset_type:          { type: String, enum: ["ERC-20"], default: "ERC-20" },
    asset_address:       { type: String, required: true },
    asset_symbol:        { type: String, required: true },
    token_id:            { type: String, default: null },

    // Importi
    amount:              { type: Schema.Types.Decimal128, required: true },
    amount_units:        { type: String, required: true },
    fee:                 { type: Schema.Types.Decimal128, default: 0 },
    note:                { type: String, default: null },

    // Wallet
    sender_wallet:       { type: String, required: true },
    recipient_wallet:    { type: String, default: null },
    escrow_wallet:       { type: String, required: true },
    escrow_encrypted_pk: { type: String, required: true },

    // Stato
    status: {
      type: String,
      enum: [
        "awaiting_deposit",
        "pending",
        "accepting",
        "accepted",
        "rejecting",
        "rejected",
        "cancelling",
        "cancelled",
        "refunding",
        "refunded",
        "expired",
        "failed",
      ],
      required: true,
    },

    // Blockchain
    tx_hash_deposit:      { type: String,  default: null },
    tx_hash_release:      { type: String,  default: null },
    deposit_block_number: { type: Number,  default: null },
    release_block_number: { type: Number,  default: null },

    // Timing
    expires_at:       { type: Date, required: true },
    locked_at:        { type: Date, default: null },
    confirmed_at:     { type: Date, default: null },
    responded_at:     { type: Date, default: null },
    completed_at:     { type: Date, default: null },
  },
  {
    timestamps: true,      // aggiunge createdAt, updatedAt
    collection: "chat_transfers",
  },
);

// ---------------------------------------------------------------------------
// Indici
// ---------------------------------------------------------------------------

// PK logica — idempotenza
ChatTransferSchema.index({ transfer_id: 1 }, { unique: true });

// Scheduler: trova pending scaduti
ChatTransferSchema.index({ status: 1, expires_at: 1 });

// Recovery: trova lock states bloccati da troppo tempo
ChatTransferSchema.index({ status: 1, locked_at: 1 });

// Query per utente
ChatTransferSchema.index({ sender_id: 1, createdAt: -1 });
ChatTransferSchema.index({ recipient_id: 1, createdAt: -1 });

// Lookup da conversazione
ChatTransferSchema.index({ conversation_id: 1, createdAt: -1 });

// Lookup da message_id (per aggiornamento bubble)
ChatTransferSchema.index({ message_id: 1 }, { sparse: true });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ChatTransferModel = mongoose.model<ChatTransferDocument, ChatTransferModel>(
  "ChatTransfer",
  ChatTransferSchema,
);
