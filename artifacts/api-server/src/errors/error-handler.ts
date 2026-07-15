import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "./AppError";
import { errorResponse } from "../utils/response";
import { logger } from "../lib/logger";

/**
 * Global Express error handler.
 * Must be registered LAST in app.ts — after all routes.
 *
 * Handles:
 * - AppError  → structured API error (expected)
 * - ZodError  → validation failure (from validate middleware)
 * - Unknown   → 500 Internal Server Error
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId;

  if (err instanceof AppError) {
    // Expected application error — log at warn level
    logger.warn(
      { code: err.code, httpStatus: err.httpStatus, requestId },
      "Application error",
    );
    res.status(err.httpStatus).json(errorResponse(err, requestId));
    return;
  }

  if (err instanceof ZodError) {
    const firstError = err.errors[0];
    const field = firstError?.path.join(".") || undefined;
    const appErr = new AppError("VALIDATION_ERROR", 400, field, {
      issues: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
    });
    logger.warn({ field, requestId }, "Validation error");
    res.status(400).json(errorResponse(appErr, requestId));
    return;
  }

  // Unhandled / unexpected error — log at error level with full stack
  logger.error({ err, requestId }, "Unhandled error");
  const internalErr = new AppError("INTERNAL_ERROR", 500);
  res.status(500).json(errorResponse(internalErr, requestId));
};
