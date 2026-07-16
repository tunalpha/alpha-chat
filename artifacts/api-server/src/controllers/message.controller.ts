/**
 * MessageController — strato HTTP per i messaggi.
 *
 * Regola: il controller è "stupido".
 * Estrae dati dalla request → chiama MessageService → formatta response.
 */

import type { RequestHandler } from "express";
import * as messageService from "../services/message.service";
import { successResponse, paginatedResponse } from "../utils/response";
import type {
  SendMessageInput,
  ListMessagesInput,
  ConversationIdParam,
  EditMessageInput,
  DeleteMessageInput,
  MessageIdParam,
} from "../validation/message.schemas";

// ---------------------------------------------------------------------------
// POST /api/v1/conversations/:conversationId/messages
// ---------------------------------------------------------------------------

export const sendMessage: RequestHandler = async (req, res, next) => {
  try {
    const { conversationId } = req.params as unknown as ConversationIdParam;
    const input = req.body as SendMessageInput;
    const senderId = req.user!.userId;

    const result = await messageService.sendMessage(
      senderId,
      conversationId,
      input,
      { requestId: req.requestId },
    );

    // 201 nuovo messaggio, 200 messaggio già esistente (idempotenza)
    const status = result.is_new ? 201 : 200;
    res.status(status).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/conversations/:conversationId/messages
// ---------------------------------------------------------------------------

export const listMessages: RequestHandler = async (req, res, next) => {
  try {
    const { conversationId } = req.params as unknown as ConversationIdParam;
    const query = req.query as unknown as ListMessagesInput;
    const userId = req.user!.userId;

    const result = await messageService.listMessages(userId, conversationId, query);

    res.status(200).json(
      paginatedResponse(
        result.messages,
        { cursor: result.nextCursor, has_more: result.hasMore },
        req.requestId,
      ),
    );
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/v1/conversations/:conversationId/messages/:messageId
// ---------------------------------------------------------------------------

export const editMessage: RequestHandler = async (req, res, next) => {
  try {
    const { conversationId, messageId } = req.params as unknown as MessageIdParam;
    const input = req.body as EditMessageInput;
    const userId = req.user!.userId;

    const result = await messageService.editMessage(
      userId,
      conversationId,
      messageId,
      input,
      { requestId: req.requestId },
    );

    const { is_new: _d, ...rest } = result;
    res.status(200).json(successResponse(rest, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/v1/conversations/:conversationId/messages/:messageId
// ---------------------------------------------------------------------------

export const deleteMessage: RequestHandler = async (req, res, next) => {
  try {
    const { conversationId, messageId } = req.params as unknown as MessageIdParam;
    const input = req.body as DeleteMessageInput;
    const userId = req.user!.userId;

    await messageService.deleteMessage(
      userId,
      conversationId,
      messageId,
      input ?? { for_everyone: false },
      { requestId: req.requestId },
    );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/v1/conversations/:conversationId/messages/:messageId/destroy
// ---------------------------------------------------------------------------

export const secureDestroyMessage: RequestHandler = async (req, res, next) => {
  try {
    const { conversationId, messageId } = req.params as unknown as MessageIdParam;
    const userId = req.user!.userId;

    await messageService.secureDestroy(
      userId,
      conversationId,
      messageId,
      { requestId: req.requestId },
    );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
