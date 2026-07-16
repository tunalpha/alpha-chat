/**
 * Collection: blocks
 *
 * Relazione di blocco tra due utenti.
 * - blocker_id blocca blocked_id
 * - Effetti: il bloccato non può inviare messaggi, vedere il profilo, chiamare
 * - Indice composto unique per garantire un solo blocco per coppia
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IBlock {
  _id: mongoose.Types.ObjectId;
  blocker_id: mongoose.Types.ObjectId;
  blocked_id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type IBlockDocument = IBlock & Document;

const blockSchema = new Schema<IBlockDocument>(
  {
    blocker_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    blocked_id:  { type: Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: true },
);

// Un utente può bloccare un altro utente una sola volta
blockSchema.index({ blocker_id: 1, blocked_id: 1 }, { unique: true });
// Lookup inverso — "sono io bloccato da X?"
blockSchema.index({ blocked_id: 1, blocker_id: 1 });

export const BlockModel: Model<IBlockDocument> =
  mongoose.models["Block"] ?? mongoose.model<IBlockDocument>("Block", blockSchema);
