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
import { getRpcUrl } from "./usda-custodial.service";

import { ChatTransferModel, type ChatTransferDocument } from "../models/chat-transfer.model";
import { UsdaPaymentModel }                             from "../models/usda-payment.model";
import { UserModel }                                    from "../models/user.model";
import { ConversationModel }                            from "../models/conversation.model";
import { MessageModel }                                 from "../models/message.model";
import { ConversationMemberRepository }                 from "../repositories/conversation-member.repository";
import { generateEscrowWallet, transferFromCustodial, toAmountUnits, ensureEscrowGas, getCustodialBalance } from "./usda-custodial.service";
import { checkAndMarkTx, rollbackTx }                   from "./asset-anti-replay";
import { acquireLock, writeAudit }                      from "./lock";
import { emitPaymentStateChanged }                      from "./events";
import { wsManager }                                    from "../lib/ws-manager";
import { syncRequestFromTransfer }                      from "../services/usda.service";
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
const POLYGONSCAN_TX = (hash: string | null) =>
  hash ? `https://polygonscan.com/tx/${hash}` : null;

function _format(doc: ChatTransferDocument): Record<string, unknown> {
  return {
    transfer_id:              doc.transfer_id,
    status:                   doc.status,
    amount:                   doc.amount?.toString() ?? "0",
    amount_units:             doc.amount_units,
    asset_symbol:             doc.asset_symbol,
    asset_address:            doc.asset_address,
    fee:                      doc.fee?.toString() ?? "0",
    note:                     doc.note ?? null,
    sender_id:                doc.sender_id.toString(),
    recipient_id:             doc.recipient_id.toString(),
    conversation_id:          doc.conversation_id.toString(),
    message_id:               doc.message_id?.toString() ?? null,
    escrow_wallet:            doc.escrow_wallet,
    sender_wallet:            doc.sender_wallet,
    recipient_wallet:         doc.recipient_wallet ?? null,
    tx_hash_deposit:          doc.tx_hash_deposit ?? null,
    tx_hash_release:          doc.tx_hash_release ?? null,
    deposit_block_number:     doc.deposit_block_number ?? null,
    release_block_number:     doc.release_block_number ?? null,
    deposit_polygonscan_url:  POLYGONSCAN_TX(doc.tx_hash_deposit ?? null),
    release_polygonscan_url:  POLYGONSCAN_TX(doc.tx_hash_release ?? null),
    expires_at:               doc.expires_at.toISOString(),
    confirmed_at:             doc.confirmed_at?.toISOString() ?? null,
    responded_at:             doc.responded_at?.toISOString() ?? null,
    completed_at:             doc.completed_at?.toISOString() ?? null,
    created_at:               (doc as any).createdAt?.toISOString() ?? null,
  };
}

/**
 * Metadati del messaggio-bolla in chat (aggiornati ad ogni cambio di stato).
 */
function _paymentMeta(doc: ChatTransferDocument): Record<string, unknown> {
  return {
    transfer_id:             doc.transfer_id,
    status:                  doc.status,
    amount:                  doc.amount?.toString() ?? "0",
    asset_symbol:            doc.asset_symbol,
    asset_address:           doc.asset_address,
    note:                    doc.note ?? null,
    sender_id:               doc.sender_id.toString(),
    recipient_id:            doc.recipient_id.toString(),
    // Se il transfer soddisfa una richiesta (usda_request), il consenso del
    // richiedente È la richiesta stessa: nessun "Accetta/Rifiuta" manuale, il
    // rilascio è automatico. Il frontend usa questo flag per nascondere i bottoni.
    is_request:              !!doc.request_payment_id,
    escrow_wallet:           doc.escrow_wallet,
    expires_at:              doc.expires_at.toISOString(),
    tx_hash_deposit:         doc.tx_hash_deposit ?? null,
    tx_hash_release:         doc.tx_hash_release ?? null,
    deposit_block_number:    doc.deposit_block_number ?? null,
    release_block_number:    doc.release_block_number ?? null,
    deposit_polygonscan_url: POLYGONSCAN_TX(doc.tx_hash_deposit ?? null),
    release_polygonscan_url: POLYGONSCAN_TX(doc.tx_hash_release ?? null),
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
          "system_metadata.status":                  transfer.status,
          "system_metadata.tx_hash_deposit":         transfer.tx_hash_deposit ?? null,
          "system_metadata.tx_hash_release":         transfer.tx_hash_release ?? null,
          "system_metadata.deposit_block_number":    transfer.deposit_block_number ?? null,
          "system_metadata.release_block_number":    transfer.release_block_number ?? null,
          "system_metadata.deposit_polygonscan_url": POLYGONSCAN_TX(transfer.tx_hash_deposit ?? null),
          "system_metadata.release_polygonscan_url": POLYGONSCAN_TX(transfer.tx_hash_release ?? null),
        },
      },
    );
  } catch (err) {
    logger.error({ err, transferId: transfer.transfer_id }, "[Payment] Errore aggiornamento message meta");
  }
}

/**
 * Invia un messaggio di notifica nella conversazione quando il trasferimento
 * è completato (status "accepted"). Compare in coda ai nuovi messaggi così
 * entrambe le parti vedono subito l'esito senza dover scorrere su.
 *
 * Fire-and-forget — non blocca la pipeline di pagamento.
 */
async function _sendCompletedNotification(transfer: ChatTransferDocument): Promise<void> {
  try {
    const now   = new Date();
    const convId = transfer.conversation_id;

    // Acquisisce sequence_number atomicamente (stesso pattern di MessageRepository.create)
    const updatedConv = await ConversationModel.findOneAndUpdate(
      { _id: convId, deleted_at: null },
      {
        $inc: { sequence_counter: 1 },
        $set: { last_message_at: now, last_activity_at: now },
      },
      { returnDocument: "after" },
    );
    if (!updatedConv) return;

    const seqNum = updatedConv.sequence_counter;

    const msg = await MessageModel.create({
      client_message_id:  randomUUID(),
      conversation_id:    convId,
      sender_id:          transfer.sender_id,
      ciphertext:         null,
      ciphertext_type:    null,
      sender_key_id:      null,
      message_type:       "payment_notification",
      sent_at:            now,
      server_received_at: now,
      sequence_number:    seqNum,
      status:             "sent",
      deleted_for_everyone: false,
      burn_after_read:    false,
      system_metadata: {
        event:        "payment_completed",
        transfer_id:  transfer.transfer_id,
        amount:       transfer.amount?.toString() ?? "0",
        asset_symbol: transfer.asset_symbol ?? "USDA",
        sender_id:    transfer.sender_id.toString(),
        recipient_id: transfer.recipient_id.toString(),
      },
    });

    await ConversationModel.updateOne(
      { _id: convId },
      { $set: { last_message_id: msg._id } },
    );

    // Notifica realtime a tutti i membri della conversazione
    const members   = await memberRepo.listMembers(convId);
    const memberIds = members.map((m) => m.user_id.toString());

    wsManager.sendToUsers(memberIds, {
      type: "message.new",
      payload: {
        id:                   msg._id.toString(),
        client_message_id:    msg.client_message_id,
        conversation_id:      convId.toString(),
        sender_id:            transfer.sender_id.toString(),
        message_type:         "payment_notification",
        ciphertext:           null,
        ciphertext_type:      null,
        sender_key_id:        null,
        sequence_number:      seqNum,
        sent_at:              now.toISOString(),
        server_received_at:   now.toISOString(),
        status:               "sent",
        reply_to_message_id:  null,
        media_id:             null,
        deleted_for_everyone: false,
        edited_at:            null,
        is_new:               true,
        burn_after_read:      false,
        expires_at:           null,
        device_ciphertexts:   null,
        system_metadata:      msg.system_metadata,
      },
    });

    logger.info(
      { transferId: transfer.transfer_id, conversationId: convId.toString() },
      "[Payment] Notifica completamento inviata nella chat ✓",
    );
  } catch (err) {
    logger.warn({ err, transferId: transfer.transfer_id }, "[Payment] _sendCompletedNotification fallito — non critico");
  }
}

/**
 * Verifica on-chain e ritorna il block number del tx (per audit).
 * In dev mode (PAYMENT_SKIP_CHAIN_VERIFY=true) ritorna null.
 */
async function _verifyDepositTx(params: {
  txHash:       string;
  escrowWallet: string;
  amountUnits:  string;
  assetAddress: string;
}): Promise<number | null> {
  if (process.env.PAYMENT_SKIP_CHAIN_VERIFY === "true") {
    logger.warn({ txHash: params.txHash }, "[Payment] On-chain verify SKIPPED (dev mode)");
    return null;
  }

  const publicClient = createPublicClient({
    chain:     polygon,
    transport: http(getRpcUrl()),
  });

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: params.txHash as `0x${string}`,
    });
  } catch {
    throw new AppError("TRANSFER_TX_NOT_FOUND", 400);
  }

  // Verifica esplicita di successo: qualsiasi stato != "success" (reverted o
  // valore inatteso) è trattato come tx non valida.
  if (receipt.status !== "success") {
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

  return Number(receipt.blockNumber);
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

    if (doc.request_payment_id) {
      // Transfer fallito → la richiesta torna pagabile.
      void syncRequestFromTransfer(doc.request_payment_id.toString(), "pending_claim");
    }
  } catch (innerErr) {
    logger.error({ innerErr, transferId }, "[Payment] Errore in _markFailed");
  }
}

// ---------------------------------------------------------------------------
// API esportata
// ---------------------------------------------------------------------------

export interface CreateTransferParams {
  senderId:             string;
  recipientId:          string;
  conversationId:       string;
  amount:               string;     // decimale leggibile ("100.00")
  note?:                string;
  assetAddress?:        string;
  assetSymbol?:         string;
  /** Indirizzo wallet del mittente fornito dal client (ThirdWeb).
   *  Usato come fallback se il profilo non ha ancora un wallet salvato. */
  senderWalletOverride?: string;
  /** Se valorizzato, questo transfer soddisfa una usda_request in chat:
   *  al deposito/accept la bolla richiesta viene aggiornata per entrambi. */
  requestPaymentId?:     string;
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

  // Carica mittente e verifica wallet.
  // Prima sceglie il wallet dal profilo MongoDB; se assente, accetta quello
  // fornito dal client (account ThirdWeb). Necessario per utenti che hanno
  // connesso il wallet via ThirdWeb ma non lo hanno ancora salvato nel profilo.
  const sender = await UserModel.findById(senderId).lean() as any;
  if (!sender) throw new AppError("USER_NOT_FOUND", 404);
  const senderWallet: string | null =
    sender.wallets?.usda?.address ??
    sender.wallet_address ??
    params.senderWalletOverride ??
    null;
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

  // ── VALIDAZIONE RICHIESTA (denaro reale) ────────────────────────────────
  // Se il transfer dichiara di soddisfare una usda_request, la richiesta va
  // validata OBBLIGATORIAMENTE server-side: un client non deve poter agganciare
  // un transfer arbitrario a una richiesta altrui e farla risultare pagata pur
  // pagando verso un altro wallet. Ogni mismatch → errore esplicito.
  if (params.requestPaymentId) {
    if (!mongoose.isValidObjectId(params.requestPaymentId)) {
      throw new AppError("REQUEST_NOT_FOUND", 404);
    }
    const reqDoc = await UsdaPaymentModel
      .findById(new mongoose.Types.ObjectId(params.requestPaymentId))
      .lean() as {
        kind: string; status: string;
        conversation_id: mongoose.Types.ObjectId;
        sender_id: mongoose.Types.ObjectId;
        recipient_id: mongoose.Types.ObjectId;
        amount: mongoose.Types.Decimal128;
      } | null;

    if (!reqDoc || reqDoc.kind !== "request")               throw new AppError("REQUEST_NOT_FOUND", 404);
    if (reqDoc.status !== "pending_claim")                   throw new AppError("REQUEST_NOT_PAYABLE", 409);
    if (reqDoc.conversation_id.toString() !== convId.toString())
      throw new AppError("REQUEST_CONVERSATION_MISMATCH", 422);
    // Il PAGANTE (sender del transfer) deve essere il destinatario della richiesta.
    if (reqDoc.recipient_id.toString() !== senderId.toString())
      throw new AppError("REQUEST_PAYER_MISMATCH", 422);
    // Il RICHIEDENTE (sender della richiesta) deve essere il recipient del transfer.
    if (reqDoc.sender_id.toString() !== recipientId.toString())
      throw new AppError("REQUEST_RECIPIENT_MISMATCH", 422);
    // L'importo del transfer deve combaciare con quello della richiesta
    // (confronto in unità on-chain per essere immune al formato decimale).
    if (toAmountUnits(reqDoc.amount.toString()) !== amountUnits)
      throw new AppError("REQUEST_AMOUNT_MISMATCH", 422);
  }

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
    request_payment_id:  params.requestPaymentId
      ? new mongoose.Types.ObjectId(params.requestPaymentId)
      : null,
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
  // Email admin — fire-and-forget, non blocca il flusso
  void (async () => {
    try {
      const { sendUsdaTransactionEmail } = await import("../services/email.service");
      await sendUsdaTransactionEmail({
        type:            "created",
        transferId:      transfer.transfer_id,
        amount:          transfer.amount.toString(),
        assetSymbol:     transfer.asset_symbol,
        senderUserId:    transfer.sender_id.toString(),
        recipientUserId: transfer.recipient_id.toString(),
        escrowWallet:    transfer.escrow_wallet,
      });
    } catch { /* silenzioso — email non critica */ }
  })();
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

  // Verifica on-chain — rollback anti-replay se fallisce; ritorna block number per audit
  let depositBlockNumber: number | null = null;
  try {
    depositBlockNumber = await _verifyDepositTx({
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
    {
      $set: {
        status:               "pending",
        tx_hash_deposit:      params.txHash,
        deposit_block_number: depositBlockNumber,
        confirmed_at:         now,
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError("TRANSFER_INVALID_TRANSITION", 409);

  await writeAudit({ transferId: params.transferId, fromStatus: "awaiting_deposit", toStatus: "pending", triggeredBy: "sender", txHash: params.txHash });
  await _updateMessageMeta(updated);
  emitPaymentStateChanged(updated);

  if (updated.request_payment_id) {
    // Transfer legato a una richiesta: il consenso del richiedente È la richiesta
    // stessa → nessun secondo "Accetta". Rilascio automatico verso il suo wallet.
    // Fire-and-forget: confirmDeposit risponde subito (stato "pending"); le bolle
    // si aggiornano via WS quando il release completa. Se l'auto-release fallisce
    // il transfer resta "pending" e lo scheduler lo ricompleta (non va in failed).
    void syncRequestFromTransfer(updated.request_payment_id.toString(), "pending");
    void autoReleaseForRequest(updated.transfer_id);
  } else {
    // Invio diretto (no request_payment_id): rilascio immediato fire-and-forget.
    // Il destinatario riceve i fondi automaticamente senza dover premere "Accetta".
    // Lo scheduler rimane come safety-net in caso di crash/gas failure.
    void autoReleaseForSend(updated.transfer_id);
  }

  logger.info({ transferId: params.transferId, txHash: params.txHash }, "[Payment] Deposito confermato ✓");
  return _format(updated);
}

/**
 * Rileva automaticamente il deposito on-chain scannerizzando gli eventi ERC-20
 * Transfer verso escrow_wallet negli ultimi ~1000 blocchi Polygon (~25 min).
 *
 * Caso d'uso principale: iOS Safari PWA ricarica la pagina dopo aver firmato
 * su MetaMask/Trust — il tx hash viene perso lato frontend.
 * Il backend trova la tx on-chain e chiama confirmDeposit internamente.
 */
export async function detectDeposit(params: {
  transferId:  string;
  requesterId: string;
}): Promise<Record<string, unknown>> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: params.transferId });
  if (!transfer) throw new AppError("TRANSFER_NOT_FOUND", 404);
  if (transfer.sender_id.toString() !== params.requesterId) throw new AppError("TRANSFER_ACCESS_DENIED", 403);
  if (transfer.status !== "awaiting_deposit") {
    // Idempotente: il deposito è già stato rilevato e processato da un altro path
    // (scheduler, bolla, chiamata concorrente di detectDeposit, ecc.).
    // Restituiamo il transfer corrente come successo invece di 409, così
    // signAndPoll() riceve 200 → setPhase("done") senza nuovo send.
    // "failed" è escluso: significa che il deposito non è mai avvenuto
    // o che una release è fallita permanentemente → 409 come prima.
    const DEPOSIT_RECEIVED: readonly string[] = [
      "pending", "accepting", "accepted",
      "rejecting", "rejected", "cancelling", "cancelled",
    ];
    if (DEPOSIT_RECEIVED.includes(transfer.status)) return _format(transfer);
    throw new AppError("TRANSFER_INVALID_TRANSITION", 409);
  }

  if (process.env.PAYMENT_SKIP_CHAIN_VERIFY === "true") {
    // In dev mode non c'è blockchain reale — non possiamo rilevare nulla
    throw new AppError("DEPOSIT_TX_NOT_DETECTED", 404);
  }

  // Range di blocchi: NON stimiamo fromBlock dal block time (fragile — Polygon
  // gira a ~1.5s/blocco e la stima a 2.5s spingeva fromBlock DOPO il blocco del
  // deposito, escludendolo dalla finestra → falso DEPOSIT_TX_NOT_DETECTED).
  //
  // Approccio robusto: fromBlock conservativo calcolato da createdAt assumendo
  // un block time di 1000ms (SOTTOSTIMA sicura del numero di blocchi trascorsi
  // → fromBlock resta sempre PRIMA del blocco reale del deposito), senza cap.
  // Il filtro effettivo avviene poi su metadata.blockTimestamp + importo, quindi
  // un fromBlock generoso non produce falsi match.
  const POLYGON_BLOCK_TIME_MS = 1_000; // sottostima: garantisce fromBlock <= blocco deposito
  const SAFETY_BUFFER         = 120n;  // buffer extra di blocchi

  const createdAt  = (transfer as any).createdAt as Date | undefined ?? new Date();
  const ageMs      = BigInt(Math.max(0, Date.now() - createdAt.getTime()));
  const ageBlocks  = ageMs / BigInt(POLYGON_BLOCK_TIME_MS) + SAFETY_BUFFER;

  const publicClient = createPublicClient({
    chain:     polygon,
    transport: http(getRpcUrl()),
  });
  const currentBlock = await publicClient.getBlockNumber();
  const fromBlock    = currentBlock > ageBlocks ? currentBlock - ageBlocks : 0n;

  // NON usare eth_getLogs: gli RPC pubblici gratuiti rifiutano getLogs su
  // range storici ("Archive requests require a personal token" su publicnode,
  // "ranges over 10000 blocks" su drpc, cap 10 blocchi su Alchemy free).
  // Usiamo alchemy_getAssetTransfers (enhanced API, free tier, range illimitato)
  // — stesso approccio del backend USDA per il poll-tx.
  interface AssetTransfer {
    hash?:        string;
    rawContract?: { value?: string };
    metadata?:    { blockTimestamp?: string };
  }
  let transfers: AssetTransfer[];
  try {
    // Enhanced API alchemy_getAssetTransfers: usa l'URL RPC configurato
    // (USDA_POLYGON_RPC). getRpcUrl() lancia RPC_NOT_CONFIGURED se assente.
    const res = await fetch(getRpcUrl(), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id:      1,
        method:  "alchemy_getAssetTransfers",
        params: [{
          fromBlock:         `0x${fromBlock.toString(16)}`,
          toBlock:           "latest",
          toAddress:         transfer.escrow_wallet,
          contractAddresses: [transfer.asset_address],
          category:          ["erc20"],
          withMetadata:      true,
          order:             "desc",
          maxCount:          "0x19",
        }],
      }),
    });
    const json = await res.json() as { result?: { transfers?: AssetTransfer[] }; error?: unknown };
    if (json.error) throw new Error(JSON.stringify(json.error));
    transfers = json.result?.transfers ?? [];
  } catch (rpcErr) {
    logger.error({ rpcErr, transferId: params.transferId }, "[Payment] detectDeposit RPC error");
    throw new AppError("DEPOSIT_DETECT_RPC_ERROR", 502);
  }

  // Filtra: (a) importo >= amount_units SE rawContract.value è disponibile,
  // E (b) blockTimestamp >= createdAt - 5min SE blockTimestamp è disponibile.
  //
  // Fix A: rawContract.value è opzionale — Alchemy può non popolarlo se non riesce
  // a decodificare l'ABI del token. In quel caso ci fidiamo dei filtri upstream
  // (toAddress + contractAddresses + category: erc20) che già circoscrivono la TX
  // al token corretto verso l'escrow corretto. Il filtro importo diventa best-effort.
  //
  // Fix C: metadata.blockTimestamp è opzionale — Alchemy può non popolarlo per
  // alcune TX (ABI non decodificata, response parziale). Stessa logica di Fix A:
  // se il campo manca saltiamo il controllo timestamp e ci fidiamo dei filtri upstream.
  const minAmount   = BigInt(transfer.amount_units);
  const minTs       = createdAt.getTime() - 5 * 60 * 1000; // createdAt - 5 minuti
  const match = transfers.find((t) => {
    try {
      // Se rawContract.value è presente verifichiamo l'importo; se assente, omettiamo
      // il check importo (toAddress + contractAddresses sono già filtri sufficienti).
      if (t.rawContract?.value != null && BigInt(t.rawContract.value) < minAmount) return false;
      // Se blockTimestamp è presente verifichiamo la finestra temporale; se assente,
      // omettiamo il check (l'upstream toAddress+contractAddresses è sufficiente).
      if (t.metadata?.blockTimestamp) {
        const ts = Date.parse(t.metadata.blockTimestamp);
        if (Number.isNaN(ts) || ts < minTs) return false;
      }
      return true;
    } catch { return false; }
  });

  if (!match?.hash) {
    logger.info({ transferId: params.transferId, blocksScanned: currentBlock - fromBlock }, "[Payment] detectDeposit: nessun tx trovato");
    throw new AppError("DEPOSIT_TX_NOT_DETECTED", 404);
  }

  logger.info({ transferId: params.transferId, txHash: match.hash }, "[Payment] Deposito rilevato automaticamente ✓");

  // Riusa la logica esistente (anti-replay + verifica on-chain + state machine)
  return confirmDeposit({
    transferId:  params.transferId,
    txHash:      match.hash,
    requesterId: params.requesterId,
  });
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

  // ADR-004 lazy-resolve: il transfer può essere stato creato prima che il
  // destinatario salvasse il wallet. Ri-leggiamo il profilo corrente e, se ora
  // ha un wallet, lo salviamo nel documento prima di procedere.
  if (!transfer.recipient_wallet) {
    const recipientUser = await UserModel.findById(transfer.recipient_id).lean() as any;
    const resolvedWallet: string | null =
      recipientUser?.wallets?.usda?.address ?? recipientUser?.wallet_address ?? null;
    if (!resolvedWallet) throw new AppError("WALLET_NOT_CONFIGURED", 412);
    // Aggiorna il documento e la variabile locale in-memory
    await ChatTransferModel.updateOne(
      { transfer_id: params.transferId },
      { $set: { recipient_wallet: resolvedWallet } },
    );
    transfer.recipient_wallet = resolvedWallet;
  }

  const locked = await acquireLock(params.transferId, "pending", "accepting");
  if (!locked) throw new AppError("TRANSFER_LOCK_FAILED", 409);

  const now = new Date();
  try {
    // Garantisce MATIC per gas prima di inviare la TX ERC-20
    await ensureEscrowGas(locked.escrow_wallet);

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
    void _sendCompletedNotification(accepted);
    void (async () => {
      try {
        const { sendUsdaTransactionEmail } = await import("../services/email.service");
        await sendUsdaTransactionEmail({
          type:            "completed",
          transferId:      accepted.transfer_id,
          amount:          accepted.amount.toString(),
          assetSymbol:     accepted.asset_symbol,
          senderUserId:    accepted.sender_id.toString(),
          recipientUserId: accepted.recipient_id.toString(),
          txHash,
        });
      } catch { /* silenzioso */ }
    })();

    if (accepted.request_payment_id) {
      void syncRequestFromTransfer(accepted.request_payment_id.toString(), "confirmed");
    }

    // Fire-and-forget: arricchisce il record con il block number del rilascio.
    // La TX è già confermata (transferFromCustodial aspetta il receipt), quindi
    // questa getTransactionReceipt ritorna subito senza attesa mining.
    void (async () => {
      try {
        const publicClient = createPublicClient({
          chain:     polygon,
          transport: http(getRpcUrl()),
        });
        const r = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
        const releaseBlock = Number(r.blockNumber);
        const enriched = await ChatTransferModel.findOneAndUpdate(
          { transfer_id: params.transferId },
          { $set: { release_block_number: releaseBlock } },
          { returnDocument: "after" },
        );
        if (enriched) {
          await _updateMessageMeta(enriched);
          emitPaymentStateChanged(enriched);
        }
        logger.info({ transferId: params.transferId, releaseBlock }, "[Payment] Release block arricchito ✓");
      } catch (enrichErr) {
        logger.warn({ enrichErr, transferId: params.transferId }, "[Payment] Non-critical: release block non arricchito");
      }
    })();

    logger.info({ transferId: params.transferId, txHash }, "[Payment] Trasferimento accettato ✓");
    return _format(accepted);
  } catch (err) {
    logger.error({ err, transferId: params.transferId }, "[Payment] Errore in acceptTransfer");
    await _markFailed(params.transferId, "accepting", String(err), "system");
    throw err instanceof AppError ? err : new AppError("INTERNAL_ERROR", 500);
  }
}

/**
 * Fire-and-forget: arricchisce il record con il block number del rilascio.
 * La TX è già confermata (transferFromCustodial aspetta il receipt).
 */
function _enrichReleaseBlock(transferId: string, txHash: string): void {
  void (async () => {
    try {
      const publicClient = createPublicClient({ chain: polygon, transport: http(getRpcUrl()) });
      const r = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      const releaseBlock = Number(r.blockNumber);
      const enriched = await ChatTransferModel.findOneAndUpdate(
        { transfer_id: transferId },
        { $set: { release_block_number: releaseBlock } },
        { returnDocument: "after" },
      );
      if (enriched) {
        await _updateMessageMeta(enriched);
        emitPaymentStateChanged(enriched);
      }
    } catch (enrichErr) {
      logger.warn({ enrichErr, transferId }, "[Payment] Non-critical: release block non arricchito");
    }
  })();
}

/**
 * AUTO-RELEASE per i transfer legati a una richiesta (request_payment_id).
 *
 * Decisione UX approvata: per un pagamento che soddisfa una richiesta NON serve
 * un secondo "Accetta" — il consenso del richiedente È la richiesta stessa.
 * Dopo il deposito in escrow i fondi vengono rilasciati automaticamente al
 * wallet del richiedente (recipient).
 *
 * Chiamato server-side: salta SOLO il check di chi chiama (requesterId);
 * mantiene i check di stato/scadenza/wallet e la verifica on-chain implicita.
 *
 * IDEMPOTENTE / SAFE-RETRY (no double-spend): prima di inviare controlla il
 * saldo escrow on-chain — se è già 0 significa che un tentativo precedente ha
 * già rilasciato i fondi (ma lo stato DB non era stato aggiornato) → ripristina
 * "accepted" senza re-inviare.
 *
 * GESTIONE FALLIMENTO (gas/RPC): il transfer NON va mai in `failed`. In caso di
 * errore lo stato viene riportato a `pending` (lock rilasciato) così che un
 * tentativo successivo — chiamata diretta o scheduler processPendingRequestReleases()
 * — possa completarlo. Un eventuale crash mid-release lascia lo stato in
 * `accepting`, coperto dal recovery processStuckTransfers().
 */
/**
 * Auto-release per transfer "send" non legati a una richiesta.
 *
 * Corrisponde ad autoReleaseForRequest ma senza il vincolo request_payment_id.
 * Usato dallo scheduler per recuperare i transfer pending con deposito
 * confermato che non hanno mai ricevuto il release (es. crash post-confirmDeposit,
 * timeout RPC durante il release, riavvio server).
 *
 * Sicurezza: stessa guardia anti-double-spend di autoReleaseForRequest
 * (verifica saldo escrow prima di inviare la TX).
 * Idempotente: acquisisce il lock atomico pending→accepting, skippa se già rilasciato.
 */
export async function autoReleaseForSend(transferId: string): Promise<void> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: transferId });
  if (!transfer)                     { logger.warn({ transferId }, "[Payment] Auto-release-send: transfer non trovato"); return; }
  if (transfer.request_payment_id)   return;                    // delegato a autoReleaseForRequest
  if (transfer.status !== "pending") return;                    // idempotente: già rilasciato/in corso
  if (transfer.expires_at < new Date()) {
    logger.warn({ transferId }, "[Payment] Auto-release-send: transfer scaduto — lo gestirà l'expiry job");
    return;
  }
  if (!transfer.recipient_wallet) {
    // Lazy-resolve: il destinatario potrebbe aver salvato il wallet dopo la creazione.
    const recipientUser = await UserModel.findById(transfer.recipient_id).lean() as any;
    const resolvedWallet: string | null =
      recipientUser?.wallets?.usda?.address ?? recipientUser?.wallet_address ?? null;
    if (!resolvedWallet) {
      logger.error({ transferId }, "[Payment] Auto-release-send: wallet destinatario assente — resta pending");
      return;
    }
    await ChatTransferModel.updateOne(
      { transfer_id: transferId },
      { $set: { recipient_wallet: resolvedWallet } },
    );
    transfer.recipient_wallet = resolvedWallet;
  }

  const locked = await acquireLock(transferId, "pending", "accepting");
  if (!locked) { logger.info({ transferId }, "[Payment] Auto-release-send: lock non acquisito, salto"); return; }

  const now = new Date();
  try {
    // Guardia anti-double-spend: se l'escrow è già vuoto, un tentativo precedente
    // ha già rilasciato → ripristina "accepted" senza re-inviare la TX.
    const balanceStr = await getCustodialBalance({ address: locked.escrow_wallet, assetAddress: locked.asset_address });
    const alreadyReleased = BigInt(balanceStr) < BigInt(locked.amount_units);

    let txHash = locked.tx_hash_release ?? undefined;
    if (!alreadyReleased) {
      await ensureEscrowGas(locked.escrow_wallet);
      const res = await transferFromCustodial({
        encryptedPk:  locked.escrow_encrypted_pk,
        toAddress:    locked.recipient_wallet!,
        amountUnits:  locked.amount_units,
        assetAddress: locked.asset_address,
      });
      txHash = res.txHash;
    } else {
      logger.warn({ transferId }, "[Payment] Auto-release-send: escrow già vuoto — ripristino accepted senza re-invio");
    }

    const accepted = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "accepting" },
      { $set: { status: "accepted", tx_hash_release: txHash ?? null, responded_at: now, completed_at: now, locked_at: null } },
      { returnDocument: "after" },
    );
    if (!accepted) throw new Error("findOneAndUpdate post-release restituito null");

    await writeAudit({ transferId, fromStatus: "accepting", toStatus: "accepted", triggeredBy: "system", txHash, note: "Auto-release send (recovery scheduler)" });
    await _updateMessageMeta(accepted);
    emitPaymentStateChanged(accepted);
    void _sendCompletedNotification(accepted);
    if (txHash) _enrichReleaseBlock(transferId, txHash);

    logger.info({ transferId, txHash }, "[Payment] Auto-release-send completato ✓");
  } catch (err) {
    // NON marcare failed: ripristina pending per un retry sicuro.
    logger.error({ err, transferId }, "[Payment] Auto-release-send fallito — ripristino stato 'pending' per retry");
    await ChatTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "accepting" },
      { $set: { status: "pending", locked_at: null } },
    );
  }
}

export async function autoReleaseForRequest(transferId: string): Promise<void> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: transferId });
  if (!transfer)                     { logger.warn({ transferId }, "[Payment] Auto-release: transfer non trovato"); return; }
  if (!transfer.request_payment_id)  return;                    // solo transfer legati a richiesta
  if (transfer.status !== "pending") return;                    // idempotente: già rilasciato/in corso
  if (transfer.expires_at < new Date()) {
    logger.warn({ transferId }, "[Payment] Auto-release: transfer scaduto — lo gestirà l'expiry job");
    return;
  }
  if (!transfer.recipient_wallet) {
    // Lazy-resolve: il richiedente potrebbe aver salvato il wallet dopo la creazione.
    const recipientUser = await UserModel.findById(transfer.recipient_id).lean() as any;
    const resolvedWallet: string | null =
      recipientUser?.wallets?.usda?.address ?? recipientUser?.wallet_address ?? null;
    if (!resolvedWallet) {
      logger.error({ transferId }, "[Payment] Auto-release: wallet richiedente assente — resta pending");
      return;
    }
    await ChatTransferModel.updateOne(
      { transfer_id: transferId },
      { $set: { recipient_wallet: resolvedWallet } },
    );
    transfer.recipient_wallet = resolvedWallet;
  }

  const locked = await acquireLock(transferId, "pending", "accepting");
  if (!locked) { logger.info({ transferId }, "[Payment] Auto-release: lock non acquisito, salto"); return; }

  const now = new Date();
  try {
    // Guardia anti-double-spend: se l'escrow è già vuoto, un tentativo precedente
    // ha già rilasciato → ripristina "accepted" senza re-inviare la TX.
    const balanceStr = await getCustodialBalance({ address: locked.escrow_wallet, assetAddress: locked.asset_address });
    const alreadyReleased = BigInt(balanceStr) < BigInt(locked.amount_units);

    let txHash = locked.tx_hash_release ?? undefined;
    if (!alreadyReleased) {
      await ensureEscrowGas(locked.escrow_wallet);
      const res = await transferFromCustodial({
        encryptedPk:  locked.escrow_encrypted_pk,
        toAddress:    locked.recipient_wallet!,
        amountUnits:  locked.amount_units,
        assetAddress: locked.asset_address,
      });
      txHash = res.txHash;
    } else {
      logger.warn({ transferId }, "[Payment] Auto-release: escrow già vuoto — ripristino accepted senza re-invio");
    }

    const accepted = await ChatTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "accepting" },
      { $set: { status: "accepted", tx_hash_release: txHash ?? null, responded_at: now, completed_at: now, locked_at: null } },
      { returnDocument: "after" },
    );
    if (!accepted) throw new Error("findOneAndUpdate post-release restituito null");

    await writeAudit({ transferId, fromStatus: "accepting", toStatus: "accepted", triggeredBy: "system", txHash, note: "Auto-release richiesta (nessun accept manuale)" });
    await _updateMessageMeta(accepted);
    emitPaymentStateChanged(accepted);
    void _sendCompletedNotification(accepted);
    if (accepted.request_payment_id) {
      void syncRequestFromTransfer(accepted.request_payment_id.toString(), "confirmed");
    }
    if (txHash) _enrichReleaseBlock(transferId, txHash);

    logger.info({ transferId, txHash }, "[Payment] Auto-release richiesta completato ✓");
  } catch (err) {
    // NON marcare failed: ripristina pending per un retry sicuro (balance-checked).
    logger.error({ err, transferId }, "[Payment] Auto-release fallito — ripristino stato 'pending' per retry");
    await ChatTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "accepting" },
      { $set: { status: "pending", locked_at: null } },
    );
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
    await ensureEscrowGas(locked.escrow_wallet);

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
    void (async () => {
      try {
        const { sendUsdaTransactionEmail } = await import("../services/email.service");
        await sendUsdaTransactionEmail({
          type:            "rejected",
          transferId:      rejected.transfer_id,
          amount:          rejected.amount.toString(),
          assetSymbol:     rejected.asset_symbol,
          senderUserId:    rejected.sender_id.toString(),
          recipientUserId: rejected.recipient_id.toString(),
          txHash,
        });
      } catch { /* silenzioso */ }
    })();

    if (rejected.request_payment_id) {
      // Pagamento rifiutato → la richiesta torna pagabile.
      void syncRequestFromTransfer(rejected.request_payment_id.toString(), "pending_claim");
    }

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
    await ensureEscrowGas(locked.escrow_wallet);

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
    void (async () => {
      try {
        const { sendUsdaTransactionEmail } = await import("../services/email.service");
        await sendUsdaTransactionEmail({
          type:            "cancelled",
          transferId:      cancelled.transfer_id,
          amount:          cancelled.amount.toString(),
          assetSymbol:     cancelled.asset_symbol,
          senderUserId:    cancelled.sender_id.toString(),
          recipientUserId: cancelled.recipient_id.toString(),
          txHash,
        });
      } catch { /* silenzioso */ }
    })();

    if (cancelled.request_payment_id) {
      // Pagamento annullato dal pagante → la richiesta torna pagabile.
      void syncRequestFromTransfer(cancelled.request_payment_id.toString(), "pending_claim");
    }

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

/**
 * Ri-emette il WS event payment.state_changed e aggiorna la system_metadata
 * del messaggio-bolla. Utile dopo un recovery manuale (script) che ha
 * aggiornato MongoDB direttamente senza passare per il service layer.
 * Accessibile da mittente o destinatario.
 */
export async function resyncTransfer(params: {
  transferId:  string;
  requesterId: string;
}): Promise<Record<string, unknown>> {
  const transfer = await ChatTransferModel.findOne({ transfer_id: params.transferId });
  if (!transfer) throw new AppError("TRANSFER_NOT_FOUND", 404);

  const isParty =
    transfer.sender_id.toString()    === params.requesterId ||
    transfer.recipient_id.toString() === params.requesterId;
  if (!isParty) throw new AppError("TRANSFER_ACCESS_DENIED", 403);

  // Aggiorna system_metadata del messaggio e ri-emette l'evento WS
  await _updateMessageMeta(transfer);
  emitPaymentStateChanged(transfer);

  logger.info(
    { transferId: params.transferId, status: transfer.status },
    "[Payment] resyncTransfer: WS event e message_meta aggiornati",
  );

  return _format(transfer);
}
