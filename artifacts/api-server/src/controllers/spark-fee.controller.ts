/**
 * Spark Fee Controller
 *
 * GET  /api/v1/spark/fee-config  — lettura (requireAdmin read_only)
 * PATCH /api/v1/spark/fee-config — aggiornamento (requireAdmin super_admin)
 *
 * ISOLAMENTO:
 * - Questa config è SEPARATA da AlphaWalletFeeConfig (BTC on-chain).
 * - Modifica fee Spark → ZERO impatto su fee BTC.
 * - Provider fee (Breez routing) NON è modificabile qui.
 * - Ogni modifica genera un audit log con prev/new values + admin + timestamp.
 */

import type { Request, Response, NextFunction } from "express";
import {
  SparkFeeConfigModel,
  SPARK_FEE_DEFAULTS,
  getSparkFeeConfig,
} from "../models/spark-fee-config.model";
import { logAuditEvent } from "../lib/audit";

/** GET /api/v1/spark/fee-config */
export async function getSparkFeeConfigHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cfg = await getSparkFeeConfig();
    res.json({
      data: {
        fee_bps:            cfg.fee_bps,
        min_fee_sat:        cfg.min_fee_sat,
        quote_validity_sec: cfg.quote_validity_sec,
        // Metadati audit (solo read — non modificabili tramite questa route)
        updated_at:         cfg.updated_at        ?? null,
        updated_by_email:   cfg.updated_by_email  ?? null,
        // Nota informativa: la provider fee non è configurabile admin
        _note: "provider_fee (Breez/Spark routing) is determined by the SDK and shown separately to users",
      },
    });
  } catch (err) { next(err); }
}

/** PATCH /api/v1/spark/fee-config — Richiede super_admin */
export async function updateSparkFeeConfigHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const adminUser = (req as any).user as { userId: string; email?: string };
    const { fee_bps, min_fee_sat, quote_validity_sec } = req.body as {
      fee_bps?:            number;
      min_fee_sat?:        number;
      quote_validity_sec?: number;
    };

    // ── Validazione ────────────────────────────────────────────────────────────
    if (fee_bps !== undefined) {
      if (typeof fee_bps !== "number" || !Number.isInteger(fee_bps) || fee_bps < 0 || fee_bps > 500) {
        res.status(400).json({
          error:   "SPARK_FEE_BPS_INVALID",
          message: "fee_bps deve essere un intero tra 0 e 500 (10 = 0.10%)",
        });
        return;
      }
    }
    if (min_fee_sat !== undefined) {
      if (typeof min_fee_sat !== "number" || !Number.isInteger(min_fee_sat) || min_fee_sat < 0) {
        res.status(400).json({
          error:   "SPARK_MIN_FEE_SAT_INVALID",
          message: "min_fee_sat deve essere un intero non negativo (satoshi)",
        });
        return;
      }
    }
    if (quote_validity_sec !== undefined) {
      if (typeof quote_validity_sec !== "number" || !Number.isInteger(quote_validity_sec) || quote_validity_sec < 5 || quote_validity_sec > 300) {
        res.status(400).json({
          error:   "SPARK_QUOTE_VALIDITY_INVALID",
          message: "quote_validity_sec deve essere un intero tra 5 e 300",
        });
        return;
      }
    }

    if (fee_bps === undefined && min_fee_sat === undefined && quote_validity_sec === undefined) {
      res.status(400).json({ error: "NO_FIELDS", message: "Nessun campo valido da aggiornare" });
      return;
    }

    // ── Carica config precedente per audit ─────────────────────────────────────
    const prev = await getSparkFeeConfig();

    // ── Aggiorna ───────────────────────────────────────────────────────────────
    const $set: Record<string, unknown> = {
      updated_at:       new Date(),
      updated_by:       adminUser.userId,
      updated_by_email: adminUser.email ?? null,
    };
    if (fee_bps            !== undefined) $set.fee_bps            = fee_bps;
    if (min_fee_sat        !== undefined) $set.min_fee_sat        = min_fee_sat;
    if (quote_validity_sec !== undefined) $set.quote_validity_sec = quote_validity_sec;

    const updated = await SparkFeeConfigModel.findOneAndUpdate(
      { _id: "spark-fee" },
      { $set },
      { upsert: true, returnDocument: "after" },
    );

    // ── Audit log obbligatorio ─────────────────────────────────────────────────
    logAuditEvent({
      event:      "SPARK_FEE_UPDATED",
      user_id:    adminUser.userId,
      ip_hash:    req.ip ?? undefined,
      created_at: new Date().toISOString(),
      metadata: {
        // Valore precedente
        prev_fee_bps:            prev.fee_bps,
        prev_min_fee_sat:        prev.min_fee_sat,
        prev_quote_validity_sec: prev.quote_validity_sec,
        // Nuovo valore
        new_fee_bps:             updated?.fee_bps            ?? prev.fee_bps,
        new_min_fee_sat:         updated?.min_fee_sat        ?? prev.min_fee_sat,
        new_quote_validity_sec:  updated?.quote_validity_sec ?? prev.quote_validity_sec,
        // Invarianti — conferma che BTC non è stato toccato
        btc_fee_config_unchanged: true,
        provider_fee_unchanged:   true,
      },
    });

    res.json({
      data: {
        ok:                 true,
        fee_bps:            updated?.fee_bps            ?? SPARK_FEE_DEFAULTS.fee_bps,
        min_fee_sat:        updated?.min_fee_sat        ?? SPARK_FEE_DEFAULTS.min_fee_sat,
        quote_validity_sec: updated?.quote_validity_sec ?? SPARK_FEE_DEFAULTS.quote_validity_sec,
        updated_at:         updated?.updated_at         ?? null,
        updated_by_email:   updated?.updated_by_email   ?? null,
      },
    });
  } catch (err) { next(err); }
}
