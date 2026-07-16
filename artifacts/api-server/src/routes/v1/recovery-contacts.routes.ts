/**
 * Recovery Contacts routes — Sprint 19
 * Tutti autenticati. Max 5 contatti per utente.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import {
  listRecoveryContacts,
  addRecoveryContact,
  removeRecoveryContact,
} from "../../services/recovery-contacts.service";

const router = Router();

// GET /api/v1/recovery-contacts
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contacts = await listRecoveryContacts(req.user!.userId);
    res.json({ contacts });
  } catch (err) { next(err); }
});

// POST /api/v1/recovery-contacts
const addSchema = z.object({
  name:     z.string().min(1).max(100),
  email:    z.string().email().max(254),
  relation: z.string().max(80).optional(),
});

router.post(
  "/",
  authenticate,
  validate("body", addSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contact = await addRecoveryContact({
        userId:   req.user!.userId,
        name:     req.body.name as string,
        email:    req.body.email as string,
        relation: req.body.relation as string | undefined,
      });
      res.status(201).json(contact);
    } catch (err) { next(err); }
  },
);

// DELETE /api/v1/recovery-contacts/:id
router.delete(
  "/:id",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await removeRecoveryContact({ userId: req.user!.userId, contactId: String(req.params["id"]) });
      res.status(204).end();
    } catch (err) { next(err); }
  },
);

export default router;
