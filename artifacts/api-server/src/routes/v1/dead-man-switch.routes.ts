/**
 * Dead Man Switch routes — Sprint 19
 * Tutti autenticati.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { getDmsStatus, configureDms } from "../../services/dead-man-switch.service";

const router = Router();

// GET /api/v1/dead-man-switch — stato attuale
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await getDmsStatus(req.user!.userId);
    res.json(status);
  } catch (err) { next(err); }
});

// PUT /api/v1/dead-man-switch — configura
const configSchema = z.object({
  enabled:     z.boolean(),
  period_days: z.number().int().min(7).max(365),
  grace_days:  z.number().int().min(1).max(30),
  action:      z.enum(["none", "lock", "notify_only"]),
});

router.put(
  "/",
  authenticate,
  validate("body", configSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await configureDms(req.user!.userId, {
        enabled:     req.body.enabled as boolean,
        period_days: req.body.period_days as number,
        grace_days:  req.body.grace_days as number,
        action:      req.body.action as "none" | "lock" | "notify_only",
      });
      res.json(status);
    } catch (err) { next(err); }
  },
);

export default router;
