import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { UserSearchSchema, UsernameParamSchema } from "../../validation/user.schemas";
import { searchUsers, getUserProfile } from "../../controllers/user.controller";

const router = Router();

// Tutte le route user richiedono autenticazione
router.use(authenticate);

/**
 * GET /api/v1/users/search — DISABILITATO (Sprint 9)
 * La ricerca pubblica è stata rimossa per privacy.
 * La scoperta di nuovi contatti avviene solo tramite codice invito monouso.
 * Endpoint mantenuto per retrocompatibilità ma restituisce sempre 410 Gone.
 */
router.get("/search", (_req, res) => {
  res.status(410).json({
    error: {
      code: "ENDPOINT_DEPRECATED",
      message: "La ricerca utenti è stata rimossa. Usa i codici invito per aggiungere contatti.",
    },
  });
});

/**
 * GET /api/v1/users/:username
 */
router.get("/:username", validate("params", UsernameParamSchema), getUserProfile);

export default router;
