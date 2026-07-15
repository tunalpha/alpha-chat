/**
 * PresenceService — gestione dello stato di presenza utente.
 *
 * Sprint 7: online / offline / typing.
 * Tutti gli aggiornamenti sono upsert — nessun document richiesto pre-esistente.
 * Gli errori MongoDB non sono fatali: loggati come warning, non propagati.
 */

import mongoose from "mongoose";
import { PresenceModel } from "../models/presence.model";
import { logger } from "../lib/logger";

export async function setOnline(userId: string): Promise<void> {
  try {
    await PresenceModel.findOneAndUpdate(
      { user_id: new mongoose.Types.ObjectId(userId) },
      { $set: { status: "online", last_seen_at: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    logger.warn({ err, userId }, "presence.setOnline failed");
  }
}

export async function setOffline(userId: string): Promise<void> {
  try {
    await PresenceModel.findOneAndUpdate(
      { user_id: new mongoose.Types.ObjectId(userId) },
      { $set: { status: "offline", last_seen_at: new Date(), is_typing_in: null } },
      { upsert: true },
    );
  } catch (err) {
    logger.warn({ err, userId }, "presence.setOffline failed");
  }
}

export async function setTyping(
  userId: string,
  conversationId: string | null,
): Promise<void> {
  try {
    await PresenceModel.findOneAndUpdate(
      { user_id: new mongoose.Types.ObjectId(userId) },
      {
        $set: {
          is_typing_in: conversationId
            ? new mongoose.Types.ObjectId(conversationId)
            : null,
          last_seen_at: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.warn({ err, userId }, "presence.setTyping failed");
  }
}
