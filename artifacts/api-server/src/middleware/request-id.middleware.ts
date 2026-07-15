import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

/**
 * Attaches a unique request ID to every request.
 * Uses X-Request-ID from the client if present and valid (UUID v4),
 * otherwise generates a new one.
 * The ID is available as req.requestId and echoed in response headers.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const clientId = req.headers["x-request-id"];
  const requestId =
    typeof clientId === "string" && clientId.length > 0 && clientId.length <= 64
      ? clientId
      : randomUUID();

  // Attach to request for use in controllers and logger
  req.requestId = requestId;

  // Echo back so the client can correlate logs
  res.setHeader("X-Request-ID", requestId);

  next();
};
