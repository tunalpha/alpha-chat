/**
 * Account Recovery Routes — Sprint 22
 *
 * Pubbliche (no auth):
 *   POST /auth/recover/card
 *   POST /auth/recover/email/request
 *   POST /auth/recover/email/verify
 *
 * Autenticate:
 *   GET  /account/recovery/status
 *   POST /account/recovery/email
 *   POST /account/recovery/card/regenerate
 *   POST /account/recovery/password
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import {
  recoverByCardHandler,
  requestEmailRecoveryHandler,
  verifyEmailTokenHandler,
  getRecoveryStatusHandler,
  setRecoveryEmailHandler,
  regenerateRecoveryCardHandler,
  changeTempPasswordHandler,
} from "../../controllers/account-recovery.controller";

// ── Rotte pubbliche (/auth/recover/*) ───────────────────────────────────────
export const recoveryAuthRouter = Router();

recoveryAuthRouter.post("/card",               ...recoverByCardHandler);
recoveryAuthRouter.post("/email/request",      ...requestEmailRecoveryHandler);
recoveryAuthRouter.post("/email/verify",       ...verifyEmailTokenHandler);

// ── Rotte autenticate (/account/recovery/*) ─────────────────────────────────
export const recoveryAccountRouter = Router();

recoveryAccountRouter.use(authenticate);
recoveryAccountRouter.get( "/status",           getRecoveryStatusHandler);
recoveryAccountRouter.post("/email",             ...setRecoveryEmailHandler);
recoveryAccountRouter.post("/card/regenerate",   regenerateRecoveryCardHandler);
recoveryAccountRouter.post("/password",          ...changeTempPasswordHandler);
