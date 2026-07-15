/**
 * Collection: presence
 *
 * Stato real-time di ogni utente. Separato da `users` per due motivi:
 *   1. Scrivibilità alta — aggiornato ad ogni heartbeat WebSocket (Sprint 7)
 *   2. Privacy — può essere nascosto completamente senza toccare il profilo
 *
 * Un documento per utente (upsert on connect/disconnect).
 *
 * CTO note: "Creare subito questa collection, anche se non serve oggi.
 * Domani conterrà: online, offline, last seen, typing, recording, in call."
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PresenceStatus = "online" | "offline" | "busy" | "away";

export interface IPresence {
  _id: mongoose.Types.ObjectId;

  user_id: mongoose.Types.ObjectId;

  status: PresenceStatus;
  last_seen_at: Date;

  /** Conversazione in cui l'utente sta scrivendo (null = non sta scrivendo) */
  is_typing_in: mongoose.Types.ObjectId | null;

  /** Conversazione in cui l'utente sta registrando un audio (null = no) */
  is_recording_in: mongoose.Types.ObjectId | null;

  /** L'utente è in una chiamata audio/video */
  is_in_call: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type IPresenceDocument = IPresence & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const presenceSchema = new Schema<IPresenceDocument>(
  {
    user_id: { type: Schema.Types.ObjectId, required: true, ref: "User", unique: true },
    status: {
      type: String,
      enum: ["online", "offline", "busy", "away"],
      default: "offline",
    },
    last_seen_at: { type: Date, default: () => new Date() },
    is_typing_in: { type: Schema.Types.ObjectId, default: null, ref: "Conversation" },
    is_recording_in: { type: Schema.Types.ObjectId, default: null, ref: "Conversation" },
    is_in_call: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici
// ---------------------------------------------------------------------------

// user_id già unique dal field definition
presenceSchema.index({ status: 1 });
// TTL: i documenti "offline" possono essere puliti dopo 30 giorni di inattività
presenceSchema.index({ last_seen_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const PresenceModel: Model<IPresenceDocument> =
  mongoose.models["Presence"] ??
  mongoose.model<IPresenceDocument>("Presence", presenceSchema);
