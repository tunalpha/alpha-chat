/**
 * AuthController — strato HTTP per l'autenticazione.
 *
 * Regola: il controller è "stupido".
 * Estrae dati dalla request → chiama AuthService → formatta response.
 * Nessuna business logic qui.
 */

import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import * as authService from "../services/auth.service";
import { successResponse } from "../utils/response";
import type { RegisterInput, LoginInput } from "../validation/auth.schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIpHash(req: Parameters<RequestHandler>[0]): string | null {
  const rawIp = req.ip ?? req.socket.remoteAddress ?? null;
  return rawIp ? createHash("sha256").update(rawIp).digest("hex") : null;
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/register
// ---------------------------------------------------------------------------

export const register: RequestHandler = async (req, res, next) => {
  try {
    const result = await authService.register({
      ...(req.body as RegisterInput),
      userAgent: req.headers["user-agent"] ?? null,
      ipHash: getIpHash(req),
      countryCode: null, // GeoIP: Sprint 4
      requestId: req.requestId,
    });
    res.status(201).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// ---------------------------------------------------------------------------

export const login: RequestHandler = async (req, res, next) => {
  try {
    const result = await authService.login({
      ...(req.body as LoginInput),
      userAgent: req.headers["user-agent"] ?? null,
      ipHash: getIpHash(req),
      countryCode: null, // GeoIP: Sprint 4
      requestId: req.requestId,
    });
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};
