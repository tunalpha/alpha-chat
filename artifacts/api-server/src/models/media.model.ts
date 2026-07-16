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
  },
  { timestamps: true },
);

// Accesso per uploader
mediaSchema.index({ uploader_id: 1 });
// Pulizia per conversazione
mediaSchema.index({ conversation_id: 1 });

export const MediaModel: Model<IMediaDocument> =
  mongoose.models["Media"] ??
  mongoose.model<IMediaDocument>("Media", mediaSchema);
