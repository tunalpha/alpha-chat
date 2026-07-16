/**
 * Recovery Dashboard routes — Sprint 19
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { getDmsStatus } from "../../services/dead-man-switch.service";
import { listRecoveryContacts } from "../../services/recovery-contacts.service";
import { getRecoveryCardData } from "../../services/phoenix.service";
import { UserModel } from "../../models/user.model";
import { SessionModel } from "../../models/session.model";

const router = Router();

// GET /api/v1/recovery-dashboard
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const [dms, contacts, recoveryCard, user, sessions] = await Promise.all([
      getDmsStatus(userId),
      listRecoveryContacts(userId),
      getRecoveryCardData(userId),
      UserModel.findById(userId).select("last_login_at createdAt").lean(),
      SessionModel.find({ user_id: userId }).select("device_name createdAt").lean(),
    ]);

    res.json({
      dms,
      contacts,
      recovery_card: recoveryCard,
      account: {
        last_seen_at: user?.last_login_at?.toISOString() ?? null,
        created_at:   user?.createdAt?.toISOString() ?? null,
      },
      sessions: sessions.map(s => ({
        device_name:    s.device_name ?? "Dispositivo",
        created_at:     s.createdAt.toISOString(),
        last_active_at: null,
      })),
    });
  } catch (err) { next(err); }
});

export default router;
