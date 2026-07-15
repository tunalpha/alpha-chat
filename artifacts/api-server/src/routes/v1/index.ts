import { Router } from "express";
import systemRoutes from "./system.routes";
import authRoutes from "./auth.routes";

/**
 * /api/v1/ — mounts all versioned sub-routers.
 * Add new modules here as they are implemented.
 */
const v1Router = Router();

// System (health, version, status)
v1Router.use("/", systemRoutes);

// Auth (register, login, refresh, logout, 2FA)
v1Router.use("/auth", authRoutes);

export default v1Router;
