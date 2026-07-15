/**
 * UserController — strato HTTP per User Discovery.
 *
 * Regola: il controller è "stupido".
 * Estrae dati dalla request → chiama UserService → formatta response.
 */

import type { RequestHandler } from "express";
import * as userService from "../services/user.service";
import { successResponse, paginatedResponse } from "../utils/response";
import type { UserSearchInput, UsernameParamInput } from "../validation/user.schemas";

// ---------------------------------------------------------------------------
// GET /api/v1/users/search?q=...
// ---------------------------------------------------------------------------

export const searchUsers: RequestHandler = async (req, res, next) => {
  try {
    const { q, limit, cursor } = req.query as unknown as UserSearchInput;
    const viewerUserId = req.user!.userId;

    const result = await userService.searchUsers(q, viewerUserId, { limit, cursor });

    res.status(200).json(
      paginatedResponse(
        result.users,
        {
          cursor: result.next_cursor,
          has_more: result.has_more,
        },
        req.requestId,
      ),
    );
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/users/:username
// ---------------------------------------------------------------------------

export const getUserProfile: RequestHandler = async (req, res, next) => {
  try {
    const { username } = req.params as unknown as UsernameParamInput;
    const viewerUserId = req.user!.userId;

    const profile = await userService.getUserProfile(username, viewerUserId);

    res.status(200).json(successResponse(profile, req.requestId));
  } catch (err) {
    next(err);
  }
};
