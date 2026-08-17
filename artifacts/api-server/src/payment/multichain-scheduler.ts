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
 *  HARDENING SCHED-03 — ANTI-DOUBLE-PAY (mai derogare):
 *  Se tx_hash_release è valorizzato e TX1 risulta "failed/unknown" (inclusi
 *  errori RPC → catch → txStatus="unknown"):
 *    - NON fare rollback a "pending". Un rollback aprirebbe la strada a un
 *      secondo TX1 con nonce diverso. Se TX1 originale è ancora in mempool
 *      e viene minata → DOUBLE PAY.
 *    - Azione: rinnova il lock + logger.error strutturato (alert admin).
 *    - I fondi sono sicuri nell'escrow. Admin verifica on-chain manualmente.
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
import { emitMCPaymentStateChanged } from "./multichain-events";

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

/**
 * Guard anti-sovrapposizione per i job periodici.
 * Con i timeout receipt per-rete (fino a 5 min su Ethereum) un job può durare
 * più del suo intervallo: senza guard le passate si accumulerebbero,
 * moltiplicando lavoro RPC e release concorrenti sugli stessi transfer.
 */
const _jobInFlight = new Set<string>();
function _guarded(jobName: string, fn: () => Promise<void>): void {
  if (_jobInFlight.has(jobName)) {
    logger.warn({ jobName }, "[MCScheduler] Passata precedente ancora in corso — skip");
    return;
  }
  _jobInFlight.add(jobName);
  void fn()
    .catch((err) => logger.error({ err, jobName }, "[MCScheduler] Job error"))
    .finally(() => _jobInFlight.delete(jobName));
}

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
 *         - failed/unknown → SCHED-03: NON rollback (rischio double pay).
 *                            Rinnova lock + logger.error strutturato. Intervento admin.
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
            const releasedDoc = await MultiChainTransferModel.findOneAndUpdate(
              { transfer_id: doc.transfer_id, status: "releasing" },
              { $set: { status: "released", completed_at: new Date(), locked_at: null } },
              { returnDocument: "after" },
            );
            logger.info(
              { transferId: doc.transfer_id, tx1: doc.tx_hash_release, tx2: doc.tx_hash_fee },
              "[MCScheduler] C-02 recovery: TX1+TX2 confermate on-chain → released",
            );
            // WS push + aggiornamento system_metadata messaggio
            if (releasedDoc) {
              emitMCPaymentStateChanged(releasedDoc);
              void import("./multichain-payment.service").then(({ syncTransferMessageMeta }) =>
                syncTransferMessageMeta(releasedDoc).catch(() => {}),
              ).catch(() => {});
            }
            // Email admin: pagamento completato via recovery scheduler (fire-and-forget)
            void import("../services/email.service").then(({ sendMultiChainTransactionEmail }) =>
              sendMultiChainTransactionEmail({
                type:            "released",
                transferId:      doc.transfer_id,
                network:         doc.network,
                asset:           doc.asset,
                grossAmount:     doc.gross_amount,
                decimals:        doc.decimals,
                senderUserId:    doc.sender_id.toString(),
                recipientUserId: doc.recipient_id.toString(),
                txHash:          doc.tx_hash_release,
              }).catch(() => {}),
            ).catch(() => {});
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
          const releasedDoc = await MultiChainTransferModel.findOneAndUpdate(
            { transfer_id: doc.transfer_id, status: "releasing" },
            { $set: { status: "released", completed_at: new Date(), locked_at: null } },
            { returnDocument: "after" },
          );
          logger.info(
            { transferId: doc.transfer_id, txHash: doc.tx_hash_release },
            "[MCScheduler] TX confermata on-chain → released",
          );
          // WS push + aggiornamento system_metadata messaggio
          if (releasedDoc) {
            emitMCPaymentStateChanged(releasedDoc);
            void import("./multichain-payment.service").then(({ syncTransferMessageMeta }) =>
              syncTransferMessageMeta(releasedDoc).catch(() => {}),
            ).catch(() => {});
          }
          // Email admin: pagamento completato via recovery scheduler (fire-and-forget)
          void import("../services/email.service").then(({ sendMultiChainTransactionEmail }) =>
            sendMultiChainTransactionEmail({
              type:            "released",
              transferId:      doc.transfer_id,
              network:         doc.network,
              asset:           doc.asset,
              grossAmount:     doc.gross_amount,
              decimals:        doc.decimals,
              senderUserId:    doc.sender_id.toString(),
              recipientUserId: doc.recipient_id.toString(),
              txHash:          doc.tx_hash_release,
            }).catch(() => {}),
          ).catch(() => {});
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
        // ── SCHED-03 HARDENING: TX1 failed/unknown + tx_hash_release PRESENTE ──
        //
        // A questo punto del codice tx_hash_release è SEMPRE non-null:
        // il caso null è gestito in cima con `continue` (linea ~106).
        //
        // NON fare rollback a "pending":
        //   Un rollback permetterebbe un secondo TX1 con nuovo nonce.
        //   Se TX1 originale è ancora in mempool e viene minata mentre il
        //   secondo TX1 è già in volo → DOUBLE PAY.
        //
        // Azione sicura:
        //   1. Rinnova il lock (defer al prossimo ciclo).
        //   2. Genera logger.error strutturato per alert admin.
        //   3. I fondi restano nell'escrow — nessuna perdita.
        //   4. Admin verifica on-chain e decide:
        //      (a) attendere che la TX venga minata (potrebbe ancora riuscire)
        //      (b) usare il panel admin per marcare manualmente come released/failed
        await MultiChainTransferModel.findOneAndUpdate(
          { transfer_id: doc.transfer_id, status: "releasing" },
          { $set: { locked_at: new Date() } },
        );
        logger.error(
          {
            transferId: doc.transfer_id,
            network:    doc.network,
            asset:      doc.asset,
            txHash:     doc.tx_hash_release,
            txStatus,
            alert:      "SCHED-03",
          },
          "[MCScheduler] ⚠️ SCHED-03: tx_hash_release SET + TX1 failed/unknown — " +
          "NON faccio rollback (rischio double pay). Lock rinnovato. Intervento admin richiesto.",
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
        // Email admin: rimborso completato via recovery scheduler (fire-and-forget)
        void import("../services/email.service").then(({ sendMultiChainTransactionEmail }) =>
          sendMultiChainTransactionEmail({
            type:            "refunded",
            transferId:      doc.transfer_id,
            network:         doc.network,
            asset:           doc.asset,
            grossAmount:     doc.gross_amount,
            decimals:        doc.decimals,
            senderUserId:    doc.sender_id.toString(),
            recipientUserId: doc.recipient_id.toString(),
            txHash:          doc.tx_hash_refund,
          }).catch(() => {}),
        ).catch(() => {});
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
        // Email admin: transfer scaduto (fire-and-forget)
        void import("../services/email.service").then(({ sendMultiChainTransactionEmail }) =>
          sendMultiChainTransactionEmail({
            type:            "expired",
            transferId:      doc.transfer_id,
            network:         doc.network,
            asset:           doc.asset,
            grossAmount:     doc.gross_amount,
            decimals:        doc.decimals,
            senderUserId:    doc.sender_id.toString(),
            recipientUserId: doc.recipient_id.toString(),
            escrowWallet:    doc.escrow_wallet,
          }).catch(() => {}),
        ).catch(() => {});
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

// ─── Auto-release: pending freschi ───────────────────────────────────────────

/**
 * Safety-net: rilascia automaticamente i transfer "pending" che non hanno ancora
 * un tx_hash_release (deposito rilevato ma release mai avviata).
 *
 * Questo compensa i casi in cui il detect fire-and-forget del controller fallisce
 * (RPC lento, riavvio server, timeout) o in cui il transfer era già "pending"
 * prima dell'introduzione dell'auto-release nel controller.
 *
 * Sicurezza:
 *   - Acquisisce il lock atomico via acquireMCLock("pending" → "releasing"):
 *     nessun doppio payout se il controller ha già avviato il release.
 *   - Salta i transfer scaduti (gestiti da processExpiredPendingTransfers → refund).
 *   - Salta i transfer con tx_hash_release già impostato (TX1 già inviata).
 */
export async function processNewPendingTransfers(): Promise<void> {
  const docs = await MultiChainTransferModel.find({
    status:          "pending",
    tx_hash_release: null,
    expires_at:      { $gt: new Date() },
  }).limit(BATCH_SIZE).lean();

  if (docs.length === 0) return;

  logger.info(
    { count: docs.length },
    "[MCScheduler] Auto-release: transfer pending senza tx_hash_release — avvio release",
  );

  for (const doc of docs) {
    try {
      const { releaseMultiChainTransfer } = await import("./multichain-payment.service");
      const result = await releaseMultiChainTransfer(doc.transfer_id);
      logger.info(
        { transferId: doc.transfer_id, status: result.status, network: doc.network },
        "[MCScheduler] Auto-release completata ✓",
      );
    } catch (err: unknown) {
      logger.error(
        { err, transferId: doc.transfer_id, network: doc.network },
        "[MCScheduler] Auto-release fallita — riproverà al prossimo ciclo",
      );
    }
  }
}

// ─── Gas Reclaim Retry ────────────────────────────────────────────────────────

/** Finestra massima per il retry del reclaim (7 giorni dalla completed_at) */
const RECLAIM_RETRY_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * Recupera tutti i transfer "released" che non hanno ancora un reclaim confermato.
 *
 * Seleziona (query unificata — copre sia "mai tentati" che "falliti con errore transitorio"):
 *   status = "released"
 *   tx_hash_reclaim = null         (non ancora confermato con successo)
 *   reclaim_error ≠ "INSUFFICIENT_BALANCE"   (esclude errori PERMANENTI; include null → mai tentati)
 *   completed_at > 7 giorni fa     (chiave escrow ancora disponibile in DB)
 *   network ≠ "bitcoin"            (BTC non ha gas nativo da recuperare)
 *
 * Questa query risolve il Gap #1:
 *   PRIMA (bug): reclaim_error: { $nin: [null, "INSUFFICIENT_BALANCE"] }
 *     → escludeva null → i transfer mai tentati (server crash dopo release ma prima
 *       di avviare TX3) erano invisibili allo scheduler per sempre.
 *   ORA: reclaim_error: { $ne: "INSUFFICIENT_BALANCE" }
 *     → include null (mai tentati) + include errori transitori → nessun escrow silente.
 *
 * "INSUFFICIENT_BALANCE" è considerato permanente: il saldo escrow non tornerà mai.
 * Non ha senso riprovare. Tutti gli altri errori sono transitori e vengono ritentati.
 *
 * Non può interferire con TX1/TX2: il transfer è già "released" quando questo
 * scheduler gira. Non tocca status, tx_hash_release, tx_hash_fee.
 */
export async function processFailedReclaims(): Promise<void> {
  const since = new Date(Date.now() - RECLAIM_RETRY_WINDOW_MS);

  const docs = await MultiChainTransferModel.find({
    status:          "released",
    tx_hash_reclaim: null,
    // GAP #1 FIX: $ne invece di $nin — include null (mai tentati) + errori transitori
    reclaim_error:   { $ne: "INSUFFICIENT_BALANCE" },
    completed_at:    { $gt: since },
    network:         { $ne: "bitcoin" },
  }).limit(BATCH_SIZE).lean();

  if (docs.length === 0) return;

  const neverTried = docs.filter(d => !d.reclaim_error).length;
  const failedRetry = docs.length - neverTried;
  logger.info(
    { count: docs.length, neverTried, failedRetry },
    "[MCReclaim] Reclaim da processare (mai tentati + errori transitori)",
  );

  for (const doc of docs) {
    try {
      const { reclaimEscrowGasById } = await import("./multichain-payment.service");
      await reclaimEscrowGasById(doc.transfer_id);
    } catch (err) {
      // reclaimEscrowGasById non dovrebbe mai lanciare, ma guard difensivo
      logger.error(
        { err, transferId: doc.transfer_id, network: doc.network },
        "[MCReclaim] Errore inatteso durante retry reclaim",
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
    _guarded("stuckReleasing", processStuckReleasingTransfers);
    _guarded("stuckRefunding", processStuckRefundingTransfers);
  }, RECOVERY_INTERVAL_MS).unref();

  // Expiry awaiting_deposit + pending — ogni 5 min
  setInterval(() => {
    _guarded("expiredMC", processExpiredMCTransfers);
    _guarded("expiredPending", processExpiredPendingTransfers);
  }, EXPIRE_INTERVAL_MS).unref();

  // Gas Reserve Recovery: waiting_for_gas → retry release — ogni 5 min
  setInterval(() => {
    _guarded("waitingForGas", processWaitingForGasTransfers);
  }, EXPIRE_INTERVAL_MS).unref();

  // Auto-release pending freschi (safety-net per i detect fire-and-forget) — ogni 2 min
  setInterval(() => {
    _guarded("newPending", processNewPendingTransfers);
  }, 2 * 60_000).unref();

  // Reclaim retry: TX3 fallite precedentemente — ogni 30 min
  setInterval(() => {
    _guarded("failedReclaims", processFailedReclaims);
  }, 30 * 60_000).unref();

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
    processNewPendingTransfers(), // auto-release pending senza tx_hash_release
    processFailedReclaims(),
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
