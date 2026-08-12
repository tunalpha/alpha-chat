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
import { ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../../lib/r2-client";
import { config } from "../../config";
import { cleanupTempObjects } from "../../services/storage.service";
import { R2EventModel } from "../../models/r2-event.model";
import { R2PricingConfigModel, R2_PRICING_DEFAULTS } from "../../models/r2-pricing-config.model";

// 60-second in-memory cache per la dashboard R2 (aggregation pesante)
let _r2DashboardCache: { data: unknown; expires: number } | null = null;

import { requireAdmin } from "../../middleware/require-admin.middleware";
import { signAccessToken } from "../../services/jwt.service";
import { UserModel } from "../../models/user.model";
import { AuditEventModel } from "../../models/audit-event.model";
import { logAuditEvent } from "../../lib/audit";
import { wsManager } from "../../lib/ws-manager";
import { AppError } from "../../errors/AppError";
import { SessionModel } from "../../models/session.model";
import { SignalKeyBundleModel } from "../../models/signal-key-bundle.model";
import { ConversationMemberModel } from "../../models/conversation-member.model";
import { PushSubscriptionModel } from "../../models/push-subscription.model";
import { MediaModel } from "../../models/media.model";
import { BlockModel } from "../../models/block.model";
import { RecoveryContactModel } from "../../models/recovery-contact.model";
import { callMetrics } from "../../lib/call-metrics";
import { DiagnosticEventModel } from "../../models/diagnostic-event.model";

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

    // ── R2 media stats (da MongoDB metadata) ──────────────────────────────────
    const [r2Stats, r2TopUploaders, r2TopConversations] = await Promise.all([
      MediaModel.aggregate<{ fileCount: number; totalBytes: number }>([
        { $group: { _id: null, fileCount: { $sum: 1 }, totalBytes: { $sum: "$ciphertextSize" } } },
      ]).then((r) => r[0] ?? { fileCount: 0, totalBytes: 0 }),
      MediaModel.aggregate([
        { $group: { _id: "$uploader_id", bytes: { $sum: "$ciphertextSize" }, count: { $sum: 1 } } },
        { $sort: { bytes: -1 } }, { $limit: 10 },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" } },
        { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, username: { $ifNull: ["$u.username", "unknown"] }, bytes: 1, count: 1 } },
      ]),
      MediaModel.aggregate([
        { $group: { _id: "$conversation_id", bytes: { $sum: "$ciphertextSize" }, count: { $sum: 1 } } },
        { $sort: { bytes: -1 } }, { $limit: 10 },
        { $project: { _id: 0, conversation_id: { $toString: "$_id" }, bytes: 1, count: 1 } },
      ]),
    ]);

    res.json({
      database: {
        size_mb: Math.round(((stats["dataSize"] ?? 0) / 1024 / 1024) * 100) / 100,
        storage_mb: Math.round(((stats["storageSize"] ?? 0) / 1024 / 1024) * 100) / 100,
        index_mb: Math.round(((stats["indexSize"] ?? 0) / 1024 / 1024) * 100) / 100,
        collections_count: stats["collections"] ?? 0,
        objects_count: stats["objects"] ?? 0,
      },
      collections: collectionStats.sort((a, b) => b.storage_mb - a.storage_mb),
      r2: {
        file_count:         r2Stats.fileCount,
        total_bytes:        r2Stats.totalBytes,
        total_mb:           Math.round((r2Stats.totalBytes / 1024 / 1024) * 100) / 100,
        total_gb:           Math.round((r2Stats.totalBytes / 1024 / 1024 / 1024) * 10000) / 10000,
        top_uploaders:      r2TopUploaders,
        top_conversations:  r2TopConversations,
      },
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
// Hard delete irreversibile di un utente (solo super_admin).
//
// Elimina completamente il record utente e tutti i dati associati:
//   - signal_key_bundles, sessions, push_subscriptions
//   - conversationmembers, blocks, recovery_contacts, media
//   - il documento utente stesso
//
// I messaggi storici vengono preservati (Forward Secrecy): il sender_id
// rimane invariato ma il client mostra "Account eliminato" quando non
// riesce a risolvere il profilo mittente.
//
// Username ed email vengono liberati per essere riutilizzati.
// ---------------------------------------------------------------------------

router.delete("/users/:id", requireAdmin("super_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const objectId = new mongoose.Types.ObjectId(id);

    // 1. Verifica che l'utente esista
    const user = await UserModel.findById(id).select("username email status").lean();
    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    // 2. Elimina tutti i dati associati (best-effort sequenziale con log errori)
    // Nota: le WebSocket attive cadranno al prossimo heartbeat dopo la revoca delle sessioni.
    const errors: string[] = [];

    const deleteStep = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { errors.push(`${label}: ${String(e)}`); }
    };

    await deleteStep("signal_key_bundles", () =>
      SignalKeyBundleModel.deleteMany({ user_id: objectId }));

    await deleteStep("sessions", () =>
      SessionModel.deleteMany({ user_id: objectId }));

    await deleteStep("push_subscriptions", () =>
      PushSubscriptionModel.deleteMany({ user_id: objectId }));

    await deleteStep("conversation_members", () =>
      ConversationMemberModel.deleteMany({ user_id: objectId }));

    await deleteStep("blocks_blocker", () =>
      BlockModel.deleteMany({ blocker_id: objectId }));

    await deleteStep("blocks_blocked", () =>
      BlockModel.deleteMany({ blocked_id: objectId }));

    await deleteStep("recovery_contacts", () =>
      RecoveryContactModel.deleteMany({ user_id: objectId }));

    await deleteStep("media_uploader", () =>
      MediaModel.deleteMany({ uploader_id: objectId }));

    // 4. Elimina il documento utente (libera username + email)
    await UserModel.findByIdAndDelete(id);

    logAuditEvent({
      event: "ACCOUNT_DELETED",
      user_id: id,
      device_id: "admin-panel",
      request_id: req.adminUser?.userId,
      created_at: new Date().toISOString(),
      metadata: {
        admin_action: "hard_delete",
        username: user.username,
        partial_errors: errors.length > 0 ? errors : undefined,
      },
    });

    res.json({
      id,
      username: user.username,
      hard_deleted: true,
      partial_errors: errors.length > 0 ? errors : null,
    });
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
// POST /admin/users/:id/temp-password
// Genera una password temporanea per un utente (supporto assistenza).
// La password in chiaro viene restituita UNA SOLA VOLTA — non viene mai salvata.
// ---------------------------------------------------------------------------

router.post("/users/:id/temp-password", requireAdmin("support"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;

    // Genera password casuale 12 caratteri — no ambigui (0/O, 1/l/I)
    const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let tempPassword = "";
    for (let i = 0; i < 12; i++) {
      tempPassword += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    }

    const hash = await argon2.hash(tempPassword, { type: argon2.argon2id });

    const user = await UserModel.findByIdAndUpdate(
      id,
      {
        password_hash: hash,
        require_password_change: true,
        temp_password_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      },
      { new: true },
    ).select("username display_name");

    if (!user) throw new AppError("USER_NOT_FOUND", 404);

    logAuditEvent({
      event: "PASSWORD_CHANGED",
      user_id: id,
      device_id: "admin-panel",
      request_id: req.adminUser?.userId,
      created_at: new Date().toISOString(),
      metadata: { admin_action: "temp_password_set" },
    });

    res.json({ username: user.username, temp_password: tempPassword });
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
// GET /admin/call-metrics
// Contatori in-memory delle chiamate WebRTC (reset a ogni riavvio server).
// ---------------------------------------------------------------------------
router.get("/call-metrics", requireAdmin("read_only"), (_req: Request, res: Response) => {
  res.json({ ok: true, data: callMetrics.snapshot() });
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

// ── Call Diagnostics Center ────────────────────────────────────────────────────

router.get("/diagnostics/health", requireAdmin("read_only"), async (req, res, next) => {
  try {
    const now        = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000);

    const [totalEvents, recentEvents, lastEvent] = await Promise.all([
      DiagnosticEventModel.estimatedDocumentCount(),
      DiagnosticEventModel.countDocuments({ created_at: { $gte: oneHourAgo } }),
      DiagnosticEventModel.findOne().sort({ created_at: -1 }).select("username event created_at").lean(),
    ]);

    res.json({
      status:           "ok",
      total_events:     totalEvents,
      events_last_hour: recentEvents,
      last_event:       lastEvent ? {
        username:    lastEvent.username,
        event:       lastEvent.event,
        created_at:  lastEvent.created_at.toISOString(),
        age_seconds: Math.round((now.getTime() - lastEvent.created_at.getTime()) / 1000),
      } : null,
      collection: "diagnostic_events",
    });
  } catch (err) { next(err); }
});

router.get("/diagnostics/events", requireAdmin("read_only"), async (req, res, next) => {
  try {
    const page   = qsInt(req.query.page, 1);
    const limit  = Math.min(qsInt(req.query.limit, 50), 200);
    const skip   = (page - 1) * limit;
    const callId = qs(req.query.call_id);
    const uname  = qs(req.query.username);
    const userId = qs(req.query.user_id);
    const evType = qs(req.query.event_type);
    const q      = qs(req.query.q);
    const since  = qs(req.query.since) ?? "1h";

    const hoursMap: Record<string, number> = { "15m": 0.25, "1h": 1, "6h": 6, "24h": 24, "7d": 168 };
    // Bug fix #1: when a specific call_id is requested, never restrict by time —
    // the call may have happened hours/days ago and would return 0 inside the default 1h window.
    const skipDateFilter = !!callId;
    const fromDate = new Date(Date.now() - (hoursMap[since] ?? 1) * 3600 * 1000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = skipDateFilter ? {} : { created_at: { $gte: fromDate } };
    if (callId) filter.call_id  = callId;  // exact UUID match on indexed field
    if (uname)  filter.username = new RegExp(uname, "i");
    if (evType) filter.event    = new RegExp(evType, "i");

    // Bug fix #2: user_id filter — accepts the 24-char hex ObjectId string
    if (userId) {
      try {
        filter.user_id = new mongoose.Types.ObjectId(userId);
      } catch {
        // invalid ObjectId string — ignore silently so the query still runs
      }
    }

    // Bug fix #3: free-text q now also searches payload fields (to, from, state, step)
    // so callee/caller ObjectId values visible in payload.to/from can be found.
    if (q) {
      const re = new RegExp(q, "i");
      filter.$or = [
        { event:           re },
        { username:        re },
        { call_id:         re },
        { "payload.to":    re },
        { "payload.from":  re },
        { "payload.state": re },
        { "payload.step":  re },
        { "payload.error": re },
      ];
    }

    const [total, events] = await Promise.all([
      DiagnosticEventModel.countDocuments(filter),
      DiagnosticEventModel.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    ]);

    res.json({
      page, limit, total, pages: Math.ceil(total / limit),
      events: events.map((e) => ({
        id: e._id.toString(), user_id: e.user_id.toString(), username: e.username,
        session_id: e.session_id, call_id: e.call_id, event: e.event,
        payload: e.payload, elapsed_ms: e.elapsed_ms, device: e.device,
        created_at: e.created_at.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

router.get("/diagnostics/calls", requireAdmin("read_only"), async (req, res, next) => {
  try {
    const since = qs(req.query.since) ?? "2h";
    const hoursMap: Record<string, number> = { "1h": 1, "2h": 2, "6h": 6, "24h": 24, "7d": 168 };
    const fromDate = new Date(Date.now() - (hoursMap[since] ?? 2) * 3600 * 1000);

    const groups = await DiagnosticEventModel.aggregate([
      { $match: { created_at: { $gte: fromDate }, call_id: { $ne: null, $exists: true } } },
      { $group: {
        _id: "$call_id",
        participants: { $addToSet: "$username" },
        event_count:  { $sum: 1 },
        first_event_at: { $min: "$created_at" },
        last_event_at:  { $max: "$created_at" },
        events_list: { $push: { event: "$event", payload: "$payload", ts: "$created_at" } },
      }},
      { $sort: { last_event_at: -1 } },
      { $limit: 50 },
    ]);

    const calls = groups.map((g) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted = ((g.events_list as any[]) ?? []).sort((a: any, b: any) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const last   = sorted[sorted.length - 1] as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iceLast  = [...sorted].reverse().find((e: any) => e.event === "ice.state");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pcLast   = [...sorted].reverse().find((e: any) => e.event === "pc.state");
      const wsConnected = sorted.some((e: { event: string }) => e.event === "ws.auth.ok");
      const wsClosed    = sorted.some((e: { event: string }) => e.event === "ws.close");
      const dur = (g.last_event_at as Date).getTime() - (g.first_event_at as Date).getTime();
      return {
        call_id: g._id as string,
        participants: g.participants as string[],
        event_count: g.event_count as number,
        first_event_at: (g.first_event_at as Date).toISOString(),
        last_event_at:  (g.last_event_at  as Date).toISOString(),
        last_event:  last?.event ?? null,
        duration_ms: dur > 0 ? dur : null,
        ws_state:    wsClosed ? "closed" : wsConnected ? "connected" : null,
        ice_state:   iceLast?.payload?.state ?? null,
        pc_state:    pcLast?.payload?.state  ?? null,
        has_cleanup: sorted.some((e: { event: string }) => e.event === "call.cleanup"),
      };
    });

    res.json({ since, calls });
  } catch (err) { next(err); }
});

router.get("/diagnostics/timeline/:callId", requireAdmin("read_only"), async (req, res, next) => {
  try {
    const events = await DiagnosticEventModel.find({ call_id: req.params.callId })
      .sort({ created_at: 1 }).limit(500).lean();

    // Determine caller/callee from events
    const offerEvent = events.find(e => e.event === "call.offer.sent");
    const callerUserId = offerEvent?.user_id?.toString() ?? null;
    const calleeUserIdFromPayload =
      (offerEvent?.payload as Record<string, unknown> | undefined)?.to as string | undefined ?? null;

    // Find participants in this call
    const participantUserIds = [...new Set(events.map(e => e.user_id?.toString()).filter(Boolean))];

    // Callee = in payload "to" OR someone in the call who isn't the caller
    const calleeUserIdActual =
      calleeUserIdFromPayload ??
      participantUserIds.find(id => id !== callerUserId) ??
      null;

    // Callee status: look up their most recent event (any call) in the last 7 days
    let callee_info: {
      user_id: string | null;
      has_any_events: boolean;
      total_events_ever: number;
      last_event_at: string | null;
      last_event_age_seconds: number | null;
      has_events_this_call: boolean;
    } = {
      user_id: calleeUserIdActual,
      has_any_events: false,
      total_events_ever: 0,
      last_event_at: null,
      last_event_age_seconds: null,
      has_events_this_call: false,
    };

    if (calleeUserIdActual) {
      const hasEventsThisCall = participantUserIds.includes(calleeUserIdActual);
      const [countResult, lastEvent] = await Promise.all([
        DiagnosticEventModel.countDocuments({ user_id: calleeUserIdActual }),
        DiagnosticEventModel.findOne({ user_id: calleeUserIdActual })
          .sort({ created_at: -1 }).select("created_at").lean(),
      ]);
      const lastAt = lastEvent?.created_at ?? null;
      callee_info = {
        user_id: calleeUserIdActual,
        has_any_events: countResult > 0,
        total_events_ever: countResult,
        last_event_at: lastAt ? lastAt.toISOString() : null,
        last_event_age_seconds: lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 1000) : null,
        has_events_this_call: hasEventsThisCall,
      };
    }

    res.json({
      call_id: req.params.callId,
      event_count: events.length,
      callee_info,
      events: events.map((e, i) => ({
        id: e._id.toString(), username: e.username, event: e.event,
        payload: e.payload, elapsed_ms: e.elapsed_ms, device: e.device,
        created_at: e.created_at.toISOString(),
        gap_ms: i > 0 ? e.created_at.getTime() - events[i - 1].created_at.getTime() : 0,
      })),
    });
  } catch (err) { next(err); }
});

router.get("/diagnostics/metrics", requireAdmin("read_only"), async (req, res, next) => {
  try {
    const range = qs(req.query.range) ?? "24h";
    const hoursMap: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720 };
    const fromDate = new Date(Date.now() - (hoursMap[range] ?? 24) * 3600 * 1000);

    const [totals, topEvents, byDay] = await Promise.all([
      DiagnosticEventModel.aggregate([
        { $match: { created_at: { $gte: fromDate } } },
        { $group: { _id: null,
          total_events:    { $sum: 1 },
          ws_errors:       { $sum: { $cond: [{ $eq: ["$event", "ws.error"]              }, 1, 0] } },
          ws_closes:       { $sum: { $cond: [{ $eq: ["$event", "ws.close"]              }, 1, 0] } },
          call_offers:     { $sum: { $cond: [{ $eq: ["$event", "call.offer.sent"]       }, 1, 0] } },
          call_retries:    { $sum: { $cond: [{ $eq: ["$event", "call.offer.retry"]      }, 1, 0] } },
          call_cleanups:   { $sum: { $cond: [{ $eq: ["$event", "call.cleanup"]          }, 1, 0] } },
          accept_timeouts: { $sum: { $cond: [{ $eq: ["$event", "accept.timeout"]        }, 1, 0] } },
          accept_errors:   { $sum: { $cond: [{ $eq: ["$event", "accept.error"]          }, 1, 0] } },
          accept_complete: { $sum: { $cond: [{ $eq: ["$event", "accept.complete"]       }, 1, 0] } },
          spinner_safety:  { $sum: { $cond: [{ $eq: ["$event", "spinner.stop.safety_net"]}, 1, 0] } },
          gum_starts:      { $sum: { $cond: [{ $eq: ["$event", "getUserMedia.start"]    }, 1, 0] } },
          gum_oks:         { $sum: { $cond: [{ $eq: ["$event", "getUserMedia.ok"]       }, 1, 0] } },
        }},
      ]),
      DiagnosticEventModel.aggregate([
        { $match: { created_at: { $gte: fromDate } } },
        { $group: { _id: "$event", count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 15 },
        { $project: { event: "$_id", count: 1, _id: 0 } },
      ]),
      DiagnosticEventModel.aggregate([
        { $match: { created_at: { $gte: fromDate } } },
        { $group: {
          _id:    { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          events: { $sum: 1 },
          calls:  { $sum: { $cond: [{ $eq: ["$event", "call.offer.sent"] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $in: ["$event", ["accept.error", "accept.timeout", "ws.error"]] }, 1, 0] } },
        }},
        { $sort: { _id: 1 } },
        { $project: { date: "$_id", events: 1, calls: 1, errors: 1, _id: 0 } },
      ]),
    ]);

    const t = (totals[0] as Record<string, number> | undefined) ?? {};
    res.json({
      range,
      total_events:    t.total_events    ?? 0,
      ws_errors:       t.ws_errors       ?? 0,
      ws_closes:       t.ws_closes       ?? 0,
      call_offers:     t.call_offers     ?? 0,
      call_retries:    t.call_retries    ?? 0,
      call_cleanups:   t.call_cleanups   ?? 0,
      accept_timeouts: t.accept_timeouts ?? 0,
      accept_errors:   t.accept_errors   ?? 0,
      accept_complete: t.accept_complete ?? 0,
      spinner_safety:  t.spinner_safety  ?? 0,
      gum_errors:      (t.gum_starts ?? 0) - (t.gum_oks ?? 0),
      top_events: topEvents,
      by_day:     byDay,
    });
  } catch (err) { next(err); }
});

router.get("/diagnostics/export", requireAdmin("read_only"), async (req, res, next) => {
  try {
    const callId = qs(req.query.call_id);
    const uname  = qs(req.query.username);
    const since  = qs(req.query.since) ?? "24h";
    const hoursMap: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 168 };
    const fromDate = new Date(Date.now() - (hoursMap[since] ?? 24) * 3600 * 1000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = { created_at: { $gte: fromDate } };
    if (callId) filter.call_id  = callId;
    if (uname)  filter.username = uname;

    const events = await DiagnosticEventModel.find(filter)
      .sort({ created_at: 1 }).limit(5000).lean();

    const payload = {
      exported_at: new Date().toISOString(),
      event_count: events.length,
      filters: { call_id: callId ?? null, username: uname ?? null, since },
      events: events.map((e) => ({
        id: e._id.toString(), username: e.username, session_id: e.session_id,
        call_id: e.call_id, event: e.event, payload: e.payload,
        elapsed_ms: e.elapsed_ms, device: e.device, created_at: e.created_at.toISOString(),
      })),
    };

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="diag-${date}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) { next(err); }
});

// =============================================================================
// Cloudflare R2 Monitoring Center
// =============================================================================

// ---------------------------------------------------------------------------
// GET /admin/r2/dashboard — storage breakdown, growth, analytics, cost forecast
// ---------------------------------------------------------------------------
router.get("/r2/dashboard", requireAdmin("support"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Serve dalla cache se valida (60s)
    if (_r2DashboardCache && Date.now() < _r2DashboardCache.expires) {
      res.json(_r2DashboardCache.data);
      return;
    }

    const now = new Date();
    const yesterday     = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);

    const typeExpr = {
      $switch: {
        branches: [
          { case: { $eq: [{ $substrCP: ["$mime_type", 0, 6] }, "image/"] }, then: "image" },
          { case: { $eq: [{ $substrCP: ["$mime_type", 0, 6] }, "video/"] }, then: "video" },
          { case: { $eq: [{ $substrCP: ["$mime_type", 0, 6] }, "audio/"] }, then: "audio" },
        ],
        default: "document",
      },
    };

    const [typeBreakdown, growth, analytics24h, totalStats, pricingDoc, classBCount] = await Promise.all([
      MediaModel.aggregate([
        { $group: { _id: typeExpr, count: { $sum: 1 }, bytes: { $sum: "$ciphertextSize" } } },
        { $project: { type: "$_id", count: 1, bytes: 1, _id: 0 } },
        { $sort: { bytes: -1 } },
      ]),
      MediaModel.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, uploads: { $sum: 1 }, bytes: { $sum: "$ciphertextSize" } } },
        { $sort: { _id: 1 } },
        { $project: { date: "$_id", uploads: 1, bytes: 1, _id: 0 } },
      ]),
      MediaModel.aggregate([
        { $match: { createdAt: { $gte: yesterday } } },
        { $group: { _id: typeExpr, count: { $sum: 1 }, bytes: { $sum: "$ciphertextSize" } } },
        { $project: { type: "$_id", count: 1, bytes: 1, _id: 0 } },
      ]),
      MediaModel.aggregate([{ $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: "$ciphertextSize" } } }]),
      R2PricingConfigModel.findById("default").lean(),
      // Class B: SIGNED_URL events this month (0 until R2EventModel accumulates data)
      R2EventModel.countDocuments({ event_type: "SIGNED_URL", status: "success", created_at: { $gte: thirtyDaysAgo } }),
    ]);

    const pricing = pricingDoc ?? R2_PRICING_DEFAULTS;

    const totalCount    = (totalStats[0] as { count: number }  | undefined)?.count ?? 0;
    const totalBytes    = (totalStats[0] as { bytes: number }  | undefined)?.bytes ?? 0;
    const totalStorageGB = totalBytes / 1024 / 1024 / 1024;

    // Class A = total uploads; Class B = logged SIGNED_URL ops (fallback 3× uploads)
    const classAOps = totalCount;
    const classBOps = classBCount > 0 ? classBCount : classAOps * 3;

    // ── Cost calculator ───────────────────────────────────────────────────────
    function calcCost(storageGB: number, classA: number, classB: number) {
      const billableGB   = Math.max(0, storageGB - pricing.free_storage_gb);
      const storageCost  = billableGB * pricing.storage_price_per_gb;
      const billableA    = Math.max(0, classA  - pricing.free_class_a);
      const classACost   = (billableA / 1_000_000) * pricing.class_a_price_per_million;
      const billableB    = Math.max(0, classB  - pricing.free_class_b);
      const classBCost   = (billableB / 1_000_000) * pricing.class_b_price_per_million;
      const total        = storageCost + classACost + classBCost;
      return {
        storage_cost:       parseFloat(storageCost.toFixed(4)),
        class_a_cost:       parseFloat(classACost.toFixed(4)),
        class_b_cost:       parseFloat(classBCost.toFixed(4)),
        egress_cost:        0,
        total_cost:         parseFloat(total.toFixed(4)),
        billable_storage_gb: parseFloat(billableGB.toFixed(4)),
        billable_class_a:   billableA,
        billable_class_b:   billableB,
      };
    }

    const current       = calcCost(totalStorageGB, classAOps, classBOps);
    const freeTierPct   = totalStorageGB > 0 ? (totalStorageGB / pricing.free_storage_gb) * 100 : 0;
    const remainingFreeGB = Math.max(0, pricing.free_storage_gb - totalStorageGB);

    // ── Forecast ──────────────────────────────────────────────────────────────
    const recentPoints  = (growth as Array<{ bytes: number }>).slice(-7);
    const avgDailyBytes = recentPoints.length > 0
      ? recentPoints.reduce((s, g) => s + g.bytes, 0) / recentPoints.length
      : 0;
    const avgDailyGB = avgDailyBytes / 1024 / 1024 / 1024;
    const daysToFreeLimit = avgDailyGB > 0 && remainingFreeGB > 0
      ? Math.ceil(remainingFreeGB / avgDailyGB)
      : null;

    const payload = {
      totals:       { count: totalCount, bytes: totalBytes, gb: totalStorageGB },
      type_breakdown: typeBreakdown,
      growth_30d:   growth,
      analytics_24h: analytics24h,
      cost_forecast: {
        pricing: {
          free_storage_gb:           pricing.free_storage_gb,
          storage_price_per_gb:      pricing.storage_price_per_gb,
          free_class_a:              pricing.free_class_a,
          class_a_price_per_million: pricing.class_a_price_per_million,
          free_class_b:              pricing.free_class_b,
          class_b_price_per_million: pricing.class_b_price_per_million,
          egress_price_per_gb:       pricing.egress_price_per_gb,
        },
        storage_gb:             parseFloat(totalStorageGB.toFixed(4)),
        free_storage_gb:        pricing.free_storage_gb,
        free_tier_pct:          parseFloat(Math.min(freeTierPct, 999).toFixed(2)),
        is_free_tier:           current.total_cost === 0,
        ...current,
        class_a_ops:            classAOps,
        class_b_ops:            classBOps,
        class_b_from_log:       classBCount > 0,
        egress_gb:              0,
        free_tier_remaining_gb: parseFloat(remainingFreeGB.toFixed(4)),
        avg_daily_gb:           parseFloat(avgDailyGB.toFixed(6)),
        days_to_free_limit:     daysToFreeLimit,
        forecast_30d_gb:        parseFloat((totalStorageGB + avgDailyGB * 30).toFixed(4)),
        forecast_90d_gb:        parseFloat((totalStorageGB + avgDailyGB * 90).toFixed(4)),
        forecast_365d_gb:       parseFloat((totalStorageGB + avgDailyGB * 365).toFixed(4)),
        forecast_30d_cost:      calcCost(totalStorageGB + avgDailyGB * 30,  classAOps, classBOps).total_cost,
        forecast_90d_cost:      calcCost(totalStorageGB + avgDailyGB * 90,  classAOps, classBOps).total_cost,
        forecast_365d_cost:     calcCost(totalStorageGB + avgDailyGB * 365, classAOps, classBOps).total_cost,
      },
    };

    _r2DashboardCache = { data: payload, expires: Date.now() + 60_000 };
    res.json(payload);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/r2/pricing — leggi configurazione prezzi
// ---------------------------------------------------------------------------
router.get("/r2/pricing", requireAdmin("support"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cfg = await R2PricingConfigModel.findById("default").lean();
    res.json(cfg ?? R2_PRICING_DEFAULTS);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PUT /admin/r2/pricing — aggiorna prezzi (solo super_admin)
// ---------------------------------------------------------------------------
router.put("/r2/pricing", requireAdmin("super_admin"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fields = [
      "free_storage_gb", "storage_price_per_gb",
      "free_class_a", "class_a_price_per_million",
      "free_class_b", "class_b_price_per_million",
      "egress_price_per_gb",
    ] as const;

    const update: Record<string, number> = {};
    for (const f of fields) {
      const v = req.body[f];
      if (v != null) {
        const n = Number(v);
        if (isNaN(n) || n < 0) {
          res.status(400).json({ error: `Campo non valido: ${f}` });
          return;
        }
        update[f] = n;
      }
    }

    const updated = await R2PricingConfigModel.findOneAndUpdate(
      { _id: "default" },
      {
        ...update,
        updated_at: new Date(),
        updated_by: (req.user as unknown as { userId?: string })?.userId ?? "unknown",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Invalida cache dashboard
    _r2DashboardCache = null;

    res.json(updated);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/r2/health — ping bucket + consecutive errors + last auto-check
// ---------------------------------------------------------------------------
router.get("/r2/health", requireAdmin("support"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const start = Date.now();
    let connected = false;
    let errorMsg: string | null = null;

    try {
      await r2.send(new HeadObjectCommand({ Bucket: config.r2.bucket, Key: "_health_check_sentinel" }));
      connected = true;
    } catch (err: unknown) {
      const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (httpStatus === 404) {
        connected = true;
      } else {
        errorMsg = (err as Error).message ?? String(err);
      }
    }

    const latencyMs = Date.now() - start;
    const bucketStatus = !connected ? "offline" : latencyMs > 2000 ? "warning" : "healthy";

    // consecutive_errors: conta errori HEALTH_CHECK consecutivi a partire dall'ultimo
    const recentChecks = await R2EventModel
      .find({ event_type: "HEALTH_CHECK" })
      .sort({ created_at: -1 })
      .limit(20)
      .lean();

    let consecutiveErrors = 0;
    for (const hc of recentChecks) {
      if (hc.status === "error") consecutiveErrors++;
      else break;
    }
    const lastAutoCheck = recentChecks[0]?.created_at?.toISOString() ?? null;

    res.json({
      connected,
      status:              bucketStatus,
      latency_ms:          latencyMs,
      bucket:              config.r2.bucket,
      endpoint:            config.r2.endpoint,
      checked_at:          new Date().toISOString(),
      last_auto_check:     lastAutoCheck,
      consecutive_errors:  consecutiveErrors,
      ...(errorMsg ? { error: errorMsg } : {}),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/r2/encryption — audit cifratura su tutti i file
// ---------------------------------------------------------------------------
router.get("/r2/encryption", requireAdmin("support"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [versionBreakdown, missingHash, totalCount] = await Promise.all([
      MediaModel.aggregate([
        { $group: { _id: "$encryptionVersion", count: { $sum: 1 } } },
        { $project: { version: "$_id", count: 1, _id: 0 } },
        { $sort: { version: 1 } },
      ]),
      MediaModel.countDocuments({ $or: [{ sha256: { $exists: false } }, { sha256: "" }, { sha256: null }] }),
      MediaModel.countDocuments({}),
    ]);

    const v1Count    = (versionBreakdown as Array<{ version: number; count: number }>).find((v) => v.version === 1)?.count ?? 0;
    const unversioned = totalCount - v1Count;
    const v1Pct      = totalCount > 0 ? ((v1Count / totalCount) * 100).toFixed(2) : "0.00";

    res.json({
      total_files:       totalCount,
      encryption_algo:   "AES-256-GCM",
      version_breakdown: versionBreakdown,
      v1_count:          v1Count,
      v1_pct:            parseFloat(v1Pct),
      unversioned_count: unversioned,
      missing_hash_count: missingHash,
      all_encrypted:     unversioned === 0 && missingHash === 0,
      verdict:           unversioned === 0 && missingHash === 0 ? "ALL_ENCRYPTED" : "ISSUES_FOUND",
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/r2/top-users — top 20 utenti per storage consumato
// ---------------------------------------------------------------------------
router.get("/r2/top-users", requireAdmin("support"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const topUsers = await MediaModel.aggregate([
      {
        $group: {
          _id:    "$uploader_id",
          bytes:  { $sum: "$ciphertextSize" },
          total:  { $sum: 1 },
          images: { $sum: { $cond: [{ $eq: [{ $substrCP: ["$mime_type", 0, 6] }, "image/"] }, 1, 0] } },
          videos: { $sum: { $cond: [{ $eq: [{ $substrCP: ["$mime_type", 0, 6] }, "video/"] }, 1, 0] } },
          audio:  { $sum: { $cond: [{ $eq: [{ $substrCP: ["$mime_type", 0, 6] }, "audio/"] }, 1, 0] } },
        },
      },
      { $sort: { bytes: -1 } },
      { $limit: 20 },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" } },
      { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id:      0,
          username: { $ifNull: ["$u.username", "—"] },
          bytes:    1,
          gb:       { $round: [{ $divide: ["$bytes", 1073741824] }, 4] },
          total:    1,
          images:   1,
          videos:   1,
          audio:    1,
        },
      },
    ]);

    res.json({ users: topUsers, total: topUsers.length });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/r2/activity — ultimi 50 eventi R2 (polling Live Activity)
// ---------------------------------------------------------------------------
router.get("/r2/activity", requireAdmin("support"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await R2EventModel
      .find({})
      .sort({ created_at: -1 })
      .limit(50)
      .populate("uploader_id", "username")
      .lean();

    const out = events.map((e) => ({
      id:           (e._id as { toString(): string }).toString(),
      event_type:   e.event_type,
      status:       e.status,
      uploader:     (e.uploader_id as unknown as { username?: string } | null)?.username ?? null,
      storage_key:  e.storage_key,
      file_size:    e.file_size,
      mime_type:    e.mime_type,
      filename:     e.filename,
      duration_ms:  e.duration_ms,
      error_message: e.error_message,
      created_at:   e.created_at.toISOString(),
    }));

    res.json({ events: out, total: out.length });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/r2/errors — ultimi 50 errori R2 (Error Center)
// ---------------------------------------------------------------------------
router.get("/r2/errors", requireAdmin("support"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = await R2EventModel
      .find({ status: "error" })
      .sort({ created_at: -1 })
      .limit(50)
      .populate("uploader_id", "username")
      .lean();

    const out = errors.map((e) => ({
      id:            (e._id as { toString(): string }).toString(),
      event_type:    e.event_type,
      uploader:      (e.uploader_id as unknown as { username?: string } | null)?.username ?? null,
      storage_key:   e.storage_key,
      file_size:     e.file_size,
      mime_type:     e.mime_type,
      filename:      e.filename,
      duration_ms:   e.duration_ms,
      error_message: e.error_message,
      error_code:    e.error_code,
      created_at:    e.created_at.toISOString(),
    }));

    res.json({ errors: out, total: out.length });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/r2/search — ricerca file per ID, username, conversazione, tipo
// ---------------------------------------------------------------------------
router.get("/r2/search", requireAdmin("support"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const qs = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
    const mediaId      = qs(req.query["media_id"]);
    const username     = qs(req.query["username"]);
    const conversId    = qs(req.query["conversation_id"]);
    const fileType     = qs(req.query["type"]);     // image | video | audio | document
    const since        = qs(req.query["since"]);
    const until        = qs(req.query["until"]);
    const minSize      = qs(req.query["min_size"]);
    const maxSize      = qs(req.query["max_size"]);
    const page         = Math.max(1, parseInt(String(req.query["page"] ?? "1")));
    const limit        = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "20"))));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: Record<string, any> = {};

    if (mediaId && /^[0-9a-fA-F]{24}$/.test(mediaId)) {
      query["_id"] = new mongoose.Types.ObjectId(mediaId);
    }
    if (conversId && /^[0-9a-fA-F]{24}$/.test(conversId)) {
      query["conversation_id"] = new mongoose.Types.ObjectId(conversId);
    }
    if (fileType) {
      const mimeMap: Record<string, RegExp> = {
        image:    /^image\//,
        video:    /^video\//,
        audio:    /^audio\//,
        document: /^application\//,
      };
      if (mimeMap[fileType]) query["mime_type"] = { $regex: mimeMap[fileType] };
    }
    if (since || until) {
      query["createdAt"] = {};
      if (since) query["createdAt"]["$gte"] = new Date(since);
      if (until) query["createdAt"]["$lte"] = new Date(until);
    }
    if (minSize || maxSize) {
      query["ciphertextSize"] = {};
      if (minSize) query["ciphertextSize"]["$gte"] = parseInt(minSize);
      if (maxSize) query["ciphertextSize"]["$lte"] = parseInt(maxSize);
    }
    if (username) {
      const user = await UserModel.findOne({ username }, "_id");
      if (!user) {
        res.json({ files: [], total: 0, page, limit });
        return;
      }
      query["uploader_id"] = user._id;
    }

    const skip = (page - 1) * limit;
    const [total, files] = await Promise.all([
      MediaModel.countDocuments(query),
      MediaModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("uploader_id", "username")
        .lean(),
    ]);

    const filesOut = files.map((f) => ({
      media_id:          f._id.toString(),
      uploader:          (f.uploader_id as unknown as { username?: string } | null)?.username ?? "—",
      conversation_id:   f.conversation_id.toString(),
      mime_type:         f.mime_type,
      original_filename: f.original_filename,
      storage_key:       f.storageKey,
      sha256:            f.sha256,
      ciphertext_size:   f.ciphertextSize,
      encryption_ver:    f.encryptionVersion,
      has_thumbnail:     !!f.thumbnailKey,
      uploaded_at:       f.uploadedAt?.toISOString() ?? f.createdAt.toISOString(),
    }));

    res.json({ files: filesOut, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /admin/r2/cleanup — esegui cleanup temp/ manuale
// ---------------------------------------------------------------------------
router.post("/r2/cleanup", requireAdmin("security_admin"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const start = Date.now();
    const deleted = await cleanupTempObjects();
    res.json({
      deleted,
      duration_ms: Date.now() - start,
      ran_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /admin/r2/consistency — verifica integrità MongoDB ↔ R2
// ---------------------------------------------------------------------------
router.post("/r2/consistency", requireAdmin("super_admin"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const checkedAt = new Date().toISOString();
    const start = Date.now();

    // 1. Tutti i MongoDB media docs
    const mongoMedia = await MediaModel.find(
      {},
      "storageKey thumbnailKey sha256 ciphertextSize mime_type createdAt",
    ).lean();

    const mongoMainKeys  = new Set(mongoMedia.map((m) => m.storageKey));
    const mongoThumbKeys = new Set(mongoMedia.filter((m) => m.thumbnailKey).map((m) => m.thumbnailKey!));
    const allMongoKeys   = new Set([...mongoMainKeys, ...mongoThumbKeys]);

    // 2. Tutti gli oggetti R2 (paginati, max 30s)
    const r2Keys = new Set<string>();
    let continuationToken: string | undefined;
    do {
      const resp = await r2.send(new ListObjectsV2Command({
        Bucket:            config.r2.bucket,
        ContinuationToken: continuationToken,
        MaxKeys:           1000,
      }));
      for (const obj of (resp.Contents ?? [])) {
        if (obj.Key) r2Keys.add(obj.Key);
      }
      continuationToken = resp.IsTruncated ? (resp.NextContinuationToken ?? undefined) : undefined;
      // Safety: max 30s
      if (Date.now() - start > 29_000) break;
    } while (continuationToken);

    // 3. Analisi
    // File orfani in R2 (non in MongoDB, fuori da temp/)
    const orphansInR2 = [...r2Keys]
      .filter((k) => !allMongoKeys.has(k) && !k.startsWith("temp/"));

    // File mancanti in R2 (in MongoDB ma non in R2)
    const missingInR2 = mongoMedia.filter((m) => !r2Keys.has(m.storageKey));

    // Thumbnail mancanti in R2
    const missingThumbs = mongoMedia.filter((m) => m.thumbnailKey && !r2Keys.has(m.thumbnailKey));

    res.json({
      checked_at:            checkedAt,
      duration_ms:           Date.now() - start,
      r2_truncated:          !!continuationToken, // true se il listing è stato interrotto per timeout
      total_mongodb_docs:    mongoMedia.length,
      total_r2_objects:      r2Keys.size,
      orphans_in_r2_count:   orphansInR2.length,
      missing_in_r2_count:   missingInR2.length,
      missing_thumbs_count:  missingThumbs.length,
      // Dettaglio (max 50 per non sovraccaricare)
      orphan_keys:           orphansInR2.slice(0, 50),
      missing_media: missingInR2.slice(0, 50).map((m) => ({
        media_id:    m._id.toString(),
        storage_key: m.storageKey,
        mime_type:   m.mime_type,
        uploaded_at: (m.uploadedAt ?? m.createdAt).toISOString(),
      })),
      verdict: orphansInR2.length === 0 && missingInR2.length === 0
        ? "CONSISTENT"
        : "INCONSISTENCIES_FOUND",
    });
  } catch (err) { next(err); }
});

// ── Gas Station Monitor ────────────────────────────────────────────────────────
import { GasStationLogModel } from "../../models/gas-station-log.model";
import { getGasStationInfo }  from "../../payment/usda-custodial.service";
import { createPublicClient, http, formatEther } from "viem";
import { mainnet as _ethMainnet, bsc as _bscChain } from "viem/chains";

/**
 * GET /admin/gas-station
 * Saldo MATIC/ETH/BNB + indirizzo gas station + storico top-up (ultimi 50).
 * La stessa chiave GAS_STATION_PRIVATE_KEY è usata per tutte le reti EVM.
 */
router.get("/gas-station", requireAdmin("read_only"), async (_req, res, next) => {
  try {
    const [info, logs] = await Promise.all([
      getGasStationInfo().catch(() => null),
      GasStationLogModel.find().sort({ created_at: -1 }).limit(50).lean(),
    ]);

    // Fetch ETH and BSC native balances (stesso indirizzo GAS_STATION per tutte le reti)
    let balance_eth: string | null = null;
    let balance_bnb: string | null = null;
    let low_balance_eth = false;
    let low_balance_bnb = false;

    if (info?.address) {
      const addr = info.address as `0x${string}`;
      const ETH_LOW_THRESHOLD = 50_000_000_000_000_000n;  // 0.05 ETH
      const BNB_LOW_THRESHOLD = 100_000_000_000_000_000n; // 0.10 BNB

      const [ethResult, bscResult] = await Promise.allSettled([
        (async () => {
          const ethRpc = process.env.ETHEREUM_RPC_URL ?? "https://ethereum.publicnode.com";
          const client = createPublicClient({ chain: _ethMainnet, transport: http(ethRpc, { timeout: 8_000 }) });
          const bal = await client.getBalance({ address: addr });
          return { balance: formatEther(bal), low: bal < ETH_LOW_THRESHOLD };
        })(),
        (async () => {
          const bscRpc = process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org";
          const client = createPublicClient({ chain: _bscChain, transport: http(bscRpc, { timeout: 8_000 }) });
          const bal = await client.getBalance({ address: addr });
          return { balance: formatEther(bal), low: bal < BNB_LOW_THRESHOLD };
        })(),
      ]);

      if (ethResult.status === "fulfilled") {
        balance_eth     = ethResult.value.balance;
        low_balance_eth = ethResult.value.low;
      }
      if (bscResult.status === "fulfilled") {
        balance_bnb     = bscResult.value.balance;
        low_balance_bnb = bscResult.value.low;
      }
    }

    res.json({
      configured:      !!info,
      address:         info?.address         ?? null,
      balance_matic:   info?.balance_matic   ?? "0",
      low_balance:     info?.low_balance     ?? false,
      threshold_matic: "10",
      balance_eth,
      balance_bnb,
      low_balance_eth,
      low_balance_bnb,
      threshold_eth:   "0.05",
      threshold_bnb:   "0.1",
      transactions: logs.map((l) => ({
        escrow_wallet:    l.escrow_wallet,
        amount_matic:     l.amount_matic,
        tx_hash:          l.tx_hash,
        gs_balance_after: l.gs_balance_after,
        created_at:       l.created_at.toISOString(),
      })),
    });
  } catch (err) { next(err); }
});

// ── Call Monitor metrics — Sprint 30 ──────────────────────────────────────────
import { getCallMetrics } from "../../services/call-session.service";

router.get("/calls/metrics", requireAdmin("read_only"), async (_req, res, next) => {
  try {
    const metrics = await getCallMetrics();
    res.json(metrics);
  } catch (err) { next(err); }
});

// ── Admin Notification Settings — Email Toggles ───────────────────────────────
import { AdminSettingsModel, getAdminSettings } from "../../models/admin-settings.model";

/** GET /api/v1/admin/notification-settings — legge le preferenze email admin + feature flags */
router.get("/notification-settings", requireAdmin("read_only"), async (_req, res, next) => {
  try {
    const settings = await getAdminSettings();
    res.json({
      gas_station_emails:          settings.gas_station_emails,
      usda_emails:                 settings.usda_emails,
      registration_emails:         settings.registration_emails,
      multichain_emails:           settings.multichain_emails ?? true,
      multichain_payments_enabled: settings.multichain_payments_enabled ?? true,
      spark_lightning_enabled:     settings.spark_lightning_enabled     ?? false,
      updated_at:                  settings.updated_at ?? null,
      updated_by:                  settings.updated_by ?? null,
    });
  } catch (err) { next(err); }
});

/** PATCH /api/v1/admin/notification-settings — aggiorna uno o più toggle */
router.patch("/notification-settings", requireAdmin("super_admin"), async (req, res, next) => {
  try {
    const { gas_station_emails, usda_emails, registration_emails, multichain_emails, multichain_payments_enabled, spark_lightning_enabled } = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date(), updated_by: (req as unknown as { user?: { userId?: string } }).user?.userId };
    if (typeof gas_station_emails          === "boolean") update.gas_station_emails          = gas_station_emails;
    if (typeof usda_emails                  === "boolean") update.usda_emails                  = usda_emails;
    if (typeof registration_emails          === "boolean") update.registration_emails          = registration_emails;
    if (typeof multichain_emails            === "boolean") update.multichain_emails            = multichain_emails;
    if (typeof multichain_payments_enabled  === "boolean") update.multichain_payments_enabled  = multichain_payments_enabled;
    if (typeof spark_lightning_enabled      === "boolean") update.spark_lightning_enabled      = spark_lightning_enabled;

    const doc = await AdminSettingsModel.findOneAndUpdate(
      { _id: "default" },
      { $set: update },
      { upsert: true, returnDocument: "after" },
    );
    res.json({
      gas_station_emails:          doc!.gas_station_emails,
      usda_emails:                 doc!.usda_emails,
      registration_emails:         doc!.registration_emails,
      multichain_emails:           doc!.multichain_emails ?? true,
      multichain_payments_enabled: doc!.multichain_payments_enabled ?? true,
      spark_lightning_enabled:     doc!.spark_lightning_enabled     ?? false,
      updated_at:                  doc!.updated_at ?? null,
      updated_by:                  doc!.updated_by ?? null,
    });
  } catch (err) { next(err); }
});

/** GET /api/v1/admin/app-feature-flags — endpoint pubblico per la chat app (no auth) */
router.get("/app-feature-flags", async (_req, res, next) => {
  try {
    const settings = await getAdminSettings();
    res.json({
      multichain_payments_enabled: settings.multichain_payments_enabled ?? true,
      // ISOLAMENTO: spark_lightning_enabled è indipendente da multichain.
      // Default: false — disabilitato fino a go-live esplicito.
      spark_lightning_enabled:     settings.spark_lightning_enabled     ?? false,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/access-log
// Accessi per utente: ultimo login + conteggio giornaliero dal log audit.
// Login event types: USER_LOGIN, NEW_DEVICE_LOGIN, TEMP_PASSWORD_LOGIN
// ---------------------------------------------------------------------------

router.get("/access-log", requireAdmin("read_only"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawDays  = parseInt(String(req.query["days"] ?? "30"), 10);
    const days     = isNaN(rawDays) ? 30 : Math.min(Math.max(rawDays, 1), 90);
    const rawPage  = parseInt(String(req.query["page"] ?? "1"), 10);
    const page     = isNaN(rawPage)  ? 1  : Math.max(rawPage, 1);
    const rawLimit = parseInt(String(req.query["limit"] ?? "50"), 10);
    const limit    = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 100);
    const skip     = (page - 1) * limit;
    const search   = qs(req.query["search"]);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Login events per user per giorno
    const loginStats = await AuditEventModel.aggregate([
      {
        $match: {
          event:      { $in: ["USER_LOGIN", "NEW_DEVICE_LOGIN", "TEMP_PASSWORD_LOGIN"] },
          created_at: { $gte: since },
          user_id:    { $ne: null },
        },
      },
      {
        $group: {
          _id: {
            user_id: "$user_id",
            day:     { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id:          "$_id.user_id",
          total_logins: { $sum: "$count" },
          daily_counts: { $push: { day: "$_id.day", count: "$count" } },
        },
      },
      { $sort: { total_logins: -1 } },
    ]);

    const allUserIds  = loginStats.map((s) => s._id).filter(Boolean);
    const total       = allUserIds.length;

    // Recupera dettagli utente — applica filtro ricerca qui
    const userFilter: Record<string, unknown> = { _id: { $in: allUserIds } };
    if (search) {
      userFilter["$or"] = [
        { username:     { $regex: search, $options: "i" } },
        { display_name: { $regex: search, $options: "i" } },
      ];
    }

    const users = await UserModel.find(userFilter)
      .select("_id username display_name status last_login_at")
      .lean();

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    // Se c'è ricerca, filtra loginStats per i soli utenti trovati
    const filtered = search
      ? loginStats.filter((s) => userMap.has(s._id))
      : loginStats;

    const items = filtered.slice(skip, skip + limit).map((stat) => {
      const user = userMap.get(stat._id);
      return {
        user_id:       stat._id,
        username:      user?.username      ?? "unknown",
        display_name:  user?.display_name  ?? null,
        status:        user?.status        ?? "unknown",
        last_login_at: user?.last_login_at ?? null,
        total_logins:  stat.total_logins   as number,
        avg_per_day:   Math.round((stat.total_logins as number) / days * 10) / 10,
        daily_counts:  (stat.daily_counts  as { day: string; count: number }[])
          .sort((a, b) => a.day.localeCompare(b.day)),
      };
    });

    res.json({
      period_days: days,
      since:       since.toISOString(),
      total:       filtered.length,
      page,
      limit,
      pages:       Math.ceil(filtered.length / limit),
      items,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /admin/performance
// Metriche prestazionali: login trend, fallimenti, distribuzione oraria,
// nuovi utenti, sessioni attive, tasso di successo.
// ---------------------------------------------------------------------------

router.get("/performance", requireAdmin("read_only"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now    = new Date();
    const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const last7  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);

    const LOGIN_EVENTS = ["USER_LOGIN", "NEW_DEVICE_LOGIN", "TEMP_PASSWORD_LOGIN"] as const;

    const [
      loginsByDay,
      failedByDay,
      hourlyToday,
      newUsersByDay,
      activeSessions,
      totalLogins30d,
      totalFailed30d,
      uniqueUsers7d,
    ] = await Promise.all([
      // Login riusciti per giorno (ultimi 30gg)
      AuditEventModel.aggregate([
        { $match: { event: { $in: LOGIN_EVENTS }, created_at: { $gte: last30 }, user_id: { $ne: null } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // Login falliti per giorno
      AuditEventModel.aggregate([
        { $match: { event: "USER_LOGIN_FAILED", created_at: { $gte: last30 } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // Distribuzione oraria oggi
      AuditEventModel.aggregate([
        { $match: { event: { $in: LOGIN_EVENTS }, created_at: { $gte: today }, user_id: { $ne: null } } },
        { $group: { _id: { $hour: "$created_at" }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // Nuovi utenti per giorno (ultimi 30gg)
      UserModel.aggregate([
        { $match: { createdAt: { $gte: last30 } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // Sessioni attive ora
      SessionModel.countDocuments({ deleted_at: null, expires_at: { $gt: now } }),
      // Totale login 30gg
      AuditEventModel.countDocuments({ event: { $in: LOGIN_EVENTS }, created_at: { $gte: last30 } }),
      // Totale falliti 30gg
      AuditEventModel.countDocuments({ event: "USER_LOGIN_FAILED", created_at: { $gte: last30 } }),
      // Utenti unici attivi 7gg
      AuditEventModel.aggregate([
        { $match: { event: { $in: LOGIN_EVENTS }, created_at: { $gte: last7 }, user_id: { $ne: null } } },
        { $group: { _id: "$user_id" } },
        { $count: "total" },
      ]).then((r) => (r[0] as { total?: number } | undefined)?.total ?? 0),
    ]);

    const totalAll      = totalLogins30d + totalFailed30d;
    const successRatePct = totalAll > 0
      ? Math.round((totalLogins30d / totalAll) * 1000) / 10
      : 100;

    // Costruisce serie giornaliera unificata (login + failed sullo stesso giorno)
    const daySet = new Set([
      ...loginsByDay.map((d: { _id: string }) => d._id),
      ...failedByDay.map((d: { _id: string }) => d._id),
    ]);
    const loginMap  = new Map(loginsByDay.map((d: { _id: string; count: number }) => [d._id, d.count]));
    const failedMap = new Map(failedByDay.map((d: { _id: string; count: number }) => [d._id, d.count]));
    const dailySeries = [...daySet].sort().map((day) => ({
      date:    day,
      logins:  loginMap.get(day)  ?? 0,
      failed:  failedMap.get(day) ?? 0,
    }));

    // Distribuzione oraria (0–23)
    const hourMap = new Map((hourlyToday as { _id: number; count: number }[]).map((h) => [h._id, h.count]));
    const hourlySeries = Array.from({ length: 24 }, (_, h) => ({
      hour:  h,
      count: hourMap.get(h) ?? 0,
    }));

    res.json({
      summary: {
        online_now:       wsManager.getOnlineCount(),
        active_sessions:  activeSessions,
        logins_30d:       totalLogins30d,
        failed_30d:       totalFailed30d,
        success_rate_pct: successRatePct,
        unique_users_7d:  uniqueUsers7d,
      },
      daily_series:   dailySeries,
      hourly_today:   hourlySeries,
      new_users_by_day: (newUsersByDay as { _id: string; count: number }[]).map((d) => ({
        date: d._id, count: d.count,
      })),
    });
  } catch (err) { next(err); }
});

export default router;
