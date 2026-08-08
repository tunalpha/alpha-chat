/**
 * multichain-transfer.model.ts — Multi-Chain Payment Engine (Phase 2)
 *
 * Collection: multichain_transfers
 *
 * Separata da chat_transfers (sistema USDA esistente).
 * Zero regressioni: non modifica né estende il modello USDA esistente.
 *
 * Importi:
 *   - Tutti come stringhe (BigInt serializzato) per precisione assoluta
 *   - Zero floating point
 *   - Valori distinti per: grossAmount, projectFee, networkFee, netAmount
 *
 * Schema contabile:
 *   grossAmount = netAmount + projectFee   (invariante verificata al momento della create)
 *   networkFee  → gas/miner fee, separata dalla project fee
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// ─── Status ───────────────────────────────────────────────────────────────────

export type MultiChainTransferStatus =
  | "awaiting_deposit"   // in attesa che l'utente depositi nel wallet escrow
  | "pending"            // deposito rilevato on-chain, in attesa di azione
  | "releasing"          // release in corso (lock state)
  | "released"           // netAmount → recipient, projectFee → feeWallet ✓
  | "refunding"          // refund in corso (lock state)
  | "refunded"           // rimborso al mittente ✓
  | "cancelling"         // cancellazione in corso (lock state)
  | "cancelled"          // annullato ✓
  | "expired"            // scaduto senza deposito
  | "failed";            // errore non recuperabile

// ─── Supported networks and assets ───────────────────────────────────────────

export type MCNetworkId   = "polygon" | "ethereum" | "bsc" | "bitcoin";
export type MCAssetSymbol = "USDA" | "USDT" | "BTC";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IMultiChainTransfer {
  // ── Idempotency ────────────────────────────────────────────────────────────
  transfer_id: string;        // UUID — PK logica, unique
  client_ref:  string;        // chiave idempotenza dal caller (UUID)

  // ── Actors ─────────────────────────────────────────────────────────────────
  sender_id:       mongoose.Types.ObjectId;
  recipient_id:    mongoose.Types.ObjectId;
  conversation_id: mongoose.Types.ObjectId;
  message_id:      mongoose.Types.ObjectId | null;

  // ── Asset ──────────────────────────────────────────────────────────────────
  network:       MCNetworkId;    // "polygon", "ethereum", "bsc", "bitcoin"
  asset:         MCAssetSymbol;  // "USDA", "USDT", "BTC"
  asset_address: string;         // contratto ERC-20 o "native" per native assets
  decimals:      number;         // decimali del token (6 USDT, 18 USDA, 8 BTC)

  // ── Amounts (BigInt serializzati come stringhe — mai floating point) ────────
  gross_amount:     string;  // importo lordo inviato dall'utente
  project_fee:      string;  // commissione 0.10% del progetto
  net_amount:       string;  // importo netto al destinatario (gross - fee)
  network_fee:      string;  // gas/miner fee effettiva (nota dopo TX, inizialmente "0")
  fee_bps:          number;  // fee rate usato (10 = 0.10%)
  fee_wallet:       string | null;  // indirizzo wallet che riceve project_fee

  // ── Wallets ────────────────────────────────────────────────────────────────
  sender_wallet:       string;        // wallet mittente
  recipient_wallet:    string;        // wallet destinatario
  escrow_wallet:       string;        // wallet escrow usa-e-getta
  escrow_encrypted_pk: string;        // PK cifrata AES-256-GCM — mai esposta via API

  // ── Status ─────────────────────────────────────────────────────────────────
  status: MultiChainTransferStatus;

  // ── Blockchain ─────────────────────────────────────────────────────────────
  tx_hash_deposit:  string | null;  // deposit dell'utente nell'escrow
  tx_hash_release:  string | null;  // release netAmount → recipient
  tx_hash_fee:      string | null;  // release projectFee → feeWallet
  tx_hash_refund:   string | null;  // refund → sender

  // ── Timing ─────────────────────────────────────────────────────────────────
  expires_at:    Date;
  locked_at:     Date | null;   // per recovery lock scaduto
  completed_at:  Date | null;   // quando lo status raggiunge un terminale

  /**
   * Importo minimo che il mittente DEVE depositare nell'escrow.
   * Null per EVM (la miner fee viene da un gas wallet separato).
   * Per Bitcoin: gross_amount + estimatedMinerFee + buffer.
   * Esposto nella API response per guidare il mittente.
   */
  min_deposit_amount: string | null;
}

export interface MultiChainTransferDocument extends IMultiChainTransfer, Document {
  createdAt: Date;
  updatedAt: Date;
}

export interface MultiChainTransferModel extends Model<MultiChainTransferDocument> {}

// ─── Schema ───────────────────────────────────────────────────────────────────

const MultiChainTransferSchema = new Schema<MultiChainTransferDocument>(
  {
    transfer_id: { type: String, required: true },
    client_ref:  { type: String, required: true },

    sender_id:       { type: Schema.Types.ObjectId, ref: "User", required: true },
    recipient_id:    { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversation_id: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    message_id:      { type: Schema.Types.ObjectId, ref: "Message", default: null },

    network:       { type: String, enum: ["polygon", "ethereum", "bsc", "bitcoin"], required: true },
    asset:         { type: String, enum: ["USDA", "USDT", "BTC"], required: true },
    asset_address: { type: String, required: true },
    decimals:      { type: Number, required: true },

    // Amounts come stringhe (BigInt serializzati)
    gross_amount: { type: String, required: true },
    project_fee:  { type: String, required: true },
    net_amount:   { type: String, required: true },
    network_fee:  { type: String, default: "0" },
    fee_bps:      { type: Number, required: true },
    fee_wallet:   { type: String, default: null },

    sender_wallet:       { type: String, required: true },
    recipient_wallet:    { type: String, required: true },
    escrow_wallet:       { type: String, required: true },
    escrow_encrypted_pk: { type: String, required: true },

    status: {
      type: String,
      enum: [
        "awaiting_deposit",
        "pending",
        "releasing",
        "released",
        "refunding",
        "refunded",
        "cancelling",
        "cancelled",
        "expired",
        "failed",
      ],
      required: true,
    },

    tx_hash_deposit: { type: String, default: null },
    tx_hash_release: { type: String, default: null },
    tx_hash_fee:     { type: String, default: null },
    tx_hash_refund:  { type: String, default: null },

    expires_at:         { type: Date, required: true },
    locked_at:          { type: Date, default: null },
    completed_at:       { type: Date, default: null },
    min_deposit_amount: { type: String, default: null },
  },
  {
    collection:  "multichain_transfers",
    timestamps:  true,
    versionKey:  false,
  },
);

// ─── Indici ───────────────────────────────────────────────────────────────────

MultiChainTransferSchema.index({ transfer_id: 1 }, { unique: true });
MultiChainTransferSchema.index({ client_ref:  1 }, { unique: true });
MultiChainTransferSchema.index({ sender_id:   1, createdAt: -1 });
MultiChainTransferSchema.index({ recipient_id: 1, createdAt: -1 });
MultiChainTransferSchema.index({ status: 1, expires_at: 1 });  // scheduler
MultiChainTransferSchema.index({ status: 1, locked_at: 1 });   // recovery
MultiChainTransferSchema.index({ escrow_wallet: 1 }, { sparse: true });
MultiChainTransferSchema.index({ tx_hash_deposit: 1 }, { sparse: true });
MultiChainTransferSchema.index({ tx_hash_release: 1 }, { sparse: true });
MultiChainTransferSchema.index({ network: 1, asset: 1, createdAt: -1 }); // reconciliation

// ─── Export ───────────────────────────────────────────────────────────────────

export const MultiChainTransferModel = mongoose.model<
  MultiChainTransferDocument,
  MultiChainTransferModel
>("MultiChainTransfer", MultiChainTransferSchema);
