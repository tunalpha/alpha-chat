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
import type { RegisterInput, LoginInput, RefreshInput } from "../validation/auth.schemas";

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
      countryCode: null, // GeoIP: Sprint 5
      requestId: req.requestId,
    });
    res.status(201).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
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
      countryCode: null, // GeoIP: Sprint 5
      requestId: req.requestId,
    });
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ---------------------------------------------------------------------------

export const refresh: RequestHandler = async (req, res, next) => {
  try {
    const { refresh_token } = req.body as RefreshInput;
    const result = await authService.refresh({
      refreshToken: refresh_token,
      requestId: req.requestId,
      ipHash: getIpHash(req),
    });
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout   (richiede authenticate middleware)
// ---------------------------------------------------------------------------

export const logout: RequestHandler = async (req, res, next) => {
  try {
    // req.user garantito dal middleware authenticate
    const user = req.user!;
    await authService.logout({
      userId: user.userId,
      deviceId: user.deviceId,
      jti: user.jti,
      accessTokenExpiresAt: user.accessTokenExpiresAt,
      requestId: req.requestId,
      ipHash: getIpHash(req),
    });
    res.status(200).json(successResponse({ message: "Logout effettuato" }, req.requestId));
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout-all   (richiede authenticate middleware)
// ---------------------------------------------------------------------------

export const logoutAll: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user!;
    const result = await authService.logoutAll({
      userId: user.userId,
      deviceId: user.deviceId,
      jti: user.jti,
      accessTokenExpiresAt: user.accessTokenExpiresAt,
      requestId: req.requestId,
      ipHash: getIpHash(req),
    });
    res.status(200).json(successResponse({
      message: "Disconnesso da tutti i dispositivi",
      revoked_sessions: result.revokedCount,
    }, req.requestId));
  } catch (err) { next(err); }
};
