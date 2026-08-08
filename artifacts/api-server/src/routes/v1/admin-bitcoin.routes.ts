/**
 * admin-bitcoin.routes.ts — Admin endpoints per Bitcoin Operations
 *
 * Route: /api/v1/admin/bitcoin/...
 *
 * Endpoints:
 *   GET  /status   — fee rate Blockstream, attività BTC recente, escrow summary
 *
 * Autenticazione: JWT admin read_only.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { MultiChainTransferModel } from "../../models/multichain-transfer.model";
import { authenticate }            from "../../middleware/authenticate.middleware";
import { requireAdmin }            from "../../middleware/require-admin.middleware";
import { logger }                  from "../../lib/logger";

const router = Router();

router.use(authenticate);
router.use(requireAdmin("read_only"));

// ─── GET /status ──────────────────────────────────────────────────────────────

/**
 * Stato operativo Bitcoin:
 * - Fee rate corrente Blockstream (1/3/6/144 block target)
 * - Contatori transfer BTC per status
 * - Ultimi 20 transfer BTC (deposit / payout / refund)
 * - Provider status
 */
router.get("/status", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { BitcoinApiClient } = await import("../../blockchain/bitcoin/bitcoin-api");
    const btcApi = new BitcoinApiClient();

    // Fetch fee rates + BTC transfer stats in parallel
    const [feeRates, btcByStatus, recentTransfers] = await Promise.allSettled([
      // Fee rates for 4 confirmation targets
      Promise.all([
        btcApi.estimateFeeRate(1).then((r) => ({ target: 1,   rate: r, label: "Next block (~10 min)" })),
        btcApi.estimateFeeRate(3).then((r) => ({ target: 3,   rate: r, label: "~30 min" })),
        btcApi.estimateFeeRate(6).then((r) => ({ target: 6,   rate: r, label: "~1 hour" })),
        btcApi.estimateFeeRate(144).then((r) => ({ target: 144, rate: r, label: "~24 hours" })),
      ]),

      // BTC transfer counts by status
      MultiChainTransferModel.aggregate([
        { $match: { network: "bitcoin" } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      // Last 20 BTC transfers
      MultiChainTransferModel
        .find({ network: "bitcoin" }, { escrow_encrypted_pk: 0 })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    // Parse fee rates
    const feeRateData = feeRates.status === "fulfilled" ? feeRates.value : null;
    const feeRateError = feeRates.status === "rejected"
      ? String((feeRates as PromiseRejectedResult).reason)
      : null;

    // Parse status counts
    const statusMap: Record<string, number> = {};
    if (btcByStatus.status === "fulfilled") {
      for (const row of btcByStatus.value) statusMap[row._id as string] = row.count as number;
    }

    // Parse recent transfers
    const recent = recentTransfers.status === "fulfilled" ? recentTransfers.value : [];

    // Aggregate BTC volumes (completed only)
    const btcVolumeResult = await MultiChainTransferModel.aggregate([
      { $match: { network: "bitcoin", status: { $in: ["released", "refunded"] } } },
      {
        $group: {
          _id:           null,
          total_count:   { $sum: 1 },
          total_gross:   { $sum: { $toLong: "$gross_amount" } },
          total_fee:     { $sum: { $toLong: "$project_fee" } },
          total_network_fee: { $sum: { $toLong: "$network_fee" } },
        },
      },
    ]);
    const btcVolume = btcVolumeResult[0] ?? { total_count: 0, total_gross: 0, total_fee: 0, total_network_fee: 0 };

    logger.debug("[Admin/Bitcoin] status fetched");

    res.json({
      provider: {
        name:    "Blockstream.info",
        network: process.env.BTC_NETWORK ?? "mainnet",
        url:     process.env.BTC_API_URL ?? "https://blockstream.info/api",
      },
      feeRates:     feeRateData,
      feeRateError: feeRateError,
      transfers: {
        byStatus: statusMap,
        totals: {
          total:         Object.values(statusMap).reduce((a, b) => a + b, 0),
          active:        (statusMap["awaiting_deposit"] ?? 0) + (statusMap["pending"] ?? 0),
          releasing:     (statusMap["releasing"] ?? 0) + (statusMap["refunding"] ?? 0),
          released:      statusMap["released"] ?? 0,
          refunded:      statusMap["refunded"] ?? 0,
          failed:        statusMap["failed"] ?? 0,
          waitingForGas: statusMap["waiting_for_gas"] ?? 0,
        },
        volume: {
          count:            btcVolume.total_count as number,
          grossSat:         String(btcVolume.total_gross),
          projectFeeSat:    String(btcVolume.total_fee),
          networkFeeSat:    String(btcVolume.total_network_fee),
        },
      },
      recent: recent,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
