import { Router } from "express";
import systemRoutes from "./system.routes";

/**
 * /api/v1/ — mounts all versioned sub-routers.
 * Add new modules here as they are implemented.
 */
const v1Router = Router();

// System (health, version, status)
v1Router.use("/", systemRoutes);

export default v1Router;
