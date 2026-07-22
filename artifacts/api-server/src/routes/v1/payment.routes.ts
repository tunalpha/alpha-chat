/**
 * payment.routes.ts — Chat Payment Engine REST API (Sprint 2)
 *
 * POST /api/v1/payments                     — crea trasferimento
 * POST /api/v1/payments/:id/deposit         — conferma deposito on-chain
 * POST /api/v1/payments/:id/accept          — destinatario accetta
 * POST /api/v1/payments/:id/reject          — destinatario rifiuta
 * POST /api/v1/payments/:id/cancel          — mittente annulla
 * GET  /api/v1/payments/:id                 — stato trasferimento
 *
 * Disciplina Sprint 2: nessun frontend collegato. Tutti i flussi testati via API.
 */

import { Router, type RequestHandler }                        from "express";
import { z }                                                  from "zod";
import { authenticate }                                       from "../../middleware/authenticate.middleware";
import { validate }                                           from "../../middleware/validate.middleware";
import * as paymentService                                    from "../../payment/chat-payment.service";

const router = Router();

// Tutti gli endpoint richiedono autenticazione
router.use(authenticate as RequestHandler);

// ---------------------------------------------------------------------------
// Schemi Zod
// ---------------------------------------------------------------------------

const CreateTransferSchema = z.object({
  recipient_id:    z.string().min(1, "recipient_id obbligatorio"),
  sender_wallet:   z.string().optional(),   // wallet ThirdWeb del mittente (fallback se non nel profilo)
  conversation_id: z.string().min(1, "conversation_id obbligatorio"),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,18})?$/, "Formato importo non valido")
    .refine((v) => parseFloat(v) > 0, "L'importo deve essere maggiore di zero"),
  note:          z.string().max(200).optional(),
  asset_address: z.string().optional(),
  asset_symbol:  z.string().optional(),
});

const DepositSchema = z.object({
  tx_hash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "Formato txHash non valido (atteso: 0x + 64 hex)"),
});

// ---------------------------------------------------------------------------
// POST /api/v1/payments — crea trasferimento
// ---------------------------------------------------------------------------

router.post(
  "/",
  validate("body", CreateTransferSchema),
  (async (req, res, next) => {
    try {
      const result = await paymentService.createTransfer({
        senderWalletOverride: req.body.sender_wallet as string | undefined,
        senderId:       req.user!.userId,
        recipientId:    req.body.recipient_id,
        conversationId: req.body.conversation_id,
        amount:         req.body.amount,
        note:           req.body.note,
        assetAddress:   req.body.asset_address,
        assetSymbol:    req.body.asset_symbol,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }) as RequestHandler,
);

// ---------------------------------------------------------------------------
// POST /api/v1/payments/:transferId/deposit — conferma deposito
// ---------------------------------------------------------------------------

router.post(
  "/:transferId/deposit",
  validate("body", DepositSchema),
  (async (req, res, next) => {
    try {
      const result = await paymentService.confirmDeposit({
        transferId:  req.params.transferId as string,
        txHash:      req.body.tx_hash,
        requesterId: req.user!.userId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }) as RequestHandler,
);

// ---------------------------------------------------------------------------
// POST /api/v1/payments/:transferId/detect-deposit — rileva tx on-chain (iOS recovery)
// ---------------------------------------------------------------------------

router.post(
  "/:transferId/detect-deposit",
  (async (req, res, next) => {
    try {
      const result = await paymentService.detectDeposit({
        transferId:  req.params.transferId as string,
        requesterId: req.user!.userId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }) as RequestHandler,
);

// ---------------------------------------------------------------------------
// POST /api/v1/payments/:transferId/accept — destinatario accetta
// ---------------------------------------------------------------------------

router.post(
  "/:transferId/accept",
  (async (req, res, next) => {
    try {
      const result = await paymentService.acceptTransfer({
        transferId:  req.params.transferId as string,
        requesterId: req.user!.userId,
        ip:          req.ip,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }) as RequestHandler,
);

// ---------------------------------------------------------------------------
// POST /api/v1/payments/:transferId/reject — destinatario rifiuta
// ---------------------------------------------------------------------------

router.post(
  "/:transferId/reject",
  (async (req, res, next) => {
    try {
      const result = await paymentService.rejectTransfer({
        transferId:  req.params.transferId as string,
        requesterId: req.user!.userId,
        ip:          req.ip,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }) as RequestHandler,
);

// ---------------------------------------------------------------------------
// POST /api/v1/payments/:transferId/cancel — mittente annulla
// ---------------------------------------------------------------------------

router.post(
  "/:transferId/cancel",
  (async (req, res, next) => {
    try {
      const result = await paymentService.cancelTransfer({
        transferId:  req.params.transferId as string,
        requesterId: req.user!.userId,
        ip:          req.ip,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }) as RequestHandler,
);

// ---------------------------------------------------------------------------
// GET /api/v1/payments/:transferId — stato (polling / debug)
// ---------------------------------------------------------------------------

router.get(
  "/:transferId",
  (async (req, res, next) => {
    try {
      const result = await paymentService.getTransfer({
        transferId:  req.params.transferId as string,
        requesterId: req.user!.userId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }) as RequestHandler,
);

// ---------------------------------------------------------------------------
// POST /api/v1/payments/:transferId/resync — forza WS event (recovery admin)
// Utile dopo un recovery manuale via script: ri-emette payment.state_changed
// e aggiorna la system_metadata del messaggio-bolla senza cambiare lo status.
// ---------------------------------------------------------------------------

router.post(
  "/:transferId/resync",
  (async (req, res, next) => {
    try {
      const result = await paymentService.resyncTransfer({
        transferId:  req.params.transferId as string,
        requesterId: req.user!.userId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }) as RequestHandler,
);

export default router;
