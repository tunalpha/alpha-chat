/**
 * ConversationController — strato HTTP per le conversazioni.
 *
 * Regola: il controller è "stupido".
 * Estrae dati dalla request → chiama ConversationService → formatta response.
 */

import type { RequestHandler } from "express";
import * as conversationService from "../services/conversation.service";
import { successResponse, paginatedResponse } from "../utils/response";
import type { CreateConversationInput, ListConversationsInput } from "../validation/conversation.schemas";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// POST /api/v1/conversations
// ---------------------------------------------------------------------------

export const createConversation: RequestHandler = async (req, res, next) => {
  try {
    const { username } = req.body as CreateConversationInput;
    const initiatorId = req.user!.userId;

    const result = await conversationService.createDirectConversation(
      initiatorId,
      username,
      { requestId: req.requestId },
    );

    // 201 se nuova, 200 se già esistente
    const status = result.is_new ? 201 : 200;
    res.status(status).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/conversations
// ---------------------------------------------------------------------------

export const listConversations: RequestHandler = async (req, res, next) => {
  try {
    const { limit } = req.query as unknown as ListConversationsInput;
    const userId = req.user!.userId;

    const conversations = await conversationService.listConversations(userId, { limit });

    res.status(200).json(
      paginatedResponse(
        conversations,
        { cursor: null, has_more: false },
        req.requestId,
      ),
    );
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/v1/conversations/:id/read
// ---------------------------------------------------------------------------

export const markConversationRead: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, error: "Invalid conversation id" });
      return;
    }
    await conversationService.markConversationRead(req.user!.userId, id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
