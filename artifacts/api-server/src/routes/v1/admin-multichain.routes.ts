/**
 * admin-multichain.routes.ts — Admin endpoints per Multi-Chain Payment Engine
 *
 * Route: /api/v1/admin/multichain/...
 *
 * Endpoints:
 *   GET  /transfers           — lista trasferimenti con filtri e paginazione
 *   GET  /transfers/:id       — singolo trasferimento per transfer_id
 *   GET  /stats               — statistiche aggregate (per admin dashboard)
 *
 * Autenticazione: require admin JWT (middleware authenticate + requireAdmin).
 * ISOLAMENTO: legge solo multichain_transfers. Non tocca chat_transfers (USDA).
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { MultiChainTransferModel } from "../../models/multichain-transfer.model";
import { authenticate }            from "../../middleware/authenticate.middleware";
import { requireAdmin }            from "../../middleware/require-admin.middleware";
import { logger }                  from "../../lib/logger";

const router = Router();

// ─── Middleware ────────────────────────────────────────────────────────────────

// H-1: richiede JWT valido + ruolo admin (minimo read_only)
// unauthenticated → 401 | non-admin → 403 | admin ✓ → 200
router.use(authenticate);
router.use(requireAdmin("read_only"));

// ─── GET /transfers ───────────────────────────────────────────────────────────

/**
 * Lista trasferimenti con filtri opzionali e paginazione.
 *
 * Query params:
 *   status    — filtra per status (es. "releasing", "pending")
 *   network   — filtra per network ("polygon", "bitcoin", ...)
 *   asset     — filtra per asset ("USDT", "BTC")
 *   page      — pagina (default: 1)
 *   limit     — risultati per pagina (default: 50, max: 200)
 *   sortBy    — campo di ordinamento (default: "createdAt")
 *   sortDir   — "asc" | "desc" (default: "desc")
 */
router.get("/transfers", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      status,
      network,
      asset,
      page    = "1",
      limit   = "50",
      sortBy  = "createdAt",
      sortDir = "desc",
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip     = (pageNum - 1) * limitNum;

    // Costruisci filtro
    const filter: Record<string, unknown> = {};
    if (status)  filter.status  = status;
    if (network) filter.network = network;
    if (asset)   filter.asset   = asset;

    // Ordinamento
    const allowedSortFields = ["createdAt", "updatedAt", "expires_at", "completed_at", "gross_amount"];
    const safeSortBy  = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const safeSortDir = sortDir === "asc" ? 1 : -1;

    const [transfers, total] = await Promise.all([
      MultiChainTransferModel
        .find(filter, {
          escrow_encrypted_pk: 0, // mai esporre la PK cifrata via admin API
        })
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

/**
 * Statistiche aggregate per la dashboard admin.
 * Conta trasferimenti per status, volume per network, fee totali.
 */
router.get("/stats", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [byStatus, byNetwork] = await Promise.all([
      // Conta per status
      MultiChainTransferModel.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Volume per network (solo released)
      MultiChainTransferModel.aggregate([
        { $match: { status: { $in: ["released", "refunded"] } } },
        {
          $group: {
            _id:              "$network",
            total_gross:      { $sum: { $toLong: "$gross_amount" } },
            total_fee:        { $sum: { $toLong: "$project_fee" } },
            total_network_fee:{ $sum: { $toLong: "$network_fee" } },
            count:            { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Struttura leggibile
    const statusMap: Record<string, number> = {};
    for (const row of byStatus) statusMap[row._id as string] = row.count as number;

    res.json({
      byStatus:  statusMap,
      byNetwork: byNetwork,
      totals: {
        total:          byStatus.reduce((s, r) => s + (r.count as number), 0),
        active:         (statusMap["awaiting_deposit"] ?? 0) + (statusMap["pending"] ?? 0),
        releasing:      (statusMap["releasing"] ?? 0) + (statusMap["refunding"] ?? 0),
        completed:      (statusMap["released"] ?? 0),
        refunded:       (statusMap["refunded"] ?? 0),
        expired:        (statusMap["expired"] ?? 0),
        failed:         (statusMap["failed"] ?? 0),
        // Gas Reserve Protection: transfer con deposito confermato in attesa di gas
        waitingForGas:  (statusMap["waiting_for_gas"] ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
