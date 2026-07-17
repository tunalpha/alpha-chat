/**
 * Admin Routes — /api/v1/admin/*
 *
 * Pannello amministrativo Alpha Chat.
 * Tutti gli endpoint richiedono autenticazione admin (requireAdmin middleware).
 *
 * IMPORTANTE: nessun endpoint espone il contenuto delle conversazioni.
 * Vengono restituiti solo metadati, conteggi e informazioni di sistema.
 *
 * Sprint 23 — Admin Operations Center
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import mongoose from "mongoose";
import os from "node:os";
import argon2 from "argon2";

import { requireAdmin } from "../../middleware/require-admin.middleware";
import { signAccessToken } from "../../services/jwt.service";
import { UserModel } from "../../models/user.model";
import { AuditEventModel } from "../../models/audit-event.model";
import { logAuditEvent } from "../../lib/audit";
import { wsManager } from "../../lib/ws-manager";
import { AppError } from "../../errors/AppError";
import { SessionModel } from "../../models/session.model";

const router = Router();

// ---------------------------------------------------------------------------
// Helper: query string normalization
// ---------------------------------------------------------------------------

function qs(val: unknown): string | undefined {
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0] as string;
  return undefined;
}

function qsInt(val: unknown, defaultVal: number): number {
  const s = qs(val);
  if (!s) return defaultVal;
  const n = parseInt(s, 10);
  return isNaN(n) ? defaultVal : n;
}

// ---------------------------------------------------------------------------
// Helper: date utils
// ---------------------------------------------------------------------------

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// POST /admin/auth/login
// Autentica un utente con admin_role e restituisce un JWT admin.
// ---------------------------------------------------------------------------

router.post("/auth/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      throw new AppError("MISSING_FIELDS", 400);
    }

    const user = await UserModel.findOne({ username: username.toLowerCase().trim() });

    if (!user || !user.password_hash) {
      throw new AppError("INVALID_CREDENTIALS", 401);
    }

    if (user.status === "suspended" || user.status === "deleted") {
      throw new AppError("ACCOUNT_INACTIVE", 401);
    }

    if (!user.admin_role) {
      throw new AppError("NOT_AN_ADMIN", 403);
    }

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) {
      throw new AppError("INVALID_CREDENTIALS", 401);
    }

    // Emetti JWT con ruolo admin nel campo roles
    const { token, expiresAt } = await signAccessToken({
      userId: user._id.toString(),
      deviceId: "admin-panel",
      roles: [`admin:${user.admin_role}`],
    });

    logAuditEvent({
      event: "USER_LOGIN",
      user_id: user._id.toString(),
      device_id: "admin-panel",
      created_at: new Date().toISOString(),
      metadata: { source: "admin_panel" },
    });

    res.json({
      token,
      expires_at: expiresAt.toISOString(),
      admin: {
        id: user._id.toString(),
        username: user.username,
        display_name: user.display_name,
        admin_role: user.admin_role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/me
// Informazioni sull'admin autenticato.
// ---------------------------------------------------------------------------

router.get("/me", requireAdmin("read_only"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await UserModel.findById(req.adminUser!.userId).select(
      "username display_name admin_role avatar_url status",
    );
    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    res.json({
      id: user._id.toString(),
      username: user.username,
      display_name: user.display_name,
      admin_role: user.admin_role,
      avatar_url: user.avatar_url,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/stats
// 14 metriche live per la dashboard principale.
// ---------------------------------------------------------------------------

router.get("/stats", requireAdmin("read_only"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const today = startOfToday();
    const yesterday = daysAgo(1);

    const db = mongoose.connection.db;
    if (!db) throw new AppError("DB_UNAVAILABLE", 503);

    const [
      totalUsers,
      activeUsers24h,
      newUsersToday,
      suspendedUsers,
      totalConversations,
      totalGroups,
      messagesToday,
      totalMedia,
      activeSessions,
      phoenixConfigured,
      totpEnabled,
      recoveryCards,
      securityEventsToday,
    ] = await Promise.all([
      UserModel.countDocuments({ status: { $ne: "deleted" } }),
      UserModel.countDocuments({ status: "active", last_login_at: { $gte: yesterday } }),
      UserModel.countDocuments({ createdAt: { $gte: today } }),
      UserModel.countDocuments({ status: "suspended" }),
      db.collection("conversations").countDocuments({}),
      db.collection("conversations").countDocuments({ type: "group" }),
      db.collection("messages").countDocuments({ createdAt: { $gte: today } }),
      db.collection("media").countDocuments({}),
      SessionModel.countDocuments({ deleted_at: null, expires_at: { $gt: now } }),
      UserModel.countDocuments({ phoenix_code_hash: { $ne: null } }),
      UserModel.countDocuments({ totp_enabled: true }),
      UserModel.countDocuments({ recovery_card_generated_at: { $ne: null } }),
      AuditEventModel.countDocuments({ created_at: { $gte: today } }),
    ]);

    const onlineNow = wsManager.getOnlineCount();

    res.json({
      total_users: totalUsers,
      active_users_24h: activeUsers24h,
      online_now: onlineNow,
      new_users_today: newUsersToday,
      suspended_users: suspendedUsers,
      total_conversations: totalConversations,
      total_groups: totalGroups,
      messages_today: messagesToday,
      total_media: totalMedia,
      active_sessions: activeSessions,
      phoenix_configured: phoenixConfigured,
      totp_enabled: totpEnabled,
      recovery_cards: recoveryCards,
      security_events_today: securityEventsToday,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/growth?range=7d|30d|90d
// Serie temporali per la crescita utenti/messaggi/media.
// ---------------------------------------------------------------------------

router.get("/growth", requireAdmin("read_only"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rangeParam = qs(req.query["range"]) ?? "30d";
    const days = rangeParam === "7d" ? 7 : rangeParam === "90d" ? 90 : 30;
    const since = daysAgo(days);

    const db = mongoose.connection.db;
    if (!db) throw new AppError("DB_UNAVAILABLE", 503);

    const dateFormat = "%Y-%m-%d";

    const [userGrowth, messageGrowth, mediaGrowth] = await Promise.all([
      UserModel.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dateFormat, date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      db.collection("messages").aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dateFormat, date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection("media").aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: dateFormat, date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
    ]);

    // Merge per data
    const dateMap = new Map<string, { users: number; messages: number; media: number }>();

    for (const entry of userGrowth) {
      const d = entry._id as string;
      if (!dateMap.has(d)) dateMap.set(d, { users: 0, messages: 0, media: 0 });
      dateMap.get(d)!.users = entry.count as number;
    }
    for (const entry of messageGrowth) {
      const d = entry["_id"] as string;
      if (!dateMap.has(d)) dateMap.set(d, { users: 0, messages: 0, media: 0 });
      dateMap.get(d)!.messages = entry["count"] as number;
    }
    for (const entry of mediaGrowth) {
      const d = entry["_id"] as string;
      if (!dateMap.has(d)) dateMap.set(d, { users: 0, messages: 0, media: 0 });
      dateMap.get(d)!.media = entry["count"] as number;
    }

    const series = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    res.json({ range: rangeParam, days, series });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/security-features
// Percentuali di adozione delle funzionalità di sicurezza.
// ---------------------------------------------------------------------------

router.get("/security-features", requireAdmin("read_only"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = mongoose.connection.db;
    if (!db) throw new AppError("DB_UNAVAILABLE", 503);

    const total = await UserModel.countDocuments({ status: { $ne: "deleted" } });
    if (total === 0) {
      res.json({ total_users: 0, features: [] });
      return;
    }

    const [totpOn, phoenixOn, recoveryCard, emailVerified, ghostMode, recoveryEmail, dmsEnabled] = await Promise.all([
      UserModel.countDocuments({ totp_enabled: true, status: { $ne: "deleted" } }),
      UserModel.countDocuments({ phoenix_code_hash: { $ne: null }, status: { $ne: "deleted" } }),
      UserModel.countDocuments({ recovery_card_generated_at: { $ne: null }, status: { $ne: "deleted" } }),
      UserModel.countDocuments({ email_verified: true, status: { $ne: "deleted" } }),
      UserModel.countDocuments({ "privacy.ghost_mode": true, status: { $ne: "deleted" } }),
      UserModel.countDocuments({ recovery_email: { $ne: null }, status: { $ne: "deleted" } }),
      db.collection("deadmanswitches").countDocuments({ enabled: true }),
    ]);

    const pct = (n: number) => Math.round((n / total) * 100);

    res.json({
      total_users: total,
      features: [
        { key: "2fa", label: "Autenticazione 2FA", count: totpOn, pct: pct(totpOn) },
        { key: "phoenix", label: "Phoenix Protocol", count: phoenixOn, pct: pct(phoenixOn) },
        { key: "recovery_card", label: "Recovery Card", count: recoveryCard, pct: pct(recoveryCard) },
        { key: "email_verified", label: "Email verificata", count: emailVerified, pct: pct(emailVerified) },
        { key: "ghost_mode", label: "Ghost Mode", count: ghostMode, pct: pct(ghostMode) },
        { key: "recovery_email", label: "Email di recupero", count: recoveryEmail, pct: pct(recoveryEmail) },
        { key: "dms", label: "Dead Man Switch", count: dmsEnabled, pct: pct(dmsEnabled) },
      ],
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/system-health
// Salute del sistema: CPU, RAM, MongoDB, WS, uptime.
// ---------------------------------------------------------------------------

router.get("/system-health", requireAdmin("read_only"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const mem = process.memoryUsage();
    const totalRam = os.totalmem();
    const freeRam = os.freemem();
    const usedRam = totalRam - freeRam;
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;

    // Ping MongoDB
    let mongoStatus: "ok" | "error" = "error";
    let mongoLatencyMs = 0;
    try {
      const db = mongoose.connection.db;
      if (db) {
        const t0 = Date.now();
        await db.command({ ping: 1 });
        mongoLatencyMs = Date.now() - t0;
        mongoStatus = "ok";
      }
    } catch {
      // già error
    }

    res.json({
      uptime_seconds: Math.floor(process.uptime()),
      node_version: process.version,
      memory: {
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        system_used_mb: Math.round(usedRam / 1024 / 1024),
        system_total_mb: Math.round(totalRam / 1024 / 1024),
        system_pct: Math.round((usedRam / totalRam) * 100),
      },
      cpu: {
        load_1m: loadAvg[0],
        load_5m: loadAvg[1],
        load_15m: loadAvg[2],
        cores: cpuCount,
        load_pct: Math.round((loadAvg[0]! / cpuCount) * 100),
      },
      mongodb: {
        status: mongoStatus,
        latency_ms: mongoLatencyMs,
        state: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      },
      websockets: {
        connections: wsManager.getOnlineCount(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/storage
// Breakdown delle dimensioni delle collezioni MongoDB.
// ---------------------------------------------------------------------------

router.get("/storage", requireAdmin("support"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = mongoose.connection.db;
    if (!db) throw new AppError("DB_UNAVAILABLE", 503);

    const dbStats = await db.stats();

    const collections = [
      "users", "sessions", "messages", "conversations", "conversationmembers",
      "media", "auditevents", "signalkeybundles", "userprekeys", "callLogs", "blocks", "invites",
    ];

    const collectionStats = await Promise.all(
      collections.map(async (name) => {
        try {
          const [collStats, count] = await Promise.all([
            db.command({ collStats: name }),
            db.collection(name).countDocuments(),
          ]);
          return {
            name,
            size_mb: Math.round(((collStats as Record<string, number>)["size"] / 1024 / 1024) * 100) / 100,
            storage_mb: Math.round(((collStats as Record<string, number>)["storageSize"] / 1024 / 1024) * 100) / 100,
            index_mb: Math.round(((collStats as Record<string, number>)["totalIndexSize"] / 1024 / 1024) * 100) / 100,
            count,
          };
        } catch {
          return { name, size_mb: 0, storage_mb: 0, index_mb: 0, count: 0 };
        }
      }),
    );

    const stats = dbStats as Record<string, number>;

    res.json({
      database: {
        size_mb: Math.round(((stats["dataSize"] ?? 0) / 1024 / 1024) * 100) / 100,
        storage_mb: Math.round(((stats["storageSize"] ?? 0) / 1024 / 1024) * 100) / 100,
        index_mb: Math.round(((stats["indexSize"] ?? 0) / 1024 / 1024) * 100) / 100,
        collections_count: stats["collections"] ?? 0,
        objects_count: stats["objects"] ?? 0,
      },
      collections: collectionStats.sort((a, b) => b.storage_mb - a.storage_mb),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/security-events
// Feed degli eventi di sicurezza (SOC).
// ---------------------------------------------------------------------------

router.get("/security-events", requireAdmin("security_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, qsInt(req.query["page"], 1));
    const limit = Math.min(100, Math.max(1, qsInt(req.query["limit"], 20)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    const evtParam = qs(req.query["event"]);
    if (evtParam) filter["event"] = evtParam;
    const uidParam = qs(req.query["user_id"]);
    if (uidParam) filter["user_id"] = uidParam;
    const sinceParam = qs(req.query["since"]);
    if (sinceParam) filter["created_at"] = { $gte: new Date(sinceParam) };

    const [events, total] = await Promise.all([
      AuditEventModel.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
      AuditEventModel.countDocuments(filter),
    ]);

    res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      events: events.map((e) => ({
        id: (e._id as mongoose.Types.ObjectId).toString(),
        event: e.event,
        user_id: e.user_id,
        device_id: e.device_id,
        ip_hash: e.ip_hash,
        country_code: e.country_code,
        metadata: e.metadata,
        created_at: e.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users
// Lista utenti (senza contenuto conversazioni).
// ---------------------------------------------------------------------------

router.get("/users", requireAdmin("support"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, qsInt(req.query["page"], 1));
    const limit = Math.min(100, Math.max(1, qsInt(req.query["limit"], 20)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    const statusParam = qs(req.query["status"]);
    if (statusParam) filter["status"] = statusParam;

    const searchParam = qs(req.query["search"]);
    if (searchParam) {
      filter["$or"] = [
        { username: { $regex: searchParam, $options: "i" } },
        { display_name: { $regex: searchParam, $options: "i" } },
        { email: { $regex: searchParam, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .select(
          "username display_name email status admin_role totp_enabled is_verified " +
          "avatar_url last_login_at createdAt phoenix_code_hash recovery_card_generated_at " +
          "failed_login_attempts locked_until suspension_reason",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UserModel.countDocuments(filter),
    ]);

    res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      users: users.map((u) => ({
        id: (u._id as mongoose.Types.ObjectId).toString(),
        username: u.username,
        display_name: u.display_name,
        email: u.email,
        status: u.status,
        admin_role: u.admin_role ?? null,
        totp_enabled: u.totp_enabled,
        is_verified: u.is_verified,
        avatar_url: u.avatar_url,
        last_login_at: u.last_login_at,
        created_at: u.createdAt,
        has_phoenix: u.phoenix_code_hash !== null,
        has_recovery_card: u.recovery_card_generated_at !== null,
        failed_login_attempts: u.failed_login_attempts,
        locked_until: u.locked_until,
        suspension_reason: u.suspension_reason,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/status
// Sospendi o riattiva un utente.
// ---------------------------------------------------------------------------

router.patch("/users/:id/status", requireAdmin("support"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const { status, reason } = req.body as { status?: string; reason?: string };

    if (!status || !["active", "suspended"].includes(status)) {
      throw new AppError("INVALID_STATUS", 400);
    }

    const user = await UserModel.findByIdAndUpdate(
      id,
      {
        status,
        suspension_reason: status === "suspended" ? (reason ?? "Admin action") : null,
      },
      { new: true },
    ).select("username status suspension_reason");

    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    logAuditEvent({
      event: "ACCOUNT_LOCKED",
      user_id: id,
      device_id: "admin-panel",
      request_id: req.adminUser?.userId,
      created_at: new Date().toISOString(),
      metadata: { admin_action: "status_change", new_status: status, reason },
    });

    res.json({ id, username: user.username, status: user.status, suspension_reason: user.suspension_reason });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/role
// Cambia il ruolo admin di un utente (solo super_admin).
// ---------------------------------------------------------------------------

router.patch("/users/:id/role", requireAdmin("super_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const { admin_role } = req.body as { admin_role?: string | null };

    const validRoles = ["super_admin", "security_admin", "support", "read_only", null];
    if (!validRoles.includes(admin_role ?? null)) {
      throw new AppError("INVALID_ROLE", 400);
    }

    const user = await UserModel.findByIdAndUpdate(
      id,
      { admin_role: admin_role ?? null },
      { new: true },
    ).select("username admin_role");

    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    logAuditEvent({
      event: "TRUST_STATUS_CHANGED",
      user_id: id,
      device_id: "admin-panel",
      request_id: req.adminUser?.userId,
      created_at: new Date().toISOString(),
      metadata: { admin_action: "role_change", new_role: admin_role },
    });

    res.json({ id, username: user.username, admin_role: user.admin_role });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id
// Soft-delete di un utente (solo super_admin).
// ---------------------------------------------------------------------------

router.delete("/users/:id", requireAdmin("super_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;

    const user = await UserModel.findByIdAndUpdate(
      id,
      { status: "deleted", deleted_at: new Date() },
      { new: true },
    ).select("username status");

    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    // Revoca tutte le sessioni
    await SessionModel.updateMany({ user_id: id }, { $set: { deleted_at: new Date() } });

    logAuditEvent({
      event: "ACCOUNT_DELETED",
      user_id: id,
      device_id: "admin-panel",
      request_id: req.adminUser?.userId,
      created_at: new Date().toISOString(),
      metadata: { admin_action: "soft_delete" },
    });

    res.json({ id, username: user.username, status: user.status });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id/sessions
// Revoca tutte le sessioni di un utente.
// ---------------------------------------------------------------------------

router.delete("/users/:id/sessions", requireAdmin("security_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;

    const result = await SessionModel.updateMany(
      { user_id: id, deleted_at: null },
      { $set: { deleted_at: new Date() } },
    );

    logAuditEvent({
      event: "SESSION_REVOKED_ALL",
      user_id: id,
      device_id: "admin-panel",
      request_id: req.adminUser?.userId,
      created_at: new Date().toISOString(),
      metadata: { admin_action: "revoke_all_sessions", revoked_count: result.modifiedCount },
    });

    res.json({ revoked: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/devices
// Lista di tutti i device/sessioni attive.
// ---------------------------------------------------------------------------

router.get("/devices", requireAdmin("security_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, qsInt(req.query["page"], 1));
    const limit = Math.min(100, Math.max(1, qsInt(req.query["limit"], 20)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { deleted_at: null };
    const uidParam = qs(req.query["user_id"]);
    if (uidParam) filter["user_id"] = uidParam;
    const trustedParam = qs(req.query["trusted"]);
    if (trustedParam !== undefined) filter["is_trusted"] = trustedParam === "true";
    if (qs(req.query["active"]) === "true") filter["expires_at"] = { $gt: new Date() };

    const [sessions, total] = await Promise.all([
      SessionModel.find(filter)
        .select("user_id device_id user_agent is_trusted last_used_at expires_at createdAt")
        .sort({ last_used_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SessionModel.countDocuments(filter),
    ]);

    // Arricchisci con username
    const userIds = [...new Set(sessions.map((s) => s.user_id?.toString()))].filter(Boolean) as string[];
    const usersMap = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await UserModel.find({ _id: { $in: userIds } }).select("username").lean();
      for (const u of users) usersMap.set((u._id as mongoose.Types.ObjectId).toString(), u.username);
    }

    res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      devices: sessions.map((s) => ({
        id: (s._id as mongoose.Types.ObjectId).toString(),
        user_id: s.user_id?.toString(),
        username: usersMap.get(s.user_id?.toString() ?? "") ?? null,
        device_id: s.device_id,
        device_name: (s as unknown as Record<string, unknown>)["device_name"] ?? null,
        user_agent: s.user_agent,
        is_trusted: s.is_trusted,
        last_used_at: s.last_used_at,
        expires_at: s.expires_at,
        created_at: s.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/devices/:sessionId
// Revoca una singola sessione.
// ---------------------------------------------------------------------------

router.delete("/devices/:sessionId", requireAdmin("security_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params["sessionId"] as string;

    const session = await SessionModel.findByIdAndUpdate(
      sessionId,
      { $set: { deleted_at: new Date() } },
      { new: true },
    );

    if (!session) throw new AppError("SESSION_NOT_FOUND", 404);

    logAuditEvent({
      event: "SESSION_REVOKED",
      user_id: session.user_id?.toString(),
      device_id: session.device_id,
      request_id: req.adminUser?.userId,
      created_at: new Date().toISOString(),
      metadata: { admin_action: "revoke_session" },
    });

    res.json({ revoked: true, session_id: sessionId });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/audit/export
// Esporta gli eventi di audit in JSON (solo super_admin).
// ---------------------------------------------------------------------------

router.get("/audit/export", requireAdmin("super_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const daysParam = qsInt(req.query["days"], 7);
    const days = Math.min(90, Math.max(1, daysParam));
    const since = daysAgo(days);

    const events = await AuditEventModel.find({ created_at: { $gte: since } })
      .sort({ created_at: -1 })
      .limit(10000)
      .lean();

    const data = {
      exported_at: new Date().toISOString(),
      period_days: days,
      total_events: events.length,
      events: events.map((e) => ({
        id: (e._id as mongoose.Types.ObjectId).toString(),
        event: e.event,
        user_id: e.user_id,
        device_id: e.device_id,
        ip_hash: e.ip_hash,
        country_code: e.country_code,
        metadata: e.metadata,
        created_at: e.created_at,
      })),
    };

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.setHeader("Content-Type", "application/json");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// seedAdminIfNeeded
// Promuove "alpha" a super_admin al primo avvio se nessun admin esiste.
// ---------------------------------------------------------------------------

export async function seedAdminIfNeeded(): Promise<void> {
  try {
    const adminCount = await UserModel.countDocuments({ admin_role: { $ne: null } });
    if (adminCount > 0) return;

    const alphaUser = await UserModel.findOne({ username: "alpha" });
    if (!alphaUser) return;

    await UserModel.updateOne({ _id: alphaUser._id }, { $set: { admin_role: "super_admin" } });
    console.log("[admin-seed] Utente 'alpha' promosso a super_admin (nessun admin esistente)");
  } catch (err) {
    console.error("[admin-seed] Errore durante seeding admin:", err);
  }
}

export default router;
