/**
 * MediaRepository — accesso al database per la collection media.
 * Solo query MongoDB. Nessuna business logic.
 */

import mongoose from "mongoose";
import { MediaModel, type IMediaDocument } from "../models/media.model";

export class MediaRepository {
  async create(params: {
    uploaderId: mongoose.Types.ObjectId;
    conversationId: mongoose.Types.ObjectId;
    mimeType: string;
    data: Buffer;
    size: number;
    originalFilename?: string | null;
    thumbnail?: Buffer | null;
    durationMs: number | null;
    waveform: number[];
  }): Promise<IMediaDocument> {
    return MediaModel.create({
      uploader_id:        params.uploaderId,
      conversation_id:    params.conversationId,
      mime_type:          params.mimeType,
      data:               params.data,
      size:               params.size,
      original_filename:  params.originalFilename ?? null,
      thumbnail:          params.thumbnail ?? null,
      duration_ms:        params.durationMs,
      waveform:           params.waveform,
    });
  }

  async findById(mediaId: mongoose.Types.ObjectId): Promise<IMediaDocument | null> {
    return MediaModel.findById(mediaId);
  }

  /**
   * Hard delete — rimuove completamente il documento media (dati inclusi).
   * Usato da Secure Destroy per eliminare foto/audio/video senza lasciare orfani.
   */
  async hardDeleteById(mediaId: mongoose.Types.ObjectId): Promise<void> {
    await MediaModel.deleteOne({ _id: mediaId });
  }
}
