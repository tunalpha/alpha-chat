/**
 * spark-fee-wallet.service.ts — Alpha Spark Fee Wallet — stato e statistiche
 *
 * ARCHITETTURA (backend-only, no SDK in Node.js per ora):
 * - Il wallet è identificato dal suo sparkAddress (statico, derivato dalla mnemonic)
 * - La mnemonic è in Replit Secret ALPHA_SPARK_FEE_MNEMONIC (mai esposta qui)
 * - Il sparkAddress è configurato via admin (PATCH /spark/fee-config { fee_address })
 * - Il "saldo ledger" è derivato dai fee records MongoDB (non dal SDK live)
 * - Il live balance (SDK) è tracciato separatamente quando il wallet è connesso
 *
 * PERCHÉ NON SDK IN NODE.JS ORA:
 * - SDK usa better-sqlite3 (nativo) → non è in api-server → no install senza review
 * - Il saldo ledger è sufficiente per monitoring amministrativo
 * - L'integrazione SDK backend è un task separato (go-live, dopo verifica)
 *
 * SWEEP (progettato, non ancora attivabile):
 * - Trigger: admin POST /fee-wallet/sweep → destinazione BTC_FEE_WALLET
 * - Soglia configurabile → accumula → sweep on-chain
 * - Status swept in fee records per riconciliazione
 *
 * SECURITY:
 * - sparkAddress è un indirizzo PUBBLICO (receiving address) — sicuro da mostrare
 * - mnemonic e private key MAI lette né esposte da questo service
 * - Nessun campo sensibile nei log
 */

import { AlphaWalletFeeRecordModel } from "../models/alpha-wallet-fee-record.model.js";
import { getSparkFeeConfig, SparkFeeConfigModel } from "../models/spark-fee-config.model.js";
import { logger }                     from "../lib/logger.js";
import {
  getFeeWalletSparkAddress,
  getSparkAddressFromMnemonic,
} from "./spark-fee-wallet-executor.js";

// ─── Tipi ────────────────────────────────────────────────────────────────────

export type FeeWalletStatus =
  | "not_configured"   // fee_address non impostato
  | "address_only"     // fee_address impostato, wallet non connesso via SDK
  | "sdk_connected"    // wallet connesso via SDK (futuro — go-live)
  | "error";           // errore connessione SDK

export interface FeeWalletInfo {
  status:       FeeWalletStatus;
  sparkAddress: string | null;
  /** Saldo LEDGER: somma dei fee records con status=success (approssimazione) */
  ledgerBalanceSat: number;
  /** Saldo LIVE dal SDK (disponibile solo quando status=sdk_connected) */
  liveBalanceSat:   number | null;
  mnemonicConfigured: boolean;
  apiKeyConfigured:   boolean;
}

export interface FeeWalletStats {
  pending:  { count: number; totalSat: number };
  success:  { count: number; totalSat: number };
  failed:   { count: number; totalSat: number };
  swept:    { count: number; totalSat: number };
  totalCollectedSat: number;
}

export interface FeeWalletHistoryRecord {
  recordId:      string;
  mainPaymentId: string;
  feeAmountSat:  number;
  status:        string;
  feePaymentId?: string;
  collectedAt?:  Date;
  createdAt?:    Date;
  lastError?:    string;
}

export interface FeeWalletHistoryResult {
  records:  FeeWalletHistoryRecord[];
  total:    number;
  page:     number;
  pages:    number;
}

export interface SweepDesign {
  configured:  boolean;
  thresholdSat: number;
  btcTreasuryAddress: string | null;
  note: string;
}

// ─── Stato in-memory del live wallet (futuro SDK) ─────────────────────────────

let _liveBalanceSat: number | null = null;

/** Chiamato da un futuro SDK connect handler quando il wallet è connesso live */
export function setLiveBalance(balanceSat: number): void {
  _liveBalanceSat = balanceSat;
}

/** Reset al disconnect */
export function clearLiveBalance(): void {
  _liveBalanceSat = null;
}

// ─── Info wallet ──────────────────────────────────────────────────────────────

/**
 * Restituisce lo stato corrente del fee wallet.
 * Il saldo ledger è calcolato dai fee records MongoDB.
 * Il saldo live (SDK) è null finché il wallet non è connesso via SDK.
 */
export async function getFeeWalletInfo(): Promise<FeeWalletInfo> {
  const cfg = await getSparkFeeConfig();
  const sparkAddress = cfg.fee_address ?? null;

  const mnemonicConfigured = Boolean(process.env["ALPHA_SPARK_FEE_MNEMONIC"]);
  const apiKeyConfigured   = Boolean(process.env["VITE_BREEZ_API_KEY"] ?? process.env["BREEZ_API_KEY"]);

  let status: FeeWalletStatus = "not_configured";
  if (sparkAddress) {
    status = _liveBalanceSat !== null ? "sdk_connected" : "address_only";
  }

  // Ledger balance = somma fee records success (non ancora swept)
  const successRecords = await AlphaWalletFeeRecordModel.aggregate([
    {
      $match: {
        source: "spark_lightning",
        status: { $in: ["success"] },
      },
    },
    {
      $group: {
        _id:         null,
        totalSat:    { $sum: "$feeAmountSat" },
      },
    },
  ]);
  const sweptRecords = await AlphaWalletFeeRecordModel.aggregate([
    {
      $match: {
        source: "spark_lightning",
        status: "swept",
      },
    },
    {
      $group: {
        _id:      null,
        totalSat: { $sum: "$feeAmountSat" },
      },
    },
  ]);

  const successTotalSat = (successRecords[0]?.totalSat as number | undefined) ?? 0;
  const sweptTotalSat   = (sweptRecords[0]?.totalSat as number | undefined) ?? 0;
  const ledgerBalanceSat = Math.max(0, successTotalSat - sweptTotalSat);

  return {
    status,
    sparkAddress,
    ledgerBalanceSat,
    liveBalanceSat: _liveBalanceSat,
    mnemonicConfigured,
    apiKeyConfigured,
  };
}

// ─── Statistiche ──────────────────────────────────────────────────────────────

/**
 * Statistiche aggregate dei fee records Spark Lightning.
 * Restituisce conteggio e totale sat per ogni status.
 */
export async function getFeeWalletStats(): Promise<FeeWalletStats> {
  const pipeline = [
    { $match: { source: "spark_lightning" } },
    {
      $group: {
        _id:      "$status",
        count:    { $sum: 1 },
        totalSat: { $sum: { $ifNull: ["$feeAmountSat", 0] } },
      },
    },
  ];

  const results = await AlphaWalletFeeRecordModel.aggregate(pipeline) as Array<{
    _id: string;
    count: number;
    totalSat: number;
  }>;

  const byStatus: Record<string, { count: number; totalSat: number }> = {};
  for (const r of results) {
    byStatus[r._id] = { count: r.count, totalSat: r.totalSat };
  }

  const pending = byStatus["pending_collection"] ?? { count: 0, totalSat: 0 };
  const success = byStatus["success"]            ?? { count: 0, totalSat: 0 };
  const swept   = byStatus["swept"]              ?? { count: 0, totalSat: 0 };
  const failed  = {
    count:    (byStatus["failed_transient"]?.count  ?? 0) + (byStatus["failed_permanent"]?.count  ?? 0),
    totalSat: (byStatus["failed_transient"]?.totalSat ?? 0) + (byStatus["failed_permanent"]?.totalSat ?? 0),
  };

  return {
    pending,
    success,
    failed,
    swept,
    totalCollectedSat: success.totalSat,
  };
}

// ─── Storico ─────────────────────────────────────────────────────────────────

/**
 * Storico fee records Spark Lightning, paginato.
 * Mostra: mainPaymentId, feeAmountSat, status, feePaymentId, date, errori.
 * Privacy: userId non esposto (privacy-by-design).
 */
export async function getFeeWalletHistory(
  page = 1,
  limit = 25,
  status?: string,
): Promise<FeeWalletHistoryResult> {
  const filter: Record<string, unknown> = { source: "spark_lightning" };
  if (status) filter["status"] = status;

  const total = await AlphaWalletFeeRecordModel.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / limit));
  const skip  = (Math.max(1, page) - 1) * limit;

  const records = await AlphaWalletFeeRecordModel.find(filter, {
    _id:          1,
    feeAmountSat: 1,
    status:       1,
    feePaymentId: 1,
    collectedAt:  1,
    createdAt:    1,
    lastError:    1,
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const mapped: FeeWalletHistoryRecord[] = records.map(r => ({
    recordId:      String(r._id),
    mainPaymentId: String(r._id).replace(/^spark_/, ""),
    feeAmountSat:  (r.feeAmountSat as number | undefined) ?? 0,
    status:        r.status,
    feePaymentId:  r.feePaymentId ?? undefined,
    collectedAt:   r.collectedAt ?? undefined,
    createdAt:     r.createdAt ?? undefined,
    lastError:     r.lastError ?? undefined,
  }));

  return { records: mapped, total, page, pages };
}

// ─── Sweep design ─────────────────────────────────────────────────────────────

/**
 * Restituisce il design corrente dello sweep.
 * Lo sweep reale non è ancora attivato — progettato, non implementato.
 *
 * Alpha Spark Fee Wallet → accumulo fee → soglia → sweep → BTC Treasury
 *
 * Lo sweep sarà implementato quando:
 * 1. Il wallet Spark backend è connesso via SDK
 * 2. ALPHA_SPARK_FEE_MNEMONIC è configurato
 * 3. La soglia è superata
 * 4. Admin approva manualmente
 */
export async function getSweepDesign(): Promise<SweepDesign> {
  const btcTreasuryAddress = process.env["BTC_FEE_WALLET"] ?? null;
  // Soglia di default: 10.000 sat (configurabile via env futuro SPARK_SWEEP_THRESHOLD_SAT)
  const thresholdSat = parseInt(process.env["SPARK_SWEEP_THRESHOLD_SAT"] ?? "10000", 10);

  return {
    configured:         Boolean(btcTreasuryAddress),
    thresholdSat,
    btcTreasuryAddress, // Indirizzo BTC on-chain — sicuro da mostrare (address pubblico)
    note: "Sweep non ancora attivo. Richiede: ALPHA_SPARK_FEE_MNEMONIC + SDK backend + approvazione admin.",
  };
}

// ─── Alert staleness ─────────────────────────────────────────────────────────

/**
 * Alert per fee pendenti bloccate.
 * Emette log WARN se ci sono fee pending da più di maxAgeHours.
 */
export async function checkFeeWalletHealth(maxAgeHours = 24): Promise<{
  healthy: boolean;
  pendingStale: number;
  alerts: string[];
}> {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600000);
  const pendingStale = await AlphaWalletFeeRecordModel.countDocuments({
    source:    "spark_lightning",
    status:    "pending_collection",
    createdAt: { $lt: cutoff },
  });

  const alerts: string[] = [];
  if (pendingStale > 0) {
    const msg = `${pendingStale} fee Spark pendenti da più di ${maxAgeHours}h — fee_address non configurato o Tier-2 non operative`;
    alerts.push(msg);
    logger.warn({ pendingStale, maxAgeHours }, `⚠️ [SparkFeeWallet] ${msg}`);
  }

  const cfg = await getSparkFeeConfig();
  if (!cfg.fee_address) {
    alerts.push("fee_address non configurato — configurare l'Alpha Spark Fee Wallet per attivare la raccolta");
  }
  if (!process.env["ALPHA_SPARK_FEE_MNEMONIC"]) {
    alerts.push("ALPHA_SPARK_FEE_MNEMONIC non impostato come Replit Secret");
  }

  return { healthy: alerts.length === 0, pendingStale, alerts };
}

// ─── Auto-configure al boot ───────────────────────────────────────────────────

/**
 * autoConfigureSparkFeeWallet — chiamata una volta al boot del server.
 *
 * Deriva automaticamente:
 * 1. fee_address da ALPHA_SPARK_FEE_MNEMONIC (se fee_address è null)
 * 2. sweep_treasury_spark_address da ALPHA_SPARK_TREASURY_MNEMONIC (se impostata e null)
 *
 * SICUREZZA:
 * - Mnemonic lette ESCLUSIVAMENTE da process.env, mai loggate
 * - Usa gli address Spark PUBBLICI (sp1...) per i campi MongoDB
 * - Fire-and-forget: errori loggati ma non bloccano il boot
 * - Idempotente: se già configurato non fa nulla
 */
export async function autoConfigureSparkFeeWallet(): Promise<void> {
  const mnemonic = process.env["ALPHA_SPARK_FEE_MNEMONIC"];
  if (!mnemonic) {
    logger.warn("[AutoConfig] ALPHA_SPARK_FEE_MNEMONIC non impostato — skip auto-configure");
    return;
  }

  const cfg = await getSparkFeeConfig();

  // ── Fee address ───────────────────────────────────────────────────────────
  if (!cfg.fee_address) {
    logger.info("[AutoConfig] fee_address non configurato — derivo dall'SDK...");
    try {
      const feeAddress = await getFeeWalletSparkAddress();
      await SparkFeeConfigModel.findOneAndUpdate(
        { _id: "spark-fee" },
        { $set: { fee_address: feeAddress, updated_at: new Date(), updated_by: "auto-configure" } },
        { upsert: true },
      );
      logger.info(
        { feeAddress: `${feeAddress.slice(0, 16)}…` },
        "[AutoConfig] ✓ fee_address configurato",
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[AutoConfig] Derivazione fee_address fallita");
    }
  } else {
    logger.info({ feeAddress: `${cfg.fee_address.slice(0, 16)}…` }, "[AutoConfig] fee_address già configurato");
  }

  // ── Treasury address ──────────────────────────────────────────────────────
  const treasuryMnemonic = process.env["ALPHA_SPARK_TREASURY_MNEMONIC"];
  const cfgAfter = await getSparkFeeConfig();

  if (!cfgAfter.sweep_treasury_spark_address && treasuryMnemonic) {
    logger.info("[AutoConfig] sweep_treasury_spark_address non configurato — derivo treasury dall'SDK...");
    try {
      const treasuryAddress = await getSparkAddressFromMnemonic(treasuryMnemonic);
      await SparkFeeConfigModel.findOneAndUpdate(
        { _id: "spark-fee" },
        { $set: { sweep_treasury_spark_address: treasuryAddress, updated_at: new Date(), updated_by: "auto-configure" } },
        { upsert: true },
      );
      logger.info(
        { treasuryAddress: `${treasuryAddress.slice(0, 16)}…` },
        "[AutoConfig] ✓ sweep_treasury_spark_address configurato",
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[AutoConfig] Derivazione treasury address fallita");
    }
  } else if (!treasuryMnemonic) {
    logger.info("[AutoConfig] ALPHA_SPARK_TREASURY_MNEMONIC non impostato — treasury non configurato");
  } else {
    logger.info("[AutoConfig] sweep_treasury_spark_address già configurato");
  }
}
