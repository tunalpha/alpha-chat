/**
 * payment-scheduler.service.ts — Chat Payment Engine Scheduler (Sprint 3)
 *
 * Due job DB-driven (ADR-003 — nessun timer in memoria per operazioni critiche):
 *
 *   processExpiredTransfers()
 *     Trova i transfer `pending` con `expires_at < now`.
 *     Per ognuno: lock atomico pending→refunding → rimborso escrow→sender → expired.
 *
 *   processStuckTransfers()
 *     Trova i lock states (accepting/rejecting/cancelling/refunding) con
 *     `locked_at` più vecchio di LOCK_STALE_MS (10 min).
 *     Recovery: verifica saldo escrow on-chain e riprova il trasferimento,
 *     oppure ripristina lo stato terminale se il saldo è già 0.
 *
 *   startPaymentScheduler()
 *     Passata iniziale all'avvio (prima di accettare traffico) + setInterval periodici.
 *
 * Entrambi i job sono idempotenti e multi-istanza safe:
 * il lock atomico via findOneAndUpdate garantisce che solo un'istanza
 * processi ogni record.
 */

import { ChatTransferModel, type ChatTransferDocument } from "../models/chat-transfer.model";
import { MessageModel }                                  from "../models/message.model";
import { acquireLock, writeAudit }                       from "./lock";
import { transferFromCustodial, getCustodialBalance }     from "./usda-custodial.service";
import { emitPaymentStateChanged }                        from "./events";
import { autoReleaseForRequest }                          from "./chat-payment.service";
import { syncRequestFromTransfer }                        from "../services/usda.service";
import { logger }                                         from "../lib/logger";
import type { ChatTransferStatus }                        from "./state-machine";
import type { AuditTriggeredBy }                          from "../models/chat-transfer-audit.model";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Oltre questo threshold un lock state è considerato bloccato. */
const LOCK_STALE_MS = 10 * 60 * 1000; // 10 minuti

/** Intervallo di controllo scadenze. */
const EXPIRE_INTERVAL_MS = 5 * 60 * 1000; // 5 minuti

/** Intervallo recovery lock states. */
const RECOVERY_INTERVAL_MS = 10 * 60 * 1000; // 10 minuti

/** Batch massimo per passata (evita timeout lunghi). */
const BATCH_SIZE = 100;

/**
 * Soglia oltre la quale un transfer legato a una richiesta ancora `pending`
 * (deposito confermato ma release non completato) viene ri-tentato. Deve essere
 * abbastanza ampia da dare tempo all'auto-release immediato di confirmDeposit.
 */
const REQUEST_RELEASE_STALE_MS = 5 * 60 * 1000; // 5 minuti

/** Intervallo del retry auto-release richieste. */
const REQUEST_RELEASE_INTERVAL_MS = 5 * 60 * 1000; // 5 minuti

/** Mappa lo stato terminale del transfer allo stato della bolla richiesta. */
function _requestStatusForTerminal(terminal: ChatTransferStatus): "confirmed" | "pending_claim" {
  // Solo "accepted" (release al richiedente) = richiesta pagata; ogni altro
  // esito terminale (rimborso/rifiuto) rende la richiesta di nuovo pagabile.
  return terminal === "accepted" ? "confirmed" : "pending_claim";
}

// ---------------------------------------------------------------------------
// Helper privati
// ---------------------------------------------------------------------------

/**
 * Aggiorna system_metadata.status nel messaggio-bolla in chat.
 * Fire-and-forget.
 */
async function _updateMsg(doc: ChatTransferDocument): Promise<void> {
  if (!doc.message_id) return;
  try {
    await MessageModel.updateOne(
      { _id: doc.message_id },
      {
        $set: {
          "system_metadata.status":          doc.status,
          "system_metadata.tx_hash_release": doc.tx_hash_release ?? null,
        },
      },
    );
  } catch (err) {
    logger.error({ err, transferId: doc.transfer_id }, "[Scheduler] Errore aggiornamento message meta");
  }
}

/**
 * Porta un transfer a `failed` dopo un errore irrecuperabile.
 * Usato nei catch block — non lancia mai.
 */
async function _failTransfer(
  transferId:   string,
  lockedStatus: ChatTransferStatus,
  reason:       string,
  triggeredBy:  AuditTriggeredBy,
): Promise<void> {
  try {
    const doc = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: lockedStatus },
      { $set: { status: "failed", completed_at: new Date() } },
      { returnDocument: "after" },
    );
    if (!doc) return;
    await writeAudit({ transferId, fromStatus: lockedStatus, toStatus: "failed", triggeredBy, note: reason });
    await _updateMsg(doc);
    emitPaymentStateChanged(doc);
  } catch (innerErr) {
    logger.error({ innerErr, transferId }, "[Scheduler] Errore in _failTransfer");
  }
}

// ---------------------------------------------------------------------------
// processExpiredTransfers
// ---------------------------------------------------------------------------

/**
 * Trova tutti i transfer `pending` con `expires_at < now` e li rimborsa.
 * Transizione: pending → refunding (lock) → expired (terminale).
 *
 * Idempotente: se un record è già in `refunding` (lock preso da un'altra istanza
 * o da una passata precedente non completata), viene saltato.
 */
export async function processExpiredTransfers(): Promise<void> {
  const now = new Date();

  const candidates = await ChatTransferModel.find(
    { status: "pending", expires_at: { $lt: now } },
    { transfer_id: 1 }, // proiezione minima per la lista
  ).limit(BATCH_SIZE).lean();

  if (candidates.length === 0) return;

  logger.info({ count: candidates.length }, "[Scheduler] Transfer pending scaduti trovati");

  for (const candidate of candidates) {
    const transferId = candidate.transfer_id as string;

    // Lock atomico — pending → refunding
    const locked = await acquireLock(transferId, "pending", "refunding");
    if (!locked) {
      logger.debug({ transferId }, "[Scheduler] Scaduto: lock non disponibile, salto");
      continue;
    }

    const completedAt = new Date();
    try {
      const { txHash } = await transferFromCustodial({
        encryptedPk:  locked.escrow_encrypted_pk,
        toAddress:    locked.sender_wallet,
        amountUnits:  locked.amount_units,
        assetAddress: locked.asset_address,
      });

      const done = await ChatTransferModel.findOneAndUpdate(
        { transfer_id: transferId, status: "refunding" },
        { $set: { status: "expired", tx_hash_release: txHash, completed_at: completedAt } },
        { returnDocument: "after" },
      );
      if (!done) continue;

      await writeAudit({
        transferId,
        fromStatus:  "refunding",
        toStatus:    "expired",
        triggeredBy: "scheduler",
        txHash,
        note:        "Transfer scaduto: rimborso automatico",
      });
      await _updateMsg(done);
      emitPaymentStateChanged(done);
      if (done.request_payment_id) {
        // Richiesta rimasta scaduta senza pagamento: torna pagabile.
        void syncRequestFromTransfer(done.request_payment_id.toString(), "pending_claim");
      }

      logger.info({ transferId, txHash }, "[Scheduler] Transfer scaduto rimborsato ✓");
    } catch (err) {
      logger.error({ err, transferId }, "[Scheduler] Errore rimborso transfer scaduto");
      await _failTransfer(transferId, "refunding", String(err), "scheduler");
    }
  }
}

// ---------------------------------------------------------------------------
// processStuckTransfers
// ---------------------------------------------------------------------------

/**
 * Configurazione recovery per ogni lock state:
 * quale stato terminale raggiungere e dove inviare i fondi.
 */
const RECOVERY_CONFIG: Record<
  "accepting" | "rejecting" | "cancelling" | "refunding",
  { terminalStatus: ChatTransferStatus; recipient: "sender" | "recipient" }
> = {
  accepting:  { terminalStatus: "accepted",  recipient: "recipient" },
  rejecting:  { terminalStatus: "rejected",  recipient: "sender"    },
  cancelling: { terminalStatus: "cancelled", recipient: "sender"    },
  refunding:  { terminalStatus: "expired",   recipient: "sender"    },
};

/**
 * Trova i lock states bloccati (locked_at > LOCK_STALE_MS fa) e li recupera.
 *
 * Per ogni transfer bloccato:
 * 1. Legge il saldo escrow on-chain.
 * 2. Se saldo >= amount_units: i fondi sono ancora nell'escrow → riprova il trasferimento.
 * 3. Se saldo = 0: il trasferimento blockchain era già andato a buon fine ma lo stato
 *    non era stato aggiornato (crash dopo la TX ma prima della write MongoDB) →
 *    ripristina direttamente lo stato terminale.
 * 4. Se il retry fallisce di nuovo: marca `failed` per non lasciare il record bloccato.
 *
 * Idempotente e multi-istanza safe: nessun ulteriore lock è necessario —
 * il record è già in un lock state, quindi solo questo scheduler lo toccherà.
 */
export async function processStuckTransfers(): Promise<void> {
  const staleThreshold = new Date(Date.now() - LOCK_STALE_MS);
  const lockStates     = ["accepting", "rejecting", "cancelling", "refunding"] as const;

  const stuck = await ChatTransferModel.find({
    status:    { $in: lockStates },
    locked_at: { $lt: staleThreshold },
  }).limit(50);

  if (stuck.length === 0) return;

  logger.warn({ count: stuck.length }, "[Scheduler] Transfer bloccati in lock state trovati");

  for (const transfer of stuck) {
    const lockedStatus = transfer.status as keyof typeof RECOVERY_CONFIG;
    const config       = RECOVERY_CONFIG[lockedStatus];
    if (!config) continue;

    // Transfer legato a una richiesta bloccato in "accepting": NON marcarlo mai
    // failed da questo ciclo. Riportalo a "pending" (unlock) e lascia il retry
    // sicuro/balance-checked a processPendingRequestReleases → autoReleaseForRequest
    // (che riconosce anche il caso escrow-già-svuotato senza re-inviare).
    if (lockedStatus === "accepting" && transfer.request_payment_id) {
      const reverted = await ChatTransferModel.findOneAndUpdate(
        { transfer_id: transfer.transfer_id, status: "accepting" },
        { $set: { status: "pending", locked_at: null } },
        { returnDocument: "after" },
      );
      if (reverted) {
        await writeAudit({
          transferId:  transfer.transfer_id,
          fromStatus:  "accepting",
          toStatus:    "pending",
          triggeredBy: "recovery",
          note:        "Auto-release richiesta bloccato: ripristino pending per retry",
        });
        await _updateMsg(reverted);
        emitPaymentStateChanged(reverted);
      }
      logger.warn(
        { transferId: transfer.transfer_id },
        "[Scheduler] Recovery: transfer-richiesta bloccato in accepting → pending (retry via auto-release)",
      );
      continue;
    }

    const { terminalStatus, recipient: recipientKey } = config;
    const toAddress = recipientKey === "sender"
      ? transfer.sender_wallet
      : transfer.recipient_wallet;

    if (!toAddress) {
      // Caso degenere: recipient_wallet assente su un accepting — segna failed
      logger.warn({ transferId: transfer.transfer_id, lockedStatus }, "[Scheduler] Recovery: destinatario wallet assente");
      await _failTransfer(transfer.transfer_id, lockedStatus, "Wallet destinatario assente", "recovery");
      continue;
    }

    try {
      // Verifica saldo escrow on-chain
      const balanceStr = await getCustodialBalance({
        address:      transfer.escrow_wallet,
        assetAddress: transfer.asset_address,
      });
      const balance = BigInt(balanceStr);
      const needed  = BigInt(transfer.amount_units);

      let txHash: string | undefined;

      if (balance >= needed) {
        // Fondi ancora presenti — riprova il trasferimento
        logger.info({ transferId: transfer.transfer_id, lockedStatus, balance: balanceStr }, "[Scheduler] Recovery: retry trasferimento");
        const result = await transferFromCustodial({
          encryptedPk:  transfer.escrow_encrypted_pk,
          toAddress,
          amountUnits:  transfer.amount_units,
          assetAddress: transfer.asset_address,
        });
        txHash = result.txHash;
      } else {
        // Saldo 0: TX già inviata, stato DB non aggiornato (crash post-TX)
        logger.info({ transferId: transfer.transfer_id, lockedStatus }, "[Scheduler] Recovery: balance 0 — stato già completato, ripristino");
        txHash = transfer.tx_hash_release ?? undefined; // usa il txHash già noto se presente
      }

      const now  = new Date();
      const done = await ChatTransferModel.findOneAndUpdate(
        { transfer_id: transfer.transfer_id, status: lockedStatus },
        {
          $set: {
            status:          terminalStatus,
            tx_hash_release: txHash ?? null,
            responded_at:    now,
            completed_at:    now,
            locked_at:       null,
          },
        },
        { returnDocument: "after" },
      );
      if (!done) continue;

      await writeAudit({
        transferId:  transfer.transfer_id,
        fromStatus:  lockedStatus,
        toStatus:    terminalStatus,
        triggeredBy: "recovery",
        txHash,
        note: balance >= needed ? "Recovery: retry trasferimento" : "Recovery: balance 0, stato ripristinato",
      });
      await _updateMsg(done);
      emitPaymentStateChanged(done);
      if (done.request_payment_id) {
        // Aggiorna la bolla-richiesta collegata al termine del recovery.
        void syncRequestFromTransfer(done.request_payment_id.toString(), _requestStatusForTerminal(terminalStatus));
      }

      logger.info(
        { transferId: transfer.transfer_id, from: lockedStatus, to: terminalStatus },
        "[Scheduler] Recovery completato ✓",
      );
    } catch (err) {
      logger.error({ err, transferId: transfer.transfer_id }, "[Scheduler] Errore recovery transfer bloccato");
      await _failTransfer(transfer.transfer_id, lockedStatus, String(err), "recovery");
    }
  }
}

// ---------------------------------------------------------------------------
// processPendingRequestReleases
// ---------------------------------------------------------------------------

/**
 * Ri-tenta l'auto-release dei transfer legati a una richiesta rimasti `pending`
 * dopo la conferma del deposito (release fallito per gas/RPC, oppure mai partito
 * per un crash tra confirmDeposit e l'auto-release fire-and-forget).
 *
 * Delega a autoReleaseForRequest(), che è idempotente e balance-checked
 * (nessun rischio di double-spend anche se un tentativo precedente era andato
 * a buon fine ma non aveva aggiornato lo stato DB).
 *
 * Sicuro multi-istanza: autoReleaseForRequest usa acquireLock atomico.
 */
export async function processPendingRequestReleases(): Promise<void> {
  const staleThreshold = new Date(Date.now() - REQUEST_RELEASE_STALE_MS);

  const candidates = await ChatTransferModel.find(
    {
      status:             "pending",
      request_payment_id: { $ne: null },
      tx_hash_deposit:    { $ne: null },      // deposito confermato on-chain
      confirmed_at:       { $lt: staleThreshold },
    },
    { transfer_id: 1 },
  ).limit(BATCH_SIZE).lean();

  if (candidates.length === 0) return;

  logger.info({ count: candidates.length }, "[Scheduler] Auto-release richieste in sospeso da completare");

  for (const candidate of candidates) {
    const transferId = candidate.transfer_id as string;
    try {
      await autoReleaseForRequest(transferId);
    } catch (err) {
      // autoReleaseForRequest non lancia mai; questo è solo un guard difensivo.
      logger.error({ err, transferId }, "[Scheduler] Errore auto-release richiesta in sospeso");
    }
  }
}

// ---------------------------------------------------------------------------
// startPaymentScheduler
// ---------------------------------------------------------------------------

/**
 * Avvia lo scheduler del Payment Engine.
 *
 * Passata iniziale (ADR-003): eseguita subito dopo la connessione MongoDB,
 * garantisce che i transfer bloccati da un riavvio vengano recuperati
 * prima che nuove richieste possano interagire con essi.
 *
 * Poi due setInterval periodici con .unref() (non bloccano il processo in
 * fase di graceful shutdown).
 */
export async function startPaymentScheduler(): Promise<void> {
  // Passata iniziale — fire-and-forget ma loggata
  void (async () => {
    try {
      await processStuckTransfers();
      await processExpiredTransfers();
      await processPendingRequestReleases();
      logger.info("[Scheduler] Passata iniziale completata ✓");
    } catch (err) {
      logger.error({ err }, "[Scheduler] Errore passata iniziale — server continua normalmente");
    }
  })();

  // Scadenze — ogni 5 minuti
  setInterval(() => { void processExpiredTransfers(); }, EXPIRE_INTERVAL_MS).unref();

  // Recovery lock states — ogni 10 minuti
  setInterval(() => { void processStuckTransfers(); }, RECOVERY_INTERVAL_MS).unref();

  // Retry auto-release richieste rimaste pending — ogni 5 minuti
  setInterval(() => { void processPendingRequestReleases(); }, REQUEST_RELEASE_INTERVAL_MS).unref();

  logger.info(
    {
      expireIntervalMin:         EXPIRE_INTERVAL_MS / 60_000,
      recoveryIntervalMin:       RECOVERY_INTERVAL_MS / 60_000,
      requestReleaseIntervalMin: REQUEST_RELEASE_INTERVAL_MS / 60_000,
    },
    "[Scheduler] Payment Engine scheduler avviato",
  );
}
