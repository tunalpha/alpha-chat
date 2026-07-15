import { randomUUID } from "node:crypto";
import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ISession {
  _id: mongoose.Types.ObjectId;

  user_id: mongoose.Types.ObjectId;
  device_id: string;
  device_name: string | null;
  device_type: "ios" | "android" | "web" | "desktop";

  // Token
  refresh_token_hash: string;
  /**
   * previous_refresh_token_hash — hash dell'ultimo token ruotato.
   * Conservato per 1 livello per rilevare il riutilizzo (S-03 theft detection).
   * Se un client presenta un token il cui hash è qui → REFRESH_TOKEN_REUSED.
   */
  previous_refresh_token_hash: string | null;
  expires_at: Date;
  /**
   * family_id — UUID che identifica la catena di rotazione di questa sessione.
   * Generato alla creazione, mai modificato durante le rotazioni.
   * Usato per: audit trail, revoca famiglia su token theft detection.
   */
  family_id: string;

  // Geolocalizzazione (CTO review: solo country_code, no city/coordinate)
  ip_hash: string | null;
  country_code: string | null;

  // Push
  push_token: string | null;
  push_enabled: boolean;

  // Device Trust (after DEVICE_TRUST_THRESHOLD consecutive logins → is_trusted)
  login_count: number;
  is_trusted: boolean;

  // Sicurezza
  is_suspicious: boolean;
  last_used_at: Date;
  user_agent: string | null;

  deleted_at: Date | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export type ISessionDocument = ISession & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const sessionSchema = new Schema<ISessionDocument>(
  {
    user_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    device_id: { type: String, required: true },
    device_name: { type: String, default: null, maxlength: 100 },
    device_type: {
      type: String,
      enum: ["ios", "android", "web", "desktop"],
      required: true,
    },

    refresh_token_hash: { type: String, required: true, unique: true },
    previous_refresh_token_hash: { type: String, default: null },
    expires_at: { type: Date, required: true },
    family_id: { type: String, default: () => randomUUID() },

    ip_hash: { type: String, default: null },
    country_code: { type: String, default: null, maxlength: 2 },

    push_token: { type: String, default: null },
    push_enabled: { type: Boolean, default: true },

    login_count: { type: Number, default: 0 },
    is_trusted: { type: Boolean, default: false },

    is_suspicious: { type: Boolean, default: false },
    last_used_at: { type: Date, required: true },
    user_agent: { type: String, default: null, maxlength: 512 },

    deleted_at: { type: Date, default: null },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici (conformi a 05_Database.md)
// ---------------------------------------------------------------------------

sessionSchema.index({ user_id: 1 });
sessionSchema.index({ user_id: 1, device_id: 1 }, { unique: true });
sessionSchema.index({ family_id: 1 });
sessionSchema.index({ previous_refresh_token_hash: 1 }, { sparse: true });
sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

// ---------------------------------------------------------------------------
// Helper statics
// ---------------------------------------------------------------------------

sessionSchema.statics.findActive = function (
  filter: Partial<Pick<ISession, "user_id" | "device_id">>,
) {
  return this.find({
    ...filter,
    deleted_at: null,
    expires_at: { $gt: new Date() },
  });
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const SessionModel: Model<ISessionDocument> =
  mongoose.models["Session"] ??
  mongoose.model<ISessionDocument>("Session", sessionSchema);
