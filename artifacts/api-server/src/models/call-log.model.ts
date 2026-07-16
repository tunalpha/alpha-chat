/**
 * CallLog — Sprint 25
 * Cronologia chiamate per ogni utente.
 * Archivia caller, callee, tipo, stato, durata.
 * Non contiene mai contenuti della conversazione.
 */
import mongoose, { type Document, Schema } from "mongoose";

export type CallStatus = "missed" | "declined" | "completed" | "failed" | "cancelled";
export type CallType   = "audio" | "video";

export interface ICallLog extends Document {
  caller_id:   string;
  callee_id:   string;
  call_type:   CallType;
  status:      CallStatus;
  started_at:  Date;
  answered_at?: Date;
  ended_at?:   Date;
  duration_sec?: number;
}

const CallLogSchema = new Schema<ICallLog>(
  {
    caller_id:   { type: String, required: true, index: true },
    callee_id:   { type: String, required: true, index: true },
    call_type:   { type: String, enum: ["audio", "video"], required: true },
    status:      { type: String, enum: ["missed", "declined", "completed", "failed", "cancelled"], required: true },
    started_at:  { type: Date, required: true },
    answered_at: { type: Date },
    ended_at:    { type: Date },
    duration_sec:{ type: Number },
  },
  { timestamps: false },
);

// Query veloce per history di un utente (caller o callee)
CallLogSchema.index({ caller_id: 1, started_at: -1 });
CallLogSchema.index({ callee_id: 1, started_at: -1 });

export const CallLogModel = mongoose.model<ICallLog>("CallLog", CallLogSchema);
