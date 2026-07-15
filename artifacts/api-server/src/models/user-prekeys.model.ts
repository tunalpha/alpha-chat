/**
 * Collection: user_prekeys
 *
 * Chiavi pubbliche del Signal Protocol per ogni device.
 * Il server conserva SOLO chiavi pubbliche — le private non lasciano mai il device.
 * Schema conforme a 05_Database.md.
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IOneTimePrekey {
  key_id: number;
  public_key: string; // Curve25519, base64
}

export interface IUserPrekeys {
  _id: mongoose.Types.ObjectId;

  user_id: mongoose.Types.ObjectId;
  device_id: string;

  // Identity Key (IK) — permanente per questo device
  identity_key: string; // Curve25519 public, base64

  // Signed PreKey (SPK) — ruotata ogni ~7 giorni
  signed_prekey: {
    key_id: number;
    public_key: string;  // Curve25519, base64
    signature: string;   // firma con IK, base64
    created_at: Date;
  };

  // One-Time PreKeys (OPK) — monouso (X3DH)
  one_time_prekeys: IOneTimePrekey[];

  last_prekey_upload_at: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type IUserPrekeysDocument = IUserPrekeys & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const signedPrekeySchema = new Schema(
  {
    key_id: { type: Number, required: true },
    public_key: { type: String, required: true },
    signature: { type: String, required: true },
    created_at: { type: Date, required: true },
  },
  { _id: false },
);

const oneTimePrekeySchema = new Schema(
  {
    key_id: { type: Number, required: true },
    public_key: { type: String, required: true },
  },
  { _id: false },
);

const userPrekeysSchema = new Schema<IUserPrekeysDocument>(
  {
    user_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    device_id: { type: String, required: true },
    identity_key: { type: String, required: true },
    signed_prekey: { type: signedPrekeySchema, required: true },
    one_time_prekeys: { type: [oneTimePrekeySchema], default: [] },
    last_prekey_upload_at: { type: Date, required: true },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici (conformi a 05_Database.md)
// ---------------------------------------------------------------------------

userPrekeysSchema.index({ user_id: 1, device_id: 1 }, { unique: true });
userPrekeysSchema.index({ user_id: 1 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const UserPrekeysModel: Model<IUserPrekeysDocument> =
  mongoose.models["UserPrekeys"] ??
  mongoose.model<IUserPrekeysDocument>("UserPrekeys", userPrekeysSchema);
