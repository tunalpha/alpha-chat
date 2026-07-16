/**
 * BlockController — strato HTTP per il blocco utenti (Sprint 15).
 */

import type { RequestHandler } from "express";
import * as blockService from "../services/block.service";
import { successResponse } from "../utils/response";
import type { BlockUserParam } from "../validation/privacy.schemas";

// ---------------------------------------------------------------------------
// POST /api/v1/users/:userId/block
// ---------------------------------------------------------------------------

export const blockUser: RequestHandler = async (req, res, next) => {
  try {
    const { userId: targetUserId } = req.params as BlockUserParam;
    await blockService.blockUser(
      req.user!.userId,
      targetUserId,
      { requestId: req.requestId },
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/v1/users/:userId/block
// ---------------------------------------------------------------------------

export const unblockUser: RequestHandler = async (req, res, next) => {
  try {
    const { userId: targetUserId } = req.params as BlockUserParam;
    await blockService.unblockUser(
      req.user!.userId,
      targetUserId,
      { requestId: req.requestId },
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/users/me/blocked
// ---------------------------------------------------------------------------

export const listBlocked: RequestHandler = async (req, res, next) => {
  try {
    const list = await blockService.listBlocked(req.user!.userId);
    res.status(200).json(successResponse(list, req.requestId));
  } catch (err) {
    next(err);
  }
};
