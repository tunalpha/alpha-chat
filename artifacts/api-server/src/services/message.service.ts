/**
 * MessageService — logica di business per i messaggi.
 *
 * Sprint 6: First Message
 *   - sendMessage()    → invia (o restituisce) un messaggio testuale
 *   - listMessages()   → legge i messaggi paginati di una conversazione
 *
 * Regole business:
 *   - Solo i membri attivi della conversazione possono inviare/leggere messaggi
 *   - client_message_id garantisce idempotenza (201 nuovo, 200 già esistente)
 *   - Il server non conosce il contenuto del ciphertext (E2E, opaco)
 *   - sequence_number viene acquisito atomicamente dalla conversazione
 *   - last_message_id / last_message_at / last_activity_at aggiornati atomicamente
 */

import mongoose from "mongoose";
import { AppError } from "../errors/AppError";
import { ConversationRepository } from "../repositories/conversation.repository";
import { ConversationMemberRepository } from "../repositories/conversation-member.repository";
import { MessageRepository } from "../repositories/message.repository";
import { logAuditEvent } from "../lib/audit";
import { logger } from "../lib/logger";
import { wsManager } from "../lib/ws-manager";
import type { SendMessageInput, ListMessagesInput, EditMessageInput, DeleteMessageInput } from "../validation/message.schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageResult {
  id: string;
  client_message_id: string;
  conversation_id: string;
  sender_id: string;
  message_type: string;
  ciphertext: string | null;
  ciphertext_type: number | null;
  sender_key_id: number | null;
  sequence_number: number;
  sent_at: string;
  server_received_at: string;
  status: string;
  reply_to_message_id: string | null;
  media_id: string | null;
  deleted_for_everyone: boolean;
  edited_at: string | null;
  is_new: boolean;
}

export interface MessageListResult {
  messages: Omit<MessageResult, "is_new">[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

const convRepo = new ConversationRepository();
const memberRepo = new ConversationMemberRepository();
const msgRepo = new MessageRepository();

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

/**
 * Invia un messaggio in una conversazione.
 * Idempotente su client_message_id: se già esiste → 200 con il messaggio originale.
 *
 * @throws CHAT_NOT_FOUND se la conversazione non esiste
 * @throws NOT_CHAT_MEMBER se il mittente non è membro attivo
 */
export async function sendMessage(
  senderId: string,
  conversationId: string,
  input: SendMessageInput,
  context?: { requestId?: string },
): Promise<MessageResult> {
  const senderObjectId = new mongoose.Types.ObjectId(senderId);
  const convObjectId = new mongoose.Types.ObjectId(conversationId);

  // 1. Verifica conversazione esistente
  const conversation = await convRepo.findById(convObjectId);
  if (!conversation) {
    throw new AppError("CHAT_NOT_FOUND", 404);
  }

  // 2. Verifica membership
  const membership = await memberRepo.findMembership(convObjectId, senderObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  // 3. Idempotenza: se il messaggio è già nel DB, restituiscilo
  const existing = await msgRepo.findByClientId(input.client_message_id);
  if (existing) {
    logger.debug(
      { clientMessageId: input.client_message_id, messageId: existing._id.toString() },
      "Duplicate client_message_id — returning existing message",
    );
    return formatMessageResult(existing, false);
  }

  // 4. reply_to_message_id: verifica che il messaggio originale esista
  let replyToObjectId: mongoose.Types.ObjectId | null = null;
  if (input.reply_to_message_id) {
    replyToObjectId = new mongoose.Types.ObjectId(input.reply_to_message_id);
    const replyTarget = await msgRepo.findById(replyToObjectId, convObjectId);
    if (!replyTarget) {
      throw new AppError("MESSAGE_NOT_FOUND", 404);
    }
  }

  // 5. Crea il messaggio (acquisisce sequence_number atomicamente)
  const message = await msgRepo.create({
    clientMessageId: input.client_message_id,
    conversationId: convObjectId,
    senderId: senderObjectId,
    ciphertext: input.ciphertext,
    ciphertextType: input.ciphertext_type,
    senderKeyId: input.sender_key_id,
    messageType: input.message_type,
    sentAt: input.sent_at as Date,
    replyToMessageId: replyToObjectId,
    mediaId: input.media_id ? new mongoose.Types.ObjectId(input.media_id) : null,
    status: "sent",
  });

  // Audit (solo evento — non logghiamo il ciphertext)
  logAuditEvent({
    event: "MESSAGE_SENT",
    user_id: senderId,
    request_id: context?.requestId,
    created_at: new Date().toISOString(),
    metadata: {
      message_id: message._id.toString(),
      conversation_id: conversationId,
      sequence_number: message.sequence_number,
    },
  });

  logger.info(
    {
      messageId: message._id.toString(),
      conversationId,
      senderId,
      sequenceNumber: message.sequence_number,
    },
    "Message sent",
  );

  const result = formatMessageResult(message, true);

  // ── WebSocket broadcast ───────────────────────────────────────────────────
  // Consegna realtime a tutti i membri della conversazione (incluso il mittente,
  // per sincronizzare multi-device). Non bloccante — errori loggati come warn.
  void (async () => {
    try {
      const members = await memberRepo.listMembers(convObjectId);
      const memberIds = members.map((m) => m.user_id.toString());
      wsManager.sendToUsers(memberIds, { type: "message.new", payload: result });
    } catch (err) {
      logger.warn({ err, conversationId }, "WS broadcast message.new failed");
    }
  })();

  return result;
}

// ---------------------------------------------------------------------------
// listMessages
// ---------------------------------------------------------------------------

/**
 * Legge i messaggi paginati di una conversazione (desc per sequence_number).
 *
 * @throws CHAT_NOT_FOUND se la conversazione non esiste
 * @throws NOT_CHAT_MEMBER se il richiedente non è membro attivo
 */
export async function listMessages(
  userId: string,
  conversationId: string,
  input: ListMessagesInput,
): Promise<MessageListResult> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const convObjectId = new mongoose.Types.ObjectId(conversationId);

  // 1. Verifica conversazione
  const conversation = await convRepo.findById(convObjectId);
  if (!conversation) {
    throw new AppError("CHAT_NOT_FOUND", 404);
  }

  // 2. Verifica membership
  const membership = await memberRepo.findMembership(convObjectId, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  // 3. Fetch messaggi paginati (filtra quelli eliminati per l'utente)
  const { messages, hasMore } = await msgRepo.listForUser({
    conversationId: convObjectId,
    userId: userObjectId,
    limit: input.limit,
    beforeSequence: input.before_sequence,
    afterSequence: input.after_sequence,
  });

  // 4. Cursor = sequence_number dell'ultimo elemento (per next page)
  const lastSeq = messages.length > 0
    ? messages[messages.length - 1]?.sequence_number
    : undefined;
  const nextCursor = hasMore && lastSeq !== undefined
    ? Buffer.from(JSON.stringify({ seq: lastSeq })).toString("base64")
    : null;

  return {
    messages: messages.map((m) => {
      const r = formatMessageResult(m, false);
      const { is_new: _dropped, ...rest } = r;
      return rest;
    }),
    hasMore,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMessageResult(
  msg: {
    _id: mongoose.Types.ObjectId;
    client_message_id: string;
    conversation_id: mongoose.Types.ObjectId;
    sender_id: mongoose.Types.ObjectId;
    message_type: string;
    ciphertext: string | null;
    ciphertext_type: number | null;
    sender_key_id: number | null;
    sequence_number: number;
    sent_at: Date;
    server_received_at: Date;
    status: string;
    reply_to_message_id: mongoose.Types.ObjectId | null;
    media_id?: mongoose.Types.ObjectId | null;
    deleted_for_everyone: boolean;
    edited_at?: Date | null;
  },
  isNew: boolean,
): MessageResult {
  return {
    id: msg._id.toString(),
    client_message_id: msg.client_message_id,
    conversation_id: msg.conversation_id.toString(),
    sender_id: msg.sender_id.toString(),
    message_type: msg.message_type,
    ciphertext: msg.ciphertext,
    ciphertext_type: msg.ciphertext_type,
    sender_key_id: msg.sender_key_id,
    sequence_number: msg.sequence_number,
    sent_at: msg.sent_at.toISOString(),
    server_received_at: msg.server_received_at.toISOString(),
    status: msg.status,
    reply_to_message_id: msg.reply_to_message_id?.toString() ?? null,
    media_id: msg.media_id?.toString() ?? null,
    deleted_for_everyone: msg.deleted_for_everyone,
    edited_at: msg.edited_at?.toISOString() ?? null,
    is_new: isNew,
  };
}

// ---------------------------------------------------------------------------
// editMessage
// ---------------------------------------------------------------------------

const EDIT_WINDOW_MS = 15 * 60 * 1_000; // 15 minuti

/**
 * Modifica il ciphertext di un messaggio esistente.
 * Solo il mittente può modificare, entro la finestra di 15 minuti.
 */
export async function editMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  input: EditMessageInput,
  context?: { requestId?: string },
): Promise<MessageResult> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const convObjectId = new mongoose.Types.ObjectId(conversationId);
  const msgObjectId = new mongoose.Types.ObjectId(messageId);

  // 1. Verifica membership
  const membership = await memberRepo.findMembership(convObjectId, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  // 2. Trova il messaggio
  const msg = await msgRepo.findByIdRaw(msgObjectId);
  if (!msg || msg.conversation_id.toString() !== conversationId) {
    throw new AppError("MESSAGE_NOT_FOUND", 404);
  }

  // 3. Solo il mittente può modificare
  if (msg.sender_id.toString() !== userId) {
    throw new AppError("MESSAGE_EDIT_FORBIDDEN", 403);
  }

  // 4. Finestra di modifica
  if (Date.now() - msg.sent_at.getTime() > EDIT_WINDOW_MS) {
    throw new AppError("MESSAGE_EDIT_EXPIRED", 403);
  }

  // 5. Aggiorna
  const updated = await msgRepo.editById(msgObjectId, input.ciphertext, input.ciphertext_type);
  if (!updated) throw new AppError("MESSAGE_NOT_FOUND", 404);

  logAuditEvent("message.edited", userId, { messageId, conversationId }, context);

  const result = formatMessageResult(updated, false);
  const { is_new: _d, ...rest } = result;

  // 6. Broadcast message.edited
  void (async () => {
    try {
      const members = await memberRepo.listMembers(convObjectId);
      const memberIds = members.map((m) => m.user_id.toString());
      wsManager.sendToUsers(memberIds, { type: "message.edited", payload: rest });
    } catch (err) {
      logger.warn({ err }, "WS broadcast message.edited failed");
    }
  })();

  return result;
}

// ---------------------------------------------------------------------------
// deleteMessage
// ---------------------------------------------------------------------------

const DELETE_FOR_ALL_WINDOW_MS = 60 * 60 * 1_000; // 1 ora

/**
 * Elimina un messaggio per me o per tutti.
 */
export async function deleteMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  input: DeleteMessageInput,
  context?: { requestId?: string },
): Promise<void> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const convObjectId = new mongoose.Types.ObjectId(conversationId);
  const msgObjectId = new mongoose.Types.ObjectId(messageId);

  // 1. Verifica membership
  const membership = await memberRepo.findMembership(convObjectId, userObjectId);
  if (!membership || membership.left_at !== null) {
    throw new AppError("NOT_CHAT_MEMBER", 403);
  }

  // 2. Trova il messaggio
  const msg = await msgRepo.findByIdRaw(msgObjectId);
  if (!msg || msg.conversation_id.toString() !== conversationId) {
    throw new AppError("MESSAGE_NOT_FOUND", 404);
  }

  if (input.for_everyone) {
    // Solo il mittente può eliminare per tutti, entro 1 ora
    if (msg.sender_id.toString() !== userId) {
      throw new AppError("MESSAGE_DELETE_FORBIDDEN", 403);
    }
    if (Date.now() - msg.sent_at.getTime() > DELETE_FOR_ALL_WINDOW_MS) {
      throw new AppError("MESSAGE_DELETE_EXPIRED", 403);
    }

    await msgRepo.deleteForEveryoneById(msgObjectId);

    logAuditEvent("message.deleted_everyone", userId, { messageId, conversationId }, context);

    // Broadcast message.deleted a tutti
    void (async () => {
      try {
        const members = await memberRepo.listMembers(convObjectId);
        const memberIds = members.map((m) => m.user_id.toString());
        wsManager.sendToUsers(memberIds, {
          type: "message.deleted",
          payload: { message_id: messageId, conversation_id: conversationId, for_everyone: true },
        });
      } catch (err) {
        logger.warn({ err }, "WS broadcast message.deleted failed");
      }
    })();
  } else {
    // Elimina solo per me
    await msgRepo.deleteForMeById(msgObjectId, userObjectId);
    logAuditEvent("message.deleted_me", userId, { messageId, conversationId }, context);
  }
}
