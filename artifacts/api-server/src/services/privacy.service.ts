/**
 * PrivacyService — impostazioni privacy utente (Sprint 15).
 *
 * - getPrivacySettings()       → restituisce le impostazioni correnti
 * - updatePrivacySettings()    → aggiorna i campi selezionati
 * - Ghost Mode integrato: se ghost_mode=true override tutto al massimo privacy
 *
 * Disappearing Messages:
 * - setDisappearingMessages()  → abilita/disabilita messaggi a scomparsa per conversazione
 */

import mongoose from "mongoose";
import { AppError } from "../errors/AppError";
import { UserRepository } from "../repositories/user.repository";
import { ConversationRepository } from "../repositories/conversation.repository";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { wsManager } from "../lib/ws-manager";
import { logger } from "../lib/logger";
import { logAuditEvent } from "../lib/audit";
import type { UpdatePrivacyInput, SetDisappearingInput } from "../validation/privacy.schemas";

const userRepo = new UserRepository();
const convRepo = new ConversationRepository();
const memberRepo = new ConversationMemberRepository();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrivacySettings {
  show_last_seen: "everyone" | "contacts" | "nobody";
  show_online_status: "everyone" | "contacts" | "nobody";
  show_read_receipts: boolean;
  allow_adding_to_groups: "everyone" | "contacts" | "nobody";
  allow_calls_from: "everyone" | "contacts" | "nobody";
  ghost_mode: boolean;
}

export interface DisappearingSettings {
  enabled: boolean;
  duration_ms: number | null;
}

// ---------------------------------------------------------------------------
// Privacy settings
// ---------------------------------------------------------------------------

export async function getPrivacySettings(userId: string): Promise<PrivacySettings> {
  const user = await userRepo.findById(userId);
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  return {
    show_last_seen:         user.privacy.show_last_seen,
    show_online_status:     user.privacy.show_online_status,
    show_read_receipts:     user.privacy.show_read_receipts,
    allow_adding_to_groups: user.privacy.allow_adding_to_groups,
    allow_calls_from:       user.privacy.allow_calls_from,
    ghost_mode:             user.privacy.ghost_mode,
  };
}

export async function updatePrivacySettings(
  userId: string,
  input: UpdatePrivacyInput,
  context?: { requestId?: string },
): Promise<PrivacySettings> {
  const user = await userRepo.findById(userId);
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  // Ghost Mode master toggle: sovrascrive tutto al massimo della privacy
  if (input.ghost_mode === true) {
    user.privacy.show_last_seen         = "nobody";
    user.privacy.show_online_status     = "nobody";
    user.privacy.show_read_receipts     = false;
    user.privacy.allow_adding_to_groups = "nobody";
    user.privacy.allow_calls_from       = "nobody";
    user.privacy.ghost_mode             = true;
  } else if (input.ghost_mode === false) {
    // Disabilita ghost mode — ripristina defaults ragionevoli
    user.privacy.show_last_seen         = "contacts";
    user.privacy.show_online_status     = "contacts";
    user.privacy.show_read_receipts     = true;
    user.privacy.allow_adding_to_groups = "contacts";
    user.privacy.allow_calls_from       = "contacts";
    user.privacy.ghost_mode             = false;
  } else {
    // Aggiornamento selettivo dei campi
    if (input.show_last_seen         !== undefined) user.privacy.show_last_seen         = input.show_last_seen;
    if (input.show_online_status     !== undefined) user.privacy.show_online_status     = input.show_online_status;
    if (input.show_read_receipts     !== undefined) user.privacy.show_read_receipts     = input.show_read_receipts;
    if (input.allow_adding_to_groups !== undefined) user.privacy.allow_adding_to_groups = input.allow_adding_to_groups;
    if (input.allow_calls_from       !== undefined) user.privacy.allow_calls_from       = input.allow_calls_from;

    // Aggiorna ghost_mode automaticamente se tutti i campi sono al massimo
    const allMax =
      user.privacy.show_last_seen         === "nobody" &&
      user.privacy.show_online_status     === "nobody" &&
      !user.privacy.show_read_receipts                 &&
      user.privacy.allow_adding_to_groups === "nobody" &&
      user.privacy.allow_calls_from       === "nobody";
    user.privacy.ghost_mode = allMax;
  }

  await user.save();

  logAuditEvent({
    event: "PRIVACY_SETTINGS_UPDATED",
    user_id: userId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata: { ghost_mode: user.privacy.ghost_mode },
  });

  logger.info({ userId, ghost_mode: user.privacy.ghost_mode }, "Privacy settings updated");

  return {
    show_last_seen:         user.privacy.show_last_seen,
    show_online_status:     user.privacy.show_online_status,
    show_read_receipts:     user.privacy.show_read_receipts,
    allow_adding_to_groups: user.privacy.allow_adding_to_groups,
    allow_calls_from:       user.privacy.allow_calls_from,
    ghost_mode:             user.privacy.ghost_mode,
  };
}

// ---------------------------------------------------------------------------
// Disappearing messages
// ---------------------------------------------------------------------------

export async function setDisappearingMessages(
  userId: string,
  conversationId: string,
  input: SetDisappearingInput,
  context?: { requestId?: string },
): Promise<DisappearingSettings> {
  const convObjectId = new mongoose.Types.ObjectId(conversationId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 1. Verifica membership
  const membership = await memberRepo.findMembership(convObjectId, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  // 2. Verifica conversazione
  const conv = await convRepo.findById(convObjectId);
  if (!conv) throw new AppError("CHAT_NOT_FOUND", 404);

  // 3. Aggiorna
  conv.disappearing_messages_enabled  = input.enabled;
  conv.disappearing_messages_duration = input.enabled ? (input.duration_ms ?? null) : null;
  await conv.save();

  logAuditEvent({
    event: "DISAPPEARING_MESSAGES_SET",
    user_id: userId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata: { conversationId, enabled: input.enabled, duration_ms: input.duration_ms },
  });

  // 4. Broadcast ai membri via WS
  void (async () => {
    try {
      const members    = await memberRepo.listMembers(convObjectId);
      const memberIds  = members.map((m) => m.user_id.toString());
      wsManager.sendToUsers(memberIds, {
        type: "conversation.disappearing_updated",
        payload: {
          conversation_id: conversationId,
          enabled:         conv.disappearing_messages_enabled,
          duration_ms:     conv.disappearing_messages_duration,
          updated_by:      userId,
        },
      });
    } catch (err) {
      logger.warn({ err }, "WS broadcast conversation.disappearing_updated failed");
    }
  })();

  return {
    enabled:     conv.disappearing_messages_enabled,
    duration_ms: conv.disappearing_messages_duration,
  };
}
