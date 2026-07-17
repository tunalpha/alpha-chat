import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import { validate } from "../../middleware/validate.middleware";
import { GenerateInviteSchema, RedeemInviteSchema } from "../../validation/invite.schemas";
import {
  generateInvite,
  redeemInvite,
  revokeMyInvites,
  getActiveInvite,
} from "../../controllers/invite.controller";

const router = Router();

// Tutti gli endpoint richiedono autenticazione
router.use(authenticate);

/** Verifica se l'utente ha già un codice invito attivo (senza esporre il codice grezzo) */
router.get("/active", getActiveInvite);

/** Genera un nuovo codice invito */
router.post("/generate", validate("body", GenerateInviteSchema), generateInvite);

/** Riscatta un codice invito ricevuto */
router.post("/redeem", validate("body", RedeemInviteSchema), redeemInvite);

/** Revoca tutti i propri codici attivi */
router.delete("/mine", revokeMyInvites);

export default router;
