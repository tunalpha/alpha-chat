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

  /**
   * Aggiorna last_read_at per l'utente nella conversazione.
   */
  async markRead(
    conversationId: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
    readAt: Date,
  ): Promise<void> {
    await ConversationMemberModel.updateOne(
      { conversation_id: conversationId, user_id: userId, deleted_at: null },
      { $set: { last_read_at: readAt } },
    );
  }

  /**
   * Imposta left_at = now per un membro (uscita dal gruppo).
   */
  async setLeftAt(
    conversationId: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
  ): Promise<void> {
    await ConversationMemberModel.updateOne(
      { conversation_id: conversationId, user_id: userId, deleted_at: null },
      { $set: { left_at: new Date() } },
    );
  }

  /**
   * Re-aggiunge un membro che aveva già lasciato il gruppo (reset left_at).
   */
  async rejoinMember(
    conversationId: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
  ): Promise<void> {
    await ConversationMemberModel.updateOne(
      { conversation_id: conversationId, user_id: userId },
      { $set: { left_at: null, joined_at: new Date() } },
    );
  }

  /**
   * Cambia il ruolo di un membro.
   */
  async setRole(
    conversationId: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
    role: MemberRole,
  ): Promise<void> {
    await ConversationMemberModel.updateOne(
      { conversation_id: conversationId, user_id: userId, deleted_at: null },
      { $set: { role } },
    );
  }

  /**
   * Lista tutti gli admin attivi di una conversazione.
   */
  async listAdmins(
    conversationId: mongoose.Types.ObjectId,
  ): Promise<IConversationMemberDocument[]> {
    return ConversationMemberModel.find({
      conversation_id: conversationId,
      role: "admin",
      deleted_at: null,
      left_at: null,
    });
  }

  /**
   * Ritorna tutti gli user_id che condividono almeno una conversazione
   * con userId (escluso userId stesso). Usato per broadcast presence.
   * Due query MongoDB — nessuna business logic.
   */
  async listContactUserIds(
    userId: mongoose.Types.ObjectId,
  ): Promise<string[]> {
    const memberships = await ConversationMemberModel.find(
      { user_id: userId, deleted_at: null, left_at: null },
      "conversation_id",
    ).lean();

    if (memberships.length === 0) return [];

    const convIds = memberships.map((m) => m.conversation_id);

    const contacts = await ConversationMemberModel.find(
      {
        conversation_id: { $in: convIds },
        user_id: { $ne: userId },
        deleted_at: null,
        left_at: null,
      },
      "user_id",
    ).lean();

    // Deduplica (un utente può essere in più conversazioni condivise)
    return [...new Set(contacts.map((c) => c.user_id.toString()))];
  }
}
