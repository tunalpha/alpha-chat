import mongoose from "mongoose";
import { InviteModel, type IInvite } from "../models/invite.model";

export class InviteRepository {
  /**
   * Crea un nuovo codice invito (già hashato).
   */
  async create(params: {
    codeHash: string;
    ownerId: mongoose.Types.ObjectId;
    expiresAt: Date;
  }): Promise<IInvite> {
    const doc = await InviteModel.create({
      code_hash: params.codeHash,
      owner_id: params.ownerId,
      expires_at: params.expiresAt,
    });
    return doc.toObject();
  }

  /**
   * Trova un codice per hash. Esclude quelli già usati o scaduti.
   */
  async findValidByHash(codeHash: string): Promise<IInvite | null> {
    const doc = await InviteModel.findOne({
      code_hash: codeHash,
      used: false,
      expires_at: { $gt: new Date() },
    }).lean();
    return doc ?? null;
  }

  /**
   * Marca un codice come usato in modo atomico.
   * Restituisce il documento aggiornato, o null se già usato/scaduto.
   */
  async markUsed(params: {
    inviteId: mongoose.Types.ObjectId;
    usedBy: mongoose.Types.ObjectId;
  }): Promise<IInvite | null> {
    const doc = await InviteModel.findOneAndUpdate(
      {
        _id: params.inviteId,
        used: false,
        expires_at: { $gt: new Date() },
      },
      {
        $set: {
          used: true,
          used_at: new Date(),
          used_by: params.usedBy,
        },
      },
      { new: true },
    ).lean();
    return doc ?? null;
  }

  /**
   * Lista i codici attivi (non usati, non scaduti) di un utente.
   */
  async listActive(ownerId: mongoose.Types.ObjectId): Promise<IInvite[]> {
    return InviteModel.find({
      owner_id: ownerId,
      used: false,
      expires_at: { $gt: new Date() },
    })
      .sort({ created_at: -1 })
      .lean();
  }

  /**
   * Cancella tutti i codici attivi di un utente (per rigenerare).
   */
  async deleteAllActive(ownerId: mongoose.Types.ObjectId): Promise<number> {
    const res = await InviteModel.deleteMany({
      owner_id: ownerId,
      used: false,
    });
    return res.deletedCount;
  }

  /**
   * Cancella un singolo codice per ID (solo se appartiene all'owner).
   */
  async deleteOwned(params: {
    inviteId: mongoose.Types.ObjectId;
    ownerId: mongoose.Types.ObjectId;
  }): Promise<boolean> {
    const res = await InviteModel.deleteOne({
      _id: params.inviteId,
      owner_id: params.ownerId,
    });
    return res.deletedCount === 1;
  }
}
