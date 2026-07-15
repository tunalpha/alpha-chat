/**
 * Middleware authenticate — verifica JWT e blocklist JTI.
 *
 * Flusso:
 *   1. Estrae Bearer token da Authorization header
 *   2. Verifica firma ES256 + claims (exp, nbf, iss, aud)
 *   3. Controlla JTI non in blocklist Redis
 *   4. Attacca req.user con payload verificato
 *
 * Se la verifica fallisce per qualsiasi motivo → 401 UNAUTHORIZED.
 * Il middleware non distingue tra token mancante, invalido o scaduto
 * (anti-enumeration: non rivela la causa al client).
 */

import type { RequestHandler } from "express";
import { verifyAccessToken } from "../services/jwt.service";
import { isJtiBlocked } from "../lib/jti-blocklist";
import { AppError } from "../errors/AppError";
import { logger } from "../lib/logger";

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", 401);
    }

    const token = authHeader.slice(7);
    const payload = await verifyAccessToken(token);

    // Controlla se il JTI è stato revocato (logout / logout-all)
    const blocked = await isJtiBlocked(payload.jti);
    if (blocked) {
      logger.info({ jti: payload.jti }, "Access token revoked (jti blocked)");
      throw new AppError("TOKEN_REVOKED", 401);
    }

    req.user = {
      userId: payload.sub,
      deviceId: payload.device_id,
      roles: payload.roles,
      jti: payload.jti,
      accessTokenExpiresAt: new Date(payload.exp * 1000),
    };

    next();
  } catch (err) {
    // Converte tutti gli errori jose in UNAUTHORIZED (non leakare dettagli JWT)
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new AppError("UNAUTHORIZED", 401));
    }
  }
};
