/**
 * Investor Secure Access Routes — /api/v1/investor/*
 *
 * Pubblico:
 *   POST /verify    — verifica codice
 *   POST /request   — richiesta accesso
 *
 * Admin (requireAdmin):
 *   GET  /admin/requests
 *   POST /admin/requests/:id/approve
 *   POST /admin/requests/:id/reject
 *   GET  /admin/codes
 *   POST /admin/codes/:id/regenerate
 *   PATCH /admin/codes/:id
 *   DELETE /admin/codes/:id
 *   GET  /admin/log
 */

import { Router } from "express";
import { requireAdmin } from "../../middleware/require-admin.middleware";
import * as investor from "../../controllers/investor.controller";

const router = Router();

// ── Public ──────────────────────────────────────────────────────────────────
router.get( "/settings", investor.getGateSettings);
router.post("/verify",   investor.verifyAccessCode);
router.post("/request",  investor.submitAccessRequest);
router.post("/contact",  investor.submitContactMessage);

// ── Admin ────────────────────────────────────────────────────────────────────
router.get(   "/admin/requests",               requireAdmin(), investor.listRequests);
router.post(  "/admin/requests/:id/approve",   requireAdmin(), investor.approveRequest);
router.post(  "/admin/requests/:id/reject",    requireAdmin(), investor.rejectRequest);
router.delete("/admin/requests/:id",           requireAdmin(), investor.deleteRequest);

router.get(   "/admin/codes",                  requireAdmin(), investor.listCodes);
router.post(  "/admin/codes",                  requireAdmin(), investor.createCode);
router.post(  "/admin/codes/:id/regenerate",   requireAdmin(), investor.regenerateCode);
router.patch( "/admin/codes/:id",              requireAdmin(), investor.updateCode);
router.delete("/admin/codes/:id",              requireAdmin(), investor.deleteCode);

router.get( "/admin/log",                    requireAdmin(), investor.getAccessLog);
router.patch("/admin/settings",              requireAdmin(), investor.updateGateSettings);

export default router;
