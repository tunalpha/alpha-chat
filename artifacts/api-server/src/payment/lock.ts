/**
 * lock.ts — Lock atomico per la state machine del Chat Payment Engine (Sprint 1)
 *
 * acquireLock() usa findOneAndUpdate con filtro sullo stato corrente.
 * Se il record è già stato acquisito da un altro processo → restituisce null.
 * Garantisce che in ambienti multi-istanza (Autoscale) un solo processo
 * esegua la transizione. (ADR-003)
 */

import { ChatTransferModel, ChatTransferDocument } from "../models/chat-transfer.model";
import { ChatTransferAuditModel, AuditTriggeredBy } from "../models/chat-transfer-audit.model";
import type { ChatTransferStatus } from "./state-machine";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// acquireLock
// ---------------------------------------------------------------------------

/**
 * Tenta di acquisire il lock atomico su un trasferimento.
 *
 * @param transferId  - transfer_id (UUID stringa)
 * @param fromStatus  - stato corrente atteso
 * @param toStatus    - stato di destinazione (lock state)
 * @returns Il documento aggiornato se il lock è acquisito, null altrimenti.
 */
export async function acquireLock(
  transferId: string,
  fromStatus: ChatTransferStatus,
  toStatus: ChatTransferStatus,
): Promise<ChatTransferDocument | null> {
  const now = new Date();

  const result = await ChatTransferModel.findOneAndUpdate(
    { transfer_id: transferId, status: fromStatus },
    { $set: { status: toStatus, locked_at: now } },
    { returnDocument: "after" },
  );

  if (!result) {
    logger.warn(
      { transferId, fromStatus, toStatus },
      "[Lock] Lock non acquisito — già preso o stato cambiato",
    );
    return null;
  }

  logger.info(
    { transferId, fromStatus, toStatus },
    "[Lock] Lock acquisito",
  );

  return result;
}

// ---------------------------------------------------------------------------
// writeAudit
// ---------------------------------------------------------------------------

/**
 * Scrive una riga nell'audit log per ogni transizione di stato.
 * Fire-and-forget: non blocca il flusso principale.
 */
export async function writeAudit(params: {
  transferId:   string;
  fromStatus:   ChatTransferStatus | null;
  toStatus:     ChatTransferStatus;
  triggeredBy:  AuditTriggeredBy;
  txHash?:      string;
  note?:        string;
  ip?:          string;
}): Promise<void> {
  try {
    await ChatTransferAuditModel.create({
      transfer_id:  params.transferId,
      from_status:  params.fromStatus,
      to_status:    params.toStatus,
      triggered_by: params.triggeredBy,
      tx_hash:      params.txHash ?? null,
      note:         params.note ?? null,
      ip:           params.ip ?? null,
    });
  } catch (err) {
    // Non bloccare mai il flusso principale per un errore di audit
    logger.error({ err, params }, "[Audit] Scrittura audit fallita");
  }
}
