/**
 * Collection: media
 *
 * Archivia i METADATA dei file multimediali inviati in chat.
 * I file binari sono archiviati esclusivamente su Cloudflare R2.
 * MongoDB NON contiene mai file binari.
 *
 * Sprint 11: messaggi vocali.
 * Sprint 13: foto, video, documenti.
 * Sprint 29: migrazione a Cloudflare R2 Object Storage.
 *
 * Flusso:
 *   Upload → R2 (PutObject) → MongoDB (metadata)
 *   Download → MongoDB (storageKey) → R2 Signed URL (5 min)
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IMedia {
  _id: mongoose.Types.ObjectId;
  uploader_id:      mongoose.Types.ObjectId;
  conversation_id:  mongoose.Types.ObjectId;
  /** Chiave di idempotenza opzionale (UUID v4) — deduplicazione retry client */
  client_upload_id: string | null;
  /** MIME type originale (es. "image/jpeg", "audio/mp4") */
  mime_type:        string;
  /** Chiave oggetto R2 (es. "images/2026/07/21/<uuid>") */
  storageKey:       string;
  /** Chiave thumbnail R2 — null se assente */
  thumbnailKey:     string | null;
  /** Nome bucket R2 */
  bucket:           string;
  /** SHA-256 esadecimale del ciphertext */
  sha256:           string;
  /** Dimensione in byte del ciphertext (blob cifrato AES-256-GCM) */
  ciphertextSize:   number;
  /**
   * Versione dell'algoritmo di cifratura client-side.
   * 1 = AES-256-GCM (attuale).
   * Usato per future migrazioni senza dover migrare i dati.
   */
  encryptionVersion: number;
  /** Nome file originale fornito dal client */
  original_filename: string | null;
  /** Durata in ms (audio/video) */
  duration_ms:      number | null;
  /** Waveform campionata 0-1 per visualizzazione (solo audio) */
  waveform:         number[];
  /** Timestamp preciso dell'upload su R2 (separato da createdAt per debugging) */
  uploadedAt:       Date;
  createdAt:        Date;
  updatedAt:        Date;
}

export type IMediaDocument = IMedia & Document;

const mediaSchema = new Schema<IMediaDocument>(
  {
    uploader_id:       { type: Schema.Types.ObjectId, required: true, ref: "User" },
    conversation_id:   { type: Schema.Types.ObjectId, required: true, ref: "Conversation" },
    mime_type:         { type: String, required: true, maxlength: 128 },
    storageKey:        { type: String, required: true },
    thumbnailKey:      { type: String, default: null },
    bucket:            { type: String, required: true },
    sha256:            { type: String, required: true, maxlength: 64 },
    ciphertextSize:    { type: Number, required: true },
    encryptionVersion: { type: Number, required: true, default: 1 },
    original_filename: { type: String, default: null },
    duration_ms:       { type: Number, default: null },
    waveform:          { type: [Number], default: [] },
    client_upload_id:  { type: String, default: null },
    uploadedAt:        { type: Date,    required: true },
  },
  { timestamps: true },
);

// Accesso per uploader
mediaSchema.index({ uploader_id: 1 });
// Pulizia per conversazione
mediaSchema.index({ conversation_id: 1 });
// Idempotenza upload (compound: uuid + uploader per isolare utenti diversi)
mediaSchema.index(
  { client_upload_id: 1, uploader_id: 1 },
  { unique: true, partialFilterExpression: { client_upload_id: { $type: "string" } } },
);

export const MediaModel: Model<IMediaDocument> =
  mongoose.models["Media"] ??
  mongoose.model<IMediaDocument>("Media", mediaSchema);
