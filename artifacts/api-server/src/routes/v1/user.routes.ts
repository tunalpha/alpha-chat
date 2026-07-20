import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { UsernameParamSchema, UpdateMeSchema } from "../../validation/user.schemas";
import { getUserProfile, updateMe } from "../../controllers/user.controller";
import {
  UpdatePrivacySchema,
  BlockUserParamSchema,
} from "../../validation/privacy.schemas";
import {
  getPrivacySettings,
  updatePrivacySettings,
} from "../../controllers/privacy.controller";
import {
  getNotificationSettings,
  updateNotificationSettings,
} from "../../controllers/notification.controller";
import { updateLanguage } from "../../controllers/language.controller";
import {
  blockUser,
  unblockUser,
  listBlocked,
} from "../../controllers/block.controller";
import { ConversationMemberRepository } from "../../repositories/conversation-member.repository";
import { wsManager } from "../../lib/ws-manager";
import { successResponse } from "../../utils/response";

const memberRepo = new ConversationMemberRepository();

const router = Router();

// Tutte le route user richiedono autenticazione
router.use(authenticate);

/**
 * GET /api/v1/users/search — DISABILITATO (Sprint 9)
 * La ricerca pubblica è stata rimossa per privacy.
 */
router.get("/search", (_req, res) => {
  res.status(410).json({
    error: {
      code: "ENDPOINT_DEPRECATED",
      message: "La ricerca utenti è stata rimossa. Usa i codici invito per aggiungere contatti.",
    },
  });
});

// ---------------------------------------------------------------------------
// Privacy (Sprint 15)
// ---------------------------------------------------------------------------

/** PATCH /api/v1/users/me — aggiorna display_name e/o avatar_url */
router.patch("/me", validate("body", UpdateMeSchema), updateMe);

/** GET  /api/v1/users/me/privacy */
router.get("/me/privacy", getPrivacySettings);

/** PATCH /api/v1/users/me/privacy */
router.patch("/me/privacy", validate("body", UpdatePrivacySchema), updatePrivacySettings);

/** GET  /api/v1/users/me/notifications */
router.get("/me/notifications", getNotificationSettings);

/** PATCH /api/v1/users/me/notifications */
router.patch("/me/notifications", updateNotificationSettings);

/** PATCH /api/v1/users/me/language */
router.patch("/me/language", updateLanguage);

// ---------------------------------------------------------------------------
// Block list (Sprint 15)
// ---------------------------------------------------------------------------

/** GET /api/v1/users/me/blocked */
router.get("/me/blocked", listBlocked);

/** POST   /api/v1/users/:userId/block */
router.post("/:userId/block", validate("params", BlockUserParamSchema), blockUser);

/** DELETE /api/v1/users/:userId/block */
router.delete("/:userId/block", validate("params", BlockUserParamSchema), unblockUser);

// ---------------------------------------------------------------------------
// Presenza — Sprint 27+
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/users/me/presence/contacts
 * Ritorna gli user_id dei contatti attualmente online.
 * Usato dal client al (ri)connessione WS per ottenere lo stato iniziale senza
 * dipendere dal timing degli eventi presence.online inviati dal server.
 */
router.get("/me/presence/contacts", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const contactIds = await memberRepo.listContactUserIds(
      new mongoose.Types.ObjectId(userId),
    );
    const online_user_ids = contactIds.filter((id) => wsManager.isOnline(id));
    res.json(successResponse({ online_user_ids }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Profilo pubblico — deve stare DOPO le route /me/* per evitare conflitti
// ---------------------------------------------------------------------------

/** GET /api/v1/users/:username */
router.get("/:username", validate("params", UsernameParamSchema), getUserProfile);

export default router;
