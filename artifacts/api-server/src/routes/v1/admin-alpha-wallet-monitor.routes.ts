/**
 * Alpha Wallet Monitor — Admin routes
 *
 * Tutti gli endpoint sono read-only (requireAdmin "read_only").
 * Zero write su DB. Zero esposizione di seed/key/PIN.
 *
 * Base: /api/v1/admin/alpha-wallet-monitor/
 */

import { Router } from "express";
import { requireAdmin } from "../../middleware/require-admin.middleware.js";
import {
  getOverviewHandler,
  getUsersHandler,
  getFeeRecordsHandler,
  getPaymentRequestsHandler,
  getErrorsHandler,
} from "../../controllers/alpha-wallet-monitor.controller.js";

const router = Router();

router.get("/overview",          requireAdmin("read_only"), getOverviewHandler);
router.get("/users",             requireAdmin("read_only"), getUsersHandler);
router.get("/fee-records",       requireAdmin("read_only"), getFeeRecordsHandler);
router.get("/payment-requests",  requireAdmin("read_only"), getPaymentRequestsHandler);
router.get("/errors",            requireAdmin("read_only"), getErrorsHandler);

export default router;
