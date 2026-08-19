import type { RequestHandler } from "express";
import { sendUserFeedbackEmail, type UserFeedbackCategory } from "../services/email.service";

interface FeedbackInput {
  category: UserFeedbackCategory;
  message: string;
  transaction_reference?: string;
  reply_to?: string;
}

/**
 * Riceve una segnalazione da un utente autenticato e la inoltra all'admin.
 * Non persiste testo o contatti: il canale e-mail esistente è l'unico output.
 */
export const submitFeedback: RequestHandler = async (req, res, next) => {
  try {
    const input = req.body as FeedbackInput;
    await sendUserFeedbackEmail({
      userId: req.user!.userId,
      category: input.category,
      message: input.message,
      transactionReference: input.transaction_reference,
      replyTo: input.reply_to,
    });

    res.status(202).json({ success: true });
  } catch (err) {
    next(err);
  }
};