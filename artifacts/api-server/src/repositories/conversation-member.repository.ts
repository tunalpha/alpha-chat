/**
 * ConversationMemberRepository — accesso al database per conversation_members.
 *
 * Regola architetturale: solo query MongoDB, nessuna business logic.
 */

import mongoose from "mongoose";
import {
  ConversationMemberModel,
  type IConversationMemberDocument,
  type MemberRole,
} from "../models/conversation-member.model";

export class ConversationMemberRepository {
  /**
   * Aggiunge un membro a una conversazione.
   */
  async addMember(params: {
    conversationId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    role?: MemberRole;
  }): Promise<IConversationMemberDocument> {
    return ConversationMemberModel.create({
      conversation_id: params.conversationId,
      user_id: params.userId,
      role: params.role ?? "member",
      joined_at: new Date(),
    });
  }

  /**
   * Trova il record di membership per (conversationId, userId).
   */
  async findMembership(
    conversationId: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
  ): Promise<IConversationMemberDocument | null> {
    return ConversationMemberModel.findOne({
      conversation_id: conversationId,
      user_id: userId,
      deleted_at: null,
    });
  }

  /**
   * Lista tutti i membri attivi di una conversazione.
   */
  async listMembers(
    conversationId: mongoose.Types.ObjectId,
  ): Promise<IConversationMemberDocument[]> {
    return ConversationMemberModel.find({
      conversation_id: conversationId,
      deleted_at: null,
      left_at: null,
    });
  }

  /**
   * Lista tutte le conversazioni attive di un utente, ordinate per last_activity_at desc.
   * Ritorna i documenti di membership (con conversation_id per popolazione successiva).
   */
  async listByUser(
    userId: mongoose.Types.ObjectId,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<IConversationMemberDocument[]> {
    const { limit = 30 } = options;

    return ConversationMemberModel.find({
      user_id: userId,
      deleted_at: null,
      left_at: null,
    })
      .sort({ pinned: -1, updatedAt: -1 })
      .limit(limit);
  }
}
