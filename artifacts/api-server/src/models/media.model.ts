/**
 * Collection: media
 *
 * Archivia i file multimediali (audio, immagini, video, documenti) inviati in chat.
 * Sprint 11: messaggi vocali (audio/webm).
 * Sprint 13: foto, video, documenti, anteprime, download, Secure Destroy.
 *
 * Storage: MongoDB Buffer — adeguato fino a ~14MB per documento.
 * Sprint 19 migrerà verso object storage per file di grandi dimensioni.
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IMedia {
  _id: mongoose.Types.ObjectId;
  uploader_id: mongoose.Types.ObjectId;
  conversation_id: mongoose.Types.ObjectId;
  /**
   * Chiave di idempotenza opzionale generata dal client prima dell'upload.
   * Presente quando il client supporta la deduplicazione dei retry.
   */
  client_upload_id?: string | null;
  /** MIME type, es. "audio/webm;codecs=opus", "image/jpeg", "video/mp4" */
  mime_type: string;
  /** Dati binari del file */
  data: Buffer;
  /** Dimensione in byte */
  size: number;
  /** Nome file originale fornito dal client */
  original_filename: string | null;
  /** Thumbnail JPEG compressa (max 240×240) — generata dal client per image/video */
  thumbnail: Buffer | null;
  /** Durata in millisecondi (per audio/video) */
  duration_ms: number | null;
  /** Waveform campionata: 50 valori 0-1 per la visualizzazione (solo audio) */
  waveform: number[];
  createdAt: Date;
  updatedAt: Date;
}

export type IMediaDocument = IMedia & Document;

const mediaSchema = new Schema<IMediaDocument>(
  {
    uploader_id:     { type: Schema.Types.ObjectId, required: true, ref: "User" },
    conversation_id: { type: Schema.Types.ObjectId, required: true, ref: "Conversation" },
    mime_type:          { type: String, required: true, maxlength: 128 },
    data:               { type: Buffer, required: true },
    size:               { type: Number, required: true },
    original_filename:  { type: String, default: null },
    thumbnail:          { type: Buffer, default: null },
    duration_ms:        { type: Number, default: null },
    waveform:           { type: [Number], default: [] },
    client_upload_id:   { type: String, default: null },
  },
  { timestamps: true },
);

// Accesso per uploader
mediaSchema.index({ uploader_id: 1 });
// Pulizia per conversazione
mediaSchema.index({ conversation_id: 1 });
// Idempotenza upload: unique compound (client_upload_id + uploader_id).
// Compound invece di solo client_upload_id per due motivi:
//   1. Due utenti diversi con la stessa UUID (raro ma possibile) non si bloccano a vicenda.
//   2. Il check E11000 nel service filtra già per uploader_id → il catch è coerente.
// partialFilterExpression: null non crea collisioni (sparse semantics).
mediaSchema.index(
  { client_upload_id: 1, uploader_id: 1 },
  { unique: true, partialFilterExpression: { client_upload_id: { $type: "string" } } },
);

export const MediaModel: Model<IMediaDocument> =
  mongoose.models["Media"] ??
  mongoose.model<IMediaDocument>("Media", mediaSchema);
