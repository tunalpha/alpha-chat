import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mongoRouter from "./mongo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mongoRouter);

export default router;
