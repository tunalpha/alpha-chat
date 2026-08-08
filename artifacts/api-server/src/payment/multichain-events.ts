/**
 * multichain-events.ts — Emissione eventi WS del Multi-Chain Payment Engine
 *
 * Emette "mc_payment.state_changed" a mittente e destinatario via WS ad ogni
 * cambio di stato (detect, release, refund, waiting_for_gas).
 *
 * Architettura speculare a payment/events.ts (Chat Payment Engine):
 *   emitPaymentStateChanged → payment.state_changed
 *   emitMCPaymentStateChanged → mc_payment.state_changed
 *
 * ISOLAMENTO: non tocca usda.payment.update né payment.state_changed. (ADR-001)
 */

import { wsManager }                       from "../lib/ws-manager";
import { logger }                          from "../lib/logger";
import type { MultiChainTransferDocument } from "../models/multichain-transfer.model";

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface MCPaymentStateChangedPayload {
  transfer_id:     string;
  conversation_id: string;
  message_id:      string | null;
  status:          string;
  network:         string;
  asset:           string;
  gross_amount:    string;
  net_amount:      string;
  tx_hash_release: string | null;
  tx_hash_deposit: string | null;
  expires_at:      string | null;
}

// ---------------------------------------------------------------------------
// emitMCPaymentStateChanged
// ---------------------------------------------------------------------------

/**
 * Invia l'evento "mc_payment.state_changed" a mittente e destinatario via WS.
 * Fire-and-forget: non lancia eccezioni.
 *
 * Il frontend (ChatPage.tsx, case "mc_payment.state_changed") aggiorna
 * system_metadata della bolla mc_payment in-place, identico al flusso
 * payment.state_changed del Chat Payment Engine.
 */
export function emitMCPaymentStateChanged(doc: MultiChainTransferDocument): void {
  try {
    const payload: MCPaymentStateChangedPayload = {
      transfer_id:     doc.transfer_id,
      conversation_id: doc.conversation_id.toString(),
      message_id:      doc.message_id?.toString() ?? null,
      status:          doc.status,
      network:         doc.network,
      asset:           doc.asset,
      gross_amount:    doc.gross_amount,
      net_amount:      doc.net_amount,
      tx_hash_release: doc.tx_hash_release ?? null,
      tx_hash_deposit: doc.tx_hash_deposit ?? null,
      expires_at:      doc.expires_at?.toISOString() ?? null,
    };

    const userIds = [
      doc.sender_id.toString(),
      doc.recipient_id.toString(),
    ];

    wsManager.sendToUsers(userIds, {
      type:    "mc_payment.state_changed",
      payload,
    });

    logger.debug(
      { transferId: doc.transfer_id, status: doc.status, userIds },
      "[MCEvents] mc_payment.state_changed emesso",
    );
  } catch (err) {
    logger.error(
      { err, transferId: doc.transfer_id },
      "[MCEvents] Errore emissione evento WS — ignorato (fire-and-forget)",
    );
  }
}
