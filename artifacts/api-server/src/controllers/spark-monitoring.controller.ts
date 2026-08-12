/**
 * spark-monitoring.controller.ts — Admin Spark/Lightning Monitoring
 *
 * SCOPE: esclusivamente monitoring e observability. NON modifica:
 *   - logiche di invio/ricezione Spark
 *   - BTC on-chain, EVM, USDA, Payment Engine, Chat, Signal
 *   - fee BTC, fee model, Treasury BTC
 *   - spark-treasury-accounting, spark-fee-config
 *
 * DATI REALI: tutti i valori provengono da `alpha_wallet_fee_records`
 * (source="spark_lightning") e da AdminSettings.
 * NON vengono prodotti mock o valori inventati.
 *
 * PRIVACY: nessun secret, mnemonic, private key, API key restituito.
 * Breez VITE_BREEZ_API_KEY: verificata la presenza (boolean), MAI il valore.
 *
 * Routes (registrate in spark.routes.ts):
 *   GET /api/v1/spark/monitoring/dashboard      — aggregate stats
 *   GET /api/v1/spark/monitoring/movements      — paginated fee records
 *   GET /api/v1/spark/monitoring/health         — health check
 *   GET /api/v1/spark/monitoring/reconciliation — fee reconciliation
 */

import { type Request, type Response, type NextFunction } from "express";
import { AlphaWalletFeeRecordModel } from "../models/alpha-wallet-fee-record.model.js";
import AdminSettingsModel            from "../models/admin-settings.model.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

type DateRange = "24h" | "7d" | "30d" | "all";

function cutoffForRange(range: string): Date | null {
  const ms: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d" : 7  * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const v = ms[range];
  return v ? new Date(Date.now() - v) : null;
}

function sumFeeAmount(records: Array<{ feeAmount: string }>): number {
  return records.reduce((s, r) => s + parseFloat(r.feeAmount || "0"), 0);
}

/** Verifica la presenza di VITE_BREEZ_API_KEY senza mai restituirne il valore. */
function breezKeyConfigured(): boolean {
  return Boolean(process.env.VITE_BREEZ_API_KEY);
}

// ─── GET /api/v1/spark/monitoring/dashboard ───────────────────────────────────

export async function getSparkDashboardHandler(
  _req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const [adminSettings, allRecords] = await Promise.all([
      AdminSettingsModel.findOne().select("spark_lightning_enabled").lean(),
      AlphaWalletFeeRecordModel.find({ source: "spark_lightning" })
        .select("status feeAmount createdAt")
        .lean(),
    ]);

    const sparkEnabled = adminSettings?.spark_lightning_enabled ?? false;
    const total        = allRecords.length;
    const completed    = allRecords.filter(r => r.status === "success");
    const failed       = allRecords.filter(r => r.status !== "success");

    const alphaFeesSuccess = sumFeeAmount(completed);
    const alphaFeesFailed  = sumFeeAmount(failed);

    const lastMovementAt = total > 0
      ? allRecords.reduce<Date | null>((latest, r) => {
          const d = r.createdAt as Date;
          return !latest || d > latest ? d : latest;
        }, null)
      : null;

    const errorRatePct = total > 0
      ? parseFloat(((failed.length / total) * 100).toFixed(2))
      : 0;

    res.json({
      data: {
        spark_enabled:              sparkEnabled,
        breez_api_key_configured:   breezKeyConfigured(),
        movements_total:            total,
        movements_completed:        completed.length,
        movements_failed:           failed.length,
        // Pagamenti pending non tracciati lato server (client-side Breez SDK IDB).
        movements_pending_note:     "N/D lato server — tracciato nel client Breez SDK",
        alpha_fees_success:         alphaFeesSuccess.toFixed(8),
        alpha_fees_failed:          alphaFeesFailed.toFixed(8),
        error_rate_percent:         errorRatePct,
        last_movement_at:           lastMovementAt ?? null,
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /api/v1/spark/monitoring/movements ───────────────────────────────────
//
// Query params:
//   range  = 24h | 7d | 30d | all   (default: 7d)
//   status = success | failed_transient | failed_permanent (default: omitted → tutti)
//   limit  = 1–200                   (default: 50)
//   page   = 1-based                 (default: 1)

const VALID_STATUSES = new Set(["success", "failed_transient", "failed_permanent"]);

export async function getSparkMovementsHandler(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const range  = typeof req.query.range  === "string" ? req.query.range  : "7d";
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit  = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"),  10) || 50,  1), 200);
    const page   = Math.max(parseInt(String(req.query.page  ?? "1"),   10) || 1, 1);

    const filter: Record<string, unknown> = { source: "spark_lightning" };
    const cutoff = cutoffForRange(range);
    if (cutoff) filter["createdAt"] = { $gte: cutoff };
    if (status && VALID_STATUSES.has(status)) filter["status"] = status;

    const [total, records] = await Promise.all([
      AlphaWalletFeeRecordModel.countDocuments(filter),
      AlphaWalletFeeRecordModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    res.json({
      data: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
        records: records.map(r => ({
          _id:         r._id,
          network:     r.network,
          assetSymbol: r.assetSymbol,
          feeAmount:   r.feeAmount,
          status:      r.status,
          feeTxHash:   r.feeTxHash    ?? null,
          lastError:   r.lastError    ?? null,
          attempts:    r.attempts,
          createdAt:   r.createdAt,
          updatedAt:   r.updatedAt,
          // PRIVACY: nessun seed, mnemonic, private key, wallet utente
        })),
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /api/v1/spark/monitoring/health ─────────────────────────────────────

export async function getSparkHealthHandler(
  _req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [adminSettings, failed24h, total24h, failedPermanent] = await Promise.all([
      AdminSettingsModel.findOne().select("spark_lightning_enabled").lean(),
      AlphaWalletFeeRecordModel.countDocuments({
        source:    "spark_lightning",
        status:    { $in: ["failed_transient", "failed_permanent"] },
        createdAt: { $gte: cutoff24h },
      }),
      AlphaWalletFeeRecordModel.countDocuments({
        source:    "spark_lightning",
        createdAt: { $gte: cutoff24h },
      }),
      AlphaWalletFeeRecordModel.countDocuments({
        source: "spark_lightning",
        status: "failed_permanent",
      }),
    ]);

    const sparkEnabled      = adminSettings?.spark_lightning_enabled ?? false;
    const keyConfigured     = breezKeyConfigured();
    const errorRate24h      = total24h > 0
      ? parseFloat(((failed24h / total24h) * 100).toFixed(2))
      : 0;

    const alerts: string[] = [];
    let overallStatus: "healthy" | "warning" | "critical" = "healthy";

    const markWorse = (s: "warning" | "critical") => {
      if (s === "critical" || overallStatus === "healthy") overallStatus = s;
    };

    if (!keyConfigured) {
      markWorse("critical");
      alerts.push("VITE_BREEZ_API_KEY non configurata — SDK Spark non funzionerà");
    }
    if (!sparkEnabled) {
      alerts.push("Spark Lightning disabilitato (kill switch attivo)");
    }
    if (errorRate24h > 20) {
      markWorse("critical");
      alerts.push(`Error rate 24h critico: ${errorRate24h}% (${failed24h}/${total24h})`);
    } else if (errorRate24h > 5) {
      markWorse("warning");
      alerts.push(`Error rate 24h elevato: ${errorRate24h}% (${failed24h}/${total24h})`);
    }
    if (failedPermanent > 0) {
      markWorse("warning");
      alerts.push(`${failedPermanent} fee record con failed_permanent — intervento manuale richiesto`);
    }

    res.json({
      data: {
        overall_status:               overallStatus,
        spark_enabled:                sparkEnabled,
        breez_api_key_configured:     keyConfigured,
        // Breez operator reachability: verificabile solo lato client
        operator_reachability_note:   "Raggiungibilità nodo Spark verificabile solo lato client (Breez SDK IDB)",
        error_rate_24h_percent:       errorRate24h,
        failed_count_24h:             failed24h,
        total_count_24h:              total24h,
        failed_permanent_total:       failedPermanent,
        alerts,
        checked_at:                   new Date().toISOString(),
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /api/v1/spark/monitoring/reconciliation ──────────────────────────────

export async function getSparkReconciliationHandler(
  _req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const all = await AlphaWalletFeeRecordModel
      .find({ source: "spark_lightning" })
      .select("status feeAmount")
      .lean();

    const success  = all.filter(r => r.status === "success");
    const failed   = all.filter(r => r.status !== "success");

    const successAmt = sumFeeAmount(success);
    const failedAmt  = sumFeeAmount(failed);
    const reconciled = failedAmt === 0;

    res.json({
      data: {
        status:              reconciled ? "ok" : "mismatch",
        total_records:       all.length,
        success_records:     success.length,
        failed_records:      failed.length,
        // alpha_wallet_fee_records con source=spark_lightning IS il Treasury Spark.
        // Mismatch = fee non recuperate da record falliti.
        alpha_fees_success:  successAmt.toFixed(8),
        alpha_fees_failed:   failedAmt.toFixed(8),
        difference:          failedAmt.toFixed(8),
        reconciliation_note: [
          "alpha_wallet_fee_records source=spark_lightning È il Treasury Spark.",
          "Nessun record BTC on-chain modificato o consultato.",
          "Differenza = fee Alpha non recuperate da movimenti falliti.",
        ].join(" "),
        alert:      !reconciled,
        checked_at: new Date().toISOString(),
      },
    });
  } catch (err) { next(err); }
}
