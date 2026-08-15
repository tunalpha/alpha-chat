/**
 * spark-sweep.controller.ts — REST handlers per il sweep fee wallet
 *
 * SCOPE LOCK: NON tocca main payment, prepareSend, sendPayment, BTC on-chain.
 * SICUREZZA: mnemonic mai in response, mai in log, mai in MongoDB.
 */

import type { Request, Response, NextFunction } from "express";
import {
  triggerManualSweep,
  getSweepPreview,
  getSweepHistory,
  getSweepStatus,
  checkAndQueueAutoSweep,
  isValidTreasuryAddress,
  fetchBtcPriceEur,
  eurToSat,
} from "../services/spark-sweep.service.js";
import { SparkSweepOperationModel } from "../models/spark-sweep-operation.model.js";
import { getSparkFeeConfig, SparkFeeConfigModel } from "../models/spark-fee-config.model.js";
import { logger } from "../lib/logger.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function adminEmail(req: Request): string {
  return (req as unknown as { adminEmail?: string }).adminEmail ?? "unknown";
}

// ─── GET /fee-wallet/sweep/preview ───────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/sweep/preview
 * Restituisce un'anteprima del prelievo: saldo, importo, treasury, prezzo BTC.
 * Usato dal dialog "Richiedi prelievo" prima della conferma.
 * Accesso: read_only admin.
 */
export async function getSweepPreviewHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const preview = await getSweepPreview();
    res.json({ data: preview });
  } catch (err) { next(err); }
}

// ─── POST /fee-wallet/sweep/trigger ──────────────────────────────────────────

/**
 * POST /api/v1/spark/fee-wallet/sweep/trigger
 * Avvia un prelievo manuale verso il treasury Spark.
 * Accesso: super_admin.
 *
 * Risponde immediatamente con operationId — lo sweep avviene in background.
 * Usa GET /sweep/status o GET /sweep/history per monitorare.
 *
 * IDEMPOTENZA: se già processing → 409 con messaggio.
 * SICUREZZA: mnemonic mai in response.
 */
export async function triggerManualSweepHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const email  = adminEmail(req);
    const result = await triggerManualSweep(email);

    if (!result.ok) {
      res.status(409).json({ error: "SWEEP_NOT_POSSIBLE", message: result.error });
      return;
    }

    logger.info({ operationId: result.operationId, adminEmail: email }, "[SweepCtrl] Sweep manuale accodato");
    res.status(202).json({ data: { ok: true, operationId: result.operationId } });
  } catch (err) { next(err); }
}

// ─── GET /fee-wallet/sweep/status ────────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/sweep/status
 * Stato corrente dello sweep: pending/processing, ultimo sweep, config.
 * Accesso: read_only admin.
 */
export async function getSweepStatusHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const status = await getSweepStatus();
    res.json({ data: status });
  } catch (err) { next(err); }
}

// ─── GET /fee-wallet/sweep/history ───────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/sweep/history?page=1&limit=20
 * Storico sweep paginato.
 * Accesso: read_only admin.
 */
export async function getSweepHistoryHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page  = Math.max(1, parseInt(String(req.query["page"]  ?? "1"),  10) || 1);
    const limit = Math.min(100, parseInt(String(req.query["limit"] ?? "20"), 10) || 20);
    const result = await getSweepHistory(page, limit);
    res.json({ data: result });
  } catch (err) { next(err); }
}

// ─── PATCH /fee-wallet/sweep/config ──────────────────────────────────────────

/**
 * PATCH /api/v1/spark/fee-wallet/sweep/config
 * Aggiorna configurazione sweep: soglia EUR, treasury address, auto-sweep.
 * Accesso: super_admin.
 *
 * Body (tutti opzionali):
 *   sweep_threshold_eur:          number (1–100000)
 *   sweep_treasury_spark_address: string | null
 *   auto_sweep_enabled:           boolean
 */
export async function updateSweepConfigHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const {
      sweep_threshold_eur,
      sweep_treasury_spark_address,
      auto_sweep_enabled,
    } = req.body as {
      sweep_threshold_eur?:          number;
      sweep_treasury_spark_address?: string | null;
      auto_sweep_enabled?:           boolean;
    };

    const $set: Record<string, unknown> = {
      updated_at:    new Date(),
      updated_by:    adminEmail(req),
    };

    if (sweep_threshold_eur !== undefined) {
      if (typeof sweep_threshold_eur !== "number" || sweep_threshold_eur < 1 || sweep_threshold_eur > 100_000) {
        res.status(400).json({ error: "INVALID_THRESHOLD", message: "sweep_threshold_eur deve essere tra 1 e 100000" });
        return;
      }
      $set["sweep_threshold_eur"] = sweep_threshold_eur;
    }

    if (sweep_treasury_spark_address !== undefined) {
      if (sweep_treasury_spark_address !== null && !isValidTreasuryAddress(sweep_treasury_spark_address)) {
        res.status(400).json({
          error:   "INVALID_TREASURY_ADDRESS",
          message: "sweep_treasury_spark_address deve iniziare con sp1 (mainnet) o sprt (testnet), oppure null",
        });
        return;
      }
      $set["sweep_treasury_spark_address"] = sweep_treasury_spark_address;
    }

    if (auto_sweep_enabled !== undefined) {
      if (typeof auto_sweep_enabled !== "boolean") {
        res.status(400).json({ error: "INVALID_AUTO_SWEEP", message: "auto_sweep_enabled deve essere boolean" });
        return;
      }
      $set["auto_sweep_enabled"] = auto_sweep_enabled;
    }

    const updated = await SparkFeeConfigModel.findOneAndUpdate(
      { _id: "spark-fee" },
      { $set },
      { upsert: true, returnDocument: "after" },
    );

    logger.info(
      { adminEmail: adminEmail(req), changes: Object.keys($set) },
      "[SweepCtrl] Configurazione sweep aggiornata",
    );

    res.json({
      data: {
        ok:                           true,
        sweep_threshold_eur:          updated?.sweep_threshold_eur,
        sweep_treasury_spark_address: updated?.sweep_treasury_spark_address ?? null,
        auto_sweep_enabled:           updated?.auto_sweep_enabled,
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /fee-wallet/sweep/config ────────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/sweep/config
 * Configurazione sweep corrente + soglia in SAT calcolata live.
 * Accesso: read_only admin.
 */
export async function getSweepConfigHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cfg = await getSparkFeeConfig();

    let btcPriceEur: number | null = null;
    let thresholdSat: number | null = null;
    try {
      btcPriceEur  = await fetchBtcPriceEur();
      thresholdSat = eurToSat(cfg.sweep_threshold_eur, btcPriceEur);
    } catch { /* prezzo non disponibile — restituisci null */ }

    res.json({
      data: {
        sweep_threshold_eur:          cfg.sweep_threshold_eur,
        sweep_treasury_spark_address: cfg.sweep_treasury_spark_address ?? null,
        auto_sweep_enabled:           cfg.auto_sweep_enabled,
        btc_price_eur:                btcPriceEur,
        threshold_sat:                thresholdSat,
      },
    });
  } catch (err) { next(err); }
}

// ─── POST /fee-wallet/sweep/auto-check ───────────────────────────────────────

/**
 * POST /api/v1/spark/fee-wallet/sweep/auto-check
 * Forza un controllo auto-sweep immediato (super_admin, per debug/test).
 * In produzione lo scheduler lo chiama autonomamente ogni 15 min.
 */
export async function forceAutoSweepCheckHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    void checkAndQueueAutoSweep().catch(e =>
      logger.error({ err: e }, "[SweepCtrl] forceAutoSweepCheck fallito"),
    );
    res.json({ data: { ok: true, message: "Auto-sweep check avviato in background" } });
  } catch (err) { next(err); }
}

// ─── GET /fee-wallet/sweep/operation/:id ─────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/sweep/operation/:id
 * Stato di una specifica operazione sweep (polling dal client dopo trigger).
 * Accesso: read_only admin.
 * SICUREZZA: lastError è sanitizzato (no mnemonic).
 */
export async function getSweepOperationHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const op = await SparkSweepOperationModel.findById(req.params["id"]).lean();
    if (!op) {
      res.status(404).json({ error: "NOT_FOUND", message: "Operazione sweep non trovata" });
      return;
    }
    res.json({ data: op });
  } catch (err) { next(err); }
}
