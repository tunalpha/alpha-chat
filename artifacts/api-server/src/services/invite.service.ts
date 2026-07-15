/**
 * Invite Service
 *
 * Genera codici monouso crittograficamente sicuri.
 * Salva SOLO l'hash SHA-256 — il codice grezzo non viene mai persistito.
 *
 * Flusso:
 *   1. generateInvite()  → restituisce rawCode (monouso, a breve vita)
 *   2. redeemInvite()    → valida hash, crea conversazione, invalida codice
 */

import { randomBytes, createHash } from "crypto";
import mongoose from "mongoose";
import { InviteRepository } from "../repositories/invite.repository";
import { createDirectConversation } from "./conversation.service";
import { logAuditEvent } from "../lib/audit";
import { AppError } from "../errors/AppError";
import { getRedisOrFallback } from "../lib/redis";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Alfabeto leggibile: niente I, O, 0, 1 (confusione visiva) */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 16;
const DEFAULT_EXPIRES_SECONDS = 300; // 5 minuti
const MAX_EXPIRES_SECONDS = 3600;    // 1 ora max

/** Rate limit: max 5 tentativi di riscatto per IP ogni 10 minuti */
const REDEEM_WINDOW_SECONDS = 600;
const REDEEM_MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRawCode(): string {
  const bytes = randomBytes(CODE_LENGTH * 2);
  let code = "";
  for (let i = 0; i < bytes.length && code.length < CODE_LENGTH; i++) {
    const idx = bytes[i]! % ALPHABET.length;
    code += ALPHABET[idx];
  }
  return code;
}

export function hashCode(raw: string): string {
  return createHash("sha256").update(raw.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

async function checkRedeemRateLimit(ipHash: string): Promise<void> {
  const redis = await getRedisOrFallback();
  const key = `invite_redeem:${ipHash}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, REDEEM_WINDOW_SECONDS);
  if (count > REDEEM_MAX_ATTEMPTS) {
    throw new AppError("RATE_LIMIT_EXCEEDED", 429);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const inviteRepo = new InviteRepository();

export class InviteService {
  /**
   * Genera un nuovo codice invito per un utente.
   * Invalida i vecchi codici non usati prima di crearne uno nuovo.
   *
   * @returns rawCode — il codice in chiaro da mostrare (mai salvato)
   */
  async generateInvite(params: {
    userId: string;
    expiresInSeconds?: number;
    requestId?: string;
  }): Promise<{ rawCode: string; expiresAt: Date; inviteId: string }> {
    const ownerId = new mongoose.Types.ObjectId(params.userId);
    const ttl = Math.min(
      params.expiresInSeconds ?? DEFAULT_EXPIRES_SECONDS,
      MAX_EXPIRES_SECONDS,
    );
    const expiresAt = new Date(Date.now() + ttl * 1000);

    // Cancella codici precedenti non usati
    const deleted = await inviteRepo.deleteAllActive(ownerId);
    if (deleted > 0) {
      logger.debug({ userId: params.userId, deleted }, "Previous active invites revoked");
    }

    const rawCode = generateRawCode();
    const codeHash = hashCode(rawCode);
    const invite = await inviteRepo.create({ codeHash, ownerId, expiresAt });

    logAuditEvent({
      event: "INVITE_GENERATED",
      user_id: params.userId,
      request_id: params.requestId,
      created_at: new Date().toISOString(),
      metadata: {
        invite_id: invite._id.toString(),
        expires_at: expiresAt.toISOString(),
        code_hash_prefix: codeHash.slice(0, 8),
      },
    });

    return { rawCode, expiresAt, inviteId: invite._id.toString() };
  }

  /**
   * Riscatta un codice invito.
   * Crea (o restituisce) la conversazione tra i due utenti.
   * Invalida il codice definitivamente.
   */
  async redeemInvite(params: {
    rawCode: string;
    redeemerId: string;
    ipHash: string;
    requestId?: string;
  }): Promise<{ conversation_id: string; is_new: boolean }> {
    await checkRedeemRateLimit(params.ipHash);

    const codeHash = hashCode(params.rawCode);
    const invite = await inviteRepo.findValidByHash(codeHash);

    if (!invite) {
      logAuditEvent({
        event: "INVITE_REDEEM_FAILED",
        user_id: params.redeemerId,
        request_id: params.requestId,
        ip_hash: params.ipHash,
        created_at: new Date().toISOString(),
        metadata: { reason: "not_found_or_expired" },
      });
      // Risposta generica — non rivelare se il codice esiste
      throw new AppError("INVITE_INVALID", 400);
    }

    // Non si può riscattare il proprio codice
    if (invite.owner_id.toString() === params.redeemerId) {
      throw new AppError("INVITE_SELF_REDEEM", 400);
    }

    const redeemerId = new mongoose.Types.ObjectId(params.redeemerId);

    // Atomic: protezione da race condition
    const marked = await inviteRepo.markUsed({ inviteId: invite._id, usedBy: redeemerId });
    if (!marked) {
      throw new AppError("INVITE_INVALID", 400);
    }

    // Recupera username del generatore e crea conversazione
    const ownerUsername = await this.getUsernameById(invite.owner_id.toString());
    const result = await createDirectConversation(
      params.redeemerId,
      ownerUsername,
      { requestId: params.requestId },
    );

    logAuditEvent({
      event: "INVITE_REDEEMED",
      user_id: params.redeemerId,
      request_id: params.requestId,
      ip_hash: params.ipHash,
      created_at: new Date().toISOString(),
      metadata: {
        invite_id: invite._id.toString(),
        owner_id: invite.owner_id.toString(),
        conversation_id: result.conversation_id,
        is_new: result.is_new,
      },
    });

    return { conversation_id: result.conversation_id, is_new: result.is_new };
  }

  /**
   * Revoca tutti i codici attivi dell'utente.
   */
  async revokeMyInvites(userId: string, requestId?: string): Promise<number> {
    const deleted = await inviteRepo.deleteAllActive(new mongoose.Types.ObjectId(userId));
    if (deleted > 0) {
      logAuditEvent({
        event: "INVITE_REVOKED",
        user_id: userId,
        request_id: requestId,
        created_at: new Date().toISOString(),
        metadata: { count: deleted },
      });
    }
    return deleted;
  }

  private async getUsernameById(userId: string): Promise<string> {
    const { UserModel } = await import("../models/user.model");
    const user = await UserModel.findById(userId).select("username").lean();
    if (!user) throw new AppError("USER_NOT_FOUND", 404);
    return user.username;
  }
}
