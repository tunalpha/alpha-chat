/**
 * UserRepository — accesso al database per la collection users.
 *
 * Regola architetturale (07_Backend_Standards.md):
 * - Nessuna business logic qui. Solo query MongoDB.
 * - I Service chiamano il Repository. I Controller chiamano i Service.
 * - Non lanciare AppError qui — lanciare errori nativi Mongoose/DB.
 *   La conversione in AppError avviene nel Service.
 */

import mongoose from "mongoose";
import { UserModel, type IUserDocument } from "../models/user.model";
import { logger } from "../lib/logger";

export interface CreateUserParams {
  username: string;
  display_name: string;
  password_hash: string;
  email: string | null;
  phone_hash: string | null;
}

export class UserRepository {
  /**
   * Cerca un utente per username (case-insensitive, il modello forza lowercase).
   */
  async findByUsername(username: string): Promise<IUserDocument | null> {
    return UserModel.findOne({ username: username.toLowerCase().trim() });
  }

  /**
   * Cerca un utente per email.
   */
  async findByEmail(email: string): Promise<IUserDocument | null> {
    return UserModel.findOne({ email: email.toLowerCase().trim() });
  }

  /**
   * Cerca un utente per phone_hash (HMAC-SHA256 già calcolato dal chiamante).
   */
  async findByPhoneHash(phoneHash: string): Promise<IUserDocument | null> {
    return UserModel.findOne({ phone_hash: phoneHash });
  }

  /**
   * Cerca un utente per _id.
   */
  async findById(id: string | mongoose.Types.ObjectId): Promise<IUserDocument | null> {
    return UserModel.findById(id);
  }

  /**
   * Crea un nuovo utente.
   */
  async create(params: CreateUserParams): Promise<IUserDocument> {
    const user = new UserModel({
      username: params.username.toLowerCase().trim(),
      display_name: params.display_name.trim(),
      password_hash: params.password_hash,
      email: params.email,
      phone_hash: params.phone_hash,
    });

    await user.save();
    logger.info({ userId: user._id.toString(), username: user.username }, "User created");
    return user;
  }

  /**
   * Incrementa il contatore di login falliti.
   * Il blocco account viene gestito dal Service dopo aver letto il contatore.
   */
  async incrementFailedLoginAttempts(userId: mongoose.Types.ObjectId): Promise<number> {
    const result = await UserModel.findByIdAndUpdate(
      userId,
      { $inc: { failed_login_attempts: 1 } },
      { returnDocument: "after" },
    );
    return result?.failed_login_attempts ?? 0;
  }

  /**
   * Azzera il contatore di login falliti e aggiorna last_login.
   */
  async recordSuccessfulLogin(
    userId: mongoose.Types.ObjectId,
    params: { ipHash: string | null; countryCode: string | null },
  ): Promise<void> {
    await UserModel.findByIdAndUpdate(userId, {
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date(),
      last_login_ip_hash: params.ipHash,
      last_login_country: params.countryCode,
    });
  }

  /**
   * Blocca l'account fino a una data specificata (dopo troppi login falliti).
   */
  async lockAccount(
    userId: mongoose.Types.ObjectId,
    lockedUntil: Date,
  ): Promise<void> {
    await UserModel.findByIdAndUpdate(userId, { locked_until: lockedUntil });
  }

  /**
   * Ricerca utenti per prefisso username (case-insensitive).
   * Esclude l'utente corrente, sospesi e cancellati.
   * Regex ancorata all'inizio: sfrutta l'indice su username.
   * Nota: username contiene solo [a-z0-9_.] — nessun carattere speciale regex.
   */
  async searchByUsername(
    query: string,
    options: {
      excludeUserId?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<IUserDocument[]> {
    const { excludeUserId, limit = 20, cursor } = options;

    const usernameFilter: Record<string, unknown> = {
      $regex: "^" + query,
      $options: "i",
    };

    // Cursor pagination: username > cursor (alfabetico)
    if (cursor) {
      usernameFilter["$gt"] = cursor;
    }

    const filter: Record<string, unknown> = {
      username: usernameFilter,
      status: "active",
    };

    if (excludeUserId) {
      filter["_id"] = { $ne: new mongoose.Types.ObjectId(excludeUserId) };
    }

    return UserModel.find(filter)
      .select("username display_name bio avatar_media_id is_verified createdAt privacy")
      .sort({ username: 1 })
      .limit(limit);
  }

  /**
   * Cerca più utenti per un array di _id (batch lookup per block list).
   */
  async findByIds(
    ids: mongoose.Types.ObjectId[],
  ): Promise<IUserDocument[]> {
    if (ids.length === 0) return [];
    return UserModel.find({ _id: { $in: ids } })
      .select("username display_name avatar_media_id is_verified status");
  }

  /**
   * Controlla se username è disponibile (non esiste nel DB).
   */
  async isUsernameAvailable(username: string): Promise<boolean> {
    const count = await UserModel.countDocuments({
      username: username.toLowerCase().trim(),
    });
    return count === 0;
  }

  /**
   * Controlla se email è disponibile.
   */
  async isEmailAvailable(email: string): Promise<boolean> {
    const count = await UserModel.countDocuments({
      email: email.toLowerCase().trim(),
    });
    return count === 0;
  }

  /**
   * Controlla se phone_hash è disponibile.
   */
  async isPhoneHashAvailable(phoneHash: string): Promise<boolean> {
    const count = await UserModel.countDocuments({ phone_hash: phoneHash });
    return count === 0;
  }
}
