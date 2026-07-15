import { Router, type IRouter } from "express";
import v1Router from "./v1";
import mongoRouter from "./mongo";
import healthRouter from "./health";

const router: IRouter = Router();

// Health check — /api/healthz (used by deployment startup probe)
router.use(healthRouter);

// Versioned API
router.use("/v1", v1Router);

// Internal DB Manager tool routes (not versioned — internal use only)
router.use(mongoRouter);

export default router;
