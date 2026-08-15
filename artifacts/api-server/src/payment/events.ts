/**
 * events.ts — Emissione eventi WS del Chat Payment Engine (Sprint 1)
 *
 * Emette "payment.state_changed" a mittente e destinatario.
 * Non interferisce con "usda.payment.update" del flusso getusda.xyz. (ADR-001)
 *
 * Il Payment Engine emette eventi di stato; la chat aggiorna il messaggio. (ADR-002)
 */

import { wsManager } from "../lib/ws-manager";
import type { ChatTransferDocument } from "../models/chat-transfer.model";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface PaymentStateChangedPayload {
  transfer_id:      string;
  conversation_id:  string;
  message_id:       string | null;
  status:           string;
  asset_symbol:     string;
  asset_address:    string;
  amount:           string;
  expires_at:       string | null;
  tx_hash_deposit:  string | null;
  tx_hash_release:  string | null;
  transfer_mode:    "direct" | "escrow";
  sender_id:        string;
  recipient_wallet: string | null;
  sender_wallet:    string | null;
}

// ---------------------------------------------------------------------------
// emitPaymentStateChanged
// ---------------------------------------------------------------------------

/**
 * Invia l'evento "payment.state_changed" a mittente e destinatario via WS.
 * Fire-and-forget: non lancia eccezioni — gli errori WS non devono
 * bloccare la pipeline del Payment Engine.
 */
export function emitPaymentStateChanged(transfer: ChatTransferDocument): void {
  try {
    const payload: PaymentStateChangedPayload = {
      transfer_id:      transfer.transfer_id,
      conversation_id:  transfer.conversation_id.toString(),
      message_id:       transfer.message_id?.toString() ?? null,
      status:           transfer.status,
      asset_symbol:     transfer.asset_symbol,
      asset_address:    transfer.asset_address,
      amount:           transfer.amount?.toString() ?? "0",
      expires_at:       transfer.expires_at?.toISOString() ?? null,
      tx_hash_deposit:  transfer.tx_hash_deposit  ?? null,
      tx_hash_release:  transfer.tx_hash_release  ?? null,
      transfer_mode:    (transfer.transfer_mode as "direct" | "escrow") ?? "escrow",
      sender_id:        transfer.sender_id.toString(),
      recipient_wallet: transfer.recipient_wallet ?? null,
      sender_wallet:    transfer.sender_wallet    ?? null,
    };

    const userIds = [
      transfer.sender_id.toString(),
      transfer.recipient_id.toString(),
    ];

    wsManager.sendToUsers(userIds, {
      type: "payment.state_changed",
      payload,
    });

    logger.debug(
      { transferId: transfer.transfer_id, status: transfer.status, userIds },
      "[PaymentEvents] payment.state_changed emesso",
    );
  } catch (err) {
    logger.error({ err, transferId: transfer.transfer_id }, "[PaymentEvents] Errore emissione evento WS");
  }
}
