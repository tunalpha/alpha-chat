/**
 * admin-multichain.routes.ts — Admin endpoints per Multi-Chain Payment Engine
 *
 * Route: /api/v1/admin/multichain/...
 *
 * Endpoints:
 *   GET  /transfers              — lista con filtri (network, asset, status, from, to) e paginazione
 *   GET  /transfers/:id          — singolo trasferimento per transfer_id o client_ref
 *   GET  /stats                  — statistiche aggregate
 *   POST /transfers/:id/cancel   — annulla transfer (super_admin)
 *   POST /transfers/:id/refund   — rimborsa transfer (super_admin)
 *   POST /transfers/:id/retry    — ritenta release (super_admin)
 *
 * Autenticazione: JWT admin. Azioni mutanti richiedono super_admin.
 * ISOLAMENTO: legge/scrive solo multichain_transfers. Non tocca chat_transfers (USDA).
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { MultiChainTransferModel } from "../../models/multichain-transfer.model";
import { authenticate }            from "../../middleware/authenticate.middleware";
import { requireAdmin }            from "../../middleware/require-admin.middleware";
import { logger }                  from "../../lib/logger";
import { AppError }                from "../../errors/AppError";
import { AuditEventModel }         from "../../models/audit-event.model";

const router = Router();

// ─── Middleware ────────────────────────────────────────────────────────────────

router.use(authenticate);
router.use(requireAdmin("read_only"));

// ─── GET /transfers ───────────────────────────────────────────────────────────

/**
 * Lista trasferimenti con filtri opzionali e paginazione.
 *
 * Query params:
 *   status    — filtra per status
 *   network   — filtra per network ("polygon", "bitcoin", "ethereum", "bsc")
 *   asset     — filtra per asset ("USDT", "BTC")
 *   from      — ISO date: createdAt >= from
 *   to        — ISO date: createdAt <= to
 *   page      — pagina (default: 1)
 *   limit     — risultati per pagina (default: 20, max: 200)
 *   sortBy    — campo di ordinamento (default: "createdAt")
 *   sortDir   — "asc" | "desc" (default: "desc")
 */
router.get("/transfers", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      status,
      network,
      asset,
      from,
      to,
      page    = "1",
      limit   = "20",
      sortBy  = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const skip     = (pageNum - 1) * limitNum;

    const filter: Record<string, unknown> = {};
    if (status)  filter.status  = status;
    if (network) filter.network = network;
    if (asset)   filter.asset   = asset;

    // Date range filter on createdAt
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) { const d = new Date(from); if (!isNaN(d.getTime())) dateFilter.$gte = d; }
      if (to)   { const d = new Date(to);   if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); dateFilter.$lte = d; } }
      if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;
    }

    const allowedSortFields = ["createdAt", "updatedAt", "expires_at", "completed_at", "gross_amount"];
    const safeSortBy  = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const safeSortDir = sortDir === "asc" ? 1 : -1;

    const [transfers, total] = await Promise.all([
      MultiChainTransferModel
        .find(filter, { escrow_encrypted_pk: 0 })
        .sort({ [safeSortBy]: safeSortDir })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      MultiChainTransferModel.countDocuments(filter),
    ]);

    res.json({
      transfers,
      pagination: {
        total,
        page:      pageNum,
        limit:     limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /transfers/:id ───────────────────────────────────────────────────────

router.get("/transfers/:id", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const transferId = req.params["id"] as string;

    const transfer = await MultiChainTransferModel.findOne(
      { $or: [{ transfer_id: transferId }, { client_ref: transferId }] },
      { escrow_encrypted_pk: 0 },
    ).lean();

    if (!transfer) {
      res.status(404).json({ error: "Transfer non trovato" });
      return;
    }

    res.json({ transfer });
  } catch (err) {
    next(err);
  }
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

router.get("/stats", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [byStatus, byNetwork] = await Promise.all([
      MultiChainTransferModel.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      MultiChainTransferModel.aggregate([
        { $match: { status: { $in: ["released", "refunded"] } } },
        {
          $group: {
            _id:               "$network",
            total_gross:       { $sum: { $toLong: "$gross_amount" } },
            total_fee:         { $sum: { $toLong: "$project_fee" } },
            total_network_fee: { $sum: { $toLong: "$network_fee" } },
            count:             { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of byStatus) statusMap[row._id as string] = row.count as number;

    res.json({
      byStatus:  statusMap,
      byNetwork: byNetwork,
      totals: {
        total:         byStatus.reduce((s, r) => s + (r.count as number), 0),
        active:        (statusMap["awaiting_deposit"] ?? 0) + (statusMap["pending"] ?? 0),
        releasing:     (statusMap["releasing"] ?? 0) + (statusMap["refunding"] ?? 0),
        completed:     (statusMap["released"] ?? 0),
        refunded:      (statusMap["refunded"] ?? 0),
        expired:       (statusMap["expired"] ?? 0),
        failed:        (statusMap["failed"] ?? 0),
        waitingForGas: (statusMap["waiting_for_gas"] ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Admin Actions (super_admin only) ─────────────────────────────────────────

const superAdminMiddleware = requireAdmin("super_admin");

// POST /transfers/:id/cancel
router.post(
  "/transfers/:id/cancel",
  superAdminMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const transferId = req.params["id"] as string;
      const { reason } = req.body as { reason?: string };

      const doc = await MultiChainTransferModel.findOne(
        { $or: [{ transfer_id: transferId }, { client_ref: transferId }] },
        { escrow_encrypted_pk: 0 },
      );
      if (!doc) throw new AppError("NOT_FOUND", 404);

      const cancellableStatuses = ["awaiting_deposit", "pending"];
      if (!cancellableStatuses.includes(doc.status)) {
        throw new AppError("INVALID_STATE", 409,
          `Cannot cancel transfer in status '${doc.status}'. Allowed: ${cancellableStatuses.join(", ")}`);
      }

      await MultiChainTransferModel.findByIdAndUpdate(doc._id, {
        $set: { status: "cancelled", locked_at: null, updatedAt: new Date() },
      });

      await AuditEventModel.create({
        event:      "MC_ADMIN_CANCEL",
        user_id:    req.adminUser!.userId,
        created_at: new Date().toISOString(),
        metadata:   { transfer_id: doc.transfer_id, network: doc.network, asset: doc.asset, reason: reason ?? null, admin_role: req.adminUser!.adminRole },
      });

      logger.info({ transferId: doc.transfer_id, adminUserId: req.adminUser!.userId }, "[Admin] MC transfer cancelled");
      res.json({ ok: true, transfer_id: doc.transfer_id, new_status: "cancelled" });
    } catch (err) {
      next(err);
    }
  },
);

// POST /transfers/:id/refund
router.post(
  "/transfers/:id/refund",
  superAdminMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const transferId = req.params["id"] as string;
      const { reason } = req.body as { reason?: string };

      const doc = await MultiChainTransferModel.findOne(
        { $or: [{ transfer_id: transferId }, { client_ref: transferId }] },
        { escrow_encrypted_pk: 0 },
      );
      if (!doc) throw new AppError("NOT_FOUND", 404);

      const refundableStatuses = ["pending", "failed", "waiting_for_gas", "expired"];
      if (!refundableStatuses.includes(doc.status)) {
        throw new AppError("INVALID_STATE", 409,
          `Cannot refund transfer in status '${doc.status}'. Allowed: ${refundableStatuses.join(", ")}`);
      }

      // Idempotency: already refunded/refunding
      if (doc.status === "refunded" || doc.status === "refunding") {
        res.json({ ok: true, transfer_id: doc.transfer_id, new_status: doc.status, idempotent: true });
        return;
      }

      // Import service lazily to avoid circular deps at module init
      const { refundMultiChainTransfer } = await import("../../payment/multichain-payment.service");
      const result = await refundMultiChainTransfer(doc.transfer_id);

      await AuditEventModel.create({
        event:      "MC_ADMIN_REFUND",
        user_id:    req.adminUser!.userId,
        created_at: new Date().toISOString(),
        metadata:   { transfer_id: doc.transfer_id, network: doc.network, asset: doc.asset, reason: reason ?? null, admin_role: req.adminUser!.adminRole },
      });

      logger.info({ transferId: doc.transfer_id, adminUserId: req.adminUser!.userId }, "[Admin] MC transfer refunded");
      res.json({ ok: true, transfer_id: doc.transfer_id, new_status: result.status });
    } catch (err) {
      next(err);
    }
  },
);

// POST /transfers/:id/retry
router.post(
  "/transfers/:id/retry",
  superAdminMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const transferId = req.params["id"] as string;
      const { reason } = req.body as { reason?: string };

      const doc = await MultiChainTransferModel.findOne(
        { $or: [{ transfer_id: transferId }, { client_ref: transferId }] },
        { escrow_encrypted_pk: 0 },
      );
      if (!doc) throw new AppError("NOT_FOUND", 404);

      const retryableStatuses = ["failed", "waiting_for_gas"];
      if (!retryableStatuses.includes(doc.status)) {
        throw new AppError("INVALID_STATE", 409,
          `Cannot retry transfer in status '${doc.status}'. Allowed: ${retryableStatuses.join(", ")}`);
      }

      const { releaseFromWaitingForGas, releaseMultiChainTransfer } = await import("../../payment/multichain-payment.service");
      const result = doc.status === "waiting_for_gas"
        ? await releaseFromWaitingForGas(doc.transfer_id)
        : await releaseMultiChainTransfer(doc.transfer_id);

      await AuditEventModel.create({
        event:      "MC_ADMIN_RETRY",
        user_id:    req.adminUser!.userId,
        created_at: new Date().toISOString(),
        metadata:   { transfer_id: doc.transfer_id, network: doc.network, asset: doc.asset, reason: reason ?? null, admin_role: req.adminUser!.adminRole, new_status: result.status },
      });

      logger.info({ transferId: doc.transfer_id, adminUserId: req.adminUser!.userId }, "[Admin] MC transfer retried");
      res.json({ ok: true, transfer_id: doc.transfer_id, new_status: result.status });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
