import { Schema, model } from "mongoose";

// ── State machine ─────────────────────────────────────────────────────────────
export type CallState =
  | "CALLING"    // Caller ha inviato offer, callee non ha ancora squillato
  | "RINGING"    // Callee sta squillando
  | "ACCEPTED"   // Callee ha accettato, WebRTC in setup
  | "CONNECTED"  // WebRTC attivo (riservato per uso futuro / upgrade pro)
  | "ENDED"      // Chiamata completata normalmente
  | "MISSED"     // Callee non ha risposto entro il timeout
  | "REJECTED"   // Callee ha rifiutato esplicitamente
  | "BUSY"       // Callee era già in un'altra chiamata
  | "CANCELLED"  // Caller ha annullato prima della risposta
  | "TIMEOUT";   // Timeout lato client (es. rete caduta)

export const CALL_STATES: CallState[] = [
  "CALLING", "RINGING", "ACCEPTED", "CONNECTED",
  "ENDED", "MISSED", "REJECTED", "BUSY", "CANCELLED", "TIMEOUT",
];

// ── Interface ─────────────────────────────────────────────────────────────────
export interface ICallSession {
  callId:          string;           // UUID generato dal client (da call.offer payload)
  callerId:        string;           // ObjectId string del chiamante
  calleeId:        string;           // ObjectId string del destinatario
  conversationId?: string;           // Conversazione associata (opzionale)
  callType:        "audio" | "video";
  state:           CallState;
  startedAt:       Date;
  ringingAt?:      Date;
  answeredAt?:     Date;
  connectedAt?:    Date;
  endedAt?:        Date;
  duration?:       number;           // Durata in secondi (da answeredAt a endedAt)
  endReason?:      string;           // "timeout", "cancelled", "user_ended", ecc.
  callerDevice?:   string;
  calleeDevice?:   string;
  platform?:       string;           // "web", "ios", "android"
}

// ── Schema ────────────────────────────────────────────────────────────────────
const callSessionSchema = new Schema<ICallSession>(
  {
    callId:          { type: String, required: true, unique: true },
    callerId:        { type: String, required: true },
    calleeId:        { type: String, required: true },
    conversationId:  { type: String },
    callType:        { type: String, enum: ["audio", "video"], default: "audio" },
    state:           { type: String, enum: CALL_STATES, default: "CALLING" },
    startedAt:       { type: Date, default: () => new Date() },
    ringingAt:       { type: Date },
    answeredAt:      { type: Date },
    connectedAt:     { type: Date },
    endedAt:         { type: Date },
    duration:        { type: Number },
    endReason:       { type: String },
    callerDevice:    { type: String },
    calleeDevice:    { type: String },
    platform:        { type: String },
  },
  { versionKey: false, timestamps: false },
);

// TTL: 90 giorni (audit trail prolungato)
callSessionSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
// Indici per history queries e admin metrics
callSessionSchema.index({ callerId: 1, startedAt: -1 });
callSessionSchema.index({ calleeId: 1, startedAt: -1 });
callSessionSchema.index({ state: 1, startedAt: -1 });

export const CallSessionModel = model<ICallSession>("call_session", callSessionSchema);
