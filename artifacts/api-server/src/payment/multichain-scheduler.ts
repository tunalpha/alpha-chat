/**
 * multichain-scheduler.ts — Recovery & Expiry Scheduler per il Multi-Chain Payment Engine
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  HARDENING C-2 — REGOLA ASSOLUTA (mai derogare):
 *  Se tx_hash_release è valorizzato, NON fare mai rollback a pending.
 *  Questo è vero indipendentemente dalle feature flags.
 *  Una rete disabilitata → defer (rinova lock), mai cancella stato.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  HARDENING M-2 — SINGLETON GUARD:
 *  startMultiChainScheduler() è idempotente: una seconda chiamata è ignorata.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  HARDENING H-3 — PENDING EXPIRY:
 *  processExpiredPendingTransfers() gestisce trasferimenti "pending"
 *  (depositati ma mai rilasciati) scaduti. Rimborso solo se tx_hash_release:null.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  GAS RESERVE PROTECTION (STEP 2):
 *  processWaitingForGasTransfers() gestisce trasferimenti in "waiting_for_gas".
 *  - Deposito preservato nell'escrow (mai perso).
 *  - Scheduler controlla gas station; se disponibile → retry release automatico.
 *  - gas_retry_count++ ad ogni fallimento.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Job:
 *    processStuckReleasingTransfers()
 *      Trasferimenti bloccati in "releasing" con lock stale (10 min).
 *      - tx_hash presente: verifica on-chain → confirmed → complete/retry TX2
 *      - tx_hash assente:  rollback a "pending" per retry
 *
 *    processStuckRefundingTransfers()
 *      Trasferimenti bloccati in "refunding".
 *
 *    processExpiredMCTransfers()
 *      "awaiting_deposit" con expires_at < now → expired.
 *
 *    processExpiredPendingTransfers()  [H-3]
 *      "pending" con expires_at < now + tx_hash_release:null → refund.
 *
 *    processWaitingForGasTransfers()  [Gas Reserve Protection]
 *      "waiting_for_gas" → retry release se gas station ripristinato.
 *
 *    startMultiChainScheduler()
 *      Passata iniziale all'avvio + setInterval periodici.
 *      Singleton guard: seconda chiamata ignorata (M-2).
 *
 * ISOLAMENTO: non tocca ChatTransferModel, usda-custodial.service.ts o altri file USDA.
 */

import { MultiChainTransferModel } from "../models/multichain-transfer.model";
import { adapterRegistry }          from "../blockchain/adapter-registry";
import { FEATURE_FLAGS }            from "../blockchain/multichain-config";
import { logger }                   from "../lib/logger";

// ─── Costanti ──────────────────────────────────────────────────────────────────

/** Lock considerato stale oltre 10 minuti */
const LOCK_STALE_MS = 10 * 60_000;

/** Intervallo recovery (ogni 10 min) */
const RECOVERY_INTERVAL_MS = 10 * 60_000;

/** Intervallo scadenze (ogni 5 min) */
const EXPIRE_INTERVAL_MS = 5 * 60_000;

/** Batch max per passata */
const BATCH_SIZE = 50;

// ─── Singleton guard (M-2) ─────────────────────────────────────────────────────

let _schedulerStarted = false;

// ─── Recovery: releasing ──────────────────────────────────────────────────────

/**
 * Recupera trasferimenti bloccati in "releasing".
 *
 * REGOLA C-2: se tx_hash_release è impostato, MAI fare rollback a pending.
 * Neanche se la feature flag è disabilitata.
 *
 * Logica:
 *   1. tx_hash_release assente → crash pre-TX1 → rollback a "pending" ✓ safe
 *   2. tx_hash_release presente:
 *      a. Feature disabilitata → defer (rinova lock), NO rollback [C-2]
 *      b. Feature abilitata → verifica on-chain
 *         - confirmed + tx_hash_fee null + fee_wallet → retry TX2 only [C-1 recovery]
 *         - confirmed + tx_hash_fee set (o no fee_wallet) → mark released
 *         - pending   → rinova lock (ancora in corso)
 *         - failed/unknown → rollback a "pending" per retry
 */
export async function processStuckReleasingTransfers(): Promise<void> {
  const staleThreshold = new Date(Date.now() - LOCK_STALE_MS);

  const stuck = await MultiChainTransferModel.find({
    status:    "releasing",
    locked_at: { $lt: staleThreshold },
  }).limit(BATCH_SIZE).lean();

  if (stuck.length === 0) return;
  logger.info({ count: stuck.length }, "[MCScheduler] Trovati transfer releasing bloccati");

  for (const doc of stuck) {
    try {
      if (!doc.tx_hash_release) {
        // Caso 1: crash prima di TX1 — rollback sicuro
        await _rollbackToStatus(doc.transfer_id, "releasing", "pending");
        logger.info(
          { transferId: doc.transfer_id },
          "[MCScheduler] tx_hash_release assente → rollback a pending (crash pre-TX1)",
        );
        continue;
      }

      // Caso 2: tx_hash_release impostato — TX1 già inviata
      // C-2: NON fare rollback indipendentemente dalla feature flag

      const featureEnabled = _isEnabled(doc.network as any);
      if (!featureEnabled) {
        // C-2 FIX: rete disabilitata MA tx_hash_release presente → defer, mai rollback
        // Rinova locked_at per evitare ripetizioni frequenti, ma preserva lo stato.
        await MultiChainTransferModel.findOneAndUpdate(
          { transfer_id: doc.transfer_id, status: "releasing" },
          { $set: { locked_at: new Date() } },
        );
        logger.warn(
          { transferId: doc.transfer_id, network: doc.network, txHash: doc.tx_hash_release },
          "[MCScheduler] C-2: rete disabilitata ma tx_hash_release set — defer senza rollback",
        );
        continue;
      }

      // Verifica stato on-chain di TX1
      let txStatus: "confirmed" | "pending" | "failed" | "unknown";
      let stuckAdapter: ReturnType<typeof adapterRegistry.get> | null = null;
      try {
        stuckAdapter = adapterRegistry.get(doc.network as any);
        txStatus = await stuckAdapter.getTransactionStatus(doc.tx_hash_release);
      } catch {
        txStatus = "unknown";
      }

      if (txStatus === "confirmed") {
        // TX1 confermata — valuta stato TX2
        const isBtcNetwork = doc.network === "bitcoin";
        const tx2Amount    = BigInt(doc.project_fee) + BigInt((doc as any).network_fee_charged ?? "0");
        const hasFeeSetup  = !isBtcNetwork && !!doc.fee_wallet && tx2Amount > 0n;
        const needsFeeTx   = hasFeeSetup && !doc.tx_hash_fee;
        const tx2Staged    = hasFeeSetup && !!doc.tx_hash_fee;

        if (needsFeeTx) {
          // C-01 recovery: TX1 confermata, TX2 non ancora iniziata
          logger.info(
            { transferId: doc.transfer_id, tx1: doc.tx_hash_release },
            "[MCScheduler] C-01 recovery: TX1 confermata, TX2 non inviata → retryEVMFeeTx",
          );
          const { retryEVMFeeTx } = await import("./multichain-payment.service");
          await retryEVMFeeTx(doc.transfer_id);
        } else if (tx2Staged) {
          // C-02 recovery: TX2 hash è staged in DB — verifica on-chain
          // Questo copre il caso in cui il processo è crashato dopo il pre-broadcast persist
          // ma prima che il broadcast completasse (o prima della receipt).
          let tx2Status: "confirmed" | "pending" | "failed" | "unknown" = "unknown";
          try {
            tx2Status = await stuckAdapter!.getTransactionStatus(doc.tx_hash_fee!);
          } catch {
            tx2Status = "unknown";
          }

          if (tx2Status === "confirmed") {
            // Entrambe le TX confermate → mark released
            await MultiChainTransferModel.findOneAndUpdate(
              { transfer_id: doc.transfer_id, status: "releasing" },
              { $set: { status: "released", completed_at: new Date(), locked_at: null } },
            );
            logger.info(
              { transferId: doc.transfer_id, tx1: doc.tx_hash_release, tx2: doc.tx_hash_fee },
              "[MCScheduler] C-02 recovery: TX1+TX2 confermate on-chain → released",
            );
          } else if (tx2Status === "pending") {
            // TX2 in mempool — rinnova lock e attendi
            await MultiChainTransferModel.findOneAndUpdate(
              { transfer_id: doc.transfer_id, status: "releasing" },
              { $set: { locked_at: new Date() } },
            );
            logger.debug(
              { transferId: doc.transfer_id, tx2Hash: doc.tx_hash_fee },
              "[MCScheduler] C-02 recovery: TX2 pending — lock rinnovato",
            );
          } else {
            // TX2 hash staged ma non trovata on-chain (non broadcastata o dropped).
            // Safe: azzera tx_hash_fee → al prossimo ciclo needsFeeTx=true → retryEVMFeeTx.
            // Se la TX originale arriva dal mempool dopo il clear, avrà stesso nonce →
            // solo una andrà a buon fine → nessun double-fee.
            logger.warn(
              { transferId: doc.transfer_id, tx2Hash: doc.tx_hash_fee, tx2Status },
              "[MCScheduler] C-02: TX2 hash staged ma non trovata on-chain — clear per retry",
            );
            await MultiChainTransferModel.findOneAndUpdate(
              { transfer_id: doc.transfer_id, status: "releasing" },
              { $set: { tx_hash_fee: null, locked_at: null } },
            );
            // Il prossimo ciclo troverà needsFeeTx=true e chiamerà retryEVMFeeTx
          }
        } else {
          // Nessuna TX2 necessaria (BTC, no fee wallet, tx2Amount=0) → released
          await MultiChainTransferModel.findOneAndUpdate(
            { transfer_id: doc.transfer_id, status: "releasing" },
            { $set: { status: "released", completed_at: new Date(), locked_at: null } },
          );
          logger.info(
            { transferId: doc.transfer_id, txHash: doc.tx_hash_release },
            "[MCScheduler] TX confermata on-chain → released",
          );
        }
      } else if (txStatus === "pending") {
        // TX ancora in mempool — rinova lock per evitare falsi allarmi
        await MultiChainTransferModel.findOneAndUpdate(
          { transfer_id: doc.transfer_id, status: "releasing" },
          { $set: { locked_at: new Date() } },
        );
        logger.debug(
          { transferId: doc.transfer_id, txHash: doc.tx_hash_release },
          "[MCScheduler] TX1 ancora pending — lock rinnovato",
        );
      } else {
        // TX1 fallita o sconosciuta.
        // tx_hash_release è impostato ma la TX non risulta on-chain.
        // NOTA: questo è un caso ambiguo per BTC (broadcast timeout).
        // Rollback a pending per permettere retry dal service.
        // Il service userà broadcastTxSafe che verificherà il txid prima di ri-broadcastare.
        await _rollbackToStatus(doc.transfer_id, "releasing", "pending");
        logger.warn(
          { transferId: doc.transfer_id, txHash: doc.tx_hash_release, txStatus },
          "[MCScheduler] TX1 failed/unknown → rollback a pending per retry",
        );
      }
    } catch (err) {
      logger.error({ err, transferId: doc.transfer_id }, "[MCScheduler] Errore recovery releasing");
    }
  }
}

// ─── Recovery: refunding ──────────────────────────────────────────────────────

/**
 * Recupera trasferimenti bloccati in "refunding".
 *
 * C-2 applicata anche qui: se tx_hash_refund impostato + rete disabilitata → defer.
 */
export async function processStuckRefundingTransfers(): Promise<void> {
  const staleThreshold = new Date(Date.now() - LOCK_STALE_MS);

  const stuck = await MultiChainTransferModel.find({
    status:    "refunding",
    locked_at: { $lt: staleThreshold },
  }).limit(BATCH_SIZE).lean();

  if (stuck.length === 0) return;
  logger.info({ count: stuck.length }, "[MCScheduler] Trovati transfer refunding bloccati");

  for (const doc of stuck) {
    try {
      if (!doc.tx_hash_refund) {
        // Nessuna TX inviata — rollback a pending
        await _rollbackToStatus(doc.transfer_id, "refunding", "pending");
        logger.info({ transferId: doc.transfer_id }, "[MCScheduler] Nessuna refund TX → rollback a pending");
        continue;
      }

      const featureEnabled = _isEnabled(doc.network as any);
      if (!featureEnabled) {
        // C-2: tx_hash_refund presente + rete disabilitata → defer
        await MultiChainTransferModel.findOneAndUpdate(
          { transfer_id: doc.transfer_id, status: "refunding" },
          { $set: { locked_at: new Date() } },
        );
        logger.warn(
          { transferId: doc.transfer_id, network: doc.network },
          "[MCScheduler] C-2: rete disabilitata ma tx_hash_refund set — defer",
        );
        continue;
      }

      let txStatus: "confirmed" | "pending" | "failed" | "unknown" = "unknown";
      try {
        const adapter = adapterRegistry.get(doc.network as any);
        txStatus = await adapter.getTransactionStatus(doc.tx_hash_refund);
      } catch {
        txStatus = "unknown";
      }

      if (txStatus === "confirmed") {
        await MultiChainTransferModel.findOneAndUpdate(
          { transfer_id: doc.transfer_id, status: "refunding" },
          { $set: { status: "refunded", completed_at: new Date(), locked_at: null } },
        );
        logger.info(
          { transferId: doc.transfer_id, txHash: doc.tx_hash_refund },
          "[MCScheduler] Refund TX confermata → refunded",
        );
      } else if (txStatus === "pending") {
        await MultiChainTransferModel.findOneAndUpdate(
          { transfer_id: doc.transfer_id, status: "refunding" },
          { $set: { locked_at: new Date() } },
        );
      } else {
        await _rollbackToStatus(doc.transfer_id, "refunding", "pending");
        logger.warn(
          { transferId: doc.transfer_id, txHash: doc.tx_hash_refund, txStatus },
          "[MCScheduler] Refund TX failed → rollback a pending",
        );
      }
    } catch (err) {
      logger.error({ err, transferId: doc.transfer_id }, "[MCScheduler] Errore recovery refunding");
    }
  }
}

// ─── Expiry: awaiting_deposit ─────────────────────────────────────────────────

/**
 * Marca "expired" i trasferimenti awaiting_deposit scaduti.
 */
export async function processExpiredMCTransfers(): Promise<void> {
  const now = new Date();

  const expired = await MultiChainTransferModel.find({
    status:     "awaiting_deposit",
    expires_at: { $lt: now },
  }).limit(BATCH_SIZE).lean();

  if (expired.length === 0) return;
  logger.info({ count: expired.length }, "[MCScheduler] Transfer awaiting_deposit scaduti");

  for (const doc of expired) {
    try {
      const result = await MultiChainTransferModel.findOneAndUpdate(
        { transfer_id: doc.transfer_id, status: "awaiting_deposit" },
        { $set: { status: "expired", completed_at: new Date() } },
      );
      if (result) {
        logger.info({ transferId: doc.transfer_id }, "[MCScheduler] Transfer → expired");
      }
    } catch (err) {
      logger.error({ err, transferId: doc.transfer_id }, "[MCScheduler] Errore expiry awaiting_deposit");
    }
  }
}

// ─── Expiry: pending (H-3) ────────────────────────────────────────────────────

/**
 * H-3: Gestisce trasferimenti "pending" scaduti.
 *
 * Un transfer passa a "pending" quando il deposito è rilevato. Se il release
 * non avviene entro expires_at, i fondi restano nell'escrow indefinitamente.
 *
 * Condizioni di sicurezza (non fare mai doppio payout):
 *   - tx_hash_release:null → nessun payout inviato → rimborso sicuro
 *   - tx_hash_fee:null     → idem (coerente con il precedente per EVM)
 *
 * Delega il rimborso a refundMultiChainTransfer() che acquisisce il lock atomico.
 */
export async function processExpiredPendingTransfers(): Promise<void> {
  const now = new Date();

  // Cerca transfer pending scaduti senza alcuna TX di payout
  const expired = await MultiChainTransferModel.find({
    status:          "pending",
    expires_at:      { $lt: now },
    tx_hash_release: null, // nessun payout mai inviato
    tx_hash_fee:     null,
  }).limit(BATCH_SIZE).lean();

  if (expired.length === 0) return;
  logger.info({ count: expired.length }, "[MCScheduler] H-3: Transfer pending scaduti — avvio rimborso");

  for (const doc of expired) {
    try {
      logger.info(
        { transferId: doc.transfer_id, expiresAt: doc.expires_at, network: doc.network },
        "[MCScheduler] H-3: rimborso transfer pending scaduto",
      );
      // Il service acquisisce il lock da "pending" → "refunding" in modo atomico.
      // La condizione del service include un controllo on-chain del saldo.
      const { refundMultiChainTransfer } = await import("./multichain-payment.service");
      await refundMultiChainTransfer(doc.transfer_id);
      logger.info(
        { transferId: doc.transfer_id },
        "[MCScheduler] H-3: rimborso completato",
      );
    } catch (err) {
      logger.error(
        { err, transferId: doc.transfer_id },
        "[MCScheduler] H-3: errore rimborso pending scaduto — riproverà al prossimo ciclo",
      );
    }
  }
}

// ─── Gas Reserve Protection: waiting_for_gas ──────────────────────────────────

/**
 * Ritenta il release dei transfer in "waiting_for_gas".
 *
 * Quando il gas station viene rifornito, questa funzione tenta di fare
 * releaseFromWaitingForGas() per ogni transfer in attesa.
 *
 * Comportamento:
 *   - Gas ora disponibile → release completa (TX1 + TX2) → "released"
 *   - Gas ancora insufficiente → GasReserveDepletedError intercettata dal service
 *     → transfer torna a "waiting_for_gas" con gas_retry_count++
 *   - Errore non-gas → logga, salta questo transfer, il prossimo ciclo riprova
 *   - Transfer non più in "waiting_for_gas" (race condition) → ignorato
 *
 * NON rimborsa mai automaticamente i waiting_for_gas: il deposito è al sicuro
 * e il rimborso richiede azione manuale dell'admin.
 */
export async function processWaitingForGasTransfers(): Promise<void> {
  const docs = await MultiChainTransferModel.find({
    status: "waiting_for_gas",
  }).limit(BATCH_SIZE).lean();

  if (docs.length === 0) return;

  logger.info(
    { count: docs.length },
    "[MCScheduler] Gas Reserve Recovery: trovati transfer waiting_for_gas — tentativo release",
  );

  for (const doc of docs) {
    try {
      const { releaseFromWaitingForGas, GasReserveDepletedError } =
        await import("./multichain-payment.service");

      const result = await releaseFromWaitingForGas(doc.transfer_id);

      if (result.status === "released") {
        logger.info(
          { transferId: doc.transfer_id, network: doc.network },
          "[MCScheduler] Gas Reserve Recovery: release completata ✓",
        );
      } else if (result.status === "waiting_for_gas") {
        logger.info(
          { transferId: doc.transfer_id, network: doc.network, gasRetryCount: result.gasRetryCount },
          "[MCScheduler] Gas Reserve Recovery: gas ancora insufficiente — waiting_for_gas (retry al prossimo ciclo)",
        );
      }
    } catch (err: unknown) {
      // GasReserveDepletedError è intercettata internamente dal service e non rilancata.
      // Qualsiasi errore qui è un problema diverso (RPC, DB, feature flag).
      logger.error(
        { err, transferId: doc.transfer_id, network: doc.network },
        "[MCScheduler] Gas Reserve Recovery: errore release — riproverà al prossimo ciclo",
      );
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

/**
 * Avvia il Multi-Chain scheduler.
 *
 * M-2 SINGLETON GUARD: una seconda chiamata è ignorata silenziosamente.
 * Questo previene interval multipli in caso di hot-reload o chiamate duplicate.
 */
export function startMultiChainScheduler(): void {
  // M-2: singleton guard
  if (_schedulerStarted) {
    logger.warn("[MCScheduler] startMultiChainScheduler() chiamata più volte — ignorata (M-2 singleton)");
    return;
  }
  _schedulerStarted = true;

  // Passata iniziale all'avvio (fire-and-forget)
  void _runAll();

  // Recovery stuck releasing/refunding — ogni 10 min
  setInterval(() => {
    void processStuckReleasingTransfers();
    void processStuckRefundingTransfers();
  }, RECOVERY_INTERVAL_MS).unref();

  // Expiry awaiting_deposit + pending — ogni 5 min
  setInterval(() => {
    void processExpiredMCTransfers();
    void processExpiredPendingTransfers();
  }, EXPIRE_INTERVAL_MS).unref();

  // Gas Reserve Recovery: waiting_for_gas → retry release — ogni 5 min
  setInterval(() => {
    void processWaitingForGasTransfers();
  }, EXPIRE_INTERVAL_MS).unref();

  logger.info(
    {
      recoveryIntervalMs: RECOVERY_INTERVAL_MS,
      expireIntervalMs:   EXPIRE_INTERVAL_MS,
      gasRecoveryIntervalMs: EXPIRE_INTERVAL_MS,
    },
    "[MCScheduler] Multi-Chain scheduler avviato (M-2 singleton)",
  );
}

/** Esposta per i test — resetta il singleton guard */
export function _resetSchedulerForTesting(): void {
  _schedulerStarted = false;
}

// ─── Helpers privati ──────────────────────────────────────────────────────────

async function _runAll(): Promise<void> {
  await Promise.allSettled([
    processStuckReleasingTransfers(),
    processStuckRefundingTransfers(),
    processExpiredMCTransfers(),
    processExpiredPendingTransfers(),
    processWaitingForGasTransfers(),
  ]);
}

async function _rollbackToStatus(
  transferId: string,
  fromStatus: string,
  toStatus: string,
): Promise<void> {
  await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: transferId, status: fromStatus as any },
    { $set: { status: toStatus as any, locked_at: null } },
  );
}

function _isEnabled(network: string): boolean {
  switch (network) {
    case "polygon":  return FEATURE_FLAGS.ENABLE_POLYGON_USDT;
    case "ethereum": return FEATURE_FLAGS.ENABLE_ETHEREUM_USDT;
    case "bsc":      return FEATURE_FLAGS.ENABLE_BSC_USDT;
    case "bitcoin":  return FEATURE_FLAGS.ENABLE_BITCOIN;
    default:         return false;
  }
}
