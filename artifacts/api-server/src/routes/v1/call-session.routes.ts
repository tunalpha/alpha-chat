/**
 * call-session.routes.ts — Sprint 30
 *
 * Nuove REST route per la state machine delle chiamate.
 * Montate su /api/v1/calls/* INSIEME alle route esistenti (calls.routes.ts).
 * NON modifica nessuna route esistente.
 */

import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { CallSessionModel } from "../../models/call-session.model";
import * as css from "../../services/call-session.service";

const router = Router();
router.use(authenticate);

// ── Schemas ────────────────────────────────────────────────────────────────────

const CallIdBody = z.object({
  call_id: z.string().min(1, "call_id obbligatorio"),
});

const StartBody = CallIdBody.extend({
  callee_id:       z.string().min(1),
  call_type:       z.enum(["audio", "video"]).default("audio"),
  conversation_id: z.string().optional(),
  caller_device:   z.string().optional(),
  platform:        z.string().optional(),
});

const WithReason = CallIdBody.extend({
  reason: z.string().max(64).optional(),
});

const WithDevice = CallIdBody.extend({
  device: z.string().optional(),
});

// ── Helper ─────────────────────────────────────────────────────────────────────

function uid(req: Express.Request): string {
  return (req.user as { userId: string }).userId;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/calls/start
 * Il chiamante crea la sessione PRIMA di inviare call.offer via WS.
 * Idempotente: se il call_id esiste già, non fa nulla.
 */
router.post("/start", validate("body", StartBody), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof StartBody>;
    await css.startSession({
      callId:         b.call_id,
      callerId:       uid(req),
      calleeId:       b.callee_id,
      callType:       b.call_type,
      conversationId: b.conversation_id,
      callerDevice:   b.caller_device,
      platform:       b.platform,
    });
    res.status(201).json({ call_id: b.call_id, state: "CALLING" });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/calls/ringing
 * Il callee segnala che il proprio client sta squillando.
 */
router.post("/ringing", validate("body", CallIdBody), async (req, res, next) => {
  try {
    const { call_id } = req.body as z.infer<typeof CallIdBody>;
    await css.setRinging(call_id, uid(req));
    res.json({ call_id, state: "RINGING" });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/calls/accept
 * Il callee ha premuto "Accetta".
 */
router.post("/accept", validate("body", WithDevice), async (req, res, next) => {
  try {
    const { call_id, device } = req.body as z.infer<typeof WithDevice>;
    await css.acceptSession(call_id, uid(req), device);
    res.json({ call_id, state: "ACCEPTED" });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/calls/reject
 * Il callee ha premuto "Rifiuta".
 */
router.post("/reject", validate("body", WithReason), async (req, res, next) => {
  try {
    const { call_id, reason } = req.body as z.infer<typeof WithReason>;
    await css.rejectSession(call_id, uid(req), reason);
    res.json({ call_id, state: "REJECTED" });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/calls/end
 * Chiamata terminata (dal chiamante o dal callee dopo l'accettazione).
 */
router.post("/end", validate("body", WithReason), async (req, res, next) => {
  try {
    const { call_id, reason } = req.body as z.infer<typeof WithReason>;
    await css.endSession(call_id, uid(req), reason);
    res.json({ call_id, state: "ENDED" });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/calls/cancel
 * Il chiamante annulla prima che il callee risponda.
 */
router.post("/cancel", validate("body", CallIdBody), async (req, res, next) => {
  try {
    const { call_id } = req.body as z.infer<typeof CallIdBody>;
    await css.cancelSession(call_id, uid(req));
    res.json({ call_id, state: "CANCELLED" });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/calls/busy
 * Chiamata non consegnata perché il callee era occupato.
 */
router.post("/busy", validate("body", CallIdBody), async (req, res, next) => {
  try {
    const { call_id } = req.body as z.infer<typeof CallIdBody>;
    await css.busySession(call_id, uid(req));
    res.json({ call_id, state: "BUSY" });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/calls/timeout
 * Il client segnala timeout (es. 30s senza risposta).
 */
router.post("/timeout", validate("body", CallIdBody), async (req, res, next) => {
  try {
    const { call_id } = req.body as z.infer<typeof CallIdBody>;
    await css.timeoutSession(call_id, uid(req));
    res.json({ call_id, state: "TIMEOUT" });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/calls/sessions
 * Cronologia sessioni con state machine completa (diverso da /calls/history esistente).
 */
router.get("/sessions", async (req, res, next) => {
  try {
    const userId = uid(req);
    const page   = Math.max(1, parseInt(String(req.query["page"]  ?? "1"),  10));
    const limit  = Math.min(50, parseInt(String(req.query["limit"] ?? "20"), 10));
    const skip   = (page - 1) * limit;

    const filter = { $or: [{ callerId: userId }, { calleeId: userId }] };

    const [sessions, total] = await Promise.all([
      CallSessionModel.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
      CallSessionModel.countDocuments(filter),
    ]);

    res.json({
      sessions,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
});

export default router;
