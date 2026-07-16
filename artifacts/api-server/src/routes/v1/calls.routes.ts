/**
 * /api/v1/calls — Sprint 25
 * Cronologia e logging chiamate.
 */
import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { CallLogModel, type CallType, type CallStatus } from "../../models/call-log.model";
import { AppError } from "../../errors/AppError";

const VALID_TYPES:   readonly string[] = ["audio", "video"];
const VALID_STATUSES: readonly string[] = ["missed", "declined", "completed", "failed", "cancelled"];

const router = Router();
router.use(authenticate);

/** POST /api/v1/calls/log */
const logCall: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const body   = req.body as Record<string, unknown>;
    const { peer_id, call_type, status, started_at, answered_at, ended_at, duration_sec, role } = body;

    if (!peer_id || !call_type || !status || !started_at) {
      throw new AppError("VALIDATION_ERROR", 400, "body", { fields: "peer_id, call_type, status, started_at" });
    }
    if (!VALID_TYPES.includes(String(call_type))) {
      throw new AppError("VALIDATION_ERROR", 400, "call_type");
    }
    if (!VALID_STATUSES.includes(String(status))) {
      throw new AppError("VALIDATION_ERROR", 400, "status");
    }

    const caller_id = role === "callee" ? String(peer_id) : userId;
    const callee_id = role === "callee" ? userId          : String(peer_id);

    const log = await CallLogModel.create({
      caller_id,
      callee_id,
      call_type:    String(call_type) as CallType,
      status:       String(status) as CallStatus,
      started_at:   new Date(String(started_at)),
      answered_at:  answered_at ? new Date(String(answered_at)) : undefined,
      ended_at:     ended_at    ? new Date(String(ended_at))    : undefined,
      duration_sec: duration_sec !== undefined ? Number(duration_sec) : undefined,
    });

    res.status(201).json({ id: String(log._id) });
  } catch (err) {
    next(err);
  }
};

/** GET /api/v1/calls/history?limit=50&before=<ISO date> */
const getHistory: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const limit  = Math.min(Number(req.query["limit"] ?? 50), 100);
    const before = req.query["before"] ? new Date(req.query["before"] as string) : new Date();

    const logs = await CallLogModel.find({
      $or: [{ caller_id: userId }, { callee_id: userId }],
      started_at: { $lt: before },
    })
      .sort({ started_at: -1 })
      .limit(limit)
      .lean();

    res.json({ calls: logs });
  } catch (err) {
    next(err);
  }
};

router.post("/log",    logCall);
router.get("/history", getHistory);

export default router;
