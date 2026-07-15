import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { UserSearchSchema, UsernameParamSchema } from "../../validation/user.schemas";
import { searchUsers, getUserProfile } from "../../controllers/user.controller";

const router = Router();

// Tutte le route user richiedono autenticazione
router.use(authenticate);

/**
 * GET /api/v1/users/search?q=marco&limit=20
 * ATTENZIONE: questa route deve stare PRIMA di /:username
 * altrimenti "search" viene interpretato come username.
 */
router.get("/search", validate("query", UserSearchSchema), searchUsers);

/**
 * GET /api/v1/users/:username
 */
router.get("/:username", validate("params", UsernameParamSchema), getUserProfile);

export default router;
