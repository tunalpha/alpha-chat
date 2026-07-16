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
    clientUploadId?: string | null;
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
      client_upload_id:   params.clientUploadId ?? null,
    });
  }

  async findById(mediaId: mongoose.Types.ObjectId): Promise<IMediaDocument | null> {
    return MediaModel.findById(mediaId);
  }

  /**
   * Cerca un documento per chiave di idempotenza, filtrato per uploader.
   * Il filtro su uploader_id è essenziale: senza di esso un UUID condiviso tra
   * utenti diversi (evento astronomicamente raro ma possibile) restituirebbe
   * i metadati di un altro utente, violando il principio zero-knowledge.
   */
  async findByClientUploadId(
    clientUploadId: string,
    uploaderId: mongoose.Types.ObjectId,
  ): Promise<IMediaDocument | null> {
    return MediaModel.findOne({ client_upload_id: clientUploadId, uploader_id: uploaderId });
  }

  /**
   * Hard delete — rimuove completamente il documento media (dati inclusi).
   * Usato da Secure Destroy per eliminare foto/audio/video senza lasciare orfani.
   */
  async hardDeleteById(mediaId: mongoose.Types.ObjectId): Promise<void> {
    await MediaModel.deleteOne({ _id: mediaId });
  }
}
