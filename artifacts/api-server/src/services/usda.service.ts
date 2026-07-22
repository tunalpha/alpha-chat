/**
 * UsdaService — orchestrazione USDA in AlphaChat.
 *
 * Dipende esclusivamente da UsdaAdapter (interfaccia astratta).
 * NON contiene logica blockchain, wallet custodiali o RPC.
 *
 * Responsabilità:
 *   1. Delegare al UsdaAdapter per le operazioni finanziarie
 *   2. Creare/aggiornare messaggi nella timeline di chat
 *   3. Persistere lo stato in usda_payments
 *   4. Broadcastare eventi WS (message.new, usda.payment.update)
 */

import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { AppError } from "../errors/AppError";
import { UsdaPaymentRepository } from "../repositories/usda-payment.repository";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { ConversationModel } from "../models/conversation.model";
import { MessageModel } from "../models/message.model";
import { UserModel } from "../models/user.model";
import { wsManager } from "../lib/ws-manager";
import { logger } from "../lib/logger";
import { MockUsdaAdapter, setMockStatusChangeCallback } from "../usda/mock-usda.adapter";
import type { UsdaAdapter, UsdaPaymentStatus } from "../usda/usda-adapter.interface";
import type { IUsdaPaymentDocument } from "../models/usda-payment.model";
import { balanceOfUsda } from "../usda/polygon-rpc";

// ---------------------------------------------------------------------------
// Dependency Injection
//
// Se USDA_API_BASE_URL è configurato → HttpUsdaAdapter (backend reale)
// Altrimenti                         → MockUsdaAdapter (simulazione)
// ---------------------------------------------------------------------------

import {
  HttpUsdaAdapter,
  UsdaNotConfiguredError,
  UsdaUnavailableError,
  setHttpStatusChangeCallback,
} from "../usda/http-usda.adapter";

let _httpAdapter: HttpUsdaAdapter | null = null;

function _createAdapter(): UsdaAdapter {
  if (process.env.USDA_API_BASE_URL) {
    logger.info("[USDA] Using HttpUsdaAdapter (USDA_API_BASE_URL configured)");
    const adapter = new HttpUsdaAdapter();
    _httpAdapter = adapter;
    return adapter;
  }
  logger.info("[USDA] Using MockUsdaAdapter (USDA_API_BASE_URL not set)");
  return new MockUsdaAdapter();
}

let _adapter: UsdaAdapter = _createAdapter();

export { UsdaNotConfiguredError, UsdaUnavailableError };

export function setUsdaAdapter(adapter: UsdaAdapter): void {
  _adapter = adapter;
  _httpAdapter = adapter instanceof HttpUsdaAdapter ? adapter : null;
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

const paymentRepo = new UsdaPaymentRepository();
const memberRepo  = new ConversationMemberRepository();

// ---------------------------------------------------------------------------
// Status-change callback (Mock: auto-conferma / Http: polling USDA)
// ---------------------------------------------------------------------------

setMockStatusChangeCallback(async (externalPaymentId, status, txHash) => {
  await _handleExternalStatusChange(externalPaymentId, status, txHash);
});

setHttpStatusChangeCallback(async (externalPaymentId, status, txHash) => {
  await _handleExternalStatusChange(externalPaymentId, status, txHash);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function _createUsdaMessage(params: {
  conversationId: mongoose.Types.ObjectId;
  senderId:       mongoose.Types.ObjectId;
  messageType:    "usda_send" | "usda_request" | "usda_receipt";
  systemMetadata: Record<string, unknown>;
}) {
  const now = new Date();

  // Acquisisce sequence_number atomicamente (stesso pattern di message.repository)
  const updatedConv = await ConversationModel.findOneAndUpdate(
    { _id: params.conversationId, deleted_at: null },
    {
      $inc: { sequence_counter: 1 },
      $set: { last_message_at: now, last_activity_at: now },
    },
    { returnDocument: "after" },
  );
  if (!updatedConv) throw new AppError("CHAT_NOT_FOUND", 404);

  const message = await MessageModel.create({
    client_message_id: randomUUID(),
    conversation_id:   params.conversationId,
    sender_id:         params.senderId,
    ciphertext:        null,
    ciphertext_type:   null,
    sender_key_id:     null,
    message_type:      params.messageType,
    sent_at:           now,
    server_received_at: now,
    sequence_number:   updatedConv.sequence_counter,
    status:            "sent",
    system_event:      params.messageType,
    system_metadata:   params.systemMetadata,
    device_ciphertexts: null,
  });

  await ConversationModel.updateOne(
    { _id: params.conversationId },
    { $set: { last_message_id: message._id } },
  );

  return message;
}

function _formatPayment(doc: IUsdaPaymentDocument): Record<string, unknown> {
  return {
    payment_id:          doc._id.toString(),
    kind:                doc.kind,
    status:              doc.status,
    amount:              doc.amount.toString(),
    fee:                 doc.fee.toString(),
    note:                doc.note,
    sender_id:           doc.sender_id.toString(),
    recipient_id:        doc.recipient_id.toString(),
    conversation_id:     doc.conversation_id.toString(),
    message_id:          doc.message_id?.toString() ?? null,
    tx_hash:             doc.tx_hash,
    external_payment_id: doc.external_payment_id,
    share_link:          doc.share_link ?? null,
    claim_expires_at:    doc.claim_expires_at?.toISOString() ?? null,
    claimed_at:          doc.claimed_at?.toISOString() ?? null,
    refunded_at:         doc.refunded_at?.toISOString() ?? null,
    created_at:          doc.createdAt.toISOString(),
    updated_at:          doc.updatedAt.toISOString(),
  };
}

function _buildMsgPayload(
  message: Awaited<ReturnType<typeof _createUsdaMessage>>,
  conversationId: string,
  senderId: string,
) {
  return {
    id:                 message._id.toString(),
    client_message_id:  message.client_message_id,
    conversation_id:    conversationId,
    sender_id:          senderId,
    message_type:       message.message_type,
    ciphertext:         null,
    status:             "sent",
    system_event:       message.system_event,
    system_metadata:    message.system_metadata,
    sequence_number:    message.sequence_number,
    server_received_at: message.server_received_at.toISOString(),
    sent_at:            message.sent_at.toISOString(),
    deleted_for_everyone: false,
    device_ciphertexts: null,
  };
}

async function _getUserName(userId: mongoose.Types.ObjectId): Promise<string> {
  const u = await UserModel.findById(userId, "username display_name").lean();
  return (u as { display_name?: string; username?: string } | null)?.display_name
    ?? (u as { username?: string } | null)?.username
    ?? "Unknown";
}

// ---------------------------------------------------------------------------
// External status change (from adapter callback / webhook)
// ---------------------------------------------------------------------------

async function _handleExternalStatusChange(
  externalPaymentId: string,
  status: UsdaPaymentStatus,
  txHash?: string,
): Promise<void> {
  const doc = await paymentRepo.findByExternalId(externalPaymentId);
  if (!doc) {
    logger.warn({ externalPaymentId }, "[USDA] Status change: payment not found");
    return;
  }

  const updated = await paymentRepo.updateStatus(doc._id, status, { txHash });
  if (!updated) return;

  // Aggiorna system_metadata nel messaggio
  if (updated.message_id) {
    await MessageModel.updateOne(
      { _id: updated.message_id },
      {
        $set: {
          "system_metadata.status":  status,
          "system_metadata.tx_hash": txHash ?? null,
        },
      },
    );
  }

  const wsPayload = {
    payment_id:      updated._id.toString(),
    message_id:      updated.message_id?.toString() ?? null,
    conversation_id: updated.conversation_id.toString(),
    status,
    tx_hash:         txHash ?? null,
    updated_at:      updated.updatedAt.toISOString(),
  };

  wsManager.sendToUsers(
    [updated.sender_id.toString(), updated.recipient_id.toString()],
    { type: "usda.payment.update", payload: wsPayload },
  );

  logger.info({ paymentId: updated._id.toString(), status, txHash }, "[USDA] Status update broadcast");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * reconcilePendingPayments — eseguita una sola volta al boot del server.
 *
 * Trova tutti i pagamenti in stati non-terminali nel DB AlphaChat e riavvia
 * il polling per ciascuno. Gestisce il caso in cui il server si riavvia mentre
 * un pagamento è ancora in attesa di conferma blockchain.
 *
 * Solo per HttpUsdaAdapter — il MockAdapter non ha polling persistente.
 */
export async function reconcilePendingPayments(): Promise<void> {
  if (!_httpAdapter) return; // MockAdapter — nessuna riconciliazione necessaria

  try {
    const pending = await paymentRepo.findNonTerminal();
    if (pending.length === 0) {
      logger.info("[USDA] Startup reconciliation: no pending payments");
      return;
    }

    logger.info({ count: pending.length }, "[USDA] Startup reconciliation: restarting polling");

    for (const doc of pending) {
      if (!doc.external_payment_id) continue;
      _httpAdapter.schedulePollingRestart(doc._id.toString(), doc.external_payment_id);
    }

    logger.info({ count: pending.length }, "[USDA] Startup reconciliation complete");
  } catch (err) {
    // Non blocca il boot — log e prosegui
    logger.error({ err }, "[USDA] Startup reconciliation failed (non-fatal)");
  }
}

export async function checkHealth(): Promise<{ available: boolean }> {
  if (_httpAdapter) {
    const ok = await _httpAdapter._refreshHealth();
    return { available: ok };
  }
  // MockAdapter è sempre disponibile
  return { available: true };
}

export async function getWallet(
  userId: string,
  /** FIX 2: indirizzo ThirdWeb live dal frontend — se presente, usato per il saldo
   *  invece dell'indirizzo salvato in MongoDB (che potrebbe essere obsoleto). */
  liveAddress?: string,
) {
  // Se stiamo usando HttpAdapter, leggiamo il saldo reale da ERC-20 via Polygon RPC.
  // La struttura dei wallet è in MongoDB (il DB di AlphaChat), non sul backend USDA.
  if (_httpAdapter) {
    const user = await UserModel.findById(
      new mongoose.Types.ObjectId(userId),
      "wallets wallet_address wallet_enabled",
    ).lean() as { wallets?: Record<string, { address: string; verifiedAt: string | null }>; wallet_address?: string; wallet_enabled?: boolean } | null;

    const wallets    = user?.wallets ?? {};
    const usdaEntry  = wallets.usda;
    const storedAddr = usdaEntry?.address ?? user?.wallet_address ?? null;

    // Priorità: indirizzo live ThirdWeb > indirizzo salvato in MongoDB
    const addressForBalance = liveAddress ?? storedAddr;

    let balance = "0.000000";
    if (addressForBalance) {
      try {
        balance = await balanceOfUsda(addressForBalance);
      } catch (err) {
        logger.warn({ err, address: addressForBalance }, "[USDA] balanceOf failed — using 0");
      }
    }

    // wallet_enabled = true se ThirdWeb è connesso (liveAddress presente) OPPURE
    // se il campo è impostato nel DB
    const walletEnabled = !!(liveAddress || usdaEntry || (storedAddr && user?.wallet_enabled));

    return {
      address:        liveAddress ?? storedAddr,   // live address ha precedenza
      chain_id:       parseInt(process.env.USDA_CHAIN_ID ?? "137", 10),
      balance_usda:   balance,
      wallet_enabled: walletEnabled,
      wallets:        wallets as Record<string, { address: string; verifiedAt: string | null }>,
    };
  }

  return _adapter.getWallet(userId);
}

export async function setWalletAddress(userId: string, address: string, chain = "usda") {
  // Aggiorna la struttura wallets multi-chain e mantiene wallet_address legacy
  const $set: Record<string, unknown> = {
    [`wallets.${chain}`]: { address, verifiedAt: new Date() },
    wallet_enabled: true,
  };
  if (chain === "usda") $set.wallet_address = address;

  await UserModel.updateOne(
    { _id: new mongoose.Types.ObjectId(userId) },
    { $set },
  );
  return _adapter.setWalletAddress(userId, address, chain as import("../usda/usda-adapter.interface").WalletChain);
}

export async function checkCapabilities() {
  return _adapter.checkCapabilities();
}

export async function getBackendInfo() {
  return _adapter.getInfo();
}

export async function preparePayment(params: {
  fromUserId: string;
  toUserId: string;
  conversationId: string;
  amount: string;
  note?: string;
}) {
  const convId   = new mongoose.Types.ObjectId(params.conversationId);
  const senderId = new mongoose.Types.ObjectId(params.fromUserId);
  const membership = await memberRepo.findMembership(convId, senderId);
  if (!membership || membership.left_at !== null) throw new AppError("NOT_CHAT_MEMBER", 403);

  // FIX 1: Verifica wallet del destinatario PRIMA di chiamare il backend USDA.
  // Se non ha un wallet registrato in MongoDB, restituisce un errore leggibile
  // invece del generico "USDA API error 400" del backend esterno.
  const recipientOid  = new mongoose.Types.ObjectId(params.toUserId);
  const recipientUser = await UserModel.findById(
    recipientOid,
    "username display_name wallets wallet_address wallet_enabled",
  ).lean() as {
    username?: string;
    display_name?: string;
    wallets?: Record<string, { address: string }>;
    wallet_address?: string;
    wallet_enabled?: boolean;
  } | null;

  if (!recipientUser) throw new AppError("USER_NOT_FOUND", 404);

  const recipientWalletAddr =
    recipientUser.wallets?.usda?.address ?? recipientUser.wallet_address ?? null;

  if (!recipientWalletAddr) {
    const recipientName = recipientUser.display_name ?? recipientUser.username ?? "Il destinatario";
    throw new AppError(
      "RECIPIENT_NO_WALLET",
      422,
      `${recipientName} non ha ancora attivato il wallet USDA. Chiedigli di attivarlo prima di inviargli denaro.`,
    );
  }

  const clientPaymentId = randomUUID();
  return _adapter.preparePayment({
    from_user_id:      params.fromUserId,
    to_user_id:        params.toUserId,
    amount:            params.amount,
    note:              params.note,
    client_payment_id: clientPaymentId,
  });
}

export async function submitPayment(params: {
  fromUserId: string;
  toUserId: string;
  conversationId: string;
  amount: string;
  fee: string;
  note?: string;
  clientPaymentId: string;
  preparedData: Record<string, unknown>;
  signature?: string;
}): Promise<Record<string, unknown>> {
  const convId       = new mongoose.Types.ObjectId(params.conversationId);
  const senderId     = new mongoose.Types.ObjectId(params.fromUserId);
  const recipientId  = new mongoose.Types.ObjectId(params.toUserId);

  // Idempotenza
  const existing = await paymentRepo.findByClientId(params.clientPaymentId);
  if (existing) return { ..._formatPayment(existing) };

  // Verifica membership
  const membership = await memberRepo.findMembership(convId, senderId);
  if (!membership || membership.left_at !== null) throw new AppError("NOT_CHAT_MEMBER", 403);

  // Chiama adapter
  const adapterResult = await _adapter.submitPayment({
    client_payment_id: params.clientPaymentId,
    from_user_id:      params.fromUserId,
    to_user_id:        params.toUserId,
    conversation_id:   params.conversationId,
    amount:            params.amount,
    fee:               params.fee,
    note:              params.note,
    prepared_data:     params.preparedData,
    signature:         params.signature,
  });

  // Nomi display
  const [senderName, recipientName] = await Promise.all([
    _getUserName(senderId),
    _getUserName(recipientId),
  ]);

  const claimExpiresAt = adapterResult.claim_expires_at
    ? new Date(adapterResult.claim_expires_at) : null;

  // Salva in DB
  const doc = await paymentRepo.create({
    clientPaymentId:    params.clientPaymentId,
    kind:               "send",
    senderId,
    recipientId,
    conversationId:     convId,
    amount:             params.amount,
    fee:                params.fee,
    note:               params.note ?? null,
    status:             adapterResult.status,
    externalPaymentId:  adapterResult.payment_id,
    claimExpiresAt,
  });

  // Crea messaggio nella chat
  const message = await _createUsdaMessage({
    conversationId: convId,
    senderId,
    messageType:    "usda_send",
    systemMetadata: {
      payment_id:      doc._id.toString(),
      kind:            "send",
      amount:          params.amount,
      fee:             params.fee,
      note:            params.note ?? null,
      status:          adapterResult.status,
      tx_hash:         adapterResult.tx_hash,
      sender_id:       params.fromUserId,
      sender_name:     senderName,
      recipient_id:    params.toUserId,
      recipient_name:  recipientName,
      claim_expires_at: claimExpiresAt?.toISOString() ?? null,
    },
  });

  // Collega il messaggio al pagamento
  await paymentRepo.updateStatus(doc._id, adapterResult.status, {
    messageId:         message._id,
    externalPaymentId: adapterResult.payment_id,
  });

  // Broadcast message.new
  const members = await memberRepo.listMembers(convId);
  wsManager.sendToUsers(
    members.map((m) => m.user_id.toString()),
    { type: "message.new", payload: _buildMsgPayload(message, params.conversationId, params.fromUserId) },
  );

  return { ..._formatPayment(doc), message_id: message._id.toString() };
}

export async function requestPayment(params: {
  fromUserId: string;
  toUserId: string;
  conversationId: string;
  amount: string;
  note?: string;
  clientPaymentId: string;
}): Promise<Record<string, unknown>> {
  const convId      = new mongoose.Types.ObjectId(params.conversationId);
  const senderId    = new mongoose.Types.ObjectId(params.fromUserId);
  const recipientId = new mongoose.Types.ObjectId(params.toUserId);

  const existing = await paymentRepo.findByClientId(params.clientPaymentId);
  if (existing) return { ..._formatPayment(existing) };

  const membership = await memberRepo.findMembership(convId, senderId);
  if (!membership || membership.left_at !== null) throw new AppError("NOT_CHAT_MEMBER", 403);

  // Recupera il wallet Polygon del richiedente — obbligatorio per il contratto USDA API
  const requesterUser = await UserModel.findById(
    new mongoose.Types.ObjectId(params.fromUserId),
    "wallets wallet_address",
  ).lean() as { wallets?: Record<string, { address: string }>; wallet_address?: string } | null;
  const requesterWallet =
    requesterUser?.wallets?.usda?.address ?? requesterUser?.wallet_address ?? null;

  if (!requesterWallet) {
    throw new AppError("WALLET_NOT_CONFIGURED", 400, undefined, {
      detail: "L'utente non ha un wallet USDA configurato. Connetti un wallet prima di richiedere un pagamento.",
    });
  }

  const adapterResult = await _adapter.requestPayment({
    from_user_id:      params.fromUserId,
    to_user_id:        params.toUserId,
    requester_wallet:  requesterWallet,
    amount:            params.amount,
    note:              params.note,
    conversation_id:   params.conversationId,
    client_payment_id: params.clientPaymentId,
  });

  const [senderName, recipientName] = await Promise.all([
    _getUserName(senderId),
    _getUserName(recipientId),
  ]);

  const claimExpiresAt = adapterResult.claim_expires_at
    ? new Date(adapterResult.claim_expires_at) : null;

  const doc = await paymentRepo.create({
    clientPaymentId:   params.clientPaymentId,
    kind:              "request",
    senderId,
    recipientId,
    conversationId:    convId,
    amount:            params.amount,
    fee:               "0",
    note:              params.note ?? null,
    status:            "pending_claim",
    externalPaymentId: adapterResult.payment_id,
    shareLink:         adapterResult.share_link ?? null,
    claimExpiresAt,
  });

  const message = await _createUsdaMessage({
    conversationId: convId,
    senderId,
    messageType:    "usda_request",
    systemMetadata: {
      payment_id:      doc._id.toString(),
      kind:            "request",
      amount:          params.amount,
      note:            params.note ?? null,
      status:          "pending_claim",
      sender_id:       params.fromUserId,
      sender_name:     senderName,
      recipient_id:    params.toUserId,
      recipient_name:  recipientName,
      claim_expires_at: claimExpiresAt?.toISOString() ?? null,
      share_link:      adapterResult.share_link ?? null,
    },
  });

  await paymentRepo.updateStatus(doc._id, "pending_claim", {
    messageId:         message._id,
    externalPaymentId: adapterResult.payment_id,
  });

  const members = await memberRepo.listMembers(convId);
  wsManager.sendToUsers(
    members.map((m) => m.user_id.toString()),
    { type: "message.new", payload: _buildMsgPayload(message, params.conversationId, params.fromUserId) },
  );

  return { ..._formatPayment(doc), message_id: message._id.toString() };
}

export async function payRequest(params: {
  requestId: string;
  payerId: string;
  signature?: string;
}): Promise<Record<string, unknown>> {
  const doc = await paymentRepo.findById(new mongoose.Types.ObjectId(params.requestId));
  if (!doc) throw new AppError("USDA_PAYMENT_NOT_FOUND", 404);
  if (doc.status !== "pending_claim") throw new AppError("USDA_PAYMENT_INVALID_STATE", 409);

  await _adapter.payRequest(doc.external_payment_id ?? params.requestId, params.payerId);

  const updated = await paymentRepo.updateStatus(doc._id, "pending");
  if (!updated) throw new AppError("USDA_UPDATE_FAILED", 500);

  if (doc.message_id) {
    await MessageModel.updateOne(
      { _id: doc.message_id },
      { $set: { "system_metadata.status": "pending" } },
    );
  }

  wsManager.sendToUsers(
    [doc.sender_id.toString(), doc.recipient_id.toString()],
    {
      type: "usda.payment.update",
      payload: {
        payment_id:      doc._id.toString(),
        message_id:      doc.message_id?.toString() ?? null,
        conversation_id: doc.conversation_id.toString(),
        status:          "pending",
        tx_hash:         null,
        updated_at:      new Date().toISOString(),
      },
    },
  );

  return _formatPayment(updated);
}

/**
 * Cerca un pagamento per client_payment_id.
 * Usato dalla recovery frontend: se sessionStorage contiene un CPI in volo
 * al momento di un crash, il client verifica qui se il pagamento è già in DB.
 * Ritorna null se non trovato o se l'utente non è un partecipante.
 */
export async function getPaymentByClientId(
  clientPaymentId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const doc = await paymentRepo.findByClientId(clientPaymentId);
  if (!doc) return null;
  const isParticipant =
    doc.sender_id.toString() === userId || doc.recipient_id.toString() === userId;
  if (!isParticipant) return null;
  return _formatPayment(doc);
}

export async function getPayment(
  paymentId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const doc = await paymentRepo.findById(new mongoose.Types.ObjectId(paymentId));
  if (!doc) throw new AppError("USDA_PAYMENT_NOT_FOUND", 404);

  const isParticipant =
    doc.sender_id.toString() === userId || doc.recipient_id.toString() === userId;
  if (!isParticipant) throw new AppError("USDA_PAYMENT_NOT_FOUND", 404);

  return _formatPayment(doc);
}

export async function getHistory(
  userId: string,
  filters: { type?: string; limit?: number; skip?: number },
): Promise<{ payments: Record<string, unknown>[]; total: number }> {
  const { payments, total } = await paymentRepo.findByUser(
    new mongoose.Types.ObjectId(userId),
    {
      kind:  filters.type as "sent" | "received" | "pending" | "claimed" | "refunded" | undefined,
      limit: filters.limit,
      skip:  filters.skip,
    },
  );
  return { payments: payments.map(_formatPayment), total };
}
