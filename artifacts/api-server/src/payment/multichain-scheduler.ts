/**
 * multichain-scheduler.ts — Recovery & Expiry Scheduler per il Multi-Chain Payment Engine
 *
 * ═══════════════════════════════════════════════════════════
 *  PRINCIPIO FONDAMENTALE (mai derogare):
 *  MAI inviare una seconda TX se tx_hash_release è già impostato.
 *  Verificare PRIMA lo stato on-chain del txid esistente.
 * ═══════════════════════════════════════════════════════════
 *
 * Job:
 *   processStuckMCTransfers()
 *     Trova trasferimenti bloccati in "releasing" o "refunding" con
 *     locked_at > LOCK_STALE_MS (10 min).
 *     - Se tx_hash presente: verifica on-chain → confirmed → mark terminale
 *     - Se tx_hash assente:  rollback a stato precedente per retry
 *
 *   processExpiredMCTransfers()
 *     Trova trasferimenti "awaiting_deposit" con expires_at < now.
 *     Lock → "expired".
 *
 *   startMultiChainScheduler()
 *     Passata iniziale all'avvio + setInterval periodici.
 *     Tutti i job sono idempotenti e multi-istanza safe via lock atomico MongoDB.
 *
 * ISOLAMENTO: non tocca ChatTransferModel, usda-custodial.service.ts o altri file USDA.
 */

import { MultiChainTransferModel } from "../models/multichain-transfer.model";
import { adapterRegistry }          from "../blockchain/adapter-registry";
import { FEATURE_FLAGS }            from "../blockchain/multichain-config";
import { logger }                   from "../lib/logger";

// ─── Costanti ──────────────────────────────────────────────────────────────────

/** Lock considerato bloccato oltre questo tempo (10 minuti) */
const LOCK_STALE_MS = 10 * 60 * 1000;

/** Intervallo recovery (ogni 10 min) */
const RECOVERY_INTERVAL_MS = 10 * 60 * 1000;

/** Intervallo scadenze (ogni 5 min) */
const EXPIRE_INTERVAL_MS = 5 * 60 * 1000;

/** Batch max per passata */
const BATCH_SIZE = 50;

// ─── Recovery: releasing ──────────────────────────────────────────────────────

/**
 * Recupera trasferimenti bloccati in stato "releasing".
 *
 * Logica:
 *   1. Se tx_hash_release esiste → verificare on-chain:
 *      - "confirmed" → mark "released" (la TX è passata, evita doppio invio)
 *      - "pending"   → lasciar stare (ancora in corso)
 *      - "failed"/"unknown" → rollback a "pending" per retry
 *   2. Se tx_hash_release assente → rollback a "pending" (crash prima dell'invio)
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
      if (doc.tx_hash_release) {
        // TX già inviata — verificare on-chain PRIMA di qualsiasi azione
        const featureEnabled = _isEnabled(doc.network as any);
        if (!featureEnabled) {
          // Feature disabilitata: non possiamo verificare — rollback sicuro
          await _rollbackToStatus(doc.transfer_id, "releasing", "pending");
          continue;
        }

        let txStatus: "confirmed" | "pending" | "failed" | "unknown";
        try {
          const adapter = adapterRegistry.get(doc.network as any);
          txStatus = await adapter.getTransactionStatus(doc.tx_hash_release);
        } catch {
          txStatus = "unknown";
        }

        if (txStatus === "confirmed") {
          // TX confermata — mark released (idempotente)
          await MultiChainTransferModel.findOneAndUpdate(
            { transfer_id: doc.transfer_id, status: "releasing" },
            {
              $set: {
                status:       "released",
                completed_at: new Date(),
                locked_at:    null,
              },
            },
          );
          logger.info(
            { transferId: doc.transfer_id, txHash: doc.tx_hash_release },
            "[MCScheduler] TX confermata on-chain → released",
          );
        } else if (txStatus === "pending") {
          // TX ancora in mempool — prolungare il lock_at per evitare falsi allarmi
          await MultiChainTransferModel.findOneAndUpdate(
            { transfer_id: doc.transfer_id, status: "releasing" },
            { $set: { locked_at: new Date() } },
          );
          logger.debug(
            { transferId: doc.transfer_id, txHash: doc.tx_hash_release },
            "[MCScheduler] TX ancora pending — lock rinnovato",
          );
        } else {
          // TX fallita o sconosciuta — rollback a pending per retry
          await _rollbackToStatus(doc.transfer_id, "releasing", "pending");
          logger.warn(
            { transferId: doc.transfer_id, txHash: doc.tx_hash_release, txStatus },
            "[MCScheduler] TX fallita → rollback a pending",
          );
        }
      } else {
        // Nessuna TX inviata — crash pre-invio → rollback sicuro
        await _rollbackToStatus(doc.transfer_id, "releasing", "pending");
        logger.info(
          { transferId: doc.transfer_id },
          "[MCScheduler] Nessuna TX inviata → rollback a pending",
        );
      }
    } catch (err) {
      logger.error({ err, transferId: doc.transfer_id }, "[MCScheduler] Errore recovery releasing");
    }
  }
}

// ─── Recovery: refunding ──────────────────────────────────────────────────────

/**
 * Recupera trasferimenti bloccati in stato "refunding".
 * Stessa logica di releasing ma per tx_hash_refund.
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
      if (doc.tx_hash_refund) {
        const featureEnabled = _isEnabled(doc.network as any);
        let txStatus: "confirmed" | "pending" | "failed" | "unknown" = "unknown";

        if (featureEnabled) {
          try {
            const adapter = adapterRegistry.get(doc.network as any);
            txStatus = await adapter.getTransactionStatus(doc.tx_hash_refund);
          } catch {
            txStatus = "unknown";
          }
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
            "[MCScheduler] Refund TX fallita → rollback a pending",
          );
        }
      } else {
        await _rollbackToStatus(doc.transfer_id, "refunding", "pending");
        logger.info(
          { transferId: doc.transfer_id },
          "[MCScheduler] Nessuna refund TX → rollback a pending",
        );
      }
    } catch (err) {
      logger.error({ err, transferId: doc.transfer_id }, "[MCScheduler] Errore recovery refunding");
    }
  }
}

// ─── Expiry ───────────────────────────────────────────────────────────────────

/**
 * Marca "expired" i trasferimenti awaiting_deposit con expires_at < now.
 * Lock atomico — safe in multi-istanza.
 */
export async function processExpiredMCTransfers(): Promise<void> {
  const now = new Date();

  const expired = await MultiChainTransferModel.find({
    status:     "awaiting_deposit",
    expires_at: { $lt: now },
  }).limit(BATCH_SIZE).lean();

  if (expired.length === 0) return;
  logger.info({ count: expired.length }, "[MCScheduler] Transfer in scadenza");

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
      logger.error({ err, transferId: doc.transfer_id }, "[MCScheduler] Errore expiry");
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

/**
 * Avvia il Multi-Chain scheduler.
 * Passata iniziale immediata + setInterval periodici.
 * Non blocca il boot: tutti i job sono fire-and-forget.
 */
export function startMultiChainScheduler(): void {
  // Passata iniziale
  void _runAll();

  // Recovery ogni 10 min
  setInterval(() => {
    void processStuckReleasingTransfers();
    void processStuckRefundingTransfers();
  }, RECOVERY_INTERVAL_MS).unref();

  // Expiry ogni 5 min
  setInterval(() => {
    void processExpiredMCTransfers();
  }, EXPIRE_INTERVAL_MS).unref();

  logger.info(
    {
      recoveryIntervalMs: RECOVERY_INTERVAL_MS,
      expireIntervalMs:   EXPIRE_INTERVAL_MS,
    },
    "[MCScheduler] Multi-Chain scheduler avviato",
  );
}

// ─── Helpers privati ──────────────────────────────────────────────────────────

async function _runAll(): Promise<void> {
  await Promise.allSettled([
    processStuckReleasingTransfers(),
    processStuckRefundingTransfers(),
    processExpiredMCTransfers(),
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
