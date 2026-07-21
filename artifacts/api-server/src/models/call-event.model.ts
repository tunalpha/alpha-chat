import { Schema, model } from "mongoose";

// ── Event types ───────────────────────────────────────────────────────────────
export type CallEventType =
  | "CALL_START"      // Caller ha avviato la chiamata
  | "CALL_RINGING"    // Callee sta squillando
  | "CALL_ACCEPT"     // Callee ha accettato
  | "CALL_REJECT"     // Callee ha rifiutato
  | "CALL_TIMEOUT"    // Timeout (callee non ha risposto)
  | "CALL_END"        // Chiamata terminata normalmente
  | "CALL_CANCEL"     // Caller ha annullato
  | "CALL_BUSY"       // Callee occupato
  | "CALL_ERROR"      // Errore generico
  | "CALL_CONNECTED"; // WebRTC connected (futuro upgrade pro)

// ── Interface ─────────────────────────────────────────────────────────────────
export interface ICallEvent {
  callId:     string;
  eventType:  CallEventType;
  userId?:    string;            // Chi ha generato l'evento
  deviceId?:  string;
  platform?:  string;           // "web", "ios", "android"
  duration?:  number;           // Durata in secondi (solo su CALL_END)
  latencyMs?: number;           // Latenza misurata dal client (futuro)
  metadata?:  Record<string, unknown>;
  createdAt:  Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────
const callEventSchema = new Schema<ICallEvent>(
  {
    callId:    { type: String, required: true },
    eventType: { type: String, required: true },
    userId:    { type: String },
    deviceId:  { type: String },
    platform:  { type: String },
    duration:  { type: Number },
    latencyMs: { type: Number },
    metadata:  { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false, timestamps: false },
);

// TTL: 30 giorni
callEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
// Query per call detail e admin monitor
callEventSchema.index({ callId: 1, createdAt: -1 });
callEventSchema.index({ eventType: 1, createdAt: -1 });
callEventSchema.index({ userId: 1, createdAt: -1 });

export const CallEventModel = model<ICallEvent>("call_event", callEventSchema, "call_events");
