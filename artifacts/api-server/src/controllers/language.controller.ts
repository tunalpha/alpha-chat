/**
 * LanguageController — salva la preferenza di lingua dell'utente.
 *
 * PATCH /api/v1/users/me/language
 *   Body: { language: string }   (es. "en", "it", "ar")
 */

import type { RequestHandler } from "express";
import { UserModel } from "../models/user.model";
import { AppError } from "../errors/AppError";
import { successResponse } from "../utils/response";
import { resolveLang } from "../lib/email-i18n";

const SUPPORTED_LANGS = ["it","en","es","fr","de","pt","ar","ru","zh","ja"] as const;

export const updateLanguage: RequestHandler = async (req, res, next) => {
  try {
    const { language } = req.body as { language?: unknown };

    if (typeof language !== "string" || !(SUPPORTED_LANGS as readonly string[]).includes(language)) {
      throw new AppError("VALIDATION_ERROR", 400);
    }

    const resolved = resolveLang(language);

    const user = await UserModel.findByIdAndUpdate(
      req.user!.userId,
      { $set: { language: resolved } },
      { new: true },
    );
    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    res.status(200).json(successResponse({ language: resolved }, req.requestId));
  } catch (err) { next(err); }
};
