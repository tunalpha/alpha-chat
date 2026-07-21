/**
 * R2EventModel — log operazioni su Cloudflare R2.
 * TTL automatico 7 giorni. Usato da Live Activity, Error Center, Health Scheduler.
 */

import { Schema, model, type Document, type Types } from "mongoose";

export type R2EventType =
  | "UPLOAD"
  | "SIGNED_URL"
  | "DELETE"
  | "CLEANUP"
  | "HEALTH_CHECK"
  | "CONSISTENCY";

export type R2EventStatus = "success" | "error";

export interface IR2Event extends Document {
  event_type:       R2EventType;
  status:           R2EventStatus;
  uploader_id?:     Types.ObjectId;
  conversation_id?: Types.ObjectId;
  storage_key?:     string;
  file_size?:       number;
  mime_type?:       string;
  filename?:        string;
  duration_ms?:     number;
  error_message?:   string;
  error_code?:      string;
  created_at:       Date;
}

const schema = new Schema<IR2Event>(
  {
    event_type:      { type: String, enum: ["UPLOAD","SIGNED_URL","DELETE","CLEANUP","HEALTH_CHECK","CONSISTENCY"], required: true },
    status:          { type: String, enum: ["success","error"], required: true },
    uploader_id:     { type: Schema.Types.ObjectId, ref: "User" },
    conversation_id: { type: Schema.Types.ObjectId },
    storage_key:     String,
    file_size:       Number,
    mime_type:       String,
    filename:        String,
    duration_ms:     Number,
    error_message:   String,
    error_code:      String,
    created_at:      { type: Date, default: () => new Date() },
  },
  { versionKey: false, timestamps: false },
);

// TTL: auto-eliminazione dopo 7 giorni
schema.index({ created_at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
schema.index({ status:     1, created_at: -1 });
schema.index({ event_type: 1, created_at: -1 });

export const R2EventModel = model<IR2Event>("R2Event", schema, "r2_events");
