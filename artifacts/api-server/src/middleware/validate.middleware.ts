import type { RequestHandler } from "express";
import type { ZodSchema } from "zod";

type Target = "body" | "query" | "params";

/**
 * Validates and parses a part of the request using a Zod schema.
 * On success the parsed (and transformed) data replaces the original.
 * On failure a ZodError is forwarded to the global error handler.
 *
 * Usage:
 *   router.post('/register', validate('body', RegisterSchema), authController.register)
 */
export function validate(target: Target, schema: ZodSchema): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(result.error);
      return;
    }
    // Replace with the parsed + transformed value
    (req as Record<string, unknown>)[target] = result.data;
    next();
  };
}
