import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { CreateConversationSchema, ListConversationsSchema } from "../../validation/conversation.schemas";
import { SetDisappearingSchema } from "../../validation/privacy.schemas";
import {
  clearConversationMessages,
  createConversation,
  listConversations,
  markConversationRead,
} from "../../controllers/conversation.controller";
import { setDisappearingMessages } from "../../controllers/privacy.controller";

const router = Router();

// Tutte le route conversazioni richiedono autenticazione
router.use(authenticate);

/**
 * POST /api/v1/conversations
 * Crea o recupera una chat diretta con un utente dato il suo username.
 * Idempotente: chiamate multiple restituiscono la stessa conversazione.
 */
router.post("/", validate("body", CreateConversationSchema), createConversation);

/**
 * GET /api/v1/conversations
 * Lista le conversazioni dell'utente autenticato, ordinate per last_activity_at.
 */
router.get("/", validate("query", ListConversationsSchema), listConversations);

/**
 * PATCH /api/v1/conversations/:id/read
 * Marca tutti i messaggi della conversazione come letti. Trigghera Burn After Read.
 */
router.patch("/:id/read", markConversationRead);

/**
 * PATCH /api/v1/conversations/:id/disappearing
 * Abilita/disabilita messaggi a scomparsa per la conversazione (Sprint 15).
 */
router.patch("/:id/disappearing", validate("body", SetDisappearingSchema), setDisappearingMessages);

/**
 * DELETE /api/v1/conversations/:id/messages
 * Cancellazione definitiva e irreversibile di tutti i messaggi della chat.
 * Solo per membri attivi. Hard delete — nessun recovery possibile.
 */
router.delete("/:id/messages", clearConversationMessages);

export default router;
