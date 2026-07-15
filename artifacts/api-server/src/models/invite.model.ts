/**
 * Invite Code Model
 *
 * PRIVACY: Solo l'hash SHA-256 del codice viene persistito.
 * Il codice grezzo è in chiaro solo in memoria durante la generazione
 * e viene inviato all'utente una sola volta — mai salvato.
 *
 * TTL index su expires_at → MongoDB elimina automaticamente i documenti
 * scaduti (expireAfterSeconds: 0 = al raggiungimento della data).
 */

import mongoose, { type Document, type Model } from "mongoose";

export interface IInvite {
  _id: mongoose.Types.ObjectId;
  /** SHA-256 hex del codice grezzo */
  code_hash: string;
  /** Utente che ha generato il codice */
  owner_id: mongoose.Types.ObjectId;
  /** Scadenza — usato anche come TTL index */
  expires_at: Date;
  /** true dopo il primo utilizzo */
  used: boolean;
  used_at?: Date;
  /** Utente che ha riscattato il codice */
  used_by?: mongoose.Types.ObjectId;
  created_at: Date;
}

export type InviteDocument = IInvite & Document;

const InviteSchema = new mongoose.Schema<InviteDocument>(
  {
    code_hash:  { type: String, required: true, unique: true },
    owner_id:   { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    expires_at: { type: Date, required: true },
    used:       { type: Boolean, default: false },
    used_at:    { type: Date },
    used_by:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    created_at: { type: Date, default: () => new Date() },
  },
  {
    collection: "invites",
    versionKey: false,
  },
);

// Indici (code_hash ha già unique:true nel campo — non ridichiarare qui)
InviteSchema.index({ owner_id: 1, used: 1 });
// TTL: MongoDB cancella automaticamente i documenti scaduti
InviteSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const InviteModel: Model<InviteDocument> =
  mongoose.models["Invite"] ??
  mongoose.model<InviteDocument>("Invite", InviteSchema);
