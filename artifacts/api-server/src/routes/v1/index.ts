import { Router } from "express";
import express from "express";
import systemRoutes from "./system.routes";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import conversationRoutes from "./conversation.routes";
import messageRoutes from "./message.routes";
import inviteRoutes from "./invite.routes";
import mediaRoutes from "./media.routes";
import keysRoutes from "./keys.routes";

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

// Messages (nested under conversations)
v1Router.use("/conversations/:conversationId/messages", messageRoutes);

// Invites (privacy-first contact discovery — Sprint 9)
v1Router.use("/invites", inviteRoutes);

// Media (upload/download audio, images — Sprint 11)
// Override body-parser limit to 25 MB for media uploads:
// max file 15 MB (video) × 1.33 base64 overhead ≈ 20 MB; 25 MB gives headroom.
// All other endpoints keep the global 1 MB limit.
v1Router.use("/media", express.json({ limit: "25mb" }), mediaRoutes);

// Signal Protocol — Key Distribution Center (Sprint 16, Fase 1)
v1Router.use("/keys", keysRoutes);

export default v1Router;
