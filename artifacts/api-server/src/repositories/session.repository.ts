/**
 * SessionRepository — accesso al database per la collection sessions.
 *
 * Regola architetturale (07_Backend_Standards.md):
 * Solo query MongoDB. Nessuna business logic.
 */

import type mongoose from "mongoose";
import { SessionModel, type ISessionDocument } from "../models/session.model";
import { hashRefreshToken, refreshTokenExpiresAt } from "../services/refresh-token.service";
import { logger } from "../lib/logger";

export interface CreateOrUpdateSessionParams {
  userId: mongoose.Types.ObjectId;
  deviceId: string;
  deviceName: string | null;
  deviceType: "ios" | "android" | "web" | "desktop";
  refreshToken: string; // in chiaro — viene hashato internamente
  countryCode?: string | null;
  city?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
}

export class SessionRepository {
  /**
   * Crea o aggiorna la sessione per (user_id, device_id).
   * Restituisce anche se era un dispositivo nuovo (isNewDevice).
   */
  async upsert(params: CreateOrUpdateSessionParams): Promise<{
    session: ISessionDocument;
    isNewDevice: boolean;
  }> {
    const existing = await SessionModel.findOne({
      user_id: params.userId,
      device_id: params.deviceId,
    });

    const isNewDevice = existing === null || existing.deleted_at !== null;
    const tokenHash = hashRefreshToken(params.refreshToken);
    const now = new Date();

    const session = await SessionModel.findOneAndUpdate(
      { user_id: params.userId, device_id: params.deviceId },
      {
        refresh_token_hash: tokenHash,
        expires_at: refreshTokenExpiresAt(),
        device_name: params.deviceName,
        device_type: params.deviceType,
        country_code: params.countryCode ?? null,
        city: params.city ?? null,
        ip_hash: params.ipHash ?? null,
        user_agent: params.userAgent ?? null,
        last_used_at: now,
        deleted_at: null,
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    if (isNewDevice) {
      logger.info(
        { userId: params.userId.toString(), deviceId: params.deviceId },
        "New device session created",
      );
    }

    return { session, isNewDevice };
  }

  /**
   * Trova una sessione attiva tramite hash del refresh token.
   */
  async findActiveByTokenHash(tokenHash: string): Promise<ISessionDocument | null> {
    return SessionModel.findOne({
      refresh_token_hash: tokenHash,
      deleted_at: null,
      expires_at: { $gt: new Date() },
    });
  }

  /**
   * Lista tutte le sessioni attive di un utente.
   */
  async findAllActiveByUserId(userId: mongoose.Types.ObjectId): Promise<ISessionDocument[]> {
    return SessionModel.find({
      user_id: userId,
      deleted_at: null,
      expires_at: { $gt: new Date() },
    }).sort({ last_used_at: -1 });
  }

  /**
   * Revoca la sessione corrispondente al token hash.
   */
  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await SessionModel.updateOne(
      { refresh_token_hash: tokenHash },
      { deleted_at: new Date() },
    );
  }

  /**
   * Revoca tutte le sessioni di un utente.
   */
  async revokeAllByUserId(userId: mongoose.Types.ObjectId): Promise<number> {
    const result = await SessionModel.updateMany(
      { user_id: userId, deleted_at: null },
      { deleted_at: new Date() },
    );
    return result.modifiedCount;
  }

  /**
   * Revoca tutte le sessioni eccetto quella del device specificato.
   */
  async revokeAllExceptDevice(
    userId: mongoose.Types.ObjectId,
    currentDeviceId: string,
  ): Promise<number> {
    const result = await SessionModel.updateMany(
      { user_id: userId, device_id: { $ne: currentDeviceId }, deleted_at: null },
      { deleted_at: new Date() },
    );
    return result.modifiedCount;
  }
}
