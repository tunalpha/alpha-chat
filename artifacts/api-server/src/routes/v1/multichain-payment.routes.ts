/**
 * multichain-payment.routes.ts — Routes Multi-Chain Payment Engine (Phase 2+)
 *
 * Base path: /api/v1/multichain
 *
 * Endpoints:
 *   GET  /config                     → info reti/asset/fee (pubblico)
 *   POST /transfers                  → crea trasferimento (autenticato)
 *   GET  /transfers/:id              → stato trasferimento (autenticato)
 *   POST /transfers/:id/detect       → rileva deposito (autenticato)
 *   POST /transfers/:id/release      → rilascia transfer (autenticato)
 *   POST /transfers/:id/refund       → rimborsa mittente (autenticato)
 *
 * Zero dipendenze da routes USDA o payment esistenti.
 */

import { Router } from "express";
import {
  getMultiChainConfig,
  handleCreateTransfer,
  handleGetTransfer,
  handleDetectDeposit,
  handleReleaseTransfer,
  handleRefundTransfer,
} from "../../controllers/multichain-payment.controller";

// Riutilizza il middleware di autenticazione esistente
import { authenticate } from "../../middleware/authenticate.middleware";

const router = Router();

// Configurazione pubblica (status feature flags, asset supportati, fee wallet pubblici)
router.get("/config", getMultiChainConfig);

// Operazioni autenticate
router.post("/transfers",              authenticate, handleCreateTransfer);
router.get("/transfers/:id",           authenticate, handleGetTransfer);
router.post("/transfers/:id/detect",   authenticate, handleDetectDeposit);
router.post("/transfers/:id/release",  authenticate, handleReleaseTransfer);
router.post("/transfers/:id/refund",   authenticate, handleRefundTransfer);

export default router;
