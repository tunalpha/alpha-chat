import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { CreateConversationSchema, ListConversationsSchema } from "../../validation/conversation.schemas";
import { createConversation, listConversations } from "../../controllers/conversation.controller";

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

export default router;
