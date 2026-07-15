import type { RequestHandler } from "express";
import { config } from "../config";

/**
 * Validates the X-Client-Version header.
 * In production, requests from versions below MIN_CLIENT_VERSION are rejected.
 * In development the header is optional.
 *
 * Version format: MAJOR.MINOR.PATCH (semver, integers only)
 */
function parseVersion(v: string): [number, number, number] | null {
  const parts = v.trim().split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return null;
  return nums as [number, number, number];
}

function isVersionAtLeast(
  client: [number, number, number],
  min: [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    if ((client[i] ?? 0) > (min[i] ?? 0)) return true;
    if ((client[i] ?? 0) < (min[i] ?? 0)) return false;
  }
  return true; // equal
}

export const clientVersionMiddleware: RequestHandler = (req, res, next) => {
  // Skip check in development
  if (config.app.env !== "production") {
    next();
    return;
  }

  const header = req.headers["x-client-version"];
  if (!header || typeof header !== "string") {
    next();
    return;
  }

  const clientVersion = parseVersion(header);
  const minVersion = parseVersion(config.app.minClientVersion);

  if (!clientVersion || !minVersion) {
    next();
    return;
  }

  if (!isVersionAtLeast(clientVersion, minVersion)) {
    res.status(426).json({
      error: {
        code: "CLIENT_VERSION_TOO_OLD",
        message: `La versione dell'app non è più supportata. Aggiorna all'ultima versione.`,
        min_version: config.app.minClientVersion,
        your_version: header,
        field: null,
        details: null,
        docs: "https://docs.alphachat.app/errors/CLIENT_VERSION_TOO_OLD",
      },
    });
    return;
  }

  next();
};
