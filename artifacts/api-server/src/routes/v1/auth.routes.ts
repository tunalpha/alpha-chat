import { Router } from "express";
import { validate } from "../../middleware/validate.middleware";
import { authenticate } from "../../middleware/authenticate.middleware";
import { RegisterSchema, LoginSchema, RefreshSchema } from "../../validation/auth.schemas";
import { register, login, refresh, logout, logoutAll } from "../../controllers/auth.controller";

const router = Router();

// Pubbliche (nessun JWT richiesto)
router.post("/register", validate("body", RegisterSchema), register);
router.post("/login",    validate("body", LoginSchema),    login);
router.post("/refresh",  validate("body", RefreshSchema),  refresh);

// Protette (JWT obbligatorio)
router.post("/logout",     authenticate, logout);
router.post("/logout-all", authenticate, logoutAll);

export default router;
