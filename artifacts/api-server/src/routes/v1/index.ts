import { Router } from "express";
import systemRoutes from "./system.routes";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import conversationRoutes from "./conversation.routes";
import messageRoutes from "./message.routes";
import inviteRoutes from "./invite.routes";
import mediaRoutes from "./media.routes";
import keysRoutes from "./keys.routes";
import phoenixRoutes from "./phoenix.routes";
import deadManSwitchRoutes from "./dead-man-switch.routes";
import recoveryContactsRoutes from "./recovery-contacts.routes";
import securityTimelineRoutes from "./security-timeline.routes";
import recoveryDashboardRoutes from "./recovery-dashboard.routes";

/**
 * /api/v1/ — mounts all versioned sub-routers.
 */
const v1Router = Router();

v1Router.use("/", systemRoutes);
v1Router.use("/auth", authRoutes);
v1Router.use("/users", userRoutes);
v1Router.use("/conversations", conversationRoutes);
v1Router.use("/conversations/:conversationId/messages", messageRoutes);
v1Router.use("/invites", inviteRoutes);
v1Router.use("/media", mediaRoutes);
v1Router.use("/keys", keysRoutes);

// Phoenix Protocol — Sprint 18
v1Router.use("/phoenix", phoenixRoutes);

// Recovery & Continuity Center — Sprint 19
v1Router.use("/dead-man-switch", deadManSwitchRoutes);
v1Router.use("/recovery-contacts", recoveryContactsRoutes);
v1Router.use("/security-timeline", securityTimelineRoutes);
v1Router.use("/recovery-dashboard", recoveryDashboardRoutes);

export default v1Router;
