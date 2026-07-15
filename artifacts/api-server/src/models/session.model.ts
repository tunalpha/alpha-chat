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
  expires_at: Date;

  // Geolocalizzazione
  ip_hash: string | null;
  country_code: string | null;
  city: string | null;

  // Push
  push_token: string | null;
  push_enabled: boolean;

  // Sicurezza
  is_suspicious: boolean;
  last_used_at: Date;

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
    expires_at: { type: Date, required: true },

    ip_hash: { type: String, default: null },
    country_code: { type: String, default: null, maxlength: 2 },
    city: { type: String, default: null, maxlength: 100 },

    push_token: { type: String, default: null },
    push_enabled: { type: Boolean, default: true },

    is_suspicious: { type: Boolean, default: false },
    last_used_at: { type: Date, required: true },

    deleted_at: { type: Date, default: null },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici (conformi a 05_Database.md)
// ---------------------------------------------------------------------------

sessionSchema.index({ user_id: 1 });
sessionSchema.index({ user_id: 1, device_id: 1 }, { unique: true });
sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

// ---------------------------------------------------------------------------
// Helper: query sessioni attive
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
