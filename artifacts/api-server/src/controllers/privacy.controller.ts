/**
 * PrivacyController — strato HTTP per le impostazioni privacy (Sprint 15).
 */

import type { RequestHandler } from "express";
import * as privacyService from "../services/privacy.service";
import { successResponse } from "../utils/response";
import type { UpdatePrivacyInput, SetDisappearingInput } from "../validation/privacy.schemas";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// GET /api/v1/users/me/privacy
// ---------------------------------------------------------------------------

export const getPrivacySettings: RequestHandler = async (req, res, next) => {
  try {
    const settings = await privacyService.getPrivacySettings(req.user!.userId);
    res.status(200).json(successResponse(settings, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/me/privacy
// ---------------------------------------------------------------------------

export const updatePrivacySettings: RequestHandler = async (req, res, next) => {
  try {
    const input = req.body as UpdatePrivacyInput;
    const updated = await privacyService.updatePrivacySettings(
      req.user!.userId,
      input,
      { requestId: req.requestId },
    );
    res.status(200).json(successResponse(updated, req.requestId));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/v1/conversations/:id/disappearing
// ---------------------------------------------------------------------------

export const setDisappearingMessages: RequestHandler = async (req, res, next) => {
  try {
    const id = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
    if (!id || !mongoose.isValidObjectId(id)) {
      res.status(400).json({ success: false, error: "Invalid conversation id" });
      return;
    }
    const input = req.body as SetDisappearingInput;
    const result = await privacyService.setDisappearingMessages(
      req.user!.userId,
      id,
      input,
      { requestId: req.requestId },
    );
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) {
    next(err);
  }
};
