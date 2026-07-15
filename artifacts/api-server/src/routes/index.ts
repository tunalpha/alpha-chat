import { Router, type IRouter } from "express";
import v1Router from "./v1";
import mongoRouter from "./mongo";

const router: IRouter = Router();

// Versioned API
router.use("/v1", v1Router);

// Internal DB Manager tool routes (not versioned — internal use only)
router.use(mongoRouter);

export default router;
