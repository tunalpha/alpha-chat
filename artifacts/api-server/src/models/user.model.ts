import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IUser {
  _id: mongoose.Types.ObjectId;

  // Identità
  username: string;
  display_name: string;
  bio: string | null;
  avatar_media_id: mongoose.Types.ObjectId | null;
  /** Data URL (base64 JPEG) o URL pubblico dell'avatar. Max ~200 KB. */
  avatar_url: string | null;

  // Autenticazione
  email: string | null;
  email_verified: boolean;
  email_verified_at: Date | null;
  password_hash: string | null;
  phone_hash: string | null;

  // 2FA
  totp_secret: string | null;
  totp_enabled: boolean;
  backup_codes: string[];

  // Sicurezza
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  last_login_ip_hash: string | null;
  last_login_country: string | null;
  username_changed_at: Date | null;

  // Privacy
  privacy: {
    show_last_seen: "everyone" | "contacts" | "nobody";
    show_online_status: "everyone" | "contacts" | "nobody";
    show_read_receipts: boolean;
    allow_adding_to_groups: "everyone" | "contacts" | "nobody";
    allow_calls_from: "everyone" | "contacts" | "nobody";
    /** Ghost Mode — override master: tutte le impostazioni al massimo privacy */
    ghost_mode: boolean;
  };

  // Lingua interfaccia (usata per le email)
  language: string;

  // Notifiche
  notification_settings: {
    messages: boolean;
    calls: boolean;
    groups: boolean;
    preview_text: boolean;
  };

  // Stato
  status: "active" | "suspended" | "deleted" | "pending_deletion";
  deleted_at: Date | null;
  deletion_scheduled_at: Date | null;
  suspension_reason: string | null;
  is_verified: boolean;

  // Phoenix Protocol (Sprint 18)
  phoenix_code_hash: string | null;
  emergency_id: string | null;

  // Account Recovery — Sprint 22
  recovery_secret_hash:           string | null;
  recovery_emergency_id:          string | null;
  recovery_card_version:          number | null;
  recovery_card_generated_at:     Date   | null;
  recovery_email:                 string | null;
  recovery_email_token:           string | null;
  recovery_email_token_expires_at: Date  | null;
  temp_password_hash:             string | null;
  temp_password_expires_at:       Date   | null;
  require_password_change:        boolean;
  last_recovery_at:               Date   | null;

  // Wallet (V2)
  wallet_enabled: boolean;
  wallet_id: string | null;

  // Admin — Sprint 23
  admin_role: "super_admin" | "security_admin" | "support" | "read_only" | null;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export type IUserDocument = IUser & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const userSchema = new Schema<IUserDocument>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_.]+$/,
    },
    display_name: { type: String, required: true, maxlength: 60, trim: true },
    bio: { type: String, default: null, maxlength: 200 },
    avatar_media_id: { type: Schema.Types.ObjectId, default: null, ref: "Media" },
    avatar_url: { type: String, default: null },

    email: { type: String, default: null, lowercase: true, trim: true },
    email_verified: { type: Boolean, default: false },
    email_verified_at: { type: Date, default: null },
    password_hash: { type: String, default: null },
    phone_hash: { type: String, default: null },

    totp_secret: { type: String, default: null },
    totp_enabled: { type: Boolean, default: false },
    backup_codes: { type: [String], default: [] },

    failed_login_attempts: { type: Number, default: 0 },
    locked_until: { type: Date, default: null },
    last_login_at: { type: Date, default: null },
    last_login_ip_hash: { type: String, default: null },
    last_login_country: { type: String, default: null },
    username_changed_at: { type: Date, default: null },

    privacy: {
      show_last_seen: { type: String, enum: ["everyone", "contacts", "nobody"], default: "contacts" },
      show_online_status: { type: String, enum: ["everyone", "contacts", "nobody"], default: "contacts" },
      show_read_receipts: { type: Boolean, default: true },
      allow_adding_to_groups: { type: String, enum: ["everyone", "contacts", "nobody"], default: "contacts" },
      allow_calls_from: { type: String, enum: ["everyone", "contacts", "nobody"], default: "contacts" },
      ghost_mode: { type: Boolean, default: false },
    },

    language: { type: String, default: "it", maxlength: 5 },

    notification_settings: {
      messages: { type: Boolean, default: true },
      calls: { type: Boolean, default: true },
      groups: { type: Boolean, default: true },
      preview_text: { type: Boolean, default: false },
    },

    status: {
      type: String,
      enum: ["active", "suspended", "deleted", "pending_deletion"],
      default: "active",
    },
    deleted_at: { type: Date, default: null },
    deletion_scheduled_at: { type: Date, default: null },
    suspension_reason: { type: String, default: null },
    is_verified: { type: Boolean, default: false },

    phoenix_code_hash: { type: String, default: null },
    emergency_id: { type: String, default: null },

    // Account Recovery — Sprint 22
    recovery_secret_hash:            { type: String,  default: null },
    recovery_emergency_id:           { type: String,  default: null },
    recovery_card_version:           { type: Number,  default: null },
    recovery_card_generated_at:      { type: Date,    default: null },
    recovery_email:                  { type: String,  default: null },
    recovery_email_token:            { type: String,  default: null },
    recovery_email_token_expires_at: { type: Date,    default: null },
    temp_password_hash:              { type: String,  default: null },
    temp_password_expires_at:        { type: Date,    default: null },
    require_password_change:         { type: Boolean, default: false },
    last_recovery_at:                { type: Date,    default: null },

    wallet_enabled: { type: Boolean, default: false },
    wallet_id: { type: String, default: null },

    // Admin — Sprint 23
    admin_role: {
      type: String,
      enum: ["super_admin", "security_admin", "support", "read_only", null],
      default: null,
    },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici (conformi a 05_Database.md)
// ---------------------------------------------------------------------------

// Partial index — indicizza solo email non-null (MongoDB indicizza null anche con sparse: true
// quando il campo è esplicitamente impostato a null, causando E11000 su più utenti senza email).
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } },
);
userSchema.index(
  { phone_hash: 1 },
  { unique: true, partialFilterExpression: { phone_hash: { $type: "string" } } },
);
userSchema.index({ status: 1 });
userSchema.index({ status: 1, createdAt: -1 });

// ---------------------------------------------------------------------------
// Metodi istanza
// ---------------------------------------------------------------------------

userSchema.methods.isLocked = function (): boolean {
  return this.locked_until != null && this.locked_until > new Date();
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const UserModel: Model<IUserDocument> =
  mongoose.models["User"] ?? mongoose.model<IUserDocument>("User", userSchema);
