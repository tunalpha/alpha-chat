/**
 * AuthController — strato HTTP per l'autenticazione.
 *
 * Regola: il controller è "stupido".
 * Estrae dati dalla request → chiama AuthService → formatta response.
 * Nessuna business logic qui.
 */

import type { RequestHandler } from "express";
import * as authService from "../services/auth.service";
import { successResponse } from "../utils/response";
import type { RegisterInput } from "../validation/auth.schemas";

// ---------------------------------------------------------------------------
// POST /api/v1/auth/register
// ---------------------------------------------------------------------------

export const register: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as RegisterInput;

    // Metadati di contesto estratti dalla request (non dalla business logic)
    const userAgent = req.headers["user-agent"] ?? null;
    const rawIp = req.ip ?? req.socket.remoteAddress ?? null;
    const ipHash = rawIp
      ? require("node:crypto").createHash("sha256").update(rawIp).digest("hex")
      : null;

    const result = await authService.register({
      ...body,
      userAgent,
      ipHash,
      countryCode: null, // geolocalizzazione IP: Sprint 4 (GeoIP)
    });

    res.status(201).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};
