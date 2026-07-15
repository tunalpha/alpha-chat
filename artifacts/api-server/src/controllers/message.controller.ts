/**
 * MessageController — strato HTTP per i messaggi.
 *
 * Regola: il controller è "stupido".
 * Estrae dati dalla request → chiama MessageService → formatta response.
 */

import type { RequestHandler } from "express";
import * as messageService from "../services/message.service";
import { successResponse, paginatedResponse } from "../utils/response";
import type { SendMessageInput, ListMessagesInput, ConversationIdParam } from "../validation/message.schemas";

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
