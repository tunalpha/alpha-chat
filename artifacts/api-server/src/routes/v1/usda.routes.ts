/**
 * Routes USDA — /api/v1/usda/*
 *
 * Tutte le route richiedono autenticazione.
 * Nessuna dipendenza da logica blockchain: il controller delega al service
 * che delega all'adapter (attualmente MockUsdaAdapter).
 */

import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.middleware";
import * as usda from "../../controllers/usda.controller";

const router = Router();
router.use(authenticate);

// ── Capabilities ───────────────────────────────────────────────────────────
router.get("/capabilities", usda.getCapabilities);

// ── Wallet ─────────────────────────────────────────────────────────────────
router.get ("/wallet",         usda.getWallet);
router.put ("/wallet/address", usda.setWalletAddress);

// ── Pagamenti ───────────────────────────────────────────────────────────────
router.post("/payments/prepare",     usda.preparePayment);
router.post("/payments",             usda.submitPayment);
router.get ("/payments/:paymentId",  usda.getPayment);

// ── Richieste pagamento ─────────────────────────────────────────────────────
router.post("/requests",                  usda.requestPayment);
router.post("/requests/:requestId/pay",   usda.payRequest);

// ── Storico ─────────────────────────────────────────────────────────────────
router.get ("/history", usda.getHistory);

export default router;
