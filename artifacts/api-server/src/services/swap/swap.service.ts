/**
 * SwapService — servizio principale Alpha Swap
 *
 * ISOLAMENTO CRITICO:
 * - Zero import da payment engine, USDA, MultiChain, Spark fee collection, treasury
 * - Zero modifiche a wallet configuration, WalletConnect, signing flow esistenti
 * - Dipende SOLO da: swap-config.model, swap.model, boltz.service
 *
 * Flussi gestiti:
 *   BTC → Lightning: Boltz Submarine Swap (con extraFees Alpha)
 *   Lightning → BTC: Breez Spark fallback (client-side; backend registra solo il record)
 */

import { randomUUID } from "crypto";
import pino           from "pino";
import {
  SwapModel,
  SwapEventModel,
  SwapState,
  appendSwapEvent,
  type ISwap,
  type SwapRoute,
  type SwapProvider,
} from "../../models/swap.model.js";
import { getSwapConfig, type ISwapConfig } from "../../models/swap-config.model.js";
import {
  getBoltzSubmarineFees,
  createBoltzSubmarineSwap,
  getBoltzSwapStatus,
  checkBoltzHealth,
  type BoltzSubmarineInfo,
} from "./boltz.service.js";
import { AppError } from "../../errors/AppError.js";

const logger = pino({ name: "swap-service" });

// ── Tipi pubblici ─────────────────────────────────────────────────────────────

export interface SwapPublicConfig {
  enabled:           boolean;
  excluded_assets:   string[];
  btcln: {
    enabled:          boolean;
    fee_bps:          number;
    provider:         "boltz_submarine";
    provider_status:  "active" | "disabled" | "error";
  };
  lnbtc: {
    enabled:          boolean;
    fee_bps:          number;
    provider:         "breez_spark_reverse";
    provider_note:    string;
  };
}

export interface BtcLnQuote {
  route:              "btc_onchain_to_lightning";
  from_amount_sat:    number;
  to_amount_sat:      number;
  alpha_fee_sat:      number;
  alpha_fee_bps:      number;
  provider_fee_sat:   number;
  miner_fee_sat:      number;
  total_debit_sat:    number;
  provider:           "boltz_submarine";
  limits:             { min_sat: number; max_sat: number };
  expires_at:         number;  // unix ms
}

export interface LnBtcQuote {
  route:              "lightning_to_btc_onchain";
  from_amount_sat:    number;
  to_amount_sat:      number;
  alpha_fee_sat:      number;
  alpha_fee_bps:      number;
  provider_fee_sat:   number;
  total_debit_sat:    number;
  provider:           "breez_spark_reverse";
  provider_note:      string;
  expires_at:         number;
}

export interface CreateBtcLnSwapParams {
  user_id:         string;
  from_amount_sat: number;
  lightning_invoice: string;
  refund_public_key: string;
}

export interface CreateLnBtcRecordParams {
  user_id:                string;
  from_amount_sat:        number;
  btc_destination_address: string;
  provider_fee_sat:       number;
  spark_payment_id:       string;
  tx_hash_claim?:         string;
}

// ── Public config ─────────────────────────────────────────────────────────────

export async function getPublicSwapConfig(): Promise<SwapPublicConfig> {
  const cfg = await getSwapConfig();

  let boltzStatus: "active" | "disabled" | "error" = "disabled";
  if (cfg.boltz_btcln_enabled) {
    try {
      const health = await checkBoltzHealth();
      boltzStatus = health.reachable ? "active" : "error";
    } catch {
      boltzStatus = "error";
    }
  }

  return {
    enabled:         cfg.enabled,
    excluded_assets: cfg.excluded_assets,
    btcln: {
      enabled:         cfg.boltz_btcln_enabled,
      fee_bps:         cfg.btcln_fee_bps,
      provider:        "boltz_submarine",
      provider_status: boltzStatus,
    },
    lnbtc: {
      enabled:         cfg.breez_spark_lnbtc_enabled,
      fee_bps:         cfg.lnbtc_fee_bps,  // 0
      provider:        "breez_spark_reverse",
      provider_note:   "Fallback temporaneo. Alpha Fee = 0% su questa direzione.",
    },
  };
}

// ── BTC → Lightning quote ─────────────────────────────────────────────────────

export async function getBtcLnQuote(fromAmountSat: number): Promise<BtcLnQuote> {
  const cfg = await getSwapConfig();
  _assertEnabled(cfg);
  _assertBoltzEnabled(cfg);

  const info = await getBoltzSubmarineFees();

  // Calcola fee Boltz (percentuale sull'invoice amount + miner fee)
  const boltzPct    = info.fees.percentage / 100;
  const providerFee = Math.ceil(fromAmountSat * boltzPct);
  const minerFee    = info.fees.minerFees;

  // Alpha fee (sulla net amount destinatario)
  const alphaFeePct = cfg.btcln_fee_bps / 10000;
  const alphaFee    = Math.ceil(fromAmountSat * alphaFeePct);

  // L'utente deve inviare: fromAmountSat + alphaFee (tramite extraFees Boltz)
  // Il destinatario riceve: fromAmountSat - providerFee - minerFee
  const toAmountSat   = fromAmountSat - providerFee - minerFee;
  const totalDebitSat = fromAmountSat + (cfg.btcln_fee_bps > 0 ? alphaFee : 0);

  if (toAmountSat <= 0) {
    throw new AppError("SWAP_AMOUNT_TOO_SMALL", 400);
  }
  if (fromAmountSat < info.limits.minimal) {
    throw new AppError("SWAP_BELOW_MINIMUM", 400);
  }
  if (fromAmountSat > info.limits.maximal) {
    throw new AppError("SWAP_ABOVE_MAXIMUM", 400);
  }

  return {
    route:           "btc_onchain_to_lightning",
    from_amount_sat: fromAmountSat,
    to_amount_sat:   toAmountSat,
    alpha_fee_sat:   alphaFee,
    alpha_fee_bps:   cfg.btcln_fee_bps,
    provider_fee_sat: providerFee,
    miner_fee_sat:   minerFee,
    total_debit_sat: totalDebitSat,
    provider:        "boltz_submarine",
    limits:          { min_sat: info.limits.minimal, max_sat: info.limits.maximal },
    expires_at:      Date.now() + 5 * 60_000,  // quote valida 5 min
  };
}

// ── BTC → Lightning create ─────────────────────────────────────────────────────

export async function createBtcLnSwap(params: CreateBtcLnSwapParams): Promise<ISwap> {
  const cfg = await getSwapConfig();
  _assertEnabled(cfg);
  _assertBoltzEnabled(cfg);

  const info        = await getBoltzSubmarineFees();
  const alphaFeePct = cfg.btcln_fee_bps / 100;  // bps→percentage (0.25 bps = 0.0025%)
  // Boltz extraFees.percentage è in % (es. 0.25 per 0.25%)
  const boltzAlphaFeePct = cfg.btcln_fee_bps / 100;

  const boltzResult = await createBoltzSubmarineSwap({
    invoice:         params.lightning_invoice,
    refundPublicKey: params.refund_public_key,
    alphaFeePct:     boltzAlphaFeePct,
    integratorId:    cfg.boltz_integrator_id,
  });

  const fromAmount  = params.from_amount_sat;
  const boltzPct    = info.fees.percentage / 100;
  const providerFee = Math.ceil(fromAmount * boltzPct);
  const minerFee    = info.fees.minerFees;
  const alphaFee    = Math.ceil(fromAmount * (cfg.btcln_fee_bps / 10000));
  const toAmount    = fromAmount - providerFee - minerFee;

  const swapId = randomUUID();
  const doc = await SwapModel.create({
    _id:                       swapId,
    user_id:                   params.user_id,
    route:                     "btc_onchain_to_lightning" satisfies SwapRoute,
    provider:                  "boltz_submarine" satisfies SwapProvider,
    state:                     "created" satisfies SwapState,
    from_amount_sat:           fromAmount,
    to_amount_sat_estimated:   toAmount,
    alpha_fee_sat:             alphaFee,
    alpha_fee_bps:             cfg.btcln_fee_bps,
    provider_fee_sat:          providerFee,
    miner_fee_sat:             minerFee,
    boltz_swap_id:             boltzResult.swapId,
    boltz_lockup_address:      boltzResult.lockupAddress,
    lightning_invoice:         params.lightning_invoice,
    boltz_timeout_block_height: boltzResult.timeoutBlockHeight,
    boltz_redeem_script:       boltzResult.redeemScript,
  });

  await appendSwapEvent(swapId, "created", "created", {
    boltz_swap_id:    boltzResult.swapId,
    lockup_address:   boltzResult.lockupAddress,
    expected_amount:  boltzResult.expectedAmount,
  });

  logger.info({ swapId, boltzSwapId: boltzResult.swapId }, "SWAP:BTCLN:CREATED");
  return doc;
}

// ── Lightning → BTC record (client-side execution via Breez) ─────────────────

export async function recordLnBtcSwap(params: CreateLnBtcRecordParams): Promise<ISwap> {
  const cfg = await getSwapConfig();
  // Non richiede enabled: il record viene creato dopo l'esecuzione client-side
  // ma lo storico è visibile solo se enabled (UI)

  const swapId = randomUUID();
  const doc = await SwapModel.create({
    _id:                       swapId,
    user_id:                   params.user_id,
    route:                     "lightning_to_btc_onchain" satisfies SwapRoute,
    provider:                  "breez_spark_reverse" satisfies SwapProvider,
    state:                     "completed" satisfies SwapState,  // eseguito client-side
    from_amount_sat:           params.from_amount_sat,
    to_amount_sat_estimated:   params.from_amount_sat - params.provider_fee_sat,
    to_amount_sat_actual:      params.from_amount_sat - params.provider_fee_sat,
    alpha_fee_sat:             0,
    alpha_fee_bps:             0,  // sempre 0 per Breez Spark
    provider_fee_sat:          params.provider_fee_sat,
    miner_fee_sat:             0,
    btc_destination_address:   params.btc_destination_address,
    spark_payment_id:          params.spark_payment_id,
    tx_hash_claim:             params.tx_hash_claim,
    completed_at:              new Date(),
  });

  await appendSwapEvent(swapId, "completed", "completed", {
    spark_payment_id: params.spark_payment_id,
    provider:         "breez_spark_reverse",
    alpha_fee_bps:    0,
  });

  logger.info({ swapId, userId: params.user_id }, "SWAP:LNBTC:RECORDED");
  return doc;
}

// ── Status BTC→LN (polling Boltz) ────────────────────────────────────────────

export async function getBtcLnSwapStatus(swapId: string, userId: string) {
  const swap = await SwapModel.findOne({ _id: swapId, user_id: userId });
  if (!swap) throw new AppError("SWAP_NOT_FOUND", 404);

  if (swap.boltz_swap_id && swap.state !== "completed" && swap.state !== "failed" && swap.state !== "refunded") {
    try {
      const boltzStatus = await getBoltzSwapStatus(swap.boltz_swap_id);
      const newState    = _mapBoltzStatus(boltzStatus.status);

      if (newState && newState !== swap.state) {
        await SwapModel.findOneAndUpdate(
          { _id: swapId },
          {
            $set: {
              state:            newState,
              tx_hash_deposit:  boltzStatus.transaction?.id ?? swap.tx_hash_deposit,
              ...(newState === "completed" ? { completed_at: new Date() } : {}),
              ...(boltzStatus.failureReason ? { error_message: boltzStatus.failureReason } : {}),
            },
          },
        );
        await appendSwapEvent(swapId, `boltz_${boltzStatus.status}`, newState, {
          boltz_status: boltzStatus.status,
          tx_id:        boltzStatus.transaction?.id,
        });
        swap.state = newState;
      }
    } catch (err) {
      logger.warn({ swapId, err }, "SWAP:STATUS:BOLTZ_POLL_FAILED");
    }
  }

  return swap;
}

// ── History ───────────────────────────────────────────────────────────────────

export async function getUserSwapHistory(userId: string, limit = 20, offset = 0) {
  const total = await SwapModel.countDocuments({ user_id: userId });
  const items = await SwapModel.find({ user_id: userId })
    .sort({ created_at: -1 })
    .skip(offset)
    .limit(limit)
    .lean();
  return { total, items };
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function adminGetSwaps(params: {
  page?: number;
  limit?: number;
  state?: string;
  route?: string;
  provider?: string;
  user_id?: string;
  since?: string;
}) {
  const page  = Math.max(1, params.page  ?? 1);
  const limit = Math.min(100, params.limit ?? 50);
  const skip  = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (params.state)    filter.state    = params.state;
  if (params.route)    filter.route    = params.route;
  if (params.provider) filter.provider = params.provider;
  if (params.user_id)  filter.user_id  = params.user_id;
  if (params.since)    filter.created_at = { $gte: new Date(params.since) };

  const [total, items] = await Promise.all([
    SwapModel.countDocuments(filter),
    SwapModel.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ]);

  return { total, page, limit, pages: Math.ceil(total / limit), items };
}

export async function adminGetRevenue(params: { since?: string; until?: string }) {
  const match: Record<string, unknown> = { state: "completed" };
  if (params.since || params.until) {
    match.completed_at = {
      ...(params.since ? { $gte: new Date(params.since) } : {}),
      ...(params.until ? { $lte: new Date(params.until) } : {}),
    };
  }

  const rows = await SwapModel.aggregate([
    { $match: match },
    {
      $group: {
        _id:               { route: "$route", provider: "$provider" },
        total_volume_sat:  { $sum: "$from_amount_sat" },
        total_alpha_fee_sat: { $sum: "$alpha_fee_sat" },
        count:             { $sum: 1 },
      },
    },
    { $sort: { "_id.route": 1 } },
  ]);

  const totalAlphaFeeSat = rows.reduce((s, r) => s + r.total_alpha_fee_sat, 0);
  const totalCount       = rows.reduce((s, r) => s + r.count, 0);

  return { rows, total_alpha_fee_sat: totalAlphaFeeSat, total_count: totalCount };
}

export async function adminPatchSwapConfig(patch: Partial<ISwapConfig>, adminId: string, adminEmail: string) {
  const allowed: (keyof ISwapConfig)[] = [
    "enabled",
    "btcln_fee_bps",
    "boltz_integrator_id",
    "boltz_btcln_enabled",
    "lnbtc_fee_bps",
    "breez_spark_lnbtc_enabled",
    "excluded_assets",
  ];

  const update: Record<string, unknown> = { updated_at: new Date(), updated_by: adminId, updated_by_email: adminEmail };
  for (const key of allowed) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }

  const doc = await (await import("../../models/swap-config.model.js")).SwapConfigModel.findOneAndUpdate(
    { _id: "swap-config" },
    { $set: update },
    { upsert: true, returnDocument: "after" },
  );

  logger.info({ patch: Object.keys(patch), adminId }, "SWAP:CONFIG:UPDATED");
  return doc;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _assertEnabled(cfg: ISwapConfig): void {
  if (!cfg.enabled) throw new AppError("SWAP_DISABLED", 503);
}

function _assertBoltzEnabled(cfg: ISwapConfig): void {
  if (!cfg.boltz_btcln_enabled) throw new AppError("SWAP_PROVIDER_DISABLED", 503);
}

function _mapBoltzStatus(status: string): SwapState | null {
  switch (status) {
    case "invoice.set":           return "created";
    case "transaction.mempool":   return "awaiting_deposit";
    case "transaction.confirmed": return "processing";
    case "invoice.paid":          return "completed";
    case "invoice.failedToPay":   return "failed";
    case "swap.expired":          return "expired";
    case "transaction.refunded":  return "refunded";
    default:                      return null;
  }
}
