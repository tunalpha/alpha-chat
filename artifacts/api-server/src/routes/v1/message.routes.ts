/**
 * Message routes — montate su /api/v1/conversations/:conversationId/messages
 * tramite mergeParams: true per accedere a :conversationId dal parent router.
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import {
  SendMessageSchema,
  ListMessagesSchema,
  ConversationIdParamSchema,
  EditMessageSchema,
  DeleteMessageSchema,
  MessageIdParamSchema,
} from "../../validation/message.schemas";
import { sendMessage, listMessages, editMessage, deleteMessage, secureDestroyMessage } from "../../controllers/message.controller";

const router = Router({ mergeParams: true });

// Tutte le route messaggi richiedono autenticazione
router.use(authenticate);

// Valida :conversationId per tutte le route di questo router
router.use(validate("params", ConversationIdParamSchema));

/**
 * POST /api/v1/conversations/:conversationId/messages
 * Invia un messaggio. Idempotente su client_message_id.
 */
router.post("/", validate("body", SendMessageSchema), sendMessage);

/**
 * GET /api/v1/conversations/:conversationId/messages
 * Lista messaggi (DESC per sequence_number, paginazione cursor).
 */
router.get("/", validate("query", ListMessagesSchema), listMessages);

/**
 * PATCH /api/v1/conversations/:conversationId/messages/:messageId
 * Modifica il ciphertext di un messaggio (solo mittente, entro 15 min).
 */
router.patch(
  "/:messageId",
  validate("params", MessageIdParamSchema),
  validate("body", EditMessageSchema),
  editMessage,
);

/**
 * DELETE /api/v1/conversations/:conversationId/messages/:messageId
 * Elimina un messaggio per me o per tutti.
 */
router.delete(
  "/:messageId",
  validate("params", MessageIdParamSchema),
  validate("body", DeleteMessageSchema),
  deleteMessage,
);

/**
 * DELETE /api/v1/conversations/:conversationId/messages/:messageId/destroy
 * Secure Destroy — cancellazione definitiva e irreversibile. Solo mittente.
 */
router.delete(
  "/:messageId/destroy",
  validate("params", MessageIdParamSchema),
  secureDestroyMessage,
);

export default router;
