import { Router } from "express";
import { pingMongoDB } from "../../lib/mongodb";
import { successResponse } from "../../utils/response";

const router = Router();

const START_TIME = Date.now();
const APP_VERSION = "1.0.0";
const BUILD = new Date().toISOString().slice(0, 10).replace(/-/g, "");

// ---------------------------------------------------------------------------
// GET /api/v1/health
// Public — minimal liveness check (used by load balancer / monitoring)
// ---------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/version
// Public — version info
// ---------------------------------------------------------------------------
router.get("/version", (_req, res) => {
  res.status(200).json(
    successResponse({
      app: "alpha-chat-api",
      version: APP_VERSION,
      build: BUILD,
      node: process.version,
      env: process.env["NODE_ENV"] ?? "development",
      api_version: "v1",
    }),
  );
});

// ---------------------------------------------------------------------------
// GET /api/v1/status
// Protected (admin only in production) — detailed dependency status
// ---------------------------------------------------------------------------
router.get("/status", async (_req, res) => {
  const [mongo] = await Promise.all([pingMongoDB()]);

  const memUsage = process.memoryUsage();
  const toMb = (bytes: number): number => Math.round(bytes / 1024 / 1024);

  const dependencies = {
    mongodb: {
      status: mongo.ok ? "ok" : "degraded",
      latency_ms: mongo.latency_ms,
    },
    redis: {
      // Redis integration will be added in Fase 1
      status: "not_configured",
      latency_ms: null,
    },
    r2: {
      // R2 integration will be added in Fase 6
      status: "not_configured",
      latency_ms: null,
    },
  };

  const allOk = Object.values(dependencies)
    .filter((d) => d.status !== "not_configured")
    .every((d) => d.status === "ok");

  const httpStatus = allOk ? 200 : 503;

  res.status(httpStatus).json(
    successResponse({
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
      dependencies,
      memory: {
        rss_mb: toMb(memUsage.rss),
        heap_used_mb: toMb(memUsage.heapUsed),
        heap_total_mb: toMb(memUsage.heapTotal),
      },
      version: APP_VERSION,
    }),
  );
});

export default router;
