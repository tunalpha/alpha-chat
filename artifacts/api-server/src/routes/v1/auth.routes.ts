import { Router } from "express";
import { validate } from "../../middleware/validate.middleware";
import { RegisterSchema } from "../../validation/auth.schemas";
import { register } from "../../controllers/auth.controller";

const router = Router();

/**
 * POST /api/v1/auth/register
 * Rate limit: 5/ora/IP — applicato nel middleware globale (Sprint 4)
 */
router.post("/register", validate("body", RegisterSchema), register);

export default router;
