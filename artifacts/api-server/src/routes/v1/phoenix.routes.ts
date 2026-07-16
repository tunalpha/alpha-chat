/**
 * Phoenix Routes — Sprint 18
 *
 * POST /api/v1/phoenix/setup        (autenticato) — configura Phoenix Code
 * GET  /api/v1/phoenix/recovery-card (autenticato) — dati Recovery Card
 * POST /api/v1/phoenix/initiate     (pubblico)    — verifica Phoenix Code + email
 * GET  /api/v1/phoenix/confirm      (pubblico)    — valida token da link email
 * POST /api/v1/phoenix/execute      (pubblico)    — esegue Lock / Phoenix Protocol
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { z } from "zod";
import {
  setupPhoenixCode,
  initiatePhoenix,
  validatePhoenixToken,
  executeLockMode,
  executePhoenixProtocol,
  getRecoveryCardData,
} from "../../services/phoenix.service";
import { AppError } from "../../errors/AppError";

const router = Router();

// Rate limiting aggressivo sulle route pubbliche anti-brute-force
const phoenixInitRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppi tentativi. Riprova tra 15 minuti." },
});

const phoenixExecuteRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 ora
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppi tentativi. Riprova tra un'ora." },
});

// ---------------------------------------------------------------------------
// Setup Phoenix Code (autenticato)
// ---------------------------------------------------------------------------

const setupSchema = z.object({
  body: z.object({
    phoenix_code: z.string().min(20, "Il Phoenix Code deve essere di almeno 20 caratteri"),
  }),
});

router.post(
  "/setup",
  authenticate,
  validate("body", setupSchema.shape.body),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { emergencyId } = await setupPhoenixCode({
        userId: req.user!.userId,
        phoenixCode: req.body.phoenix_code as string,
      });
      res.status(200).json({ success: true, emergency_id: emergencyId });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Recovery Card (autenticato)
// ---------------------------------------------------------------------------

router.get(
  "/recovery-card",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await getRecoveryCardData(req.user!.userId);
      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Initiate (pubblico, rate limited)
// ---------------------------------------------------------------------------

const initiateSchema = z.object({
  body: z.object({
    username: z.string().min(1),
    phoenix_code: z.string().min(1),
    action: z.enum(["lock", "destroy"]),
  }),
});

router.post(
  "/initiate",
  phoenixInitRateLimit,
  validate("body", initiateSchema.shape.body),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip ?? req.socket.remoteAddress;
      await initiatePhoenix({
        username: req.body.username as string,
        phoenixCode: req.body.phoenix_code as string,
        action: req.body.action as "lock" | "destroy",
        ip,
      });
      // Risposta generica per non rivelare se l'utente esiste o meno
      res.status(200).json({
        success: true,
        message: "Se l'utente esiste e il codice è corretto, riceverai un'email di conferma.",
      });
    } catch (err) {
      // Risposta generica anche in caso di errore di autenticazione
      if (err instanceof AppError && err.code === "INVALID_CREDENTIALS") {
        res.status(200).json({
          success: true,
          message: "Se l'utente esiste e il codice è corretto, riceverai un'email di conferma.",
        });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Confirm token (pubblico)
// ---------------------------------------------------------------------------

router.get(
  "/confirm",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.query["token"];
      if (typeof token !== "string" || !token) {
        throw new AppError("VALIDATION_ERROR", 400);
      }
      const result = await validatePhoenixToken(token);
      res.status(200).json({
        valid: true,
        username: result.username,
        action: result.action,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Execute (pubblico, rate limited, token monouso)
// ---------------------------------------------------------------------------

const executeSchema = z.object({
  body: z.object({
    token: z.string().min(1),
    action: z.enum(["lock", "destroy"]),
  }),
});

router.post(
  "/execute",
  phoenixExecuteRateLimit,
  validate("body", executeSchema.shape.body),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip ?? req.socket.remoteAddress;
      const { token, action } = req.body as { token: string; action: "lock" | "destroy" };

      if (action === "lock") {
        await executeLockMode(token, ip);
      } else {
        await executePhoenixProtocol(token, ip);
      }

      res.status(200).json({ success: true, action });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
