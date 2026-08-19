import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { submitFeedback } from "../../controllers/feedback.controller";

const router = Router();

const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Hai inviato troppe segnalazioni. Riprova tra 15 minuti." },
});

export const FeedbackSchema = z
  .object({
    category: z.enum(["problem", "transaction", "suggestion", "general"]),
    message: z.string().trim().min(10, "Descrivi la segnalazione con almeno 10 caratteri").max(4000),
    transaction_reference: z.string().trim().min(3).max(180).optional(),
    reply_to: z.string().trim().email("Inserisci un'e-mail valida").max(254).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.category === "transaction" && !input.transaction_reference) {
      ctx.addIssue({
        code: "custom",
        path: ["transaction_reference"],
        message: "Inserisci l'Exchange ID o l'hash della transazione",
      });
    }
    if (input.category !== "transaction" && input.transaction_reference) {
      ctx.addIssue({
        code: "custom",
        path: ["transaction_reference"],
        message: "Il riferimento transazione è previsto solo per i problemi di transazione",
      });
    }
  });

router.post("/", authenticate, feedbackLimiter, validate("body", FeedbackSchema), submitFeedback);

export default router;