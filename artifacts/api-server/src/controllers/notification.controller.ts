/**
 * NotificationController — impostazioni notifiche utente.
 */

import type { RequestHandler } from "express";
import { UserRepository } from "../repositories/user.repository";
import { AppError } from "../errors/AppError";
import { successResponse } from "../utils/response";

const userRepo = new UserRepository();

export interface NotificationSettings {
  messages:     boolean;
  calls:        boolean;
  groups:       boolean;
  preview_text: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/v1/users/me/notifications
// ---------------------------------------------------------------------------

export const getNotificationSettings: RequestHandler = async (req, res, next) => {
  try {
    const user = await userRepo.findById(req.user!.userId);
    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    res.status(200).json(successResponse({
      messages:     user.notification_settings.messages,
      calls:        user.notification_settings.calls,
      groups:       user.notification_settings.groups,
      preview_text: user.notification_settings.preview_text,
    }, req.requestId));
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/me/notifications
// ---------------------------------------------------------------------------

export const updateNotificationSettings: RequestHandler = async (req, res, next) => {
  try {
    const user = await userRepo.findById(req.user!.userId);
    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    const patch = req.body as Partial<NotificationSettings>;
    if (patch.messages     !== undefined) user.notification_settings.messages     = patch.messages;
    if (patch.calls        !== undefined) user.notification_settings.calls        = patch.calls;
    if (patch.groups       !== undefined) user.notification_settings.groups       = patch.groups;
    if (patch.preview_text !== undefined) user.notification_settings.preview_text = patch.preview_text;

    await user.save();

    res.status(200).json(successResponse({
      messages:     user.notification_settings.messages,
      calls:        user.notification_settings.calls,
      groups:       user.notification_settings.groups,
      preview_text: user.notification_settings.preview_text,
    }, req.requestId));
  } catch (err) { next(err); }
};
