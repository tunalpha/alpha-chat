/**
 * Account Recovery Controller — Sprint 22
 */

import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import {
  recoverByCard,
  requestEmailRecovery,
  verifyEmailToken,
  regenerateRecoveryCard,
  setRecoveryEmail,
  getRecoveryStatus,
  changeTempPassword,
} from "../services/account-recovery.service";
import { validate } from "../middleware/validate.middleware";
import {
  RecoverByCardSchema,
  RecoverByEmailRequestSchema,
  RecoverByEmailVerifySchema,
  SetRecoveryEmailSchema,
  ChangeTempPasswordSchema,
} from "../validation/account-recovery.schemas";
import { AppError } from "../errors/AppError";

// ── POST /auth/recover/card ──────────────────────────────────────────────────
export const recoverByCardHandler = [
  validate("body", RecoverByCardSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await recoverByCard({
        username:       req.body.username,
        emergencyId:    req.body.emergency_id,
        recoverySecret: req.body.recovery_secret,
        requestId:      req.headers["x-request-id"] as string,
        ipHash:         (req as any).ipHash,
      });
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  },
];

// ── POST /auth/recover/email/request ────────────────────────────────────────
export const requestEmailRecoveryHandler = [
  validate("body", RecoverByEmailRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await requestEmailRecovery({
        username:  req.body.username,
        email:     req.body.email,
        requestId: req.headers["x-request-id"] as string,
      });
      // Risposta sempre uguale (anti-enumeration)
      res.json({ success: true, message: "Se i dati sono corretti, riceverai un link via email." });
    } catch (e) { next(e); }
  },
];

// ── POST /auth/recover/email/verify ─────────────────────────────────────────
export const verifyEmailTokenHandler = [
  validate("body", RecoverByEmailVerifySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await verifyEmailToken({
        token:     req.body.token,
        requestId: req.headers["x-request-id"] as string,
        ipHash:    (req as any).ipHash,
      });
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  },
];

// ── GET /account/recovery/status ────────────────────────────────────────────
export async function getRecoveryStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = new mongoose.Types.ObjectId((req as any).auth.userId);
    const status = await getRecoveryStatus(userId);
    res.json(status);
  } catch (e) { next(e); }
}

// ── POST /account/recovery/email ────────────────────────────────────────────
export const setRecoveryEmailHandler = [
  validate("body", SetRecoveryEmailSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = new mongoose.Types.ObjectId((req as any).auth.userId);
      await setRecoveryEmail(userId, req.body.email);
      res.json({ success: true });
    } catch (e) { next(e); }
  },
];

// ── POST /account/recovery/card/regenerate ──────────────────────────────────
export async function regenerateRecoveryCardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const auth   = (req as any).auth;
    const userId = new mongoose.Types.ObjectId(auth.userId);
    // Recupera username dal DB se non presente nel token
    const { UserModel } = await import("../models/user.model");
    const user = await UserModel.findById(userId).select("username");
    const card   = await regenerateRecoveryCard(userId, user?.username ?? auth.username ?? "");
    res.json({ success: true, card });
  } catch (e) { next(e); }
}

// ── POST /account/recovery/password ─────────────────────────────────────────
export const changeTempPasswordHandler = [
  validate("body", ChangeTempPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = new mongoose.Types.ObjectId((req as any).auth.userId);
      await changeTempPassword(userId, req.body.temp_password, req.body.new_password);
      res.json({ success: true });
    } catch (e) { next(e); }
  },
];
