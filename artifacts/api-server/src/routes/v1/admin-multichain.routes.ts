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
import { McFeeOverrideModel }      from "../../models/mc-fee-override.model";
import {
  McNetworkFeeConfigModel,
  getNetworkFeeConfig,
  DEFAULT_SAFETY_MARGIN_BPS,
}                                  from "../../models/mc-network-fee-config.model";
import { DEFAULT_FEE_BPS }         from "../../blockchain/fee-config";
import { authenticate }            from "../../middleware/authenticate.middleware";
import { requireAdmin }            from "../../middleware/require-admin.middleware";
import { logger }                  from "../../lib/logger";
import { AppError }                from "../../errors/AppError";
import { AuditEventModel }         from "../../models/audit-event.model";
import { getNativePriceCacheStatus } from "../../blockchain/native-price-provider";

// ─── Reti supportate ─────────────────────────────────────────────────────────

const SUPPORTED_NETWORKS = ["polygon", "ethereum", "bsc", "bitcoin"] as const;
type SupportedNetwork = typeof SUPPORTED_NETWORKS[number];

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

// ─── GET /fee-config ──────────────────────────────────────────────────────────

/**
 * Restituisce la configurazione project fee corrente per tutte le reti.
 *
 * Per ogni rete mostra:
 *   - fee_bps: valore attuale (DB override o default globale)
 *   - is_override: true se configurato manualmente in DB
 *   - updated_at, updated_by, note: metadati dell'ultima modifica
 */
router.get("/fee-config", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const defaultBps = Number(DEFAULT_FEE_BPS);
    const overrides  = await McFeeOverrideModel.find({}).lean();
    const overrideMap = new Map(overrides.map(o => [o.network, o]));

    const networks = SUPPORTED_NETWORKS.map((network: SupportedNetwork) => {
      const override = overrideMap.get(network);
      return {
        network,
        label:       network.charAt(0).toUpperCase() + network.slice(1),
        fee_bps:     override ? override.fee_bps : defaultBps,
        is_override: !!override,
        updated_at:  override ? override.updated_at.toISOString() : null,
        updated_by:  override ? override.updated_by_admin_id : null,
        note:        override ? override.note : null,
      };
    });

    res.json({ networks, default_bps: defaultBps });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /fee-config/:network — super_admin ───────────────────────────────────

/**
 * Imposta o aggiorna la project fee per una specifica rete.
 *
 * Body: { fee_bps: number [0–10000], note?: string }
 *
 * Effetto immediato sui nuovi transfer. I transfer già creati non sono impattati.
 * Registra un evento audit per tracciabilità.
 */
router.put(
  "/fee-config/:network",
  requireAdmin("super_admin"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const network = req.params["network"] as string;

      if (!SUPPORTED_NETWORKS.includes(network as SupportedNetwork)) {
        throw new AppError("INVALID_NETWORK", 400,
          `Rete non supportata: '${network}'. Valori ammessi: ${SUPPORTED_NETWORKS.join(", ")}`);
      }

      const { fee_bps, note } = req.body as { fee_bps?: unknown; note?: unknown };

      if (fee_bps === undefined || fee_bps === null) {
        throw new AppError("MISSING_FIELD", 400, "Il campo 'fee_bps' è obbligatorio");
      }
      const bps = Number(fee_bps);
      if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
        throw new AppError("INVALID_FEE_BPS", 400,
          `fee_bps deve essere un intero in [0, 10000], ricevuto: ${fee_bps}`);
      }

      const adminId = req.adminUser!.userId;
      const now     = new Date();

      const updated = await McFeeOverrideModel.findOneAndUpdate(
        { network } as Record<string, unknown>,
        {
          $set: {
            fee_bps:              bps,
            updated_at:           now,
            updated_by_admin_id:  adminId,
            note:                 typeof note === "string" ? note.trim().slice(0, 500) || null : null,
          },
        },
        { upsert: true, new: true },
      ).lean();

      await AuditEventModel.create({
        event:      "MC_ADMIN_FEE_CONFIG_UPDATE",
        user_id:    adminId,
        created_at: now.toISOString(),
        metadata:   {
          network,
          fee_bps:     bps,
          note:        updated?.note ?? null,
          admin_role:  req.adminUser!.adminRole,
          prev_fee_bps: undefined,  // non richiamiamo valore precedente per semplicità
        },
      });

      logger.info(
        { network, fee_bps: bps, adminUserId: adminId },
        "[Admin] MC project fee aggiornata",
      );

      res.json({
        ok:         true,
        network,
        fee_bps:    bps,
        updated_at: now.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /fee-config/:network — rimuove override (torna al default) ────────

router.delete(
  "/fee-config/:network",
  requireAdmin("super_admin"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const network = req.params["network"] as string;

      if (!SUPPORTED_NETWORKS.includes(network as SupportedNetwork)) {
        throw new AppError("INVALID_NETWORK", 400, `Rete non supportata: '${network}'`);
      }

      await McFeeOverrideModel.findOneAndDelete({ network } as Record<string, unknown>);

      await AuditEventModel.create({
        event:      "MC_ADMIN_FEE_CONFIG_RESET",
        user_id:    req.adminUser!.userId,
        created_at: new Date().toISOString(),
        metadata:   { network, reset_to_default: true, admin_role: req.adminUser!.adminRole },
      });

      logger.info({ network, adminUserId: req.adminUser!.userId }, "[Admin] MC fee override rimosso — torna al default");

      res.json({ ok: true, network, reset_to_default: true, default_bps: Number(DEFAULT_FEE_BPS) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /network-fee-config ──────────────────────────────────────────────────
//
// Restituisce la configurazione safety margin per ogni rete EVM.
// Separata dalla project fee (fee-config). BTC: non applicabile (no gas).
// Espone anche lo stato della cache prezzi nativi per diagnostica.

router.get("/network-fee-config", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const evmNetworks: SupportedNetwork[] = ["polygon", "ethereum", "bsc"];
    const docs = await McNetworkFeeConfigModel.find({ network: { $in: evmNetworks } }).lean();
    const overrideMap = new Map(docs.map(d => [d.network, d]));

    const networks = evmNetworks.map((network: SupportedNetwork) => {
      const doc = overrideMap.get(network);
      return {
        network,
        label:               network.charAt(0).toUpperCase() + network.slice(1),
        safety_margin_bps:   doc?.safety_margin_bps   ?? DEFAULT_SAFETY_MARGIN_BPS,
        max_network_fee_raw: doc?.max_network_fee_raw  ?? null,
        is_override:         !!doc,
        updated_at:          doc?.updated_at?.toISOString() ?? null,
        updated_by:          doc?.updated_by_admin_id       ?? null,
        note:                doc?.note                      ?? null,
      };
    });

    // Aggiunge diagnostica cache prezzi (utile per debug)
    const priceCache = getNativePriceCacheStatus();

    res.json({
      networks,
      default_safety_margin_bps: DEFAULT_SAFETY_MARGIN_BPS,
      price_cache: priceCache,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /network-fee-config/:network — super_admin ───────────────────────────
//
// Aggiorna la configurazione safety margin per una rete specifica.
// Body: { safety_margin_bps: number [10000–50000], max_network_fee_raw?: string|null, note?: string }

router.put(
  "/network-fee-config/:network",
  requireAdmin("super_admin"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const network = req.params["network"] as string;
      const evmNetworks = ["polygon", "ethereum", "bsc"];

      if (!evmNetworks.includes(network)) {
        throw new AppError("INVALID_NETWORK", 400,
          `Safety margin supportato solo per reti EVM: ${evmNetworks.join(", ")}. BTC non ha gas dinamico.`);
      }

      const { safety_margin_bps, max_network_fee_raw, note } =
        req.body as { safety_margin_bps?: unknown; max_network_fee_raw?: unknown; note?: unknown };

      if (safety_margin_bps === undefined || safety_margin_bps === null) {
        throw new AppError("MISSING_FIELD", 400, "Il campo 'safety_margin_bps' è obbligatorio");
      }

      const marginBps = Number(safety_margin_bps);
      if (!Number.isInteger(marginBps) || marginBps < 10_000 || marginBps > 50_000) {
        throw new AppError("INVALID_SAFETY_MARGIN", 400,
          `safety_margin_bps deve essere un intero in [10000, 50000] (= tra 0% e 400%), ricevuto: ${safety_margin_bps}`);
      }

      // max_network_fee_raw: opzionale, stringa BigInt o null
      let maxFeeRaw: string | null = null;
      if (max_network_fee_raw !== undefined && max_network_fee_raw !== null && max_network_fee_raw !== "") {
        // Valida che sia una stringa BigInt valida
        try {
          BigInt(max_network_fee_raw as string);
          maxFeeRaw = String(max_network_fee_raw);
        } catch {
          throw new AppError("INVALID_MAX_FEE", 400,
            `max_network_fee_raw deve essere una stringa BigInt valida (o null), ricevuto: ${max_network_fee_raw}`);
        }
      }

      const adminId = req.adminUser!.userId;
      const now     = new Date();

      await McNetworkFeeConfigModel.findOneAndUpdate(
        { network } as Record<string, unknown>,
        {
          $set: {
            safety_margin_bps:   marginBps,
            max_network_fee_raw: maxFeeRaw,
            updated_at:          now,
            updated_by_admin_id: adminId,
            note: typeof note === "string" ? note.trim().slice(0, 500) || null : null,
          },
        },
        { upsert: true, new: true },
      ).lean();

      await AuditEventModel.create({
        event:      "MC_ADMIN_NETWORK_FEE_CONFIG_UPDATE",
        user_id:    adminId,
        created_at: now.toISOString(),
        metadata:   {
          network,
          safety_margin_bps: marginBps,
          max_network_fee_raw: maxFeeRaw,
          admin_role: req.adminUser!.adminRole,
        },
      });

      logger.info(
        { network, safety_margin_bps: marginBps, max_network_fee_raw: maxFeeRaw, adminUserId: adminId },
        "[Admin] MC network fee config aggiornata",
      );

      res.json({
        ok:                  true,
        network,
        safety_margin_bps:   marginBps,
        max_network_fee_raw: maxFeeRaw,
        updated_at:          now.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /network-fee-config/:network — ripristina default safety margin ───

router.delete(
  "/network-fee-config/:network",
  requireAdmin("super_admin"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const network = req.params["network"] as string;
      const evmNetworks = ["polygon", "ethereum", "bsc"];

      if (!evmNetworks.includes(network)) {
        throw new AppError("INVALID_NETWORK", 400, `Rete non valida: ${network}`);
      }

      await McNetworkFeeConfigModel.findOneAndDelete({ network } as Record<string, unknown>);

      await AuditEventModel.create({
        event:      "MC_ADMIN_NETWORK_FEE_CONFIG_RESET",
        user_id:    req.adminUser!.userId,
        created_at: new Date().toISOString(),
        metadata:   { network, reset_to_default: true, admin_role: req.adminUser!.adminRole },
      });

      logger.info({ network, adminUserId: req.adminUser!.userId }, "[Admin] MC network fee config reset → default");

      res.json({
        ok:                            true,
        network,
        reset_to_default:              true,
        default_safety_margin_bps:     DEFAULT_SAFETY_MARGIN_BPS,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /network-fee-config/prices — stato cache prezzi nativi ───────────────
//
// Per diagnostica: mostra l'età della cache CoinGecko per ogni rete.
// Utile per verificare che il provider sia healthy prima di creare transfer.

router.get("/network-fee-config/prices", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const status = getNativePriceCacheStatus();
    const allHealthy = Object.values(status).every(s => s !== null && s.ageSeconds < 300);
    res.json({ prices: status, healthy: allHealthy });
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
