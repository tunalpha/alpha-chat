/**
 * Collection: conversation_members
 *
 * Join table tra utenti e conversazioni.
 * Schema conforme a 05_Database.md + estensioni Sprint 5B:
 *   - archived (advisor): permette di archiviare una chat
 *   - pinned (advisor): fissa in alto nella lista
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemberRole = "admin" | "member";

export interface IConversationMember {
  _id: mongoose.Types.ObjectId;

  conversation_id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;

  role: MemberRole;

  // --- Notifiche ---
  is_muted: boolean;
  muted_until: Date | null;

  // --- UI personale ---
  /** Chat archiviata (nascosta dalla lista principale) */
  archived: boolean;
  /** Chat fissata in cima alla lista */
  pinned: boolean;
  pinned_at: Date | null;

  // --- Stato lettura ---
  last_read_message_id: mongoose.Types.ObjectId | null;
  last_read_at: Date | null;

  // --- Messaggi nascosti "solo per me" ---
  hidden_message_ids: mongoose.Types.ObjectId[];

  // --- Membership ---
  joined_at: Date;
  left_at: Date | null;
  removed_by: mongoose.Types.ObjectId | null;
  deleted_at: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type IConversationMemberDocument = IConversationMember & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const conversationMemberSchema = new Schema<IConversationMemberDocument>(
  {
    conversation_id: { type: Schema.Types.ObjectId, required: true, ref: "Conversation" },
    user_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },

    role: { type: String, enum: ["admin", "member"], default: "member" },

    is_muted: { type: Boolean, default: false },
    muted_until: { type: Date, default: null },

    archived: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },
    pinned_at: { type: Date, default: null },

    last_read_message_id: { type: Schema.Types.ObjectId, default: null, ref: "Message" },
    last_read_at: { type: Date, default: null },

    hidden_message_ids: { type: [Schema.Types.ObjectId], default: [] },

    joined_at: { type: Date, required: true, default: () => new Date() },
    left_at: { type: Date, default: null },
    removed_by: { type: Schema.Types.ObjectId, default: null, ref: "User" },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici (conformi a 05_Database.md)
// ---------------------------------------------------------------------------

// Verifica appartenenza — path critico
conversationMemberSchema.index(
  { conversation_id: 1, user_id: 1 },
  { unique: true },
);
conversationMemberSchema.index({ user_id: 1 });
conversationMemberSchema.index({ user_id: 1, last_read_at: 1 });
conversationMemberSchema.index({ conversation_id: 1, role: 1 });
// Sort lista conversazioni per utente (pinned desc, last_activity)
conversationMemberSchema.index({ user_id: 1, pinned: -1, deleted_at: 1 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ConversationMemberModel: Model<IConversationMemberDocument> =
  mongoose.models["ConversationMember"] ??
  mongoose.model<IConversationMemberDocument>("ConversationMember", conversationMemberSchema);
