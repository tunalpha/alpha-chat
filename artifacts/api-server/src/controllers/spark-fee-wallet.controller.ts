/**
 * spark-fee-wallet.controller.ts — Alpha Spark Fee Wallet — Admin Handlers
 *
 * Endpoint per il monitoring e la gestione del fee wallet Spark.
 * Accessibili solo agli admin (read_only o super_admin).
 *
 * SECURITY:
 * - mnemonic MAI letto né esposto
 * - sparkAddress è pubblico (receiving address)
 * - liveBalance null finché SDK non è connesso
 *
 * ISOLAMENTO:
 * - Zero import da main Lightning payment flow
 * - Zero import da BTC fee engine, MultiChain, USDA
 */

import type { Request, Response, NextFunction } from "express";
import {
  getFeeWalletInfo,
  getFeeWalletStats,
  getFeeWalletHistory,
  getSweepDesign,
  checkFeeWalletHealth,
} from "../services/spark-fee-wallet.service.js";
import { SparkFeeConfigModel } from "../models/spark-fee-config.model.js";
import { logger } from "../lib/logger.js";

// ─── Info wallet ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/info
 *
 * Stato corrente del wallet:
 *   - status: not_configured | address_only | sdk_connected | error
 *   - sparkAddress (pubblico — ricevente)
 *   - ledgerBalanceSat (da MongoDB)
 *   - liveBalanceSat (da SDK — null se non connesso)
 *   - mnemonicConfigured: boolean (MAI il valore)
 *   - apiKeyConfigured: boolean (MAI il valore)
 *
 * Accesso: read_only admin
 */
export async function getFeeWalletInfoHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const info = await getFeeWalletInfo();
    res.json({ data: info });
  } catch (err) { next(err); }
}

// ─── Statistiche ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/stats
 *
 * Statistiche aggregate dei fee records:
 *   pending, success, failed, swept — count + totalSat ciascuno
 *   totalCollectedSat = somma fee con status=success
 *
 * Accesso: read_only admin
 */
export async function getFeeWalletStatsHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stats = await getFeeWalletStats();
    res.json({ data: stats });
  } catch (err) { next(err); }
}

// ─── Storico ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/history?page=1&limit=25&status=
 *
 * Storico fee records paginato.
 * Privacy: userId non esposto (privacy-by-design).
 * Include: mainPaymentId, feeAmountSat, status, feePaymentId, date, errori.
 * Note: feePaymentId = Spark payment ID del pagamento verso Alpha Spark Fee Wallet.
 *
 * Accesso: read_only admin
 */
export async function getFeeWalletHistoryHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page   = Math.max(1, parseInt(String(req.query?.["page"]  ?? "1"),  10));
    const limit  = Math.min(100, Math.max(1, parseInt(String(req.query?.["limit"] ?? "25"), 10)));
    const status = String(req.query?.["status"] ?? "");

    const result = await getFeeWalletHistory(page, limit, status || undefined);
    res.json({ data: result });
  } catch (err) { next(err); }
}

// ─── Sweep design ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/sweep-design
 *
 * Restituisce il design dello sweep (non ancora attivo).
 * Mostra: soglia configurata, BTC treasury address (pubblico), note.
 *
 * NON esegue lo sweep — solo informazioni sulla progettazione.
 * Accesso: read_only admin
 */
export async function getSweepDesignHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const design = await getSweepDesign();
    res.json({ data: design });
  } catch (err) { next(err); }
}

// ─── Health check ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/spark/fee-wallet/health
 *
 * Verifica stato del fee wallet:
 *   - Fee pendenti da > 24h (stale)
 *   - fee_address configurato
 *   - ALPHA_SPARK_FEE_MNEMONIC presente
 *
 * Accesso: read_only admin
 */
export async function getFeeWalletHealthHandler(
  _req: Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const health = await checkFeeWalletHealth();
    res.json({ data: health });
  } catch (err) { next(err); }
}

// ─── Configura fee_address ────────────────────────────────────────────────────

/**
 * PATCH /api/v1/spark/fee-wallet/configure-address
 *
 * Imposta il fee_address del wallet Spark nel MongoDB.
 * Equivalente a PATCH /spark/fee-config { fee_address } ma con validazione
 * specifica per il formato dell'address Spark.
 *
 * Validazione:
 *   - deve iniziare con "sp1" (mainnet) o "sprt" (testnet)
 *   - lunghezza minima: 20 caratteri
 *
 * SECURITY:
 *   - NON accetta il mnemonic — solo l'address pubblico
 *   - L'admin deve derivare l'address tramite il PoC browser o SDK separato
 *
 * Accesso: super_admin
 */
export async function configureFeeAddressHandler(
  req:  Request,
  res:  Response,
  next: NextFunction,
): Promise<void> {
  try {
    const admin = (req as unknown as { adminEmail?: string }).adminEmail ?? "unknown";
    const { fee_address } = req.body as { fee_address: string | null };

    // Validazione
    if (fee_address !== null) {
      if (typeof fee_address !== "string") {
        res.status(400).json({ error: "INVALID_ADDRESS", message: "fee_address deve essere string o null" });
        return;
      }
      if (fee_address.length < 20) {
        res.status(400).json({ error: "INVALID_ADDRESS", message: "fee_address troppo corto (min 20 char)" });
        return;
      }
      if (!fee_address.startsWith("sp1") && !fee_address.startsWith("sprt")) {
        res.status(400).json({
          error:   "INVALID_ADDRESS_FORMAT",
          message: "fee_address deve iniziare con 'sp1' (mainnet) o 'sprt' (testnet/regtest)",
        });
        return;
      }
    }

    const updated = await SparkFeeConfigModel.findOneAndUpdate(
      { _id: "spark-fee" },
      {
        $set: {
          fee_address:      fee_address,
          updated_at:       new Date(),
          updated_by:       admin,
          updated_by_email: admin,
        },
      },
      { returnDocument: "after" },
    );

    logger.info(
      { event: "SPARK_FEE_ADDRESS_CONFIGURED", admin, fee_address: fee_address ?? "null" },
      "[SparkFeeWallet] fee_address configurato",
    );

    res.json({
      data: {
        ok:          true,
        fee_address: updated?.fee_address ?? null,
        updated_at:  updated?.updated_at  ?? null,
      },
    });
  } catch (err) { next(err); }
}
