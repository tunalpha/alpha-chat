/**
 * MediaRepository — accesso al database per la collection media.
 * Solo query MongoDB. Nessuna business logic.
 * Sprint 29: i campi data/thumbnail Buffer sono stati rimossi (migrazione R2).
 */

import mongoose from "mongoose";
import { MediaModel, type IMediaDocument } from "../models/media.model";

export class MediaRepository {
  async create(params: {
    uploaderId:        mongoose.Types.ObjectId;
    conversationId:    mongoose.Types.ObjectId;
    mimeType:          string;
    storageKey:        string;
    thumbnailKey:      string | null;
    bucket:            string;
    sha256:            string;
    ciphertextSize:    number;
    encryptionVersion: number;
    originalFilename?: string | null;
    durationMs:        number | null;
    waveform:          number[];
    clientUploadId?:   string | null;
    uploadedAt:        Date;
  }): Promise<IMediaDocument> {
    return MediaModel.create({
      uploader_id:       params.uploaderId,
      conversation_id:   params.conversationId,
      mime_type:         params.mimeType,
      storageKey:        params.storageKey,
      thumbnailKey:      params.thumbnailKey,
      bucket:            params.bucket,
      sha256:            params.sha256,
      ciphertextSize:    params.ciphertextSize,
      encryptionVersion: params.encryptionVersion,
      original_filename: params.originalFilename ?? null,
      duration_ms:       params.durationMs,
      waveform:          params.waveform,
      client_upload_id:  params.clientUploadId ?? null,
      uploadedAt:        params.uploadedAt,
    });
  }

  async findById(mediaId: mongoose.Types.ObjectId): Promise<IMediaDocument | null> {
    return MediaModel.findById(mediaId);
  }

  /**
   * Cerca per chiave idempotenza filtrata per uploader.
   * Il filtro su uploader_id è essenziale: senza di esso un UUID condiviso tra
   * utenti diversi (evento astronomicamente raro) violerebbe la zero-knowledge.
   */
  async findByClientUploadId(
    clientUploadId: string,
    uploaderId: mongoose.Types.ObjectId,
  ): Promise<IMediaDocument | null> {
    return MediaModel.findOne({
      client_upload_id: clientUploadId,
      uploader_id:      uploaderId,
    });
  }

  /** Trova tutti i media di una conversazione (per pulizia su delete gruppo) */
  async findAllByConversation(
    conversationId: mongoose.Types.ObjectId,
  ): Promise<IMediaDocument[]> {
    return MediaModel.find({ conversation_id: conversationId }).select("storageKey thumbnailKey");
  }

  /**
   * Hard delete — rimuove il documento metadata.
   * Il chiamante è responsabile di eliminare prima i file da R2.
   */
  async hardDeleteById(mediaId: mongoose.Types.ObjectId): Promise<void> {
    await MediaModel.deleteOne({ _id: mediaId });
  }

  /** Aggregazione: totale file + bytes per uploader (top N) */
  async topUploaders(limit = 10): Promise<Array<{ username: string; bytes: number; count: number }>> {
    return MediaModel.aggregate([
      { $group: { _id: "$uploader_id", bytes: { $sum: "$ciphertextSize" }, count: { $sum: 1 } } },
      { $sort: { bytes: -1 } },
      { $limit: limit },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" } },
      { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, username: { $ifNull: ["$u.username", "unknown"] }, bytes: 1, count: 1 } },
    ]);
  }

  /** Aggregazione: totale file + bytes per conversazione (top N) */
  async topConversations(limit = 10): Promise<Array<{ conversation_id: string; bytes: number; count: number }>> {
    return MediaModel.aggregate([
      { $group: { _id: "$conversation_id", bytes: { $sum: "$ciphertextSize" }, count: { $sum: 1 } } },
      { $sort: { bytes: -1 } },
      { $limit: limit },
      { $project: { _id: 0, conversation_id: { $toString: "$_id" }, bytes: 1, count: 1 } },
    ]);
  }

  /** Stats aggregate: count totale e bytes totali */
  async globalStats(): Promise<{ fileCount: number; totalBytes: number }> {
    const [countResult, sizeResult] = await Promise.all([
      MediaModel.countDocuments(),
      MediaModel.aggregate([{ $group: { _id: null, total: { $sum: "$ciphertextSize" } } }]),
    ]);
    return {
      fileCount:  countResult,
      totalBytes: (sizeResult[0] as { total?: number } | undefined)?.total ?? 0,
    };
  }
}
