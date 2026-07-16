/**
 * Security Timeline routes — Sprint 19
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { getTimeline } from "../../services/security-timeline.service";

const router = Router();

// GET /api/v1/security-timeline?limit=50&before=ISO
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit  = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 100);
    const before = req.query["before"] ? new Date(String(req.query["before"])) : undefined;
    const events = await getTimeline({ userId: req.user!.userId, limit, before });
    res.json({ events });
  } catch (err) { next(err); }
});

export default router;
