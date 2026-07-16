/**
 * BlockRepository — accesso al database per la collection blocks.
 * Solo query MongoDB. Nessuna business logic.
 */

import mongoose from "mongoose";
import { BlockModel, type IBlockDocument } from "../models/block.model";

export class BlockRepository {
  /** Crea un blocco. Ritorna null se già esistente (idempotente). */
  async block(
    blockerId: mongoose.Types.ObjectId,
    blockedId: mongoose.Types.ObjectId,
  ): Promise<IBlockDocument | null> {
    try {
      return await BlockModel.create({ blocker_id: blockerId, blocked_id: blockedId });
    } catch (err: unknown) {
      // E11000 duplicate key — già bloccato
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 11000) {
        return null;
      }
      throw err;
    }
  }

  /** Rimuove un blocco. Ritorna true se eliminato, false se non esisteva. */
  async unblock(
    blockerId: mongoose.Types.ObjectId,
    blockedId: mongoose.Types.ObjectId,
  ): Promise<boolean> {
    const result = await BlockModel.deleteOne({
      blocker_id: blockerId,
      blocked_id: blockedId,
    });
    return result.deletedCount === 1;
  }

  /** Verifica se blocker ha bloccato blocked. */
  async isBlocked(
    blockerId: mongoose.Types.ObjectId,
    blockedId: mongoose.Types.ObjectId,
  ): Promise<boolean> {
    const doc = await BlockModel.exists({
      blocker_id: blockerId,
      blocked_id: blockedId,
    });
    return doc !== null;
  }

  /** Verifica se esiste un blocco in qualsiasi direzione tra i due utenti. */
  async isBlockedEither(
    userA: mongoose.Types.ObjectId,
    userB: mongoose.Types.ObjectId,
  ): Promise<boolean> {
    const doc = await BlockModel.exists({
      $or: [
        { blocker_id: userA, blocked_id: userB },
        { blocker_id: userB, blocked_id: userA },
      ],
    });
    return doc !== null;
  }

  /** Lista gli ID degli utenti bloccati da blockerId. */
  async listBlockedIds(
    blockerId: mongoose.Types.ObjectId,
  ): Promise<mongoose.Types.ObjectId[]> {
    const docs = await BlockModel.find(
      { blocker_id: blockerId },
      { blocked_id: 1 },
    ).sort({ createdAt: -1 });
    return docs.map((d) => d.blocked_id);
  }

  /** Lista i documenti block di un utente (per l'endpoint /me/blocked). */
  async listBlocked(
    blockerId: mongoose.Types.ObjectId,
  ): Promise<IBlockDocument[]> {
    return BlockModel.find({ blocker_id: blockerId }).sort({ createdAt: -1 });
  }
}
