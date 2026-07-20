/**
 * DiagnosticEvent — Alpha Chat
 *
 * Evento diagnostico inviato dal client durante chiamate WebRTC / WS.
 * TTL configurabile via DIAG_TTL_DAYS (default 7 giorni).
 *
 * Privacy: nessun contenuto di messaggi, nessuna chiave crittografica.
 * Solo eventi tecnici (stati WS, ICE, PeerConnection, step acceptCall, ecc.)
 */

import mongoose, { type Document, Schema } from "mongoose";

const TTL_SECONDS = Number(process.env.DIAG_TTL_DAYS ?? 7) * 24 * 3600;

export interface IDiagnosticEvent extends Document {
  user_id:    mongoose.Types.ObjectId;
  username:   string;
  session_id: string;
  call_id:    string | null;
  event:      string;
  payload:    Record<string, unknown>;
  elapsed_ms: number | null;
  device: {
    user_agent:             string;
    platform:               string;
    network_type:           string | null;
    app_version:            string;
    build_time:             string | null;
    service_worker_version: string | null;
    ios_version:            string | null;
    safari_version:         string | null;
  };
  created_at: Date;
}

const schema = new Schema<IDiagnosticEvent>(
  {
    user_id:    { type: Schema.Types.ObjectId, required: true, ref: "User", index: true },
    username:   { type: String,  required: true, index: true },
    session_id: { type: String,  required: true },
    call_id:    { type: String,  default: null,  index: true },
    event:      { type: String,  required: true, index: true },
    payload:    { type: Schema.Types.Mixed, default: {} },
    elapsed_ms: { type: Number,  default: null },
    device: {
      user_agent:             { type: String, default: "" },
      platform:               { type: String, default: "" },
      network_type:           { type: String, default: null },
      app_version:            { type: String, default: "" },
      build_time:             { type: String, default: null },
      service_worker_version: { type: String, default: null },
      ios_version:            { type: String, default: null },
      safari_version:         { type: String, default: null },
    },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false },
);

// TTL index — eliminazione automatica dopo N giorni
schema.index({ created_at: 1 }, { expireAfterSeconds: TTL_SECONDS });

// Indice composto per query frequenti nell'admin
schema.index({ created_at: -1, username: 1 });
schema.index({ call_id: 1, created_at: 1 });

export const DiagnosticEventModel = mongoose.model<IDiagnosticEvent>(
  "DiagnosticEvent",
  schema,
  "diagnostic_events",
);
