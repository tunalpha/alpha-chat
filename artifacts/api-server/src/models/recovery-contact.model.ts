/**
 * RecoveryContact — Sprint 19
 *
 * Contatti fidati configurati dall'utente (max 5).
 * Ricevono solo richieste di conferma, mai dati dell'account.
 */

import mongoose, { Document, Model, Schema } from "mongoose";

export interface IRecoveryContact {
  user_id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  relation: string | null;  // es. "collega", "avvocato" — facoltativo
  created_at: Date;
  updated_at: Date;
}

export type IRecoveryContactDocument = IRecoveryContact & Document;

const schema = new Schema<IRecoveryContactDocument>(
  {
    user_id:  { type: Schema.Types.ObjectId, required: true, ref: "User" },
    name:     { type: String, required: true, trim: true, maxlength: 100 },
    email:    { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    relation: { type: String, default: null, trim: true, maxlength: 80 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

schema.index({ user_id: 1, email: 1 }, { unique: true }); // no duplicati per utente
schema.index({ user_id: 1 });

export const RecoveryContactModel: Model<IRecoveryContactDocument> =
  mongoose.models["RecoveryContact"] ??
  mongoose.model<IRecoveryContactDocument>("RecoveryContact", schema);
