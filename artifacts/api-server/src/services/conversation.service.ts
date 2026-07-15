/**
 * ConversationService — logica di business per conversazioni.
 *
 * Sprint 5B: Chat Creation
 *   - createDirectConversation()  → trova o crea chat diretta (idempotente)
 *   - listConversations()         → lista conversazioni ordinate per last_activity_at
 *
 * Regole business:
 *   - Una sola chat diretta tra due utenti (idempotenza garantita dal repository)
 *   - Il creatore non può aprire chat con sé stesso
 *   - Il target deve essere un utente attivo
 *   - La chat diretta ha esattamente 2 membri
 */

import mongoose from "mongoose";
import { AppError } from "../errors/AppError";
import { UserRepository } from "../repositories/user.repository";
import { ConversationRepository } from "../repositories/conversation.repository";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { ConversationModel } from "../models/conversation.model";
import { UserModel } from "../models/user.model";
import { MessageModel } from "../models/message.model";
import { logAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";
import { wsManager } from "../lib/ws-manager";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
  role: "admin" | "member";
  joined_at: string;
}

export interface ConversationResult {
  conversation_id: string;
  type: "direct" | "group" | "channel";
  /** Null per chat dirette (la "controparte" è in members) */
  name: string | null;
  created_at: string;
  last_activity_at: string;
  member_count: number;
  members: ConversationMember[];
  is_new: boolean;
}

export interface LastMessagePreview {
  message_id: string;
  sender_id: string;
  /** ciphertext opaco — il server non lo decrittografa mai */
  ciphertext: string;
  sent_at: string;
}

export interface ConversationListItem {
  conversation_id: string;
  type: "direct" | "group" | "channel";
  name: string | null;
  /** Profilo dell'altra persona (solo per direct) */
  other_user: {
    user_id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    is_verified: boolean;
  } | null;
  last_message_at: string | null;
  last_activity_at: string;
  member_count: number;
  is_pinned: boolean;
  is_archived: boolean;
  is_muted: boolean;
  unread_count: number;
  last_message_preview: LastMessagePreview | null;
  /** ISO timestamp dell'ultima lettura dell'ALTRO utente (per le ✓✓ read receipts) */
  other_user_last_read_at: string | null;
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

const userRepo = new UserRepository();
const convRepo = new ConversationRepository();
const memberRepo = new ConversationMemberRepository();

// ---------------------------------------------------------------------------
// createDirectConversation
// ---------------------------------------------------------------------------

/**
 * Trova o crea una chat diretta tra l'utente corrente e il target username.
 * Idempotente: chiamate multiple restituiscono la stessa conversazione.
 *
 * @throws USER_NOT_FOUND se il target non esiste o non è attivo
 * @throws CANNOT_CHAT_WITH_SELF se si tenta di aprire una chat con sé stessi
 */
export async function createDirectConversation(
  initiatorId: string,
  targetUsername: string,
  context?: { requestId?: string },
): Promise<ConversationResult> {
  const initiatorObjectId = new mongoose.Types.ObjectId(initiatorId);

  // 1. Trova il target
  const targetUser = await userRepo.findByUsername(targetUsername);
  if (!targetUser || targetUser.status !== "active") {
    throw new AppError("USER_NOT_FOUND", 404);
  }

  if (targetUser._id.toString() === initiatorId) {
    throw new AppError("CANNOT_CHAT_WITH_SELF", 400);
  }

  // 2. Cerca conversazione diretta esistente
  const existing = await convRepo.findDirectBetween(initiatorObjectId, targetUser._id);

  if (existing) {
    logger.debug(
      { conversationId: existing._id.toString(), initiatorId, targetId: targetUser._id.toString() },
      "Existing direct conversation found",
    );

    // Recupera members per la risposta
    const members = await buildMemberList(existing._id, [initiatorObjectId, targetUser._id]);
    return formatConversationResult(existing, members, false);
  }

  // 3. Crea nuova conversazione
  const conversation = await convRepo.create({
    type: "direct",
    createdBy: initiatorObjectId,
    memberCount: 0,
  });

  // 4. Aggiungi entrambi i membri
  await Promise.all([
    memberRepo.addMember({ conversationId: conversation._id, userId: initiatorObjectId }),
    memberRepo.addMember({ conversationId: conversation._id, userId: targetUser._id }),
  ]);

  // 5. Aggiorna member_count
  await ConversationModel.updateOne(
    { _id: conversation._id },
    { member_count: 2, last_activity_at: new Date() },
  );

  // Audit
  logAuditEvent({
    event: "CONVERSATION_CREATED",
    user_id: initiatorId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata: {
      conversation_id: conversation._id.toString(),
      type: "direct",
      target_user_id: targetUser._id.toString(),
    },
  });

  logger.info(
    { conversationId: conversation._id.toString(), initiatorId, targetId: targetUser._id.toString() },
    "Direct conversation created",
  );

  const members = await buildMemberList(conversation._id, [initiatorObjectId, targetUser._id]);
  const fresh = await convRepo.findById(conversation._id);
  return formatConversationResult(fresh ?? conversation, members, true);
}

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

/**
 * Lista le conversazioni attive dell'utente, ordinate per last_activity_at desc.
 * Per le chat dirette include il profilo dell'altra persona.
 */
export async function listConversations(
  userId: string,
  options: { limit?: number } = {},
): Promise<ConversationListItem[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const { limit = 30 } = options;

  // 1. Membership records dell'utente
  const memberships = await memberRepo.listByUser(userObjectId, { limit });

  if (memberships.length === 0) return [];

  const convIds = memberships.map((m) => m.conversation_id);

  // 2. Fetch conversazioni
  const conversations = await ConversationModel.find({
    _id: { $in: convIds },
    deleted_at: null,
  }).sort({ last_activity_at: -1 });

  if (conversations.length === 0) return [];

  // 3. Per le chat dirette: fetch dell'altro utente
  // Trova tutti i membri di tutte le conversazioni dirette in un'unica query
  const directConvIds = conversations
    .filter((c) => c.type === "direct")
    .map((c) => c._id);

  const allDirectMembers =
    directConvIds.length > 0
      ? await memberRepo.listByUser(userObjectId, { limit: 200 })
      : [];

  // Mappa conversationId → other member + last_read_at
  const otherMembersMap: Map<string, { userId: mongoose.Types.ObjectId; lastReadAt: Date | null }> = new Map();

  if (directConvIds.length > 0) {
    const { ConversationMemberModel } = await import("../models/conversation-member.model");
    const otherMembers = await ConversationMemberModel.find({
      conversation_id: { $in: directConvIds },
      user_id: { $ne: userObjectId },
      deleted_at: null,
    }).lean();

    for (const m of otherMembers) {
      otherMembersMap.set(m.conversation_id.toString(), {
        userId: m.user_id,
        lastReadAt: m.last_read_at ?? null,
      });
    }
  }

  // 4. Fetch profili altri utenti (direct chats)
  const otherUserIds = [...otherMembersMap.values()].map((m) => m.userId);
  const otherUsers =
    otherUserIds.length > 0
      ? await UserModel.find({ _id: { $in: otherUserIds }, status: "active" }).lean()
      : [];

  const otherUserMap = new Map(otherUsers.map((u) => [u._id.toString(), u]));

  // 5. Mappa membership per lookup rapido
  const membershipMap = new Map(memberships.map((m) => [m.conversation_id.toString(), m]));

  // 6. Batch-fetch ultimi messaggi per anteprima
  const lastMessageIds = conversations
    .map((c) => c.last_message_id)
    .filter((id): id is mongoose.Types.ObjectId => id != null);

  const lastMessages =
    lastMessageIds.length > 0
      ? await MessageModel.find({ _id: { $in: lastMessageIds } })
          .select("_id conversation_id sender_id ciphertext sent_at")
          .lean()
      : [];

  const lastMessageMap = new Map(lastMessages.map((m) => [m.conversation_id.toString(), m]));

  // 7. Conta messaggi non letti per ciascuna conversazione
  //    Non letti = messaggi con sent_at > membership.last_read_at, mittente ≠ me
  const convIdsWithLastRead = conversations.map((c) => {
    const m = membershipMap.get(c._id.toString());
    return { convId: c._id, lastReadAt: m?.last_read_at ?? null };
  });

  const unreadAgg: { _id: string; count: number }[] = await MessageModel.aggregate([
    {
      $match: {
        $or: convIdsWithLastRead.map(({ convId, lastReadAt }) => ({
          conversation_id: convId,
          sender_id: { $ne: userObjectId },
          ...(lastReadAt ? { sent_at: { $gt: lastReadAt } } : {}),
        })),
      },
    },
    {
      $group: { _id: { $toString: "$conversation_id" }, count: { $sum: 1 } },
    },
  ]);

  const unreadMap = new Map(unreadAgg.map((r) => [r._id, r.count]));

  // 8. Assembla risultato
  return conversations.map((conv) => {
    const membership = membershipMap.get(conv._id.toString());
    const otherMemberInfo = otherMembersMap.get(conv._id.toString());
    const otherUser = otherMemberInfo
      ? otherUserMap.get(otherMemberInfo.userId.toString())
      : undefined;
    const lastMsg = lastMessageMap.get(conv._id.toString());
    const otherMember = otherMembersMap.get(conv._id.toString());

    return {
      conversation_id: conv._id.toString(),
      type: conv.type,
      name: conv.name,
      other_user: otherUser
        ? {
            user_id: otherUser._id.toString(),
            username: otherUser.username,
            display_name: otherUser.display_name,
            avatar_url: null,
            is_verified: otherUser.is_verified,
          }
        : null,
      last_message_at: conv.last_message_at?.toISOString() ?? null,
      last_activity_at: conv.last_activity_at.toISOString(),
      member_count: conv.member_count,
      is_pinned: membership?.pinned ?? false,
      is_archived: membership?.archived ?? false,
      is_muted: membership?.is_muted ?? false,
      unread_count: unreadMap.get(conv._id.toString()) ?? 0,
      last_message_preview: lastMsg
        ? {
            message_id: lastMsg._id.toString(),
            sender_id: lastMsg.sender_id.toString(),
            ciphertext: lastMsg.ciphertext ?? "",
            sent_at: lastMsg.sent_at.toISOString(),
          }
        : null,
      other_user_last_read_at: otherMember?.lastReadAt?.toISOString() ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// markConversationRead
// ---------------------------------------------------------------------------

/**
 * Marca come letti tutti i messaggi della conversazione per l'utente corrente.
 * Aggiorna last_read_at nella membership e invia read.receipt via WebSocket
 * agli altri membri.
 */
export async function markConversationRead(
  userId: string,
  conversationId: string,
): Promise<void> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const convObjectId = new mongoose.Types.ObjectId(conversationId);

  const now = new Date();
  await memberRepo.markRead(convObjectId, userObjectId, now);

  // Broadcast read.receipt ai membri che NON sono l'utente corrente
  const members = await memberRepo.listMembers(convObjectId);
  const recipientIds = members
    .map((m) => m.user_id.toString())
    .filter((id) => id !== userId);

  if (recipientIds.length > 0) {
    wsManager.sendToUsers(recipientIds, {
      type: "read.receipt",
      payload: {
        conversation_id: conversationId,
        user_id: userId,
        read_at: now.toISOString(),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildMemberList(
  conversationId: mongoose.Types.ObjectId,
  userIds: mongoose.Types.ObjectId[],
): Promise<ConversationMember[]> {
  const [members, users] = await Promise.all([
    memberRepo.listMembers(conversationId),
    UserModel.find({ _id: { $in: userIds } }).lean(),
  ]);

  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  return members.map((m) => {
    const u = userMap.get(m.user_id.toString());
    return {
      user_id: m.user_id.toString(),
      username: u?.username ?? "[deleted]",
      display_name: u?.display_name ?? "[deleted]",
      avatar_url: null,
      is_verified: u?.is_verified ?? false,
      role: m.role,
      joined_at: m.joined_at.toISOString(),
    };
  });
}

function formatConversationResult(
  conv: { _id: mongoose.Types.ObjectId; type: "direct" | "group" | "channel"; name: string | null; createdAt: Date; last_activity_at: Date; member_count: number },
  members: ConversationMember[],
  isNew: boolean,
): ConversationResult {
  return {
    conversation_id: conv._id.toString(),
    type: conv.type,
    name: conv.name,
    created_at: conv.createdAt.toISOString(),
    last_activity_at: conv.last_activity_at.toISOString(),
    member_count: conv.member_count,
    members,
    is_new: isNew,
  };
}
