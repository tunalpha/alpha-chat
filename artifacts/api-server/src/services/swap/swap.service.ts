/**
 * SwapService — servizio principale Alpha Swap
 *
 * ISOLAMENTO CRITICO:
 * - Zero import da payment engine, USDA, MultiChain, Spark fee collection, treasury
 * - Zero modifiche a wallet configuration, WalletConnect, signing flow esistenti
 * - Dipende SOLO da: swap-config.model, swap.model, boltz.service, refund-key.service
 *
 * PATTERN FONDAMENTALE — ZERO LOST TRANSACTIONS:
 *
 *   1. WRITE-BEFORE-SUBMIT (BTC→LN):
 *      Swap record persistito in MongoDB con state="submitted" PRIMA di chiamare Boltz.
 *      Se Boltz risponde OK → state="created" + lockup_address.
 *      Se HTTP timeout/lost → state rimane "submitted" (reconciler gestisce).
 *
 *   2. IDEMPOTENZA:
 *      Campo idempotency_key (client UUID). Stessa key = stesso swap (no duplicate).
 *      Verificato PRIMA di chiamare Boltz.
 *
 *   3. REFUND KEY DETERMINISTICA:
 *      Derivata server-side via HMAC-SHA256(secret, swapId).
 *      MAI salvata la privKey, MAI ritornata dalle API.
 *      Sempre riproducibile dopo restart.
 *
 *   4. STATE MACHINE SERVER-SIDE:
 *      Il frontend non è la fonte della verità — MongoDB lo è.
 *      Il reconciler riconcilia con Boltz ogni 30s.
 *
 *   5. FAILED_RECOVERABLE ≠ FAILED:
 *      Errori di rete/timeout → failed_recoverable (NON failed_permanent).
 *      Il reconciler riprova. Solo errori espliciti Boltz → failed_permanent.
 */

import { randomUUID }  from "crypto";
import pino            from "pino";
import {
  SwapModel,
  SwapEventModel,
  appendSwapEvent,
  TERMINAL_STATES,
  RECONCILABLE_STATES,
  mapBoltzStatusToSwapState,
  type SwapState,
  type SwapRoute,
  type SwapProvider,
  type ISwap,
} from "../../models/swap.model.js";
import { getSwapConfig, type ISwapConfig } from "../../models/swap-config.model.js";
import {
  getBoltzSubmarineFees,
  createBoltzSubmarineSwap,
  getBoltzSwapStatus,
  checkBoltzHealth,
} from "./boltz.service.js";
import { deriveRefundPublicKey } from "./refund-key.service.js";
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
  /**
   * Provider EVM attivo: "lifi" | "changenow"
   * Letto dall'endpoint pubblico GET /api/v1/swap/config (no auth richiesta).
   * Determinato da SwapProviderConfigModel (isPrimary=true, status=enabled).
   * Default: "lifi" se nessun provider configurato.
   */
  activeEvmProvider: string;
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
  expires_at:         number;
}

export interface CreateBtcLnSwapParams {
  user_id:           string;
  from_amount_sat:   number;
  lightning_invoice: string;
  idempotency_key:   string;  // client UUID — garantisce no-duplicate su retry
}

export interface CreateLnBtcRecordParams {
  user_id:                 string;
  from_amount_sat:         number;
  btc_destination_address: string;
  provider_fee_sat:        number;
  spark_payment_id:        string;
  tx_hash_claim?:          string;
  /** UUID client-generated — garantisce no-duplicate su retry e recovery */
  idempotency_key?:        string;
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

  // Legge il provider EVM primario dal DB (SwapProviderConfigModel).
  // getPrimaryProvider() è già importata in swap-provider-router.service.ts
  // ma qui usiamo l'import diretto dal model per non creare dipendenza circolare.
  let activeEvmProvider = "lifi";
  try {
    const { getPrimaryProvider } = await import("./swap-provider-router.service.js");
    const primary = await getPrimaryProvider();
    if (primary?.providerId) activeEvmProvider = primary.providerId;
  } catch {
    // default "lifi" — fail-open
  }

  return {
    enabled:          cfg.enabled,
    excluded_assets:  cfg.excluded_assets,
    btcln: {
      enabled:         cfg.boltz_btcln_enabled,
      fee_bps:         cfg.btcln_fee_bps,
      provider:        "boltz_submarine",
      provider_status: boltzStatus,
    },
    lnbtc: {
      enabled:         cfg.breez_spark_lnbtc_enabled,
      fee_bps:         cfg.lnbtc_fee_bps,
      provider:        "breez_spark_reverse",
      provider_note:   "Fallback temporaneo. Alpha Fee = 0% su questa direzione.",
    },
    activeEvmProvider,
  };
}

// ── BTC → Lightning quote ─────────────────────────────────────────────────────

export async function getBtcLnQuote(fromAmountSat: number): Promise<BtcLnQuote> {
  const cfg = await getSwapConfig();
  _assertEnabled(cfg);
  _assertBoltzEnabled(cfg);

  const info = await getBoltzSubmarineFees();

  const boltzPct    = info.fees.percentage / 100;
  const providerFee = Math.ceil(fromAmountSat * boltzPct);
  const minerFee    = info.fees.minerFees;
  const alphaFee    = Math.ceil(fromAmountSat * (cfg.btcln_fee_bps / 10000));
  const toAmountSat = fromAmountSat - providerFee - minerFee;

  if (toAmountSat <= 0) throw new AppError("SWAP_AMOUNT_TOO_SMALL", 400);
  if (fromAmountSat < info.limits.minimal) throw new AppError("SWAP_BELOW_MINIMUM", 400, undefined, { min_sat: info.limits.minimal, max_sat: info.limits.maximal });
  if (fromAmountSat > info.limits.maximal) throw new AppError("SWAP_ABOVE_MAXIMUM", 400, undefined, { min_sat: info.limits.minimal, max_sat: info.limits.maximal });

  return {
    route:            "btc_onchain_to_lightning",
    from_amount_sat:  fromAmountSat,
    to_amount_sat:    toAmountSat,
    alpha_fee_sat:    alphaFee,
    alpha_fee_bps:    cfg.btcln_fee_bps,
    provider_fee_sat: providerFee,
    miner_fee_sat:    minerFee,
    total_debit_sat:  fromAmountSat + (cfg.btcln_fee_bps > 0 ? alphaFee : 0),
    provider:         "boltz_submarine",
    limits:           { min_sat: info.limits.minimal, max_sat: info.limits.maximal },
    expires_at:       Date.now() + 5 * 60_000,
  };
}

// ── BTC → Lightning create (write-before-submit + idempotency) ────────────────

export async function createBtcLnSwap(params: CreateBtcLnSwapParams): Promise<ISwap> {
  const cfg = await getSwapConfig();
  _assertEnabled(cfg);
  _assertBoltzEnabled(cfg);

  // ── 1. Idempotency check ──────────────────────────────────────────────────
  // Se esiste già uno swap attivo con la stessa idempotency_key → ritorna quello
  const existing = await SwapModel.findOne({
    user_id:         params.user_id,
    idempotency_key: params.idempotency_key,
  });
  if (existing) {
    logger.info(
      { swapId: existing._id, ikey: params.idempotency_key, state: existing.state },
      "SWAP:BTCLN:IDEMPOTENT_RETURN",
    );
    return existing;
  }

  // ── 2. Genera swapId e chiave refund deterministica ───────────────────────
  const swapId         = randomUUID();
  const refundPubKey   = deriveRefundPublicKey(swapId);

  // ── 3. WRITE-BEFORE-SUBMIT: persisti in MongoDB con state="submitted" ─────
  //    Questo garantisce che in caso di crash/timeout dopo la scrittura,
  //    il reconciler possa gestire lo swap. Se Boltz non ha risposto,
  //    boltz_swap_id rimane null e il reconciler eventualmente cancella.
  const info        = await getBoltzSubmarineFees();
  const boltzPct    = info.fees.percentage / 100;
  const providerFee = Math.ceil(params.from_amount_sat * boltzPct);
  const minerFee    = info.fees.minerFees;
  const alphaFee    = Math.ceil(params.from_amount_sat * (cfg.btcln_fee_bps / 10000));
  const toAmount    = params.from_amount_sat - providerFee - minerFee;

  const doc = await SwapModel.create({
    _id:                     swapId,
    user_id:                 params.user_id,
    idempotency_key:         params.idempotency_key,
    route:                   "btc_onchain_to_lightning" satisfies SwapRoute,
    provider:                "boltz_submarine" satisfies SwapProvider,
    state:                   "submitted" satisfies SwapState,
    from_amount_sat:         params.from_amount_sat,
    to_amount_sat_estimated: toAmount,
    alpha_fee_sat:           alphaFee,
    alpha_fee_bps:           cfg.btcln_fee_bps,
    provider_fee_sat:        providerFee,
    miner_fee_sat:           minerFee,
    lightning_invoice:       params.lightning_invoice,
    refund_public_key:       refundPubKey,   // safe: solo pubkey
    reconcile_attempts:      0,
  });

  await appendSwapEvent(swapId, "submitted", "submitted", {
    idempotency_key: params.idempotency_key,
  });

  logger.info({ swapId, userId: params.user_id }, "SWAP:BTCLN:SUBMITTED");

  // ── 4. Chiama Boltz (DOPO aver scritto in DB) ─────────────────────────────
  try {
    const boltzAlphaFeePct = cfg.btcln_fee_bps / 100; // bps → % (25 bps = 0.25%)
    const boltzResult = await createBoltzSubmarineSwap({
      invoice:         params.lightning_invoice,
      refundPublicKey: refundPubKey,
      alphaFeePct:     boltzAlphaFeePct,
      integratorId:    cfg.boltz_integrator_id,
    });

    // ── 5. Aggiorna con i dati Boltz → state="created" ─────────────────────
    await SwapModel.findOneAndUpdate(
      { _id: swapId },
      {
        $set: {
          state:                      "created" satisfies SwapState,
          boltz_swap_id:              boltzResult.swapId,
          boltz_lockup_address:       boltzResult.lockupAddress,
          boltz_expected_amount:      boltzResult.expectedAmount,
          boltz_timeout_block_height: boltzResult.timeoutBlockHeight,
          boltz_redeem_script:        boltzResult.redeemScript,
        },
      },
    );

    await appendSwapEvent(swapId, "created", "created", {
      boltz_swap_id:   boltzResult.swapId,
      lockup_address:  boltzResult.lockupAddress,
      expected_amount: boltzResult.expectedAmount,
    });

    logger.info(
      { swapId, boltzSwapId: boltzResult.swapId, lockupAddress: boltzResult.lockupAddress },
      "SWAP:BTCLN:CREATED",
    );

    // Ritorna il doc aggiornato
    const updated = await SwapModel.findById(swapId);
    return updated ?? doc;

  } catch (err) {
    // ── 6. Se Boltz fallisce: NON eliminare il record ─────────────────────
    //    Distinguiamo errore di rete (failed_recoverable) da errore Boltz (failed_permanent)
    const errMsg = (err as Error).message ?? "";
    const isPermanent = errMsg.includes("BOLTZ_DISABLED") ||
                        errMsg.includes("HTTP 4") ||
                        errMsg.includes("invoice");

    const newState: SwapState = isPermanent ? "failed_permanent" : "failed_recoverable";

    await SwapModel.findOneAndUpdate(
      { _id: swapId },
      {
        $set: {
          state:         newState,
          error_code:    isPermanent ? "BOLTZ_REJECTED" : "BOLTZ_UNREACHABLE",
          error_message: errMsg,
        },
      },
    );

    await appendSwapEvent(swapId, isPermanent ? "boltz_rejected" : "boltz_unreachable", newState, {
      error: errMsg,
    });

    logger.warn({ swapId, newState, err: errMsg }, "SWAP:BTCLN:CREATE_FAILED");

    // Se errore permanente: lancia eccezione (nessun dato Boltz da restituire)
    if (isPermanent) throw new AppError("SWAP_PROVIDER_ERROR", 502);

    // Se recuperabile: ritorna doc con stato failed_recoverable
    // Il frontend mostra "in attesa di riconciliazione"
    const updated = await SwapModel.findById(swapId);
    return updated ?? doc;
  }
}

// ── Lightning → BTC record (client-side execution via Breez) ─────────────────

export async function recordLnBtcSwap(params: CreateLnBtcRecordParams): Promise<ISwap> {
  // ── Idempotency: se esiste già un record con questa chiave, restituiscilo ────
  if (params.idempotency_key) {
    const existing = await SwapModel.findOne({
      user_id:         params.user_id,
      idempotency_key: params.idempotency_key,
    });
    if (existing) {
      logger.info(
        { swapId: existing._id, userId: params.user_id, idempotencyKey: params.idempotency_key },
        "SWAP:LNBTC:IDEMPOTENT_RETURN",
      );
      return existing;
    }
  }

  const swapId = randomUUID();
  const doc = await SwapModel.create({
    _id:                     swapId,
    user_id:                 params.user_id,
    idempotency_key:         params.idempotency_key,
    route:                   "lightning_to_btc_onchain" satisfies SwapRoute,
    provider:                "breez_spark_reverse" satisfies SwapProvider,
    state:                   "completed" satisfies SwapState,
    from_amount_sat:         params.from_amount_sat,
    to_amount_sat_estimated: params.from_amount_sat - params.provider_fee_sat,
    to_amount_sat_actual:    params.from_amount_sat - params.provider_fee_sat,
    alpha_fee_sat:           0,
    alpha_fee_bps:           0,
    provider_fee_sat:        params.provider_fee_sat,
    miner_fee_sat:           0,
    btc_destination_address: params.btc_destination_address,
    spark_payment_id:        params.spark_payment_id,
    tx_hash_claim:           params.tx_hash_claim,
    completed_at:            new Date(),
  });

  await appendSwapEvent(swapId, "completed", "completed", {
    spark_payment_id: params.spark_payment_id,
    provider:         "breez_spark_reverse",
    alpha_fee_bps:    0,
    idempotency_key:  params.idempotency_key,
  });

  logger.info({ swapId, userId: params.user_id }, "SWAP:LNBTC:RECORDED");
  return doc;
}

// ── Status BTC→LN (polling Boltz + aggiornamento stato) ──────────────────────

export async function getBtcLnSwapStatus(swapId: string, userId: string): Promise<ISwap> {
  const swap = await SwapModel.findOne({ _id: swapId, user_id: userId });
  if (!swap) throw new AppError("SWAP_NOT_FOUND", 404);

  // Solo se ha un boltz_swap_id e non è terminale → poll Boltz
  if (swap.boltz_swap_id && !TERMINAL_STATES.includes(swap.state)) {
    try {
      const boltzStatus = await getBoltzSwapStatus(swap.boltz_swap_id);
      const newState    = mapBoltzStatusToSwapState(boltzStatus.status);

      if (newState && newState !== swap.state) {
        await SwapModel.findOneAndUpdate(
          { _id: swapId },
          {
            $set: {
              state:           newState,
              tx_hash_deposit: boltzStatus.transaction?.id ?? swap.tx_hash_deposit,
              ...(newState === "completed"    ? { completed_at: new Date(), to_amount_sat_actual: swap.to_amount_sat_estimated } : {}),
              ...(boltzStatus.failureReason  ? { error_message: boltzStatus.failureReason } : {}),
              reconciled_at:   new Date(),
            },
          },
        );
        await appendSwapEvent(swapId, `boltz_${boltzStatus.status}`, newState, {
          boltz_status: boltzStatus.status,
          tx_id:        boltzStatus.transaction?.id,
        });
        swap.state = newState;
      }
    } catch {
      // Poll silenzioso — lo scheduler recupera
    }
  }

  return swap;
}

// ── Active swap per recovery frontend ────────────────────────────────────────

/**
 * Ritorna lo swap BTC→LN attivo più recente per l'utente.
 * Il frontend lo usa per recuperare lo stato dopo restart/crash.
 * Ritorna null se non esiste alcuno swap attivo.
 */
export async function getActiveBtcLnSwap(userId: string): Promise<ISwap | null> {
  const swap = await SwapModel.findOne({
    user_id: userId,
    route:   "btc_onchain_to_lightning",
    state:   { $in: RECONCILABLE_STATES },
  }).sort({ created_at: -1 });
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
  page?: number; limit?: number; state?: string; route?: string;
  provider?: string; user_id?: string; since?: string;
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
  return { rows, total_alpha_fee_sat: totalAlphaFeeSat, total_count: rows.reduce((s, r) => s + r.count, 0) };
}

export async function adminPatchSwapConfig(patch: Partial<ISwapConfig>, adminId: string, adminEmail: string) {
  const allowed: (keyof ISwapConfig)[] = [
    "enabled", "btcln_fee_bps", "boltz_integrator_id",
    "boltz_btcln_enabled", "lnbtc_fee_bps", "breez_spark_lnbtc_enabled", "excluded_assets",
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

// ── Reconciler hooks (chiamati dallo swap-reconciler.service) ─────────────────

/**
 * Riconcilia un singolo swap con Boltz.
 * Chiamato dallo scheduler — NON esporre via HTTP.
 */
export async function reconcileSwap(swap: ISwap): Promise<{ updated: boolean; newState: SwapState }> {
  // Swap senza boltz_swap_id: è rimasto in "submitted" perché Boltz non ha risposto.
  // Se ha più di 5 minuti senza risposta → cancella (nessun deposito possibile).
  if (!swap.boltz_swap_id) {
    const age = Date.now() - new Date(swap.created_at).getTime();
    if (age > 5 * 60_000) {
      await SwapModel.findOneAndUpdate(
        { _id: swap._id, state: "submitted" },
        { $set: { state: "cancelled", error_code: "BOLTZ_NO_RESPONSE", reconciled_at: new Date() } },
      );
      await appendSwapEvent(swap._id, "cancelled_no_boltz_response", "cancelled", {
        age_ms: age,
      });
      logger.info({ swapId: swap._id, ageSec: Math.round(age / 1000) }, "SWAP:RECONCILE:CANCELLED_NO_BOLTZ");
      return { updated: true, newState: "cancelled" };
    }
    return { updated: false, newState: swap.state };
  }

  // Swap con boltz_swap_id → poll Boltz
  try {
    const boltzStatus = await getBoltzSwapStatus(swap.boltz_swap_id);
    const newState    = mapBoltzStatusToSwapState(boltzStatus.status);

    if (!newState || newState === swap.state) {
      // Nessun cambiamento di stato
      await SwapModel.findOneAndUpdate(
        { _id: swap._id },
        { $set: { reconciled_at: new Date() }, $inc: { reconcile_attempts: 1 } },
      );
      return { updated: false, newState: swap.state };
    }

    const update: Record<string, unknown> = {
      state:           newState,
      reconciled_at:   new Date(),
      tx_hash_deposit: boltzStatus.transaction?.id ?? swap.tx_hash_deposit,
    };
    if (newState === "completed")  { update.completed_at = new Date(); update.to_amount_sat_actual = swap.to_amount_sat_estimated; }
    if (boltzStatus.failureReason) update.error_message = boltzStatus.failureReason;
    if (newState === "failed_permanent") update.error_code = "BOLTZ_FAILED";

    await SwapModel.findOneAndUpdate({ _id: swap._id }, { $set: update, $inc: { reconcile_attempts: 1 } });
    await appendSwapEvent(swap._id, `reconciled_${boltzStatus.status}`, newState, {
      boltz_status:  boltzStatus.status,
      tx_id:         boltzStatus.transaction?.id,
      attempt:       (swap.reconcile_attempts ?? 0) + 1,
    });

    logger.info(
      { swapId: swap._id, from: swap.state, to: newState, boltzStatus: boltzStatus.status },
      "SWAP:RECONCILE:STATE_CHANGE",
    );
    return { updated: true, newState };

  } catch (err) {
    // Boltz non raggiungibile — non cambiare stato, riprova al prossimo ciclo
    logger.warn({ swapId: swap._id, err: (err as Error).message }, "SWAP:RECONCILE:BOLTZ_UNREACHABLE");
    await SwapModel.findOneAndUpdate(
      { _id: swap._id },
      { $set: { reconciled_at: new Date() }, $inc: { reconcile_attempts: 1 } },
    );
    return { updated: false, newState: swap.state };
  }
}

/**
 * Recupera tutti gli swap non-terminali che richiedono riconciliazione.
 * Chiamato dallo scheduler.
 */
export async function getNonTerminalSwaps(): Promise<ISwap[]> {
  return SwapModel.find({
    route:  "btc_onchain_to_lightning",
    state:  { $in: RECONCILABLE_STATES },
    provider: "boltz_submarine",
  }).lean();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _assertEnabled(cfg: ISwapConfig): void {
  if (!cfg.enabled) throw new AppError("SWAP_DISABLED", 503);
}

function _assertBoltzEnabled(cfg: ISwapConfig): void {
  if (!cfg.boltz_btcln_enabled) throw new AppError("SWAP_PROVIDER_DISABLED", 503);
}
