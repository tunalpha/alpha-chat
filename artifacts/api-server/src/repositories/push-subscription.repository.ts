/**
 * PushSubscriptionRepository — CRUD per push_subscriptions.
 * Solo query MongoDB, nessuna business logic.
 */

import mongoose from "mongoose";
import {
  PushSubscriptionModel,
  type IPushSubscriptionDocument,
} from "../models/push-subscription.model";

export class PushSubscriptionRepository {
  /** Crea o aggiorna una subscription (upsert per endpoint). */
  async upsert(params: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    platform?: string | null;
    browser?: string | null;
    device?: string | null;
  }): Promise<IPushSubscriptionDocument> {
    return PushSubscriptionModel.findOneAndUpdate(
      { endpoint: params.endpoint },
      {
        $set: {
          user_id:  new mongoose.Types.ObjectId(params.userId),
          p256dh:   params.p256dh,
          auth:     params.auth,
          platform: params.platform ?? null,
          browser:  params.browser  ?? null,
          device:   params.device   ?? null,
          last_used: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ) as unknown as IPushSubscriptionDocument;
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await PushSubscriptionModel.deleteOne({ endpoint });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await PushSubscriptionModel.deleteMany({
      user_id: new mongoose.Types.ObjectId(userId),
    });
  }

  async findByUserId(userId: string): Promise<IPushSubscriptionDocument[]> {
    return PushSubscriptionModel.find({
      user_id: new mongoose.Types.ObjectId(userId),
    }).lean() as unknown as IPushSubscriptionDocument[];
  }

  async findByUserIds(userIds: string[]): Promise<IPushSubscriptionDocument[]> {
    if (userIds.length === 0) return [];
    return PushSubscriptionModel.find({
      user_id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean() as unknown as IPushSubscriptionDocument[];
  }

  async touchEndpoint(endpoint: string): Promise<void> {
    await PushSubscriptionModel.updateOne(
      { endpoint },
      { $set: { last_used: new Date() } },
    );
  }
}
