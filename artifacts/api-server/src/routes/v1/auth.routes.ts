import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.middleware";
import { authenticate } from "../../middleware/authenticate.middleware";
import { RegisterSchema, LoginSchema, RefreshSchema } from "../../validation/auth.schemas";
import { register, login, refresh, logout, logoutAll, changeTempPasswordAuth, updateIdentityKey } from "../../controllers/auth.controller";

const router = Router();

// ─── A07: Rate limiting su endpoint pubblici ────────────────────────────────
// Login: 10 tentativi per 15 min per IP — integra l'account lockout in-DB
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Troppi tentativi di accesso. Riprova tra 15 minuti." } },
  skipSuccessfulRequests: true, // conta solo i fallimenti
});

// Register: 5 nuovi account per ora per IP (nessun limite nei test integration,
// che registrano un utente per ogni caso e superavano il tetto)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 100_000 : 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Troppe registrazioni. Riprova più tardi." } },
});

// Refresh token: 60 per 15 min per IP (multi-device + auto-refresh)
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Troppe richieste di refresh. Riprova tra poco." } },
  skipSuccessfulRequests: false,
});

// Cambio password temporanea: 5 per 15 min per IP
const changeTempPwLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Troppe richieste. Riprova tra 15 minuti." } },
});

// Pubbliche (nessun JWT richiesto)
router.post("/register", registerLimiter, validate("body", RegisterSchema), register);
router.post("/login",    loginLimiter,    validate("body", LoginSchema),    login);
router.post("/refresh",  refreshLimiter,  validate("body", RefreshSchema),  refresh);

// Protette (JWT obbligatorio)
router.post("/logout",     authenticate, logout);
router.post("/logout-all", authenticate, logoutAll);

// Sprint 22: cambio password obbligatorio dopo recovery
router.post("/change-temporary-password", changeTempPwLimiter, ...changeTempPasswordAuth);

// Sprint 28: aggiornamento blob Identity Key condivisa (migrazione / recovery)
router.patch("/identity-key", ...updateIdentityKey);

export default router;
