/**
 * GroupService — business logic per gruppi E2E — Sprint 21.
 *
 * Usa il modello Conversation esistente (type: "group") e ConversationMember
 * già predisposti, con error-codes già definiti (NOT_GROUP_ADMIN, ALREADY_MEMBER,
 * GROUP_FULL).
 */

import mongoose from "mongoose";
import { AppError } from "../errors/AppError";
import { ConversationRepository } from "../repositories/conversation.repository";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { UserRepository } from "../repositories/user.repository";
import { logAuditEvent } from "../lib/audit";
import type {
  CreateGroupInput,
  UpdateGroupInput,
  AddMemberInput,
  ChangeRoleInput,
} from "../validation/group.schemas";

const convRepo   = new ConversationRepository();
const memberRepo = new ConversationMemberRepository();
const userRepo   = new UserRepository();

// ---------------------------------------------------------------------------
// Tipi output
// ---------------------------------------------------------------------------

export interface GroupMemberInfo {
  user_id:      string;
  username:     string;
  display_name: string;
  role:         "admin" | "member";
  joined_at:    string;
}

export interface GroupDetail {
  group_id:     string;
  name:         string;
  description:  string;
  member_count: number;
  max_members:  number;
  created_by:   string;
  created_at:   string;
  my_role:      "admin" | "member";
  members:      GroupMemberInfo[];
}

// ---------------------------------------------------------------------------
// createGroup
// ---------------------------------------------------------------------------

export async function createGroup(
  creatorId: string,
  input: CreateGroupInput,
  context?: { requestId?: string },
): Promise<GroupDetail> {
  const creatorObjectId = new mongoose.Types.ObjectId(creatorId);

  // Risolvi username → userId per tutti i membri
  const memberDocs = await Promise.all(
    input.member_usernames.map(async (username) => {
      const u = await userRepo.findByUsername(username);
      if (!u) throw new AppError("USER_NOT_FOUND", 404);
      return u;
    }),
  );

  // Deduplica (no auto-add creatore duplicato)
  const uniqueIds = new Set(memberDocs.map((u) => u._id.toString()));
  uniqueIds.delete(creatorId); // lo aggiungiamo come admin
  const memberIds = [...uniqueIds].map((id) => new mongoose.Types.ObjectId(id));

  const totalCount = memberIds.length + 1; // + creatore
  if (totalCount > 256) throw new AppError("GROUP_FULL", 400);

  // Crea conversazione
  const conv = await convRepo.create({
    type:        "group",
    createdBy:   creatorObjectId,
    memberCount: totalCount,
    name:        input.name,
    description: input.description,
  });

  // Aggiungi creatore come admin
  await memberRepo.addMember({
    conversationId: conv._id as mongoose.Types.ObjectId,
    userId:         creatorObjectId,
    role:           "admin",
  });

  // Aggiungi gli altri come member
  await Promise.all(
    memberIds.map((uid) =>
      memberRepo.addMember({
        conversationId: conv._id as mongoose.Types.ObjectId,
        userId:         uid,
        role:           "member",
      }),
    ),
  );

  logAuditEvent({
    event:      "GROUP_CREATED",
    user_id:    creatorId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata:   { group_id: conv._id.toString(), name: input.name, members: totalCount },
  });

  return getGroupDetail(creatorId, conv._id.toString());
}

// ---------------------------------------------------------------------------
// getGroupDetail (helper interno + esposto)
// ---------------------------------------------------------------------------

export async function getGroupDetail(
  requesterId: string,
  groupId: string,
): Promise<GroupDetail> {
  const groupObjectId = new mongoose.Types.ObjectId(groupId);
  const conv = await convRepo.findById(groupObjectId);
  if (!conv || conv.type !== "group") throw new AppError("CHAT_NOT_FOUND", 404);

  const requesterObjectId = new mongoose.Types.ObjectId(requesterId);
  const myMembership = await memberRepo.findMembership(groupObjectId, requesterObjectId);
  if (!myMembership || myMembership.left_at !== null) throw new AppError("CHAT_NOT_FOUND", 404);

  const members = await memberRepo.listMembers(groupObjectId);
  const userIds  = members.map((m) => m.user_id);
  const users    = await userRepo.findByIds(userIds.map((id) => new mongoose.Types.ObjectId(id.toString())));
  const userMap  = new Map(users.map((u) => [u._id.toString(), u]));

  const memberInfos: GroupMemberInfo[] = members.map((m) => {
    const u = userMap.get(m.user_id.toString());
    return {
      user_id:      m.user_id.toString(),
      username:     u?.username     ?? "",
      display_name: u?.display_name ?? "",
      role:         m.role as "admin" | "member",
      joined_at:    (m.joined_at ?? m.createdAt ?? new Date()).toISOString(),
    };
  });

  return {
    group_id:     conv._id.toString(),
    name:         (conv as any).name        ?? "",
    description:  (conv as any).description ?? "",
    member_count: conv.member_count,
    max_members:  conv.max_members,
    created_by:   conv.created_by?.toString() ?? "",
    created_at:   (conv.createdAt ?? new Date()).toISOString(),
    my_role:      myMembership.role as "admin" | "member",
    members:      memberInfos,
  };
}

// ---------------------------------------------------------------------------
// updateGroup
// ---------------------------------------------------------------------------

export async function updateGroup(
  adminId: string,
  groupId: string,
  input: UpdateGroupInput,
  context?: { requestId?: string },
): Promise<GroupDetail> {
  await assertAdmin(adminId, groupId);
  await convRepo.updateGroupMeta(new mongoose.Types.ObjectId(groupId), {
    name:        input.name,
    description: input.description,
  });
  logAuditEvent({
    event: "GROUP_UPDATED", user_id: adminId, request_id: context?.requestId,
    created_at: new Date().toISOString(), metadata: { group_id: groupId },
  });
  return getGroupDetail(adminId, groupId);
}

// ---------------------------------------------------------------------------
// deleteGroup
// ---------------------------------------------------------------------------

export async function deleteGroup(
  adminId: string,
  groupId: string,
  context?: { requestId?: string },
): Promise<void> {
  await assertAdmin(adminId, groupId);
  await convRepo.softDelete(new mongoose.Types.ObjectId(groupId));
  logAuditEvent({
    event: "GROUP_DELETED", user_id: adminId, request_id: context?.requestId,
    created_at: new Date().toISOString(), metadata: { group_id: groupId },
  });
}

// ---------------------------------------------------------------------------
// addMember
// ---------------------------------------------------------------------------

export async function addMember(
  adminId: string,
  groupId: string,
  input: AddMemberInput,
  context?: { requestId?: string },
): Promise<GroupMemberInfo> {
  await assertAdmin(adminId, groupId);

  const groupObjectId = new mongoose.Types.ObjectId(groupId);
  const conv = await convRepo.findById(groupObjectId);
  if (!conv) throw new AppError("CHAT_NOT_FOUND", 404);
  if (conv.member_count >= conv.max_members) throw new AppError("GROUP_FULL", 400);

  const user = await userRepo.findByUsername(input.username);
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  const userObjectId = user._id as mongoose.Types.ObjectId;
  const existing = await memberRepo.findMembership(groupObjectId, userObjectId);
  if (existing && existing.left_at === null) throw new AppError("ALREADY_MEMBER", 409);

  // Re-add se aveva lasciato il gruppo
  if (existing && existing.left_at !== null) {
    await memberRepo.rejoinMember(groupObjectId, userObjectId);
  } else {
    await memberRepo.addMember({ conversationId: groupObjectId, userId: userObjectId, role: "member" });
  }
  await convRepo.incrementMemberCount(groupObjectId, 1);

  logAuditEvent({
    event: "GROUP_MEMBER_ADDED", user_id: adminId, request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata: { group_id: groupId, added_user: user._id.toString() },
  });

  return {
    user_id:      user._id.toString(),
    username:     user.username,
    display_name: user.display_name,
    role:         "member",
    joined_at:    new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

export async function removeMember(
  adminId: string,
  groupId: string,
  targetUserId: string,
  context?: { requestId?: string },
): Promise<void> {
  // Non puoi rimuovere te stesso con questa API (usa leaveGroup)
  if (adminId === targetUserId) throw new AppError("NOT_GROUP_ADMIN", 403);
  await assertAdmin(adminId, groupId);

  const groupObjectId  = new mongoose.Types.ObjectId(groupId);
  const targetObjectId = new mongoose.Types.ObjectId(targetUserId);
  const membership = await memberRepo.findMembership(groupObjectId, targetObjectId);
  if (!membership || membership.left_at !== null) throw new AppError("USER_NOT_FOUND", 404);

  await memberRepo.setLeftAt(groupObjectId, targetObjectId);
  await convRepo.incrementMemberCount(groupObjectId, -1);

  logAuditEvent({
    event: "GROUP_MEMBER_REMOVED", user_id: adminId, request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata: { group_id: groupId, removed_user: targetUserId },
  });
}

// ---------------------------------------------------------------------------
// leaveGroup
// ---------------------------------------------------------------------------

export async function leaveGroup(
  userId: string,
  groupId: string,
  context?: { requestId?: string },
): Promise<void> {
  const groupObjectId = new mongoose.Types.ObjectId(groupId);
  const userObjectId  = new mongoose.Types.ObjectId(userId);

  const membership = await memberRepo.findMembership(groupObjectId, userObjectId);
  if (!membership || membership.left_at !== null) throw new AppError("CHAT_NOT_FOUND", 404);

  // Se è l'ultimo admin, blocca (il gruppo rimarrebbe senza admin)
  if (membership.role === "admin") {
    const admins = await memberRepo.listAdmins(groupObjectId);
    if (admins.length <= 1) {
      // C'è un solo admin — promuovi prima un altro membro
      const others = await memberRepo.listMembers(groupObjectId);
      const nextMember = others.find((m) => m.user_id.toString() !== userId);
      if (!nextMember) {
        // Solo il creatore rimasto — elimina il gruppo
        await convRepo.softDelete(groupObjectId);
        await memberRepo.setLeftAt(groupObjectId, userObjectId);
        return;
      }
      await memberRepo.setRole(groupObjectId, nextMember.user_id as mongoose.Types.ObjectId, "admin");
    }
  }

  await memberRepo.setLeftAt(groupObjectId, userObjectId);
  await convRepo.incrementMemberCount(groupObjectId, -1);

  logAuditEvent({
    event: "GROUP_LEFT", user_id: userId, request_id: context?.requestId,
    created_at: new Date().toISOString(), metadata: { group_id: groupId },
  });
}

// ---------------------------------------------------------------------------
// changeRole
// ---------------------------------------------------------------------------

export async function changeRole(
  adminId: string,
  groupId: string,
  targetUserId: string,
  input: ChangeRoleInput,
  context?: { requestId?: string },
): Promise<void> {
  if (adminId === targetUserId) throw new AppError("NOT_GROUP_ADMIN", 403);
  await assertAdmin(adminId, groupId);

  const groupObjectId  = new mongoose.Types.ObjectId(groupId);
  const targetObjectId = new mongoose.Types.ObjectId(targetUserId);

  const membership = await memberRepo.findMembership(groupObjectId, targetObjectId);
  if (!membership || membership.left_at !== null) throw new AppError("USER_NOT_FOUND", 404);

  await memberRepo.setRole(groupObjectId, targetObjectId, input.role);

  logAuditEvent({
    event: "GROUP_ROLE_CHANGED", user_id: adminId, request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata: { group_id: groupId, target: targetUserId, new_role: input.role },
  });
}

// ---------------------------------------------------------------------------
// Helper — verifica che userId sia admin del gruppo
// ---------------------------------------------------------------------------

async function assertAdmin(userId: string, groupId: string): Promise<void> {
  const groupObjectId = new mongoose.Types.ObjectId(groupId);
  const userObjectId  = new mongoose.Types.ObjectId(userId);
  const conv = await convRepo.findById(groupObjectId);
  if (!conv || conv.type !== "group") throw new AppError("CHAT_NOT_FOUND", 404);
  const membership = await memberRepo.findMembership(groupObjectId, userObjectId);
  if (!membership || membership.left_at !== null || membership.role !== "admin") {
    throw new AppError("NOT_GROUP_ADMIN", 403);
  }
}
