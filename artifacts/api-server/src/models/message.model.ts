/**
 * Collection: messages
 *
 * Il core di Alpha Chat. Ogni messaggio è un documento.
 * Il contenuto è SEMPRE cifrato E2E: il server conserva solo il ciphertext opaco.
 *
 * Schema conforme a 05_Database.md + estensioni Sprint 6 (CTO recommendations):
 *   - status: queued|sent|delivered|read|deleted|failed — per ✓ ✓✓ nel frontend
 *   - server_received_at: separato da createdAt — il client può essere offline
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageType = "text" | "media" | "system" | "reply" | "forward";

/**
 * Stato delivery del messaggio (CTO recommendation Sprint 6).
 *
 * Macchina a stati:
 *   queued → sent (server ha ricevuto)
 *   sent → delivered (server ha consegnato al device destinatario)
 *   delivered → read (destinatario ha letto)
 *   * → deleted (eliminazione per tutti)
 *   queued → failed (il server non ha ricevuto entro timeout)
 */
export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "deleted"
  | "failed";

export interface IMessage {
  _id: mongoose.Types.ObjectId;

  /** UUID v4 generato dal client — garantisce idempotenza */
  client_message_id: string;
  conversation_id: mongoose.Types.ObjectId;
  sender_id: mongoose.Types.ObjectId;

  // --- Contenuto cifrato (Signal Protocol) ---
  /** base64 — null solo per messaggi di sistema */
  ciphertext: string | null;
  /** Signal Protocol message type: 1=WhisperMessage, 3=PreKeyWhisperMessage */
  ciphertext_type: number | null;
  /** ID della chiave SPK/OPK del mittente */
  sender_key_id: number | null;
  /**
   * Fase 4 — Multi-device: mappa device_id → ciphertext cifrato per quel device.
   * Il server non interpreta mai il contenuto (opaco, E2E).
   * Null per messaggi legacy (pre-Fase 4).
   */
  device_ciphertexts: Array<{ device_id: string; body: string; type: number }> | null;

  // --- Tipo ---
  message_type: MessageType;

  // --- Reply ---
  reply_to_message_id: mongoose.Types.ObjectId | null;
  reply_to_snapshot: {
    sender_id: mongoose.Types.ObjectId;
    message_type: string;
  } | null;

  // --- Media ---
  media_id: mongoose.Types.ObjectId | null;

  // --- Sistema (non E2E) ---
  system_event: string | null;
  system_metadata: Record<string, unknown> | null;

  // --- Ordine e Delivery ---
  /**
   * Numero di sequenza monotono per conversation_id.
   * Assegnato dal server con $inc atomico sul documento conversation.
   * Garantisce ordinamento stabile e rilevamento gap.
   */
  sequence_number: number;
  /**
   * server_received_at — timestamp di ricezione del server.
   * Separato da createdAt / sent_at perché il client può accodare messaggi
   * offline e inviarli in batch. Il server imposta questo campo all'arrivo.
   */
  server_received_at: Date;
  /** Timestamp del client (incluso nel ciphertext, qui come metadato per sort) */
  sent_at: Date;

  // --- Status (CTO recommendation Sprint 6) ---
  status: MessageStatus;

  // --- Eliminazione ---
  deleted_for_everyone: boolean;
  deleted_for_everyone_at: Date | null;
  deleted_for: mongoose.Types.ObjectId[];

  // --- Modifica ---
  edited_at: Date | null;

  // --- Messaggi a scomparsa ---
  expires_at: Date | null;

  // --- Secure Destroy (auto-destroy timer — schema prep) ---
  /** Se impostato, il messaggio viene distrutto definitivamente a questa data */
  destroy_at: Date | null;

  // --- Burn After Read (Sprint 15) ---
  /**
   * Se true, il messaggio viene hard-deleted sul server non appena il
   * destinatario lo legge (markConversationRead). Broadcast message.destroyed.
   */
  burn_after_read: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type IMessageDocument = IMessage & Document;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const replySnapshotSchema = new Schema(
  {
    sender_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    message_type: { type: String, required: true },
  },
  { _id: false },
);

const messageSchema = new Schema<IMessageDocument>(
  {
    client_message_id: { type: String, required: true },
    conversation_id: { type: Schema.Types.ObjectId, required: true, ref: "Conversation" },
    sender_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },

    ciphertext: { type: String, default: null },
    ciphertext_type: { type: Number, default: null },
    sender_key_id: { type: Number, default: null },

    message_type: {
      type: String,
      enum: ["text", "media", "system", "reply", "forward"],
      required: true,
    },

    reply_to_message_id: { type: Schema.Types.ObjectId, default: null, ref: "Message" },
    reply_to_snapshot: { type: replySnapshotSchema, default: null },

    media_id: { type: Schema.Types.ObjectId, default: null, ref: "Media" },

    system_event: { type: String, default: null },
    system_metadata: { type: Schema.Types.Mixed, default: null },

    sequence_number: { type: Number, required: true },
    server_received_at: { type: Date, required: true, default: () => new Date() },
    sent_at: { type: Date, required: true },

    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "deleted", "failed"],
      default: "sent",
    },

    deleted_for_everyone: { type: Boolean, default: false },
    deleted_for_everyone_at: { type: Date, default: null },
    deleted_for: { type: [Schema.Types.ObjectId], default: [] },

    edited_at: { type: Date, default: null },

    expires_at: { type: Date, default: null },

    destroy_at: { type: Date, default: null },

    burn_after_read: { type: Boolean, default: false },

    // Fase 4: multi-device — array opaco al server
    device_ciphertexts: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

// ---------------------------------------------------------------------------
// Indici (conformi a 05_Database.md)
// ---------------------------------------------------------------------------

// Idempotenza — prevenire duplicati su client_message_id
messageSchema.index({ client_message_id: 1 }, { unique: true });

// Fetch messaggi paginati in ordine — path critico
messageSchema.index({ conversation_id: 1, sequence_number: 1 }, { unique: true });

// Paginazione per timestamp come fallback
messageSchema.index({ conversation_id: 1, createdAt: 1 });

// Storico messaggi di un utente
messageSchema.index({ sender_id: 1 });

// Auto-delete messaggi a scomparsa
messageSchema.index(
  { expires_at: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { expires_at: { $type: "date" } },
  },
);

// Fetch risposte a un messaggio
messageSchema.index(
  { reply_to_message_id: 1 },
  { sparse: true },
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const MessageModel: Model<IMessageDocument> =
  mongoose.models["Message"] ??
  mongoose.model<IMessageDocument>("Message", messageSchema);
