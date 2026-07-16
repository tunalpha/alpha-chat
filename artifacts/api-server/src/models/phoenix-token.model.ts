import mongoose, { type Document, type Model, Schema } from "mongoose";

/**
 * PhoenixToken — Sprint 18
 *
 * Token monouso generato dopo la verifica del Phoenix Code.
 * Il token raw viene inviato via email; qui salviamo solo il suo hash SHA-256.
 * Scade dopo 15 minuti. Una volta usato (used_at != null) non è più valido.
 */

export type PhoenixAction = "lock" | "destroy";

export interface IPhoenixToken {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  token_hash: string;         // SHA-256(raw_token) in hex
  action: PhoenixAction;      // azione richiesta dall'utente
  expires_at: Date;           // ora + 15 minuti
  used_at: Date | null;       // null → non ancora usato
  ip_hash: string | null;     // IP anonimizzato per audit
  created_at: Date;
}

export type IPhoenixTokenDocument = IPhoenixToken & Document;

const phoenixTokenSchema = new Schema<IPhoenixTokenDocument>(
  {
    user_id:    { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    action:     { type: String, enum: ["lock", "destroy"], required: true },
    expires_at: { type: Date, required: true },
    used_at:    { type: Date, default: null },
    ip_hash:    { type: String, default: null },
    created_at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

// TTL index: Mongoose/MongoDB rimuove i documenti scaduti automaticamente
phoenixTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const PhoenixTokenModel: Model<IPhoenixTokenDocument> =
  mongoose.models["PhoenixToken"] ??
  mongoose.model<IPhoenixTokenDocument>("PhoenixToken", phoenixTokenSchema);
