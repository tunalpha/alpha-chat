/**
 * Collection: conversations
 *
 * Ogni chat 1-to-1, gruppo e canale è un documento qui.
 * Schema conforme a 05_Database.md + estensioni Sprint 5B:
 *   - last_activity_at (CTO recommendation): separato da updatedAt —
 *     aggiornato ad ogni messaggio, react, edit. Non aggiornato da cambi
 *     impostazioni. Usato per ordinare la lista conversazioni.
 *   - type: aggiunto 'channel' per V2 (struttura pronta)
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConversationType = "direct" | "group" | "channel";

export interface IConversation {
  _id: mongoose.Types.ObjectId;

  type: ConversationType;

  // --- Solo per gruppi/canali ---
  name: string | null;
  description: string | null;
  avatar_media_id: mongoose.Types.ObjectId | null;
  invite_link_token: string | null;
  invite_link_enabled: boolean;
  invite_link_expires_at: Date | null;

  // --- Creazione ---
  created_by: mongoose.Types.ObjectId | null;

  // --- Limiti gruppo ---
  max_members: number;

  // --- Messaggi a scomparsa ---
  disappearing_messages_enabled: boolean;
  disappearing_messages_duration: number | null;

  // --- Stato ultimi messaggi ---
  last_message_id: mongoose.Types.ObjectId | null;
  last_message_at: Date | null;
  /**
   * last_activity_at — separato da updatedAt.
   * Aggiornato su ogni evento di chat (messaggi, react, edit, join/leave).
   * Non aggiornato su cambi impostazioni (nome, avatar, ecc.).
   * Usato per ordinare la lista conversazioni.
   */
  last_activity_at: Date;

  // --- Denormalizzato per evitare COUNT query ---
  member_count: number;

  /**
   * sequence_counter — contatore atomico per sequence_number dei messaggi.
   * Incrementato con $inc ad ogni messaggio inviato.
   * Garantisce sequence_number monotono per conversazione.
   */
  sequence_counter: number;

  deleted_at: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type IConversationDocument = IConversation & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const conversationSchema = new Schema<IConversationDocument>(
  {
    type: {
      type: String,
      enum: ["direct", "group", "channel"],
      required: true,
    },

    name: { type: String, default: null, maxlength: 100, trim: true },
    description: { type: String, default: null, maxlength: 300, trim: true },
    avatar_media_id: { type: Schema.Types.ObjectId, default: null, ref: "Media" },
    invite_link_token: { type: String, default: null },
    invite_link_enabled: { type: Boolean, default: false },
    invite_link_expires_at: { type: Date, default: null },

    created_by: { type: Schema.Types.ObjectId, default: null, ref: "User" },
    max_members: { type: Number, default: 256 },

    disappearing_messages_enabled: { type: Boolean, default: false },
    disappearing_messages_duration: { type: Number, default: null },

    last_message_id: { type: Schema.Types.ObjectId, default: null, ref: "Message" },
    last_message_at: { type: Date, default: null },
    last_activity_at: { type: Date, default: () => new Date() },

    member_count: { type: Number, default: 0 },
    sequence_counter: { type: Number, default: 0 },

    deleted_at: { type: Date, default: null },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici (conformi a 05_Database.md + last_activity_at per sort)
// ---------------------------------------------------------------------------

conversationSchema.index(
  { invite_link_token: 1 },
  { unique: true, partialFilterExpression: { invite_link_token: { $type: "string" } } },
);
conversationSchema.index({ type: 1 });
conversationSchema.index({ last_message_at: -1 });
conversationSchema.index({ last_activity_at: -1 }); // Sort lista conversazioni
conversationSchema.index({ created_by: 1 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ConversationModel: Model<IConversationDocument> =
  mongoose.models["Conversation"] ??
  mongoose.model<IConversationDocument>("Conversation", conversationSchema);
