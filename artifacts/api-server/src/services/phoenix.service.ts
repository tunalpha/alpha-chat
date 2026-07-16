/**
 * Phoenix Service — Sprint 18
 */

import crypto from "node:crypto";
import mongoose from "mongoose";
import argon2 from "argon2";
import { UserModel } from "../models/user.model";
import { PhoenixTokenModel, type PhoenixAction } from "../models/phoenix-token.model";
import { UserPrekeysModel } from "../models/user-prekeys.model";
import { SignalKeyBundleModel } from "../models/signal-key-bundle.model";
import { ConversationModel } from "../models/conversation.model";
import { MessageModel } from "../models/message.model";
import { sendPhoenixConfirmEmail } from "./email.service";
import { revokeAllSessions } from "./refresh-token.service";
import { wsManager } from "../lib/ws-manager";
import { logger } from "../lib/logger";
import { AppError } from "../errors/AppError";

const PHOENIX_ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 4,
  parallelism: 2,
};

const TOKEN_EXPIRY_MS = 15 * 60 * 1000;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
function generateEmergencyId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let id = "";
  for (let i = 0; i < 8; i++) id += chars[bytes[i] % chars.length];
  return id.slice(0, 4) + "-" + id.slice(4);
}
function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

// ── 1. Setup Phoenix Code ────────────────────────────────────────────────────

export async function setupPhoenixCode(params: {
  userId: string;
  phoenixCode: string;
}): Promise<{ emergencyId: string }> {
  const { userId, phoenixCode } = params;

  if (phoenixCode.length < 20) {
    throw new AppError("VALIDATION_ERROR", 400);
  }

  const hash = await argon2.hash(phoenixCode, PHOENIX_ARGON2_OPTIONS);
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  const emergencyId = user.emergency_id ?? generateEmergencyId();
  await UserModel.updateOne(
    { _id: userId },
    { $set: { phoenix_code_hash: hash, emergency_id: emergencyId } },
  );

  logger.info({ userId, emergencyId }, "Phoenix Code configured");
  return { emergencyId };
}

// ── 2. Initiate ──────────────────────────────────────────────────────────────

export async function initiatePhoenix(params: {
  username: string;
  phoenixCode: string;
  action: PhoenixAction;
  ip?: string;
}): Promise<void> {
  const { username, phoenixCode, action, ip } = params;
  const user = await UserModel.findOne({ username: username.toLowerCase().trim() });

  if (!user || !user.phoenix_code_hash || !user.email) {
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
    throw new AppError("INVALID_CREDENTIALS", 401);
  }

  const valid = await argon2.verify(user.phoenix_code_hash, phoenixCode);
  if (!valid) throw new AppError("INVALID_CREDENTIALS", 401);

  await PhoenixTokenModel.deleteMany({ user_id: user._id, used_at: null });

  const rawToken = generateToken();
  await PhoenixTokenModel.create({
    user_id: user._id,
    token_hash: hashToken(rawToken),
    action,
    expires_at: new Date(Date.now() + TOKEN_EXPIRY_MS),
    ip_hash: hashIp(ip),
  });

  await sendPhoenixConfirmEmail({
    to: user.email,
    username: user.username,
    confirmToken: rawToken,
    action,
    expiresInMinutes: 15,
  });

  logger.info({ userId: user._id.toString(), action }, "Phoenix initiation email sent");
}

// ── 3. Validate Token ────────────────────────────────────────────────────────

export interface ValidateTokenResult {
  valid: true;
  userId: string;
  username: string;
  action: PhoenixAction;
  tokenId: string;
}

export async function validatePhoenixToken(rawToken: string): Promise<ValidateTokenResult> {
  const doc = await PhoenixTokenModel.findOne({ token_hash: hashToken(rawToken) });
  if (!doc)          throw new AppError("NOT_FOUND", 404);
  if (doc.used_at)   throw new AppError("NOT_FOUND", 410);
  if (doc.expires_at < new Date()) throw new AppError("NOT_FOUND", 410);

  const user = await UserModel.findById(doc.user_id).lean();
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  return {
    valid: true,
    userId: doc.user_id.toString(),
    username: user.username,
    action: doc.action,
    tokenId: doc._id.toString(),
  };
}

// ── 4a. Lock Mode ────────────────────────────────────────────────────────────

export async function executeLockMode(rawToken: string, ip?: string): Promise<void> {
  const { userId, tokenId } = await validatePhoenixToken(rawToken);
  await PhoenixTokenModel.updateOne({ _id: tokenId }, { $set: { used_at: new Date() } });

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const revokedCount = await revokeAllSessions(userObjectId);

  wsManager.sendToUser(userId, { type: "phoenix:lock", payload: { reason: "emergency_lock" } });
  logger.info({ userId, revokedCount, ip: hashIp(ip) }, "Phoenix Lock Mode executed");
}

// ── 4b. Phoenix Protocol (irreversibile) ─────────────────────────────────────

export async function executePhoenixProtocol(rawToken: string, ip?: string): Promise<void> {
  const { userId, tokenId } = await validatePhoenixToken(rawToken);
  await PhoenixTokenModel.updateOne({ _id: tokenId }, { $set: { used_at: new Date() } });

  const userObjectId = new mongoose.Types.ObjectId(userId);
  wsManager.sendToUser(userId, { type: "phoenix:destroy", payload: { reason: "account_destroyed" } });

  await new Promise((r) => setTimeout(r, 500));

  await Promise.all([
    revokeAllSessions(userObjectId),
    SignalKeyBundleModel.deleteMany({ user_id: userObjectId }),
    UserPrekeysModel.deleteMany({ user_id: userObjectId }),
    ConversationModel.deleteMany({ "members.user_id": userObjectId }),
    MessageModel.deleteMany({ sender_id: userObjectId }),
    PhoenixTokenModel.deleteMany({ user_id: userObjectId }),
  ]);

  await UserModel.updateOne(
    { _id: userObjectId },
    {
      $set: {
        status: "deleted",
        deleted_at: new Date(),
        phoenix_code_hash: null,
        password_hash: null,
        email: null,
        display_name: "[Deleted]",
        bio: null,
        avatar_media_id: null,
      },
    },
  );

  logger.info({ userId, ip: hashIp(ip) }, "Phoenix Protocol executed — account destroyed");
}

// ── Recovery Card ────────────────────────────────────────────────────────────

export async function getRecoveryCardData(userId: string): Promise<{
  username: string;
  emergencyId: string;
  hasPhoenixCode: boolean;
  portalUrl: string;
}> {
  const user = await UserModel.findById(userId).lean();
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  return {
    username: user.username,
    emergencyId: user.emergency_id ?? "—",
    hasPhoenixCode: !!user.phoenix_code_hash,
    portalUrl: `${process.env.PUBLIC_URL ?? "https://alphachat.sbs"}/emergency`,
  };
}
