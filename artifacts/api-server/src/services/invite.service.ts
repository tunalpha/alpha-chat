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
const DEFAULT_EXPIRES_SECONDS = 900; // 15 minuti
const MAX_EXPIRES_SECONDS = 3600;    // 1 ora max

/**
 * Rate limit riscatto codici invito:
 *   - 10 tentativi per IP ogni 10 minuti
 *   - Si conta SOLO su codice inesistente (brute-force protection)
 *   - Codice scaduto/già usato → errore specifico, senza consumare quota
 */
const REDEEM_WINDOW_SECONDS = 600;
const REDEEM_MAX_ATTEMPTS = 10;

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

/**
 * Controlla se l'IP ha superato la quota di tentativi falliti.
 * @returns secondi rimanenti nella finestra se bloccato, 0 altrimenti
 */
async function getRateLimitRetryAfter(ipHash: string): Promise<number> {
  const redis = await getRedisOrFallback();
  const key = `invite_redeem:${ipHash}`;
  const raw = await redis.get(key);
  const count = parseInt(raw ?? "0", 10);
  if (count >= REDEEM_MAX_ATTEMPTS) {
    const remaining = await redis.ttl(key);
    return remaining > 0 ? remaining : REDEEM_WINDOW_SECONDS;
  }
  return 0;
}

/**
 * Incrementa il contatore dei tentativi falliti per questo IP.
 * Chiamato SOLO quando il codice non esiste (brute-force).
 */
async function incrementFailedAttempt(ipHash: string): Promise<void> {
  const redis = await getRedisOrFallback();
  const key = `invite_redeem:${ipHash}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, REDEEM_WINDOW_SECONDS);
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
    // ── 1. Controlla rate limit (senza incrementare ancora) ──────────────────
    const retryAfter = await getRateLimitRetryAfter(params.ipHash);
    if (retryAfter > 0) {
      throw new AppError("RATE_LIMIT_EXCEEDED", 429, undefined, { retryAfterSeconds: retryAfter });
    }

    const codeHash = hashCode(params.rawCode);

    // ── 2. Cerca il codice (qualsiasi stato) ─────────────────────────────────
    const anyInvite = await inviteRepo.findAnyByHash(codeHash);

    if (!anyInvite) {
      // Codice inesistente → consuma quota (potenziale brute-force)
      await incrementFailedAttempt(params.ipHash);
      logAuditEvent({
        event: "INVITE_REDEEM_FAILED",
        user_id: params.redeemerId,
        request_id: params.requestId,
        ip_hash: params.ipHash,
        created_at: new Date().toISOString(),
        metadata: { reason: "not_found" },
      });
      throw new AppError("INVITE_INVALID", 400);
    }

    // ── 3. Codice trovato: distingui i casi senza consumare quota ─────────────
    const now = new Date();
    if (anyInvite.used) {
      logAuditEvent({
        event: "INVITE_REDEEM_FAILED",
        user_id: params.redeemerId,
        request_id: params.requestId,
        ip_hash: params.ipHash,
        created_at: new Date().toISOString(),
        metadata: { reason: "already_used" },
      });
      throw new AppError("INVITE_ALREADY_USED", 400);
    }
    if (anyInvite.expires_at <= now) {
      logAuditEvent({
        event: "INVITE_REDEEM_FAILED",
        user_id: params.redeemerId,
        request_id: params.requestId,
        ip_hash: params.ipHash,
        created_at: new Date().toISOString(),
        metadata: { reason: "expired" },
      });
      throw new AppError("INVITE_EXPIRED", 400);
    }

    // ── 4. Codice valido ─────────────────────────────────────────────────────
    const invite = anyInvite; // a questo punto è non-usato e non scaduto

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
