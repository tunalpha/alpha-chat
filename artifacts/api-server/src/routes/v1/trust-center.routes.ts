/**
 * Trust Center routes — Sprint 20
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { getTrustCenterStatus } from "../../services/trust-center.service";
import { logSecurityEvent } from "../../services/security-timeline.service";

const router = Router();

// Schema per i check client-side inviati dal frontend
const clientChecksSchema = z.object({
  pin_configured:       z.boolean().optional().default(false),
  biometric_configured: z.boolean().optional().default(false),
  timeout_configured:   z.boolean().optional().default(false),
});

// GET /api/v1/trust-center?pin=true&biometric=false&timeout=true
// Parametri query opzionali per i check client-side
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientChecks = {
      pin_configured:       req.query["pin"] === "true",
      biometric_configured: req.query["biometric"] === "true",
      timeout_configured:   req.query["timeout"] === "true",
    };
    const status = await getTrustCenterStatus(req.user!.userId, clientChecks);
    res.json(status);
  } catch (err) { next(err); }
});

// POST /api/v1/trust-center/audit — esegui audit manuale
router.post(
  "/audit",
  authenticate,
  validate("body", clientChecksSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientChecks = {
        pin_configured:       req.body.pin_configured as boolean,
        biometric_configured: req.body.biometric_configured as boolean,
        timeout_configured:   req.body.timeout_configured as boolean,
      };
      const status = await getTrustCenterStatus(req.user!.userId, clientChecks);

      // Logga l'audit come evento di sicurezza
      await logSecurityEvent({
        user_id: req.user!.userId,
        event_type: "IDENTITY_VERIFIED",
        metadata: { trigger: "manual_audit", score: status.score, level: status.level },
      });

      res.json({ ...status, audited_at: new Date().toISOString() });
    } catch (err) { next(err); }
  },
);

export default router;
