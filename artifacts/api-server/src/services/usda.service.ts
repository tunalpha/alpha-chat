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

// ---------------------------------------------------------------------------
// Dependency Injection
//
// Se USDA_API_BASE_URL è configurato → HttpUsdaAdapter (backend reale)
// Altrimenti                         → MockUsdaAdapter (simulazione)
//
// Per passare al backend reale: impostare USDA_API_BASE_URL come secret Replit.
// ---------------------------------------------------------------------------

import { HttpUsdaAdapter, UsdaNotConfiguredError } from "../usda/http-usda.adapter";

function _createAdapter(): UsdaAdapter {
  if (process.env.USDA_API_BASE_URL) {
    logger.info("[USDA] Using HttpUsdaAdapter (USDA_API_BASE_URL configured)");
    return new HttpUsdaAdapter();
  }
  logger.info("[USDA] Using MockUsdaAdapter (USDA_API_BASE_URL not set)");
  return new MockUsdaAdapter();
}

let _adapter: UsdaAdapter = _createAdapter();

export { UsdaNotConfiguredError };

export function setUsdaAdapter(adapter: UsdaAdapter): void {
  _adapter = adapter;
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

const paymentRepo = new UsdaPaymentRepository();
const memberRepo  = new ConversationMemberRepository();

// ---------------------------------------------------------------------------
// Mock status-change callback (auto-conferma simulata)
// ---------------------------------------------------------------------------

setMockStatusChangeCallback(async (externalPaymentId, status, txHash) => {
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

export async function getWallet(userId: string) {
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
  const convId    = new mongoose.Types.ObjectId(params.conversationId);
  const senderId  = new mongoose.Types.ObjectId(params.fromUserId);
  const membership = await memberRepo.findMembership(convId, senderId);
  if (!membership || membership.left_at !== null) throw new AppError("NOT_CHAT_MEMBER", 403);

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

  const adapterResult = await _adapter.requestPayment({
    from_user_id:      params.fromUserId,
    to_user_id:        params.toUserId,
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
