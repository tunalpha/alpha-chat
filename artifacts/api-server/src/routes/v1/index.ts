import { Router } from "express";
import systemRoutes from "./system.routes";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import conversationRoutes from "./conversation.routes";

/**
 * /api/v1/ — mounts all versioned sub-routers.
 * Add new modules here as they are implemented.
 */
const v1Router = Router();

// System (health, version, status)
v1Router.use("/", systemRoutes);

// Auth (register, login, refresh, logout, 2FA)
v1Router.use("/auth", authRoutes);

// Users (discovery, profiles)
v1Router.use("/users", userRoutes);

// Conversations (direct chat, groups)
v1Router.use("/conversations", conversationRoutes);

export default v1Router;
