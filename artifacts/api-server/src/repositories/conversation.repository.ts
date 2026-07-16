/**
 * ConversationRepository — accesso al database per la collection conversations.
 *
 * Regola architetturale (07_Backend_Standards.md):
 * Solo query MongoDB. Nessuna business logic.
 */

import mongoose from "mongoose";
import {
  ConversationModel,
  type IConversationDocument,
  type ConversationType,
} from "../models/conversation.model";
import { ConversationMemberModel } from "../models/conversation-member.model";

export class ConversationRepository {
  /**
   * Trova una conversazione diretta esistente tra due utenti.
   * Algoritmo:
   *   1. Prendi i conversation_ids dove userId è membro attivo
   *   2. Tra quelli, trova la conversazione direct dove otherUserId è anche membro attivo
   * Complessità: O(1) con indici su conversation_id+user_id.
   */
  async findDirectBetween(
    userId: mongoose.Types.ObjectId,
    otherUserId: mongoose.Types.ObjectId,
  ): Promise<IConversationDocument | null> {
    // Step 1: conversation_ids dove userId è membro
    const myMemberships = await ConversationMemberModel.find(
      { user_id: userId, deleted_at: null, left_at: null },
      { conversation_id: 1 },
    ).lean();

    if (myMemberships.length === 0) return null;

    const myConvIds = myMemberships.map((m) => m.conversation_id);

    // Step 2: tra quei conversation_ids, trova dove otherUserId è anche membro
    const sharedMembership = await ConversationMemberModel.findOne({
      user_id: otherUserId,
      conversation_id: { $in: myConvIds },
      deleted_at: null,
      left_at: null,
    }).lean();

    if (!sharedMembership) return null;

    // Step 3: verifica che la conversazione sia di tipo 'direct'
    return ConversationModel.findOne({
      _id: sharedMembership.conversation_id,
      type: "direct",
      deleted_at: null,
    });
  }

  /**
   * Crea una nuova conversazione.
   */
  async create(params: {
    type: ConversationType;
    createdBy: mongoose.Types.ObjectId;
    memberCount?: number;
  }): Promise<IConversationDocument> {
    return ConversationModel.create({
      type: params.type,
      created_by: params.createdBy,
      member_count: params.memberCount ?? 0,
      last_activity_at: new Date(),
    });
  }

  /**
   * Trova una conversazione per ID.
   */
  async findById(id: mongoose.Types.ObjectId): Promise<IConversationDocument | null> {
    return ConversationModel.findOne({ _id: id, deleted_at: null });
  }

  /**
   * Aggiorna last_message_id, last_message_at e last_activity_at.
   * Chiamato dopo Secure Destroy per puntare al messaggio precedente.
   * Se prevMsg è null la conversazione non ha più messaggi → campi a null.
   */
  async updateLastMessage(
    conversationId: mongoose.Types.ObjectId,
    prevMsg: { _id: mongoose.Types.ObjectId; server_received_at: Date } | null,
  ): Promise<void> {
    await ConversationModel.updateOne(
      { _id: conversationId },
      {
        $set: {
          last_message_id:  prevMsg ? prevMsg._id           : null,
          last_message_at:  prevMsg ? prevMsg.server_received_at : null,
          last_activity_at: new Date(),
        },
      },
    );
  }

  /**
   * Aggiorna member_count e last_activity_at atomicamente.
   */
  async incrementMemberCount(
    conversationId: mongoose.Types.ObjectId,
    delta: 1 | -1,
  ): Promise<void> {
    await ConversationModel.updateOne(
      { _id: conversationId },
      {
        $inc: { member_count: delta },
        $set: { last_activity_at: new Date() },
      },
    );
  }
}
