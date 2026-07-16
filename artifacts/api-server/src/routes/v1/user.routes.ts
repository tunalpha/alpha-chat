import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { UsernameParamSchema } from "../../validation/user.schemas";
import { getUserProfile } from "../../controllers/user.controller";
import {
  UpdatePrivacySchema,
  BlockUserParamSchema,
} from "../../validation/privacy.schemas";
import {
  getPrivacySettings,
  updatePrivacySettings,
} from "../../controllers/privacy.controller";
import {
  blockUser,
  unblockUser,
  listBlocked,
} from "../../controllers/block.controller";

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

/** GET  /api/v1/users/me/privacy */
router.get("/me/privacy", getPrivacySettings);

/** PATCH /api/v1/users/me/privacy */
router.patch("/me/privacy", validate("body", UpdatePrivacySchema), updatePrivacySettings);

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
// Profilo pubblico — deve stare DOPO le route /me/* per evitare conflitti
// ---------------------------------------------------------------------------

/** GET /api/v1/users/:username */
router.get("/:username", validate("params", UsernameParamSchema), getUserProfile);

export default router;
