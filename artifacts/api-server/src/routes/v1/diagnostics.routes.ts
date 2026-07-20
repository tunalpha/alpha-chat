/**
 * Diagnostics Routes — /api/v1/diagnostics/*
 *
 * Endpoint per la raccolta di eventi diagnostici dal client.
 * Chiamato automaticamente da DiagnosticLogger ogni 5 secondi.
 *
 * Call Diagnostics Center — Alpha Chat
 */

import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../../middleware/authenticate.middleware";
import { DiagnosticEventModel } from "../../models/diagnostic-event.model";

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/diagnostics/events
// Body: { session_id, device, events[] }
// ---------------------------------------------------------------------------

router.post("/events", authenticate, async (req, res, next) => {
  try {
    const userId   = new mongoose.Types.ObjectId(req.user!.userId);

    const { session_id, username: bodyUsername, device, events } = req.body as {
      session_id?: string;
      username?:   string;
      device?: {
        user_agent?:   string;
        platform?:     string;
        network_type?: string | null;
        app_version?:  string;
      };
      events?: unknown[];
    };

    if (!Array.isArray(events) || events.length === 0) {
      res.status(204).end();
      return;
    }

    // username dal body (inviato dal DiagnosticLogger) — fallback sicuro
    const username = typeof bodyUsername === "string" && bodyUsername.trim().length > 0
      ? bodyUsername.trim().slice(0, 64)
      : "unknown";

    // Limita a 100 eventi per batch
    const batch = (events as Record<string, unknown>[]).slice(0, 100);

    const docs = batch.map((e) => ({
      user_id:    userId,
      username,
      session_id: typeof session_id === "string" ? session_id.slice(0, 64) : "unknown",
      call_id:    typeof e.call_id === "string" ? e.call_id.slice(0, 64) : null,
      event:      typeof e.event === "string" ? e.event.slice(0, 100) : "unknown",
      payload:    typeof e.payload === "object" && e.payload !== null ? e.payload as Record<string, unknown> : {},
      elapsed_ms: typeof e.elapsed_ms === "number" ? e.elapsed_ms : null,
      device: {
        user_agent:             String(device?.user_agent             ?? "").slice(0, 512),
        platform:               String(device?.platform               ?? "").slice(0, 64),
        network_type:           device?.network_type ? String(device.network_type).slice(0, 32) : null,
        app_version:            String(device?.app_version            ?? "").slice(0, 32),
        build_time:             device?.build_time             ? String(device.build_time).slice(0, 64)   : null,
        service_worker_version: device?.service_worker_version ? String(device.service_worker_version).slice(0, 32) : null,
        ios_version:            device?.ios_version            ? String(device.ios_version).slice(0, 16)  : null,
        safari_version:         device?.safari_version         ? String(device.safari_version).slice(0, 16) : null,
      },
      created_at: typeof e.timestamp === "string" ? new Date(e.timestamp) : new Date(),
    }));

    await DiagnosticEventModel.insertMany(docs, { ordered: false }).catch((err: unknown) => {
      // ordered:false con bulk duplicati ritorna BulkWriteError code 11000 — ignorare
      // qualsiasi altro errore (es. ValidationError) viene rilanciato per il logging
      const code = (err as { code?: number }).code;
      if (code !== 11000) throw err;
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
