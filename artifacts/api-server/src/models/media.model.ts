/**
 * Collection: media
 *
 * Archivia i file multimediali (audio, immagini, documenti) inviati in chat.
 * Sprint 11: messaggi vocali (audio/webm).
 * I dati audio sono memorizzati come Buffer — adeguato per voice messages < 5MB.
 * Sprint 12 migrerà verso object storage per file di grandi dimensioni.
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IMedia {
  _id: mongoose.Types.ObjectId;
  uploader_id: mongoose.Types.ObjectId;
  conversation_id: mongoose.Types.ObjectId;
  /** MIME type, es. "audio/webm;codecs=opus" */
  mime_type: string;
  /** Dati binari del file */
  data: Buffer;
  /** Dimensione in byte */
  size: number;
  /** Durata in millisecondi (per audio) */
  duration_ms: number | null;
  /** Waveform campionata: 50 valori 0-1 per la visualizzazione */
  waveform: number[];
  createdAt: Date;
  updatedAt: Date;
}

export type IMediaDocument = IMedia & Document;

const mediaSchema = new Schema<IMediaDocument>(
  {
    uploader_id:     { type: Schema.Types.ObjectId, required: true, ref: "User" },
    conversation_id: { type: Schema.Types.ObjectId, required: true, ref: "Conversation" },
    mime_type:       { type: String, required: true, maxlength: 128 },
    data:            { type: Buffer, required: true },
    size:            { type: Number, required: true },
    duration_ms:     { type: Number, default: null },
    waveform:        { type: [Number], default: [] },
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
