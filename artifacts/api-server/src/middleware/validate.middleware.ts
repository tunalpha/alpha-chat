import type { RequestHandler } from "express";
import type { ZodSchema } from "zod";

type Target = "body" | "query" | "params";

/**
 * Validates and parses a part of the request using a Zod schema.
 * On success the parsed (and transformed) data replaces the original.
 * On failure a ZodError is forwarded to the global error handler.
 *
 * Note: req.query and req.params are getter-only properties in Express 5 /
 * Node.js http.IncomingMessage. Direct assignment throws TypeError.
 * We use Object.defineProperty to redefine them as writable.
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
    // Replace with the parsed + transformed value.
    // For 'query' and 'params', req[target] is a getter-only property in some
    // Express/Node versions — use Object.defineProperty to safely override it.
    if (target === "body") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).body = result.data;
    } else {
      Object.defineProperty(req, target, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}
