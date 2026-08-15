/**
 * spark-fee.controller.ts — Platform Fee Spark / Lightning
 *
 * Gestisce la configurazione della fee, la registrazione del debito e la
 * raccolta fisica della fee (architettura C2+A).
 *
 * ARCHITETTURA C2+A:
 *   POST   /fee-record             — client registra fee come pending_collection
 *   PATCH  /fee-record/collected   — client notifica avvenuto pagamento Spark (Tier 1)
 *   PATCH  /fee-record/bulk-collected — client notifica pagamento aggregato (Tier 2)
 *   GET    /fee-record/pending     — client legge fee pendenti al login/connect
 *   GET    /user-fee-config        — client legge fee BPS + fee_address (non admin)
 *
 * GUARDRAIL:
 *   - recordSparkFeeHandler:      status="pending_collection", userId tracciato
 *   - markFeeCollectedHandler:    idempotente, previene doppia riscossione
 *   - getPendingFeesHandler:      restituisce solo le fee del proprio userId
 *
 * ISOLAMENTO:
 *   - Zero import da BTC fee engine, MultiChain, USDA, Payment Engine
 *   - Zero modifica al main Lightning payment flow
 */

import type { Request, Response, NextFunction } from "express";
import { getSparkFeeConfig }  from "../models/spark-fee-config.model.js";
import {
  recordSparkFee,
  markSparkFeeCollected,
  markSparkFeesBulkCollected,
  getSparkFeePending,
  emitSparkFeeAccountingFailureAlert,
} from "../services/spark-treasury-accounting.js";

// ─── Lettura config (admin) ───────────────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-config
 * Restituisce la configurazione completa della fee Spark (inclusi campi audit).
 * Accesso: read_only admin o superiore.
 */
export async function getSparkFeeConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cfg = await getSparkFeeConfig();
    res.json({
      data: {
        fee_bps:            cfg.fee_bps,
        min_fee_sat:        cfg.min_fee_sat,
        quote_validity_sec: cfg.quote_validity_sec,
        fee_address:        cfg.fee_address ?? null,
        updated_at:         cfg.updated_at         ?? null,
        updated_by:         cfg.updated_by         ?? null,
        updated_by_email:   cfg.updated_by_email   ?? null,
      },
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/v1/spark/user-fee-config
 * Restituisce la configurazione fee per il client (utente autenticato, non admin).
 * Include fee_address per Tier-1 e Tier-2 fee collection.
 * Fail-safe: mai lancia — restituisce defaults se il DB non è raggiungibile.
 */
export async function getUserFeeConfigHandler(
  _req: Request,
  res:  Response,
): Promise<void> {
  try {
    const cfg = await getSparkFeeConfig();
    res.json({
      data: {
        fee_bps:            cfg.fee_bps,
        min_fee_sat:        cfg.min_fee_sat,
        quote_validity_sec: cfg.quote_validity_sec,
        fee_address:        cfg.fee_address ?? null,
      },
    });
  } catch {
    // Fail-safe: restituisce defaults se DB non raggiungibile
    res.json({
      data: {
        fee_bps:            10,
        min_fee_sat:        1,
        quote_validity_sec: 30,
        fee_address:        null,
      },
    });
  }
}

// ─── Modifica config (super admin) ───────────────────────────────────────────

import { SparkFeeConfigModel, SPARK_FEE_DEFAULTS } from "../models/spark-fee-config.model.js";
import { logger } from "../lib/logger.js";

/**
 * PATCH /api/v1/spark/fee-config
 * Aggiorna la configurazione della Platform Fee Spark.
 * Genera audit log con prev/new values + admin + timestamp.
 * Accesso: super_admin.
 *
 * Campi aggiornabili:
 *   fee_bps, min_fee_sat, quote_validity_sec, fee_address
 *
 * NOTA: fee_address viene configurato DOPO la verifica del wallet.
 * Prima di impostarlo, verificare con la documentazione Breez Spark.
 */
export async function updateSparkFeeConfigHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const admin = (req as unknown as { adminEmail?: string }).adminEmail ?? "unknown";
    const {
      fee_bps,
      min_fee_sat,
      quote_validity_sec,
      fee_address,
    } = req.body as {
      fee_bps?:            number;
      min_fee_sat?:        number;
      quote_validity_sec?: number;
      fee_address?:        string | null;
    };

    const prev = await getSparkFeeConfig();
    const $set: Record<string, unknown> = {
      updated_at:       new Date(),
      updated_by:       admin,
      updated_by_email: admin,
    };

    if (fee_bps !== undefined) {
      if (typeof fee_bps !== "number" || fee_bps < 0 || fee_bps > 500) {
        res.status(400).json({ error: "INVALID_FEE_BPS", message: "fee_bps: 0–500" });
        return;
      }
      $set["fee_bps"] = fee_bps;
    }
    if (min_fee_sat !== undefined) {
      if (typeof min_fee_sat !== "number" || min_fee_sat < 0) {
        res.status(400).json({ error: "INVALID_MIN_FEE_SAT", message: "min_fee_sat >= 0" });
        return;
      }
      $set["min_fee_sat"] = min_fee_sat;
    }
    if (quote_validity_sec !== undefined) {
      if (typeof quote_validity_sec !== "number" || quote_validity_sec < 5 || quote_validity_sec > 300) {
        res.status(400).json({ error: "INVALID_QUOTE_VALIDITY", message: "quote_validity_sec: 5–300" });
        return;
      }
      $set["quote_validity_sec"] = quote_validity_sec;
    }
    if (fee_address !== undefined) {
      if (fee_address !== null && typeof fee_address !== "string") {
        res.status(400).json({ error: "INVALID_FEE_ADDRESS", message: "fee_address: string|null" });
        return;
      }
      // fee_address è un indirizzo Spark pubblico (identity pubkey), non una chiave privata.
      // Il mnemonic del wallet NON deve mai essere salvato qui.
      $set["fee_address"] = fee_address;
    }

    const updated = await SparkFeeConfigModel.findOneAndUpdate(
      { _id: "spark-fee" },
      { $set },
      { returnDocument: "after" },
    );

    logger.info({
      event:  "SPARK_FEE_CONFIG_UPDATED",
      admin,
      prev:   { fee_bps: prev.fee_bps, min_fee_sat: prev.min_fee_sat, quote_validity_sec: prev.quote_validity_sec, fee_address: prev.fee_address },
      next:   { fee_bps: updated?.fee_bps, min_fee_sat: updated?.min_fee_sat, quote_validity_sec: updated?.quote_validity_sec, fee_address: updated?.fee_address },
    }, "[SparkFeeConfig] Configurazione aggiornata");

    res.json({
      data: {
        ok:                 true,
        fee_bps:            updated?.fee_bps            ?? SPARK_FEE_DEFAULTS.fee_bps,
        min_fee_sat:        updated?.min_fee_sat        ?? SPARK_FEE_DEFAULTS.min_fee_sat,
        quote_validity_sec: updated?.quote_validity_sec ?? SPARK_FEE_DEFAULTS.quote_validity_sec,
        fee_address:        updated?.fee_address        ?? null,
        updated_at:         updated?.updated_at         ?? null,
        updated_by_email:   updated?.updated_by_email   ?? null,
      },
    });
  } catch (err) { next(err); }
}

// ─── Registrazione fee pendente (Tier 1 — client) ────────────────────────────

/**
 * POST /api/v1/spark/fee-record
 *
 * Registra nel ledger MongoDB la fee Alpha Platform come pending_collection.
 * Chiamato dal client immediatamente dopo ogni invio Lightning completato.
 * Il client tenterà poi l'invio Spark (Tier 1) e — se fallisce — il Tier 2
 * al prossimo avvio/login.
 *
 * Idempotente: paymentId è la chiave di deduplicazione.
 * Auth: utente autenticato normale (NON admin).
 * Fire-and-forget lato client: risposta 200/201 non blocca il flusso UI.
 *
 * ISOLAMENTO: non tocca BTC fee engine, MultiChain, USDA, Payment Engine.
 * SCOPE LOCK: non modifica il main Lightning payment flow.
 */
export async function recordSparkFeeHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = (req as { user?: { userId?: string; email?: string } }).user;
    const { paymentId, alphaPlatformFeeSat } = req.body as {
      paymentId:           string;
      alphaPlatformFeeSat: number;
    };

    if (!paymentId || typeof paymentId !== "string" || paymentId.length < 16) {
      res.status(400).json({ error: "INVALID_PAYMENT_ID", message: "paymentId obbligatorio (min 16 chars)" });
      return;
    }
    if (typeof alphaPlatformFeeSat !== "number" || alphaPlatformFeeSat < 0) {
      res.status(400).json({ error: "INVALID_FEE", message: "alphaPlatformFeeSat deve essere un numero >= 0" });
      return;
    }

    // fee_address: usata come riferimento nel ledger, non per l'invio reale
    const cfg       = await getSparkFeeConfig();
    const feeWallet = cfg.fee_address ?? process.env["BTC_FEE_WALLET"] ?? "pending-wallet-setup";

    try {
      const result = await recordSparkFee({
        paymentHash:         paymentId,
        alphaPlatformFeeSat: BigInt(Math.round(alphaPlatformFeeSat)),
        feeWallet,
        userId: user?.userId,
      });
      res.status(result.duplicate ? 200 : 201).json({ data: { ok: true, duplicate: result.duplicate } });
    } catch (err) {
      emitSparkFeeAccountingFailureAlert(
        paymentId,
        BigInt(Math.round(alphaPlatformFeeSat)),
        err,
      );
      res.json({ data: { ok: false, error: "ACCOUNTING_FAILED" } });
    }
  } catch (err) { next(err); }
}

// ─── Marcatura come raccolto (Tier 1 singolo) ────────────────────────────────

/**
 * PATCH /api/v1/spark/fee-record/collected
 *
 * Chiamato dal client dopo che il pagamento Spark fee (Tier 1) è completato.
 * Aggiorna lo status da pending_collection → success con feePaymentId.
 * Idempotente: stesso feePaymentId → 200 con duplicate=true.
 *
 * Body: { mainPaymentId: string, feePaymentId: string }
 */
export async function markFeeCollectedHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { mainPaymentId, feePaymentId } = req.body as {
      mainPaymentId: string;
      feePaymentId:  string;
    };

    if (!mainPaymentId || !feePaymentId) {
      res.status(400).json({ error: "MISSING_FIELDS", message: "mainPaymentId e feePaymentId sono obbligatori" });
      return;
    }

    const recordId = mainPaymentId.startsWith("spark_") ? mainPaymentId : `spark_${mainPaymentId}`;
    const result   = await markSparkFeeCollected(recordId, feePaymentId);

    res.json({ data: { ok: result.ok, duplicate: result.duplicate } });
  } catch (err) { next(err); }
}

// ─── Marcatura bulk come raccolte (Tier 2 aggregato) ─────────────────────────

/**
 * PATCH /api/v1/spark/fee-record/bulk-collected
 *
 * Chiamato dal client dopo che il pagamento Spark aggregato (Tier 2) è completato.
 * Un unico feePaymentId copre N fee pendenti raccolte in un solo pagamento.
 * Idempotente: record già success vengono ignorati.
 *
 * Body: { mainPaymentIds: string[], feePaymentId: string }
 */
export async function markFeesBulkCollectedHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { mainPaymentIds, feePaymentId } = req.body as {
      mainPaymentIds: string[];
      feePaymentId:   string;
    };

    if (!Array.isArray(mainPaymentIds) || mainPaymentIds.length === 0) {
      res.status(400).json({ error: "MISSING_FIELDS", message: "mainPaymentIds (array non vuoto) è obbligatorio" });
      return;
    }
    if (!feePaymentId || typeof feePaymentId !== "string") {
      res.status(400).json({ error: "MISSING_FIELDS", message: "feePaymentId è obbligatorio" });
      return;
    }

    const recordIds = mainPaymentIds.map(id =>
      id.startsWith("spark_") ? id : `spark_${id}`,
    );

    const result = await markSparkFeesBulkCollected(recordIds, feePaymentId);
    res.json({ data: { ok: result.ok, updated: result.updated } });
  } catch (err) { next(err); }
}

// ─── Fee pendenti per utente (Tier 2 — client) ───────────────────────────────

/**
 * GET /api/v1/spark/fee-record/pending
 *
 * Restituisce le fee pendenti dell'utente autenticato.
 * Include il fee_address attuale per il pagamento Spark.
 * Se fee_address è null: il client sa che non deve tentare il pagamento.
 *
 * Auth: utente autenticato normale (NON admin).
 */
export async function getPendingFeesHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = (req as { user?: { userId?: string } }).user;
    if (!user?.userId) {
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }

    const [pending, cfg] = await Promise.all([
      getSparkFeePending(user.userId),
      getSparkFeeConfig(),
    ]);

    res.json({
      data: {
        feeAddress:  cfg.fee_address ?? null,
        pendingFees: pending.records,
        totalSat:    pending.totalSat,
      },
    });
  } catch (err) { next(err); }
}
