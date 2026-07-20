/**
 * PushSubscription — collection: push_subscriptions
 * Una subscription per dispositivo/browser. Gestita dal Push Notification Service.
 */

import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IPushSubscription {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: string | null;   // "android" | "ios" | "windows" | "macos" | "linux" | null
  browser: string | null;    // "chrome" | "firefox" | "safari" | "edge" | null
  device: string | null;     // user-agent snippet (non contiene dati sensibili)
  last_used: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type IPushSubscriptionDocument = IPushSubscription & Document;

const schema = new Schema<IPushSubscriptionDocument>(
  {
    user_id:  { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    endpoint: { type: String, required: true },
    p256dh:   { type: String, required: true },
    auth:     { type: String, required: true },
    platform: { type: String, default: null },
    browser:  { type: String, default: null },
    device:   { type: String, default: null },
    last_used: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

schema.index({ endpoint: 1 }, { unique: true });

export const PushSubscriptionModel: Model<IPushSubscriptionDocument> =
  (mongoose.models["PushSubscription"] as Model<IPushSubscriptionDocument>) ??
  mongoose.model<IPushSubscriptionDocument>("PushSubscription", schema, "push_subscriptions");
