import { Router } from "express";
import { validate } from "../../middleware/validate.middleware";
import { RegisterSchema, LoginSchema } from "../../validation/auth.schemas";
import { register, login } from "../../controllers/auth.controller";

const router = Router();

/**
 * POST /api/v1/auth/register
 * Rate limit: 5/ora/IP — applicato globalmente (Sprint 4)
 */
router.post("/register", validate("body", RegisterSchema), register);

/**
 * POST /api/v1/auth/login
 * Rate limit: 20/ora/IP — applicato globalmente (Sprint 4)
 */
router.post("/login", validate("body", LoginSchema), login);

export default router;
