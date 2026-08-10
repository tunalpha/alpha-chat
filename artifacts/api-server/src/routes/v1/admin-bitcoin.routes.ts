/**
 * admin-bitcoin.routes.ts — Admin endpoints per Bitcoin Operations
 *
 * Route: /api/v1/admin/bitcoin/...
 *
 * Endpoints:
 *   GET   /status   — fee rate, attività BTC, escrow summary, wallet balances
 *   PATCH /config   — aggiorna treasury wallet (DB-backed, no restart)
 *
 * Autenticazione: JWT admin read_only (GET) / read_only (PATCH — solo wallet config).
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { MultiChainTransferModel } from "../../models/multichain-transfer.model";
import { BtcSettingsModel }        from "../../models/btc-settings.model";
import { authenticate }             from "../../middleware/authenticate.middleware";
import { requireAdmin }             from "../../middleware/require-admin.middleware";
import { logger }                   from "../../lib/logger";
import { getBtcTreasuryWallet }     from "../../blockchain/multichain-config";

const router = Router();

router.use(authenticate);
router.use(requireAdmin("read_only"));

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Validazione indirizzo BTC: mainnet bech32 (bc1q/bc1p) + legacy (1…/3…) */
function isValidBtcAddress(addr: string): boolean {
  return /^(bc1[a-z0-9]{6,90}|[13][a-zA-Z0-9]{24,34})$/.test(addr.trim());
}

/** Fetcha balance onchain da Blockstream; restituisce sat o null su errore */
async function fetchBtcBalance(address: string | null): Promise<string | null> {
  if (!address) return null;
  try {
    const url  = `https://blockstream.info/api/address/${address.trim()}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      chain_stats:   { funded_txo_sum: number; spent_txo_sum: number };
      mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
    };
    const sat =
      data.chain_stats.funded_txo_sum   - data.chain_stats.spent_txo_sum +
      data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
    return String(sat);
  } catch {
    return null;
  }
}

// ─── GET /status ───────────────────────────────────────────────────────────────

router.get("/status", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { BitcoinApiClient } = await import("../../blockchain/bitcoin/bitcoin-api");
    const btcApi = new BitcoinApiClient();

    // Leggi indirizzi wallet
    const treasuryWallet = await getBtcTreasuryWallet();
    const feeWallet      = process.env.BTC_FEE_WALLET ?? null;

    // Fetch tutto in parallelo
    const [feeRates, btcByStatus, recentTransfers, treasuryBalance, feeBalance] =
      await Promise.allSettled([
        Promise.all([
          btcApi.estimateFeeRate(1).then((r) => ({ target: 1,   rate: r, label: "Next block (~10 min)" })),
          btcApi.estimateFeeRate(3).then((r) => ({ target: 3,   rate: r, label: "~30 min" })),
          btcApi.estimateFeeRate(6).then((r) => ({ target: 6,   rate: r, label: "~1 hour" })),
          btcApi.estimateFeeRate(144).then((r) => ({ target: 144, rate: r, label: "~24 hours" })),
        ]),

        MultiChainTransferModel.aggregate([
          { $match: { network: "bitcoin" } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),

        MultiChainTransferModel
          .find({ network: "bitcoin" }, { escrow_encrypted_pk: 0 })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),

        fetchBtcBalance(treasuryWallet),
        fetchBtcBalance(feeWallet),
      ]);

    const feeRateData  = feeRates.status  === "fulfilled" ? feeRates.value  : null;
    const feeRateError = feeRates.status  === "rejected"
      ? String((feeRates as PromiseRejectedResult).reason) : null;

    const statusMap: Record<string, number> = {};
    if (btcByStatus.status === "fulfilled") {
      for (const row of btcByStatus.value) statusMap[row._id as string] = row.count as number;
    }

    const recent = recentTransfers.status === "fulfilled" ? recentTransfers.value : [];

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
    const btcVolume = btcVolumeResult[0] ?? {
      total_count: 0, total_gross: 0, total_fee: 0, total_network_fee: 0,
    };

    logger.debug("[Admin/Bitcoin] status fetched");

    res.json({
      provider: {
        name:    "Blockstream.info",
        network: process.env.BTC_NETWORK ?? "mainnet",
        url:     process.env.BTC_API_URL ?? "https://blockstream.info/api",
      },
      feeRates:     feeRateData,
      feeRateError: feeRateError,

      // Wallet configuration
      treasuryWallet:        treasuryWallet,
      treasuryWalletBalance: treasuryBalance.status === "fulfilled" ? treasuryBalance.value : null,
      feeWallet:             feeWallet,
      feeWalletBalance:      feeBalance.status === "fulfilled" ? feeBalance.value : null,

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
          count:         btcVolume.total_count as number,
          grossSat:      String(btcVolume.total_gross),
          projectFeeSat: String(btcVolume.total_fee),
          networkFeeSat: String(btcVolume.total_network_fee),
        },
      },
      recent: recent,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /config ─────────────────────────────────────────────────────────────

/**
 * Aggiorna la configurazione BTC (treasury wallet).
 * Salva in MongoDB → effetto immediato senza restart.
 * Body: { treasury_wallet: string }
 */
router.patch("/config", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { treasury_wallet } = req.body as { treasury_wallet?: string };

    if (treasury_wallet !== undefined) {
      const addr = (treasury_wallet ?? "").trim();
      if (addr === "") {
        // Rimuovi override DB → torna all'env var
        await BtcSettingsModel.deleteOne({ key: "treasury_wallet" });
        logger.info("[Admin/Bitcoin] treasury_wallet DB override rimosso");
      } else {
        if (!isValidBtcAddress(addr)) {
          res.status(400).json({ error: "Indirizzo BTC non valido" });
          return;
        }
        const userId = (req as unknown as { user?: { _id?: string } }).user?._id ?? "admin";
        await BtcSettingsModel.findOneAndUpdate(
          { key: "treasury_wallet" },
          { $set: { value: addr, updated_at: new Date(), updated_by: String(userId) } },
          { upsert: true },
        );
        logger.info(`[Admin/Bitcoin] treasury_wallet aggiornato → ${addr}`);
      }
    }

    // Risposta con stato attuale
    const current = await getBtcTreasuryWallet();
    res.json({ ok: true, treasury_wallet: current });
  } catch (err) {
    next(err);
  }
});

export default router;
