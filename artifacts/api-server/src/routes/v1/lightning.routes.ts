/**
 * Lightning Invoice Link routes
 *
 * POST /  — crea link opaque per invoice BOLT11 (autenticato)
 * GET  /:invoiceId — recupera invoice per pagina pubblica di pagamento (no auth)
 *
 * Montato in v1/index.ts su /lightning/invoice-links
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../../middleware/authenticate.middleware";
import {
  createInvoiceLink,
  getInvoiceLink,
} from "../../controllers/lightning-link.controller";

const router = Router();

// Rate limit creazione link: 30/minuto per utente autenticato
const createLimiter = rateLimit({
  windowMs:        60_000,
  max:             30,
  // userId se autenticato, altrimenti nessun fallback su IP (la route è già protetta da authenticate)
  skip:            () => false,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: "RATE_LIMIT", message: "Troppi link creati. Riprova tra un minuto." },
});

// POST — autenticato
router.post("/", authenticate, createLimiter, createInvoiceLink);

// GET  — pubblico (nessun dato personale esposto)
router.get("/:invoiceId", getInvoiceLink);

export default router;
