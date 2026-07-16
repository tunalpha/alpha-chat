/**
 * BlockService — blocco utenti (Sprint 15).
 *
 * - blockUser()    → blocca un utente
 * - unblockUser()  → sblocca un utente
 * - listBlocked()  → lista utenti bloccati (con profilo pubblico minimale)
 * - isBlocked()    → check direzionale
 */

import mongoose from "mongoose";
import { AppError } from "../errors/AppError";
import { BlockRepository } from "../repositories/block.repository";
import { UserRepository } from "../repositories/user.repository";
import { logAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";

const blockRepo = new BlockRepository();
const userRepo  = new UserRepository();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlockedUserEntry {
  user_id: string;
  username: string;
  display_name: string;
  blocked_at: string;
}

// ---------------------------------------------------------------------------
// blockUser
// ---------------------------------------------------------------------------

export async function blockUser(
  blockerId: string,
  targetUserId: string,
  context?: { requestId?: string },
): Promise<void> {
  if (blockerId === targetUserId) {
    throw new AppError("CANNOT_BLOCK_SELF", 400);
  }

  const blockerObjectId = new mongoose.Types.ObjectId(blockerId);
  const targetObjectId  = new mongoose.Types.ObjectId(targetUserId);

  // Verifica che il target esista
  const target = await userRepo.findById(targetUserId);
  if (!target || target.status !== "active") {
    throw new AppError("USER_NOT_FOUND", 404);
  }

  await blockRepo.block(blockerObjectId, targetObjectId);
  // Idempotente: se già bloccato non è un errore

  logAuditEvent({
    event:      "USER_BLOCKED",
    user_id:    blockerId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata:   { target_user_id: targetUserId },
  });

  logger.info({ blockerId, targetUserId }, "User blocked");
}

// ---------------------------------------------------------------------------
// unblockUser
// ---------------------------------------------------------------------------

export async function unblockUser(
  blockerId: string,
  targetUserId: string,
  context?: { requestId?: string },
): Promise<void> {
  const blockerObjectId = new mongoose.Types.ObjectId(blockerId);
  const targetObjectId  = new mongoose.Types.ObjectId(targetUserId);

  await blockRepo.unblock(blockerObjectId, targetObjectId);
  // Idempotente: se non bloccato non è un errore

  logAuditEvent({
    event:      "USER_UNBLOCKED",
    user_id:    blockerId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata:   { target_user_id: targetUserId },
  });

  logger.info({ blockerId, targetUserId }, "User unblocked");
}

// ---------------------------------------------------------------------------
// listBlocked
// ---------------------------------------------------------------------------

export async function listBlocked(
  userId: string,
): Promise<BlockedUserEntry[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const blocks = await blockRepo.listBlocked(userObjectId);

  if (blocks.length === 0) return [];

  // Batch-fetch profili degli utenti bloccati
  const blockedIds = blocks.map((b) => b.blocked_id);
  const users = await userRepo.findByIds(blockedIds);
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  return blocks.map((block) => {
    const u = userMap.get(block.blocked_id.toString());
    return {
      user_id:      block.blocked_id.toString(),
      username:     u?.username     ?? "[deleted]",
      display_name: u?.display_name ?? "[deleted]",
      blocked_at:   block.createdAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// isBlocked
// ---------------------------------------------------------------------------

export async function isBlocked(
  blockerId: string,
  targetUserId: string,
): Promise<boolean> {
  return blockRepo.isBlocked(
    new mongoose.Types.ObjectId(blockerId),
    new mongoose.Types.ObjectId(targetUserId),
  );
}
