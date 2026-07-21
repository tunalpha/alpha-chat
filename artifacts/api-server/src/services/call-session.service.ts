/**
 * call-session.service.ts — Sprint 30
 *
 * Modulo separato per la state machine delle chiamate.
 * NON modifica alcuna logica esistente di messaggi, Signal, auth o media.
 *
 * Utilizzato in due modi:
 *  1. Fire-and-forget da ws-server.ts (onCall* exports)
 *  2. REST API esplicita da call-session.routes.ts
 */

import { logger } from "../lib/logger";
import { CallSessionModel, type CallState } from "../models/call-session.model";
import { CallEventModel, type CallEventType } from "../models/call-event.model";

// ── Helpers interni ───────────────────────────────────────────────────────────

async function _logEvent(
  callId: string,
  eventType: CallEventType,
  extra?: {
    userId?:    string;
    deviceId?:  string;
    platform?:  string;
    duration?:  number;
    latencyMs?: number;
    metadata?:  Record<string, unknown>;
  },
): Promise<void> {
  try {
    await CallEventModel.create({ callId, eventType, createdAt: new Date(), ...extra });
  } catch (err) {
    logger.warn({ err, callId, eventType }, "[CallSession] _logEvent failed (non-blocking)");
  }
}

async function _transitionState(
  callId:  string,
  state:   CallState,
  fields?: Partial<{
    ringingAt:   Date;
    answeredAt:  Date;
    connectedAt: Date;
    endedAt:     Date;
    duration:    number;
    endReason:   string;
    calleeDevice:string;
  }>,
): Promise<void> {
  try {
    await CallSessionModel.updateOne({ callId }, { $set: { state, ...fields } });
  } catch (err) {
    logger.warn({ err, callId, state }, "[CallSession] _transitionState failed (non-blocking)");
  }
}

// ── Fire-and-forget hooks (called from ws-server.ts) ─────────────────────────
// Tutti sono void: non bloccano mai il signaling WS.

export function onCallOffer(
  callId:         string | undefined,
  callerId:       string,
  calleeId:       string,
  callType:       "audio" | "video",
  conversationId?: string,
): void {
  if (!callId) return;
  void (async () => {
    try {
      await CallSessionModel.findOneAndUpdate(
        { callId },
        {
          $setOnInsert: {
            callId, callerId, calleeId, callType,
            conversationId,
            state:     "CALLING" as CallState,
            startedAt: new Date(),
          },
        },
        { upsert: true, new: false },
      );
      await _logEvent(callId, "CALL_START", { userId: callerId });
    } catch (err) {
      logger.warn({ err, callId }, "[CallSession] onCallOffer failed");
    }
  })();
}

export function onCallBusy(
  callId:  string | undefined,
  callerId:string,
  calleeId:string,
): void {
  if (!callId) return;
  void (async () => {
    try {
      await CallSessionModel.findOneAndUpdate(
        { callId },
        {
          $setOnInsert: {
            callId, callerId, calleeId,
            callType:  "audio" as const,
            startedAt: new Date(),
          },
          $set: { state: "BUSY" as CallState, endedAt: new Date(), endReason: "busy" },
        },
        { upsert: true },
      );
      await _logEvent(callId, "CALL_BUSY", { userId: calleeId });
    } catch (err) {
      logger.warn({ err, callId }, "[CallSession] onCallBusy failed");
    }
  })();
}

export function onCallAnswer(
  callId:  string | undefined,
  calleeId:string,
  _callerId:string,
): void {
  if (!callId) return;
  void _transitionState(callId, "ACCEPTED", { answeredAt: new Date() });
  void _logEvent(callId, "CALL_ACCEPT", { userId: calleeId });
}

export function onCallReject(
  callId:   string | undefined,
  calleeId: string,
  _callerId:string,
  reason?:  string,
): void {
  if (!callId) return;
  void _transitionState(callId, "REJECTED", { endedAt: new Date(), endReason: reason });
  void _logEvent(callId, "CALL_REJECT", { userId: calleeId, metadata: { reason } });
}

export function onCallEnd(
  callId:  string | undefined,
  userId:  string,
  _toId:   string,
  reason?: string,
): void {
  if (!callId) return;

  let finalState: CallState       = "ENDED";
  let eventType:  CallEventType   = "CALL_END";
  if (reason === "timeout")   { finalState = "TIMEOUT";   eventType = "CALL_TIMEOUT"; }
  if (reason === "cancelled") { finalState = "CANCELLED"; eventType = "CALL_CANCEL";  }

  const now = new Date();
  void (async () => {
    try {
      const session = await CallSessionModel
        .findOne({ callId })
        .select("answeredAt startedAt")
        .lean();
      const startMs  = ((session?.answeredAt ?? session?.startedAt) ?? now).getTime();
      const duration = Math.max(0, Math.round((now.getTime() - startMs) / 1000));
      await _transitionState(callId, finalState, { endedAt: now, endReason: reason, duration });
      await _logEvent(callId, eventType, { userId, duration, metadata: { reason } });
    } catch (err) {
      logger.warn({ err, callId }, "[CallSession] onCallEnd failed");
    }
  })();
}

// ── REST API state transitions (chiamati da call-session.routes.ts) ───────────

export async function startSession(params: {
  callId:          string;
  callerId:        string;
  calleeId:        string;
  callType:        "audio" | "video";
  conversationId?: string;
  callerDevice?:   string;
  platform?:       string;
}): Promise<void> {
  await CallSessionModel.findOneAndUpdate(
    { callId: params.callId },
    {
      $setOnInsert: {
        ...params,
        state:     "CALLING" as CallState,
        startedAt: new Date(),
      },
    },
    { upsert: true, new: false },
  );
  await _logEvent(params.callId, "CALL_START", {
    userId:   params.callerId,
    platform: params.platform,
    deviceId: params.callerDevice,
  });
}

export async function setRinging(callId: string, userId: string): Promise<void> {
  await _transitionState(callId, "RINGING", { ringingAt: new Date() });
  await _logEvent(callId, "CALL_RINGING", { userId });
}

export async function acceptSession(callId: string, userId: string, device?: string): Promise<void> {
  await _transitionState(callId, "ACCEPTED", { answeredAt: new Date(), calleeDevice: device });
  await _logEvent(callId, "CALL_ACCEPT", { userId, deviceId: device });
}

export async function rejectSession(callId: string, userId: string, reason?: string): Promise<void> {
  await _transitionState(callId, "REJECTED", { endedAt: new Date(), endReason: reason });
  await _logEvent(callId, "CALL_REJECT", { userId, metadata: { reason } });
}

export async function endSession(callId: string, userId: string, reason?: string): Promise<void> {
  let finalState: CallState     = "ENDED";
  let eventType:  CallEventType = "CALL_END";
  if (reason === "timeout")   { finalState = "TIMEOUT";   eventType = "CALL_TIMEOUT"; }
  if (reason === "cancelled") { finalState = "CANCELLED"; eventType = "CALL_CANCEL";  }

  const now = new Date();
  const session = await CallSessionModel.findOne({ callId }).select("answeredAt startedAt").lean();
  const startMs = ((session?.answeredAt ?? session?.startedAt) ?? now).getTime();
  const duration = Math.max(0, Math.round((now.getTime() - startMs) / 1000));

  await _transitionState(callId, finalState, { endedAt: now, endReason: reason, duration });
  await _logEvent(callId, eventType, { userId, duration, metadata: { reason } });
}

export async function cancelSession(callId: string, userId: string): Promise<void> {
  await _transitionState(callId, "CANCELLED", { endedAt: new Date(), endReason: "caller_cancelled" });
  await _logEvent(callId, "CALL_CANCEL", { userId });
}

export async function busySession(callId: string, userId: string): Promise<void> {
  await _transitionState(callId, "BUSY", { endedAt: new Date(), endReason: "busy" });
  await _logEvent(callId, "CALL_BUSY", { userId });
}

export async function timeoutSession(callId: string, userId: string): Promise<void> {
  await _transitionState(callId, "TIMEOUT", { endedAt: new Date(), endReason: "timeout" });
  await _logEvent(callId, "CALL_TIMEOUT", { userId });
}

// ── Admin metrics ─────────────────────────────────────────────────────────────

export interface CallMetricsResult {
  calls_today:      number;
  active_now:       number;
  avg_duration_sec: number;
  completed_count:  number;
  missed_count:     number;
  rejected_count:   number;
  busy_count:       number;
  timeout_count:    number;
  cancelled_count:  number;
  error_count:      number;
  success_rate:     number;   // 0–100
  chart_24h:        { hour: number; calls: number; avg_duration: number }[];
}

export async function getCallMetrics(): Promise<CallMetricsResult> {
  const now        = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [todayCount, activeCount, statsAgg, chart24h] = await Promise.all([
    CallSessionModel.countDocuments({ startedAt: { $gte: todayStart } }),

    CallSessionModel.countDocuments({
      state: { $in: ["CALLING", "RINGING", "ACCEPTED", "CONNECTED"] },
    }),

    CallSessionModel.aggregate([
      { $group: { _id: "$state", count: { $sum: 1 }, avgDur: { $avg: "$duration" } } },
    ]),

    CallSessionModel.aggregate([
      { $match:  { startedAt: { $gte: h24ago } } },
      { $group:  {
          _id:        { $hour: "$startedAt" },
          calls:      { $sum: 1 },
          avgDuration:{ $avg: "$duration" },
      }},
      { $sort:   { _id: 1 } },
      { $project: {
          _id:         0,
          hour:        "$_id",
          calls:       1,
          avg_duration:{ $ifNull: [{ $round: ["$avgDuration", 1] }, 0] },
      }},
    ]),
  ]);

  const byState: Record<string, { count: number; avgDur: number }> = {};
  for (const s of statsAgg) {
    byState[s._id as string] = { count: s.count as number, avgDur: s.avgDur as number ?? 0 };
  }

  const completed  = byState["ENDED"]?.count     ?? 0;
  const missed     = byState["MISSED"]?.count    ?? 0;
  const rejected   = byState["REJECTED"]?.count  ?? 0;
  const busy       = byState["BUSY"]?.count      ?? 0;
  const timeout    = byState["TIMEOUT"]?.count   ?? 0;
  const cancelled  = byState["CANCELLED"]?.count ?? 0;
  const total      = Object.values(byState).reduce((a, b) => a + b.count, 0);
  const successRate= total > 0 ? Math.round((completed / total) * 100) : 0;
  const avgDur     = Math.round(byState["ENDED"]?.avgDur ?? 0);

  return {
    calls_today:      todayCount,
    active_now:       activeCount,
    avg_duration_sec: avgDur,
    completed_count:  completed,
    missed_count:     missed,
    rejected_count:   rejected,
    busy_count:       busy,
    timeout_count:    timeout,
    cancelled_count:  cancelled,
    error_count:      0,
    success_rate:     successRate,
    chart_24h:        chart24h as { hour: number; calls: number; avg_duration: number }[],
  };
}
