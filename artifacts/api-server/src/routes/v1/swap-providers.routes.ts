/**
 * Swap Provider Manager — API routes
 *
 * ISOLAMENTO: completamente separato da payment, USDA, MultiChain, Li.Fi operativo.
 *
 * Routes:
 *   GET  /api/v1/swap/providers          — lista provider (admin read_only)
 *   PATCH /api/v1/swap/providers/:id     — aggiorna provider (admin super_admin)
 *   GET  /api/v1/swap/providers/audit    — audit log modifiche (admin super_admin)
 *
 * SICUREZZA:
 *   - Tutte le route richiedono admin autenticato (requireAdmin middleware)
 *   - Nessun utente normale può leggere o modificare la configurazione
 *   - Ogni modifica viene registrata nel audit log con adminId e timestamp
 *   - Il backend valida e applica le regole — il frontend non può bypassarle
 *
 * NON modificare comportamento operativo Li.Fi (lifi-client.ts invariato).
 * ChangeNOW rimane DISABLED — nessuna API ChangeNOW viene mai chiamata da qui.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middleware/require-admin.middleware.js";
import {
  getProviderConfiguration,
  updateProviderConfig,
  getProviderAuditLog,
} from "../../services/swap/swap-provider-router.service.js";

const router = Router();

// ── Schema validazione ────────────────────────────────────────────────────────

const PatchProviderSchema = z.object({
  status:     z.enum(["enabled", "disabled", "fallback"]).optional(),
  isPrimary:  z.boolean().optional(),
  isFallback: z.boolean().optional(),
  reason:     z.string().max(500).optional(),
});

// ── GET /api/v1/swap/providers ────────────────────────────────────────────────

router.get(
  "/",
  requireAdmin("read_only"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const providers = await getProviderConfiguration();
      res.json({ ok: true, providers });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/v1/swap/providers/audit ─────────────────────────────────────────

router.get(
  "/audit",
  requireAdmin("super_admin"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
      const log   = await getProviderAuditLog(limit);
      res.json({ ok: true, log });
    } catch (err) {
      next(err);
    }
  },
);

// ── PATCH /api/v1/swap/providers/:id ─────────────────────────────────────────

router.patch(
  "/:id",
  requireAdmin("super_admin"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providerId = String(req.params.id);

      const parsed = PatchProviderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues });
        return;
      }

      // adminId e adminEmail dal middleware requireAdmin
      const adminId    = (req as Request & { admin?: { _id: string; email?: string } }).admin?._id ?? "unknown";
      const adminEmail = (req as Request & { admin?: { _id: string; email?: string } }).admin?.email;

      const updated = await updateProviderConfig({
        adminId:    String(adminId),
        adminEmail: adminEmail,
        providerId,
        ...parsed.data,
      });

      res.json({ ok: true, provider: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("PROVIDER_NOT_FOUND") || msg.startsWith("INVALID_CONFIG")) {
        res.status(400).json({ ok: false, error: msg });
        return;
      }
      next(err);
    }
  },
);

export default router;
