/**
 * MessageRepository — accesso al database per la collection messages.
 *
 * Regola architetturale (07_Backend_Standards.md):
 * Solo query MongoDB. Nessuna business logic.
 */

import mongoose from "mongoose";
import { MessageModel, type IMessageDocument, type MessageStatus } from "../models/message.model";
import { ConversationModel } from "../models/conversation.model";

export class MessageRepository {
  /**
   * Cerca un messaggio per client_message_id (idempotenza).
   */
  async findByClientId(clientMessageId: string): Promise<IMessageDocument | null> {
    return MessageModel.findOne({ client_message_id: clientMessageId });
  }

  /**
   * Trova un messaggio per _id verificando che appartenga alla conversazione.
   */
  async findById(
    messageId: mongoose.Types.ObjectId,
    conversationId: mongoose.Types.ObjectId,
  ): Promise<IMessageDocument | null> {
    return MessageModel.findOne({
      _id: messageId,
      conversation_id: conversationId,
      deleted_for_everyone: false,
    });
  }

  /**
   * Crea un nuovo messaggio acquisendo atomicamente il sequence_number
   * dalla conversazione con $inc. Aggiorna contestualmente last_message_id,
   * last_message_at e last_activity_at in un'unica operazione.
   *
   * Ritorna { message, sequenceNumber }.
   */
  async create(params: {
    clientMessageId: string;
    conversationId: mongoose.Types.ObjectId;
    senderId: mongoose.Types.ObjectId;
    ciphertext: string;
    ciphertextType: number;
    senderKeyId: number | null;
    messageType: IMessageDocument["message_type"];
    sentAt: Date;
    replyToMessageId?: mongoose.Types.ObjectId | null;
    mediaId?: mongoose.Types.ObjectId | null;
    status?: MessageStatus;
    burnAfterRead?: boolean;
    expiresAt?: Date | null;
    /** Fase 4: array di ciphertext per device del destinatario */
    deviceCiphertexts?: Array<{ device_id: string; body: string; type: number }> | null;
  }): Promise<IMessageDocument> {
    const now = new Date();

    // 1. Acquisisce atomicamente il prossimo sequence_number
    //    e aggiorna i campi last_* sulla conversazione in un'unica write.
    const updatedConv = await ConversationModel.findOneAndUpdate(
      { _id: params.conversationId, deleted_at: null },
      {
        $inc: { sequence_counter: 1 },
        $set: {
          last_message_at: now,
          last_activity_at: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!updatedConv) {
      throw new Error("Conversation not found during message creation");
    }

    const sequenceNumber = updatedConv.sequence_counter;

    // 2. Crea il documento messaggio
    const message = await MessageModel.create({
      client_message_id: params.clientMessageId,
      conversation_id: params.conversationId,
      sender_id: params.senderId,
      ciphertext: params.ciphertext,
      ciphertext_type: params.ciphertextType,
      sender_key_id: params.senderKeyId,
      message_type: params.messageType,
      sent_at: params.sentAt,
      server_received_at: now,
      sequence_number: sequenceNumber,
      status: params.status ?? "sent",
      reply_to_message_id: params.replyToMessageId ?? null,
      media_id: params.mediaId ?? null,
      burn_after_read: params.burnAfterRead ?? false,
      expires_at: params.expiresAt ?? null,
      device_ciphertexts: params.deviceCiphertexts ?? null,
    });

    // 3. Aggiorna last_message_id sulla conversazione (non critico per ordering)
    await ConversationModel.updateOne(
      { _id: params.conversationId },
      { $set: { last_message_id: message._id } },
    );

    return message;
  }

  /**
   * Lista messaggi paginati per una conversazione.
   * Paginazione basata su sequence_number DESC (messaggi più recenti prima).
   *
   * @param beforeSequence  — cursor: prende messaggi con seq < beforeSequence
   * @param afterSequence   — prende messaggi con seq > afterSequence
   */
  async list(params: {
    conversationId: mongoose.Types.ObjectId;
    limit: number;
    beforeSequence?: number;
    afterSequence?: number;
  }): Promise<{ messages: IMessageDocument[]; hasMore: boolean }> {
    const { conversationId, limit, beforeSequence, afterSequence } = params;

    const filter: Record<string, unknown> = {
      conversation_id: conversationId,
      deleted_for_everyone: false,
    };

    if (beforeSequence !== undefined) {
      filter["sequence_number"] = { $lt: beforeSequence };
    } else if (afterSequence !== undefined) {
      filter["sequence_number"] = { $gt: afterSequence };
    }

    // Fetch limit+1 per sapere se ci sono altri messaggi
    const messages = await MessageModel.find(filter)
      .sort({ sequence_number: -1 })
      .limit(limit + 1);

    const hasMore = messages.length > limit;
    return {
      messages: hasMore ? messages.slice(0, limit) : messages,
      hasMore,
    };
  }

  /**
   * Aggiorna lo status di un messaggio.
   */
  async updateStatus(
    messageId: mongoose.Types.ObjectId,
    status: MessageStatus,
  ): Promise<void> {
    await MessageModel.updateOne({ _id: messageId }, { $set: { status } });
  }

  /**
   * Trova un messaggio per _id (per operazioni di edit/delete).
   * Ignora deleted_for_everyone per permettere al server di gestire la cancellazione.
   */
  async findByIdRaw(
    messageId: mongoose.Types.ObjectId,
  ): Promise<IMessageDocument | null> {
    return MessageModel.findById(messageId);
  }

  /**
   * Modifica il ciphertext di un messaggio e imposta edited_at.
   */
  async editById(
    messageId: mongoose.Types.ObjectId,
    ciphertext: string,
    ciphertextType: number,
  ): Promise<IMessageDocument | null> {
    return MessageModel.findOneAndUpdate(
      { _id: messageId, deleted_for_everyone: false },
      { $set: { ciphertext, ciphertext_type: ciphertextType, edited_at: new Date() } },
      { returnDocument: "after" },
    );
  }

  /**
   * Elimina un messaggio per tutti (soft delete).
   */
  async deleteForEveryoneById(
    messageId: mongoose.Types.ObjectId,
  ): Promise<void> {
    const now = new Date();
    await MessageModel.updateOne(
      { _id: messageId },
      {
        $set: {
          deleted_for_everyone: true,
          deleted_for_everyone_at: now,
          status: "deleted",
          ciphertext: null,
        },
      },
    );
  }

  /**
   * Secure Destroy — cancellazione definitiva del documento (hard delete).
   * Non lascia tracce nel database. Per audit log usare il service layer.
   */
  async hardDeleteById(messageId: mongoose.Types.ObjectId): Promise<boolean> {
    const result = await MessageModel.deleteOne({ _id: messageId });
    return result.deletedCount === 1;
  }

  /**
   * Elimina un messaggio solo per l'utente specificato (aggiunge a deleted_for[]).
   */
  async deleteForMeById(
    messageId: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
  ): Promise<void> {
    await MessageModel.updateOne(
      { _id: messageId },
      { $addToSet: { deleted_for: userId } },
    );
  }

  /**
   * Trova il messaggio più recente di una conversazione (dopo un hard delete).
   * Usato da Secure Destroy per aggiornare last_message_id sulla conversazione.
   */
  async findLastInConversation(
    conversationId: mongoose.Types.ObjectId,
  ): Promise<{ _id: mongoose.Types.ObjectId; server_received_at: Date } | null> {
    const msg = await MessageModel.findOne(
      { conversation_id: conversationId, deleted_for_everyone: false },
      { _id: 1, server_received_at: 1 },
    ).sort({ sequence_number: -1 });
    return msg ? { _id: msg._id as mongoose.Types.ObjectId, server_received_at: msg.server_received_at } : null;
  }

  /**
   * Lista messaggi filtrati per utente (escludi deleted_for e deleted_for_everyone).
   */
  async listForUser(params: {
    conversationId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    limit: number;
    beforeSequence?: number;
    afterSequence?: number;
  }): Promise<{ messages: IMessageDocument[]; hasMore: boolean }> {
    const { conversationId, userId, limit, beforeSequence, afterSequence } = params;

    const filter: Record<string, unknown> = {
      conversation_id: conversationId,
      deleted_for_everyone: false,
      deleted_for: { $nin: [userId] },
    };

    if (beforeSequence !== undefined) {
      filter["sequence_number"] = { $lt: beforeSequence };
    } else if (afterSequence !== undefined) {
      filter["sequence_number"] = { $gt: afterSequence };
    }

    const messages = await MessageModel.find(filter)
      .sort({ sequence_number: -1 })
      .limit(limit + 1);

    const hasMore = messages.length > limit;
    return {
      messages: hasMore ? messages.slice(0, limit) : messages,
      hasMore,
    };
  }

  /** Elimina definitivamente tutti i messaggi di una conversazione dal DB. */
  async deleteAllByConversation(conversationId: mongoose.Types.ObjectId): Promise<number> {
    const result = await MessageModel.deleteMany({ conversation_id: conversationId });
    return result.deletedCount ?? 0;
  }
}
