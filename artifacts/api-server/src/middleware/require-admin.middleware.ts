/**
 * requireAdmin — middleware di autorizzazione per il pannello admin.
 *
 * Verifica il JWT Bearer nell'header Authorization e controlla che l'utente
 * abbia un admin_role sufficiente per l'operazione richiesta.
 *
 * Gerarchia ruoli (dal più basso al più alto):
 *   read_only → support → security_admin → super_admin
 */

import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/jwt.service";
import { AppError } from "../errors/AppError";

// ---------------------------------------------------------------------------
// Gerarchia dei ruoli
// ---------------------------------------------------------------------------

const ROLE_LEVELS: Record<string, number> = {
  read_only: 1,
  support: 2,
  security_admin: 3,
  super_admin: 4,
};

export type AdminRole = "read_only" | "support" | "security_admin" | "super_admin";

// Aggiunta type safety all'oggetto request
declare global {
  namespace Express {
    interface Request {
      adminUser?: {
        userId: string;
        adminRole: AdminRole;
        jti: string;
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function requireAdmin(minRole: AdminRole = "read_only") {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // Estrai token dall'header Authorization: Bearer <token>
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        throw new AppError("MISSING_TOKEN", 401);
      }

      const token = authHeader.slice(7);
      const payload = await verifyAccessToken(token);

      // Cerca il ruolo admin nel claims roles[]
      // Il formato è: roles = ["admin:super_admin"] o ["admin:security_admin"] etc.
      const adminRoleClaim = payload.roles.find((r: string) => r.startsWith("admin:"));
      if (!adminRoleClaim) {
        throw new AppError("FORBIDDEN", 403);
      }

      const adminRole = adminRoleClaim.replace("admin:", "") as AdminRole;
      const roleLevel = ROLE_LEVELS[adminRole] ?? 0;
      const requiredLevel = ROLE_LEVELS[minRole] ?? 0;

      if (roleLevel < requiredLevel) {
        throw new AppError("INSUFFICIENT_ROLE", 403);
      }

      req.adminUser = {
        userId: payload.sub,
        adminRole,
        jti: payload.jti,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
