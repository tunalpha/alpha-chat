/**
 * chat-payment.service.ts — Chat Payment Engine (Sprint 2)
 *
 * Orchestrazione completa del ciclo di vita di un trasferimento P2P:
 *   create → deposit → (accept | reject | cancel)
 *
 * Principi rispettati:
 *   ADR-001 — zero dipendenze da getusda.xyz
 *   ADR-002 — ogni trasferimento crea un Payment Message in chat
 *   ADR-003 — lock atomico via findOneAndUpdate, nessun timer in memoria
 *   ADR-004 — accept senza recipient_wallet → WALLET_NOT_CONFIGURED (412), transfer resta PENDING
 *
 * escrow_encrypted_pk NON compare mai nei valori di ritorno.
 */

import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { createPublicClient, http, hexToBigInt } from "viem";
import { polygon } from "viem/chains";

import { ChatTransferModel, type ChatTransferDocument } from "../models/chat-transfer.model";
import { UserModel }                                    from "../models/user.model";
import { ConversationModel }                            from "../models/conversation.model";
import { MessageModel }                                 from "../models/message.model";
import { ConversationMemberRepository }                 from "../repositories/conversation-member.repository";
import { generateEscrowWallet, transferFromCustodial, toAmountUnits } from "./usda-custodial.service";
import { checkAndMarkTx, rollbackTx }                   from "./asset-anti-replay";
import { acquireLock, writeAudit }                      from "./lock";
import { emitPaymentStateChanged }                      from "./events";
import { wsManager }                                    from "../lib/ws-manager";
import { AppError }                                     from "../errors/AppError";
import { logger }                                       from "../lib/logger";
import type { ChatTransferStatus }                      from "./state-machine";
import type { AuditTriggeredBy }                        from "../models/chat-transfer-audit.model";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const PAYMENT_EXPIRY_MS        = 48 * 60 * 60 * 1000; // 48 ore
const DEFAULT_USDA_CONTRACT    = "0xe714655fD1B3ba96B887DF1F94336c2A78E24001";
const DEFAULT_USDA_SYMBOL      = "USDA";
/** keccak256("Transfer(address,address,uint256)") — evento ERC-20 standard */
const ERC20_TRANSFER_TOPIC     = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const memberRepo = new ConversationMemberRepository();

// ---------------------------------------------------------------------------
// Helpers privati
// ---------------------------------------------------------------------------

/**
 * Vista pubblica del trasferimento — escrow_encrypted_pk sempre escluso.
 */
function _format(doc: ChatTransferDocument): Record<string, unknown> {
  return {
    transfer_id:      doc.transfer_id,
    status:           doc.status,
    amount:           doc.amount?.toString() ?? "0",
    amount_units:     doc.amount_units,
    asset_symbol:     doc.asset_symbol,
    asset_address:    doc.asset_address,
    fee:              doc.fee?.toString() ?? "0",
    note:             doc.note ?? null,
    sender_id:        doc.sender_id.toString(),
    recipient_id:     doc.recipient_id.toString(),
    conversation_id:  doc.conversation_id.toString(),
    message_id:       doc.message_id?.toString() ?? null,
    escrow_wallet:    doc.escrow_wallet,
    sender_wallet:    doc.sender_wallet,
    recipient_wallet: doc.recipient_wallet ?? null,
    tx_hash_deposit:  doc.tx_hash_deposit ?? null,
    tx_hash_release:  doc.tx_hash_release ?? null,
    expires_at:       doc.expires_at.toISOString(),
    confirmed_at:     doc.confirmed_at?.toISOString() ?? null,
    responded_at:     doc.responded_at?.toISOString() ?? null,
    completed_at:     doc.completed_at?.toISOString() ?? null,
    created_at:       (doc as any).createdAt?.toISOString() ?? null,
  };
}

/**
 * Metadati del messaggio-bolla in chat (aggiornati ad ogni cambio di stato).
 */
function _paymentMeta(doc: ChatTransferDocument): Record<string, unknown> {
  return {
    transfer_id:     doc.transfer_id,
    status:          doc.status,
    amount:          doc.amount?.toString() ?? "0",
    asset_symbol:    doc.asset_symbol,
    asset_address:   doc.asset_address,
    note:            doc.note ?? null,
    sender_id:       doc.sender_id.toString(),
    recipient_id:    doc.recipient_id.toString(),
    escrow_wallet:   doc.escrow_wallet,
    expires_at:      doc.expires_at.toISOString(),
    tx_hash_deposit: doc.tx_hash_deposit ?? null,
    tx_hash_release: doc.tx_hash_release ?? null,
  };
}

/**
 * Crea il messaggio-bolla di tipo "payment" nella conversazione.
 * Stesso pattern di _createUsdaMessage in usda.service.ts.
 */
async function _createPaymentMessage(
  transfer: ChatTransferDocument,
): Promise<mongoose.Types.ObjectId> {
  const now = new Date();

  const updatedConv = await ConversationModel.findOneAndUpdate(
    { _id: transfer.conversation_id, deleted_at: null },
    {
      $inc: { sequence_counter: 1 },
      $set: { last_message_at: now, last_activity_at: now },
    },
    { returnDocument: "after" },
  );
  if (!updatedConv) throw new AppError("CHAT_NOT_FOUND", 404);

  const message = await MessageModel.create({
    client_message_id:  randomUUID(),
    conversation_id:    transfer.conversation_id,
    sender_id:          transfer.sender_id,
    ciphertext:         null,
    ciphertext_type:    null,
    sender_key_id:      null,
    message_type:       "payment",
    sent_at:            now,
    server_received_at: now,
    sequence_number:    updatedConv.sequence_counter,
    status:             "sent",
    system_event:       "payment",
    system_metadata:    _paymentMeta(transfer),
    device_ciphertexts: null,
  });

  await ConversationModel.updateOne(
    { _id: transfer.conversation_id },
    { $set: { last_message_id: message._id } },
  );

  return message._id as mongoose.Types.ObjectId;
}

/**
 * Broadcast message.new a tutti i membri della conversazione.
 * Fire-and-forget: non lancia eccezioni.
 */
async function _broadcastMessage(
  messageId: mongoose.Types.ObjectId,
  transfer: ChatTransferDocument,
): Promise<void> {
  try {
    const message = await MessageModel.findById(messageId).lean();
    if (!message) return;

    const members = await memberRepo.listMembers(transfer.conversation_id);
    wsManager.sendToUsers(
      members.map((m) => m.user_id.toString()),
      {
        type: "message.new",
        payload: {
          id:                   message._id.toString(),
          client_message_id:    (message as any).client_message_id,
          conversation_id:      transfer.conversation_id.toString(),
          sender_id:            transfer.sender_id.toString(),
          message_type:         "payment",
          ciphertext:           null,
          status:               "sent",
          system_event:         "payment",
          system_metadata:      (message as any).system_metadata,
          sequence_number:      (message as any).sequence_number,
          server_received_at:   ((message as any).server_received_at as Date).toISOString(),
          sent_at:              ((message as any).sent_at as Date).toISOString(),
          deleted_for_everyone: false,
          device_ciphertexts:   null,
        },
      },
    );
  } catch (err) {
    logger.error({ err, transferId: transfer.transfer_id }, "[Payment] Errore broadcast message.new");
  }
}

/**
 * Aggiorna il campo system_metadata del messaggio-bolla quando lo stato cambia.
 * Fire-and-forget.
 */
async function _updateMessageMeta(transfer: ChatTransferDocument): Promise<void> {
  if (!transfer.message_id) return;
  try {
    await MessageModel.updateOne(
      { _id: transfer.message_id },
      {
        $set: {
          "system_metadata.status":          transfer.status,
          "system_metadata.tx_hash_deposit": transfer.tx_hash_deposit ?? null,
          "system_metadata.tx_hash_release": transfer.tx_hash_release ?? null,
        },
      },
    );
  } catch (err) {
    logger.error({ err, transferId: transfer.transfer_id }, "[Payment] Errore aggiornamento message meta");
  }
}

/**
 * Verifica on-chain che txHash contenga un evento Transfer ERC-20
 * verso escrowWallet per almeno amountUnits.
 *
 * Saltabile in dev/test con PAYMENT_SKIP_CHAIN_VERIFY=true.
 */
async function _verifyDepositTx(params: {
  txHash:       string;
  escrowWallet: string;
  amountUnits:  string;
  assetAddress: string;
}): Promise<void> {
  if (process.env.PAYMENT_SKIP_CHAIN_VERIFY === "true") {
    logger.warn({ txHash: params.txHash }, "[Payment] On-chain verify SKIPPED (dev mode)");
    return;
  }

  const publicClient = createPublicClient({
    chain:     polygon,
    transport: http(process.env.USDA_POLYGON_RPC ?? "https://polygon-bor-rpc.publicnode.com"),
  });

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: params.txHash as `0x${string}`,
    });
  } catch {
    throw new AppError("TRANSFER_TX_NOT_FOUND", 400);
  }

  if (receipt.status === "reverted") {
    throw new AppError("TRANSFER_TX_REVERTED", 400);
  }

  // topics[2] = to address — ERC-20 Transfer event (padded a 32 byte)
  const escrowPadded = `0x000000000000000000000000${params.escrowWallet.slice(2).toLowerCase()}`;
  const minAmount    = BigInt(params.amountUnits);

  const validLog = receipt.logs.find((log) => {
    if (log.address.toLowerCase() !== params.assetAddress.toLowerCase()) return false;
    if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC)           return false;
    if (log.topics[2]?.toLowerCase() !== escrowPadded)                   return false;
    try {
      return hexToBigInt(log.data as `0x${string}`) >= minAmount;
    } catch {
      return false;
    }
  });

  if (!validLog) throw new AppError("TRANSFER_TX_INVALID", 400);
}

/**
 * Segna un trasferimento come failed dopo un errore in un lock state.
 * Usato nei catch block di accept/reject/cancel.
 */
async function _markFailed(
  transferId:    string,
  lockedStatus:  ChatTransferStatus,
  reason:        string,
  triggeredBy:   AuditTriggeredBy,
): Promise<void> {
  try {
    const doc = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: lockedStatus },
      { $set: { status: "failed", completed_at: new Date() } },
      { returnDocument: "after" },
    );
    if (!doc) return;

    await writeAudit({ transferId, fromStatus: lockedStatus, toStatus: "failed", triggeredBy, note: reason });
    await _updateMessageMeta(doc);
    emitPaymentStateChanged(doc);
  } catch (innerErr) {
    logger.error({ innerErr, transferId }, "[Payment] Errore in _markFailed");
  }
}

// ---------------------------------------------------------------------------
// API esportata
// ---------------------------------------------------------------------------

export interface CreateTransferParams {
  senderId:       string;
  recipientId:    string;
  conversationId: string;
  amount:         string;     // decimale leggibile ("100.00")
  note?:          string;
  assetAddress?:  string;
  assetSymbol?:   string;
}

/**
 * Crea un nuovo trasferimento P2P.
 * Genera wallet escrow, crea il record chat_transfer e il messaggio-bolla in chat.
 * Il mittente deve poi inviare i fondi all'escrow e chiamare /deposit.
 */
export async function createTransfer(
  params: CreateTransferParams,
): Promise<Record<string, unknown>> {
  const senderId    = new mongoose.Types.ObjectId(params.senderId);
  const recipientId = new mongoose.Types.ObjectId(params.recipientId);
  const convId      = new mongoose.Types.ObjectId(params.conversationId);

  if (senderId.equals(recipientId)) throw new AppError("TRANSFER_SELF_SEND", 400);

  const assetAddress = params.assetAddress ?? process.env.USDA_CONTRACT_ADDRESS ?? DEFAULT_USDA_CONTRACT;
  const assetSymbol  = params.assetSymbol  ?? DEFAULT_USDA_SYMBOL;

  // Carica mittente e verifica wallet
  const sender = await UserModel.findById(senderId).lean() as any;
  if (!sender) throw new AppError("USER_NOT_FOUND", 404);
  const senderWallet: string | null = sender.wallets?.usda?.address ?? sender.wallet_address ?? null;
  if (!senderWallet) throw new AppError("WALLET_NOT_CONFIGURED", 412);

  // Carica destinatario (wallet può essere null — ADR-004)
  const recipient = await UserModel.findById(recipientId).lean() as any;
  if (!recipient) throw new AppError("USER_NOT_FOUND", 404);
  const recipientWallet: string | null = recipient.wallets?.usda?.address ?? recipient.wallet_address ?? null;

  // Verifica appartenenza alla conversazione
  const members    = await memberRepo.listMembers(convId);
  const memberIds  = members.map((m) => m.user_id.toString());
  if (!memberIds.includes(senderId.toString())) throw new AppError("TRANSFER_NOT_MEMBER", 403);

  // Calcola importo on-chain
  const amountUnits = toAmountUnits(params.amount);
  const amount      = mongoose.Types.Decimal128.fromString(params.amount);

  // Genera wallet escrow (fail-fast se ESCROW_MASTER_KEY mancante)
  const escrow = generateEscrowWallet();

  const transferId = randomUUID();
  const now        = new Date();
  const expiresAt  = new Date(now.getTime() + PAYMENT_EXPIRY_MS);

  // Crea record chat_transfer
  let transfer = await ChatTransferModel.create({
    transfer_id:         transferId,
    sender_id:           senderId,
    recipient_id:        recipientId,
    conversation_id:     convId,
    message_id:          null,
    asset_type:          "ERC-20",
    asset_address:       assetAddress,
    asset_symbol:        assetSymbol,
    token_id:            null,
    amount,
    amount_units:        amountUnits,
    fee:                 mongoose.Types.Decimal128.fromString("0"),
    note:                params.note ?? null,
    sender_wallet:       senderWallet,
    recipient_wallet:    recipientWallet,
    escrow_wallet:       escrow.address,
    escrow_encrypted_pk: escrow.encryptedPk,
    status:              "awaiting_deposit",
    expires_at:          expiresAt,
  });

  await writeAudit({ transferId, fromStatus: null, toStatus: "awaiting_deposit", triggeredBy: "sender", note: "Transfer creato" });

  // Crea messaggio-bolla in chat
  try {
    const msgId = await _createPaymentMessage(transfer);
    const updated = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: transferId },
      { $set: { message_id: msgId } },
      { returnDocument: "after" },
    );
    if (updated) {
      transfer = updated;
      await _broadcastMessage(msgId, transfer);
    }
  } catch (err) {
    logger.error({ err, transferId }, "[Payment] Errore creazione payment message — transfer creato comunque");
  }

  emitPaymentStateChanged(transfer);
  logger.info({ transferId, sender: params.senderId, amount: params.amount }, "[Payment] Transfer creato ✓");
  return _format(transfer);
}

/**
 * Conferma il deposito on-chain del mittente verso l'escrow.
 * Verifica il txHash on-chain (saltabile con PAYMENT_SKIP_CHAIN_VERIFY=true in dev).
 * Transizione: awaiting_deposit → pending.
 */
export async function confirmDeposit(params: {
  transferId:  string;
  txHash:      string;
  requesterId: string;
}): Promise<Record<string, unknown>> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: params.transferId });
  if (!transfer) throw new AppError("TRANSFER_NOT_FOUND", 404);

  if (transfer.sender_id.toString() !== params.requesterId) throw new AppError("TRANSFER_ACCESS_DENIED", 403);
  if (transfer.status !== "awaiting_deposit")                throw new AppError("TRANSFER_INVALID_TRANSITION", 409);
  if (transfer.expires_at < new Date())                      throw new AppError("TRANSFER_EXPIRED", 410);

  // Anti-replay
  await checkAndMarkTx(params.txHash, "chat-transfer-deposit");

  // Verifica on-chain — rollback anti-replay se fallisce
  try {
    await _verifyDepositTx({
      txHash:       params.txHash,
      escrowWallet: transfer.escrow_wallet,
      amountUnits:  transfer.amount_units,
      assetAddress: transfer.asset_address,
    });
  } catch (verifyErr) {
    await rollbackTx(params.txHash);
    throw verifyErr;
  }

  const now     = new Date();
  const updated = await ChatTransferModel.findOneAndUpdate(
    { transfer_id: params.transferId, status: "awaiting_deposit" },
    { $set: { status: "pending", tx_hash_deposit: params.txHash, confirmed_at: now } },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError("TRANSFER_INVALID_TRANSITION", 409);

  await writeAudit({ transferId: params.transferId, fromStatus: "awaiting_deposit", toStatus: "pending", triggeredBy: "sender", txHash: params.txHash });
  await _updateMessageMeta(updated);
  emitPaymentStateChanged(updated);

  logger.info({ transferId: params.transferId, txHash: params.txHash }, "[Payment] Deposito confermato ✓");
  return _format(updated);
}

/**
 * Il destinatario accetta il pagamento.
 * ADR-004: se recipient_wallet è null → 412 WALLET_NOT_CONFIGURED (non fallisce il transfer).
 * Lock: pending → accepting → accepted.
 */
export async function acceptTransfer(params: {
  transferId:  string;
  requesterId: string;
  ip?:         string;
}): Promise<Record<string, unknown>> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: params.transferId });
  if (!transfer) throw new AppError("TRANSFER_NOT_FOUND", 404);

  if (transfer.recipient_id.toString() !== params.requesterId) throw new AppError("TRANSFER_ACCESS_DENIED", 403);
  if (transfer.status !== "pending")                           throw new AppError("TRANSFER_INVALID_TRANSITION", 409);
  if (transfer.expires_at < new Date())                        throw new AppError("TRANSFER_EXPIRED", 410);
  if (!transfer.recipient_wallet)                              throw new AppError("WALLET_NOT_CONFIGURED", 412);

  const locked = await acquireLock(params.transferId, "pending", "accepting");
  if (!locked) throw new AppError("TRANSFER_LOCK_FAILED", 409);

  const now = new Date();
  try {
    const { txHash } = await transferFromCustodial({
      encryptedPk:  locked.escrow_encrypted_pk,
      toAddress:    locked.recipient_wallet!,
      amountUnits:  locked.amount_units,
      assetAddress: locked.asset_address,
    });

    const accepted = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: params.transferId, status: "accepting" },
      { $set: { status: "accepted", tx_hash_release: txHash, responded_at: now, completed_at: now } },
      { returnDocument: "after" },
    );
    if (!accepted) throw new Error("findOneAndUpdate post-release restituito null");

    await writeAudit({ transferId: params.transferId, fromStatus: "accepting", toStatus: "accepted", triggeredBy: "recipient", txHash, ip: params.ip });
    await _updateMessageMeta(accepted);
    emitPaymentStateChanged(accepted);

    logger.info({ transferId: params.transferId, txHash }, "[Payment] Trasferimento accettato ✓");
    return _format(accepted);
  } catch (err) {
    logger.error({ err, transferId: params.transferId }, "[Payment] Errore in acceptTransfer");
    await _markFailed(params.transferId, "accepting", String(err), "system");
    throw err instanceof AppError ? err : new AppError("INTERNAL_ERROR", 500);
  }
}

/**
 * Il destinatario rifiuta il pagamento.
 * Lock: pending → rejecting → rejected. Rimborso automatico al mittente.
 */
export async function rejectTransfer(params: {
  transferId:  string;
  requesterId: string;
  ip?:         string;
}): Promise<Record<string, unknown>> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: params.transferId });
  if (!transfer) throw new AppError("TRANSFER_NOT_FOUND", 404);

  if (transfer.recipient_id.toString() !== params.requesterId) throw new AppError("TRANSFER_ACCESS_DENIED", 403);
  if (transfer.status !== "pending")                           throw new AppError("TRANSFER_INVALID_TRANSITION", 409);

  const locked = await acquireLock(params.transferId, "pending", "rejecting");
  if (!locked) throw new AppError("TRANSFER_LOCK_FAILED", 409);

  const now = new Date();
  try {
    const { txHash } = await transferFromCustodial({
      encryptedPk:  locked.escrow_encrypted_pk,
      toAddress:    locked.sender_wallet,
      amountUnits:  locked.amount_units,
      assetAddress: locked.asset_address,
    });

    const rejected = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: params.transferId, status: "rejecting" },
      { $set: { status: "rejected", tx_hash_release: txHash, responded_at: now, completed_at: now } },
      { returnDocument: "after" },
    );
    if (!rejected) throw new Error("findOneAndUpdate post-refund restituito null");

    await writeAudit({ transferId: params.transferId, fromStatus: "rejecting", toStatus: "rejected", triggeredBy: "recipient", txHash, ip: params.ip });
    await _updateMessageMeta(rejected);
    emitPaymentStateChanged(rejected);

    logger.info({ transferId: params.transferId, txHash }, "[Payment] Trasferimento rifiutato ✓");
    return _format(rejected);
  } catch (err) {
    logger.error({ err, transferId: params.transferId }, "[Payment] Errore in rejectTransfer");
    await _markFailed(params.transferId, "rejecting", String(err), "system");
    throw err instanceof AppError ? err : new AppError("INTERNAL_ERROR", 500);
  }
}

/**
 * Il mittente annulla il pagamento (solo da stato pending).
 * Lock: pending → cancelling → cancelled. Rimborso automatico al mittente.
 */
export async function cancelTransfer(params: {
  transferId:  string;
  requesterId: string;
  ip?:         string;
}): Promise<Record<string, unknown>> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: params.transferId });
  if (!transfer) throw new AppError("TRANSFER_NOT_FOUND", 404);

  if (transfer.sender_id.toString() !== params.requesterId) throw new AppError("TRANSFER_ACCESS_DENIED", 403);
  if (transfer.status !== "pending")                        throw new AppError("TRANSFER_INVALID_TRANSITION", 409);

  const locked = await acquireLock(params.transferId, "pending", "cancelling");
  if (!locked) throw new AppError("TRANSFER_LOCK_FAILED", 409);

  const now = new Date();
  try {
    const { txHash } = await transferFromCustodial({
      encryptedPk:  locked.escrow_encrypted_pk,
      toAddress:    locked.sender_wallet,
      amountUnits:  locked.amount_units,
      assetAddress: locked.asset_address,
    });

    const cancelled = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: params.transferId, status: "cancelling" },
      { $set: { status: "cancelled", tx_hash_release: txHash, responded_at: now, completed_at: now } },
      { returnDocument: "after" },
    );
    if (!cancelled) throw new Error("findOneAndUpdate post-cancel restituito null");

    await writeAudit({ transferId: params.transferId, fromStatus: "cancelling", toStatus: "cancelled", triggeredBy: "sender", txHash, ip: params.ip });
    await _updateMessageMeta(cancelled);
    emitPaymentStateChanged(cancelled);

    logger.info({ transferId: params.transferId, txHash }, "[Payment] Trasferimento annullato ✓");
    return _format(cancelled);
  } catch (err) {
    logger.error({ err, transferId: params.transferId }, "[Payment] Errore in cancelTransfer");
    await _markFailed(params.transferId, "cancelling", String(err), "sender");
    throw err instanceof AppError ? err : new AppError("INTERNAL_ERROR", 500);
  }
}

/**
 * Recupera lo stato di un trasferimento.
 * Accessibile solo da mittente o destinatario.
 */
export async function getTransfer(params: {
  transferId:  string;
  requesterId: string;
}): Promise<Record<string, unknown>> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: params.transferId });
  if (!transfer) throw new AppError("TRANSFER_NOT_FOUND", 404);

  const isParty =
    transfer.sender_id.toString()    === params.requesterId ||
    transfer.recipient_id.toString() === params.requesterId;
  if (!isParty) throw new AppError("TRANSFER_ACCESS_DENIED", 403);

  return _format(transfer);
}
