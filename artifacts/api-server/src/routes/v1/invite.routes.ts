import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { GenerateInviteSchema, RedeemInviteSchema } from "../../validation/invite.schemas";
import {
  generateInvite,
  redeemInvite,
  revokeMyInvites,
} from "../../controllers/invite.controller";

const router = Router();

// Tutti gli endpoint richiedono autenticazione
router.use(authenticate);

/** Genera un nuovo codice invito */
router.post("/generate", validate("body", GenerateInviteSchema), generateInvite);

/** Riscatta un codice invito ricevuto */
router.post("/redeem", validate("body", RedeemInviteSchema), redeemInvite);

/** Revoca tutti i propri codici attivi */
router.delete("/mine", revokeMyInvites);

export default router;
