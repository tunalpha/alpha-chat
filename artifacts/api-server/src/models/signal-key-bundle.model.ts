/**
 * Collection: signal_key_bundles
 *
 * Distribuisce il materiale crittografico pubblico per Signal Protocol.
 *
 * ZERO PLAINTEXT RULE — regola permanente:
 *   Il server conserva SOLO chiavi pubbliche. Mai chiavi private, mai plaintext.
 *   Le chiavi private rimangono esclusivamente sul dispositivo client (IndexedDB).
 *
 * Struttura PreKey Bundle (Signal spec):
 *   - Identity Key      : chiave pubblica Curve25519 a lungo termine
 *   - Signed PreKey     : chiave pubblica Curve25519 a medio termine, firmata con Identity Key
 *   - One-Time PreKeys  : pool di chiavi DH monouso (eliminate dopo X3DH)
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IOneTimePreKey {
  key_id: number;
  /** Chiave pubblica X25519 — 32 byte, codificata base64 */
  public_key: string;
  consumed: boolean;
  consumed_at: Date | null;
}

export interface ISignalKeyBundle {
  _id: mongoose.Types.ObjectId;

  /** Utente proprietario del bundle */
  user_id: mongoose.Types.ObjectId;

  /** Dispositivo (da Session.device_id) */
  device_id: string;

  /**
   * Registration ID — numero casuale 1–16383 generato dal client (Signal spec §2.3).
   * Identificatore stabile per il dispositivo nella rete Signal.
   */
  registration_id: number;

  /** Identity Key pubblica (Curve25519/Ed25519, 32 byte raw, base64) */
  identity_key: string;

  // --- Signed PreKey ---
  signed_pre_key_id: number;
  /** Chiave pubblica X25519, 32 byte base64 */
  signed_pre_key: string;
  /** Firma Ed25519 della signed_pre_key con l'identity key, 64 byte base64 */
  signed_pre_key_signature: string;
  /** Quando è stata generata/ruotata la signed prekey */
  signed_pre_key_rotated_at: Date;

  // --- One-Time PreKeys ---
  one_time_pre_keys: IOneTimePreKey[];

  /** Contatore cache OTPK non consumate — denormalizzato per query veloci */
  otpk_count: number;

  createdAt: Date;
  updatedAt: Date;
}

export type ISignalKeyBundleDocument = ISignalKeyBundle & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const oneTimePreKeySchema = new Schema<IOneTimePreKey>(
  {
    key_id: { type: Number, required: true },
    public_key: { type: String, required: true },
    consumed: { type: Boolean, default: false },
    consumed_at: { type: Date, default: null },
  },
  { _id: false },
);

const signalKeyBundleSchema = new Schema<ISignalKeyBundleDocument>(
  {
    user_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    device_id: { type: String, required: true },
    registration_id: { type: Number, required: true, min: 1, max: 16383 },
    identity_key: { type: String, required: true },
    signed_pre_key_id: { type: Number, required: true },
    signed_pre_key: { type: String, required: true },
    signed_pre_key_signature: { type: String, required: true },
    signed_pre_key_rotated_at: { type: Date, default: () => new Date() },
    one_time_pre_keys: { type: [oneTimePreKeySchema], default: [] },
    otpk_count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici
// ---------------------------------------------------------------------------

// Un bundle per (user, device) — upsert su questo indice
signalKeyBundleSchema.index({ user_id: 1, device_id: 1 }, { unique: true });

// Lookup per userId (recupero bundle dal destinatario durante X3DH)
signalKeyBundleSchema.index({ user_id: 1 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const SignalKeyBundleModel: Model<ISignalKeyBundleDocument> =
  mongoose.models["SignalKeyBundle"] ??
  mongoose.model<ISignalKeyBundleDocument>(
    "SignalKeyBundle",
    signalKeyBundleSchema,
    "signal_key_bundles",
  );
