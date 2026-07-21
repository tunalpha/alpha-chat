import app from "./app";
import { logger } from "./lib/logger";
import { config } from "./config";
import { connectMongoDB, disconnectMongoDB } from "./lib/mongodb";
import { createWsServer } from "./lib/ws-server";
import { runDmsScheduler } from "./services/dead-man-switch.service";
import { seedAdminIfNeeded } from "./routes/v1/admin.routes";
import { startTempCleanupScheduler } from "./schedulers/temp-cleanup.scheduler";
import { startR2HealthScheduler } from "./schedulers/r2-health.scheduler";

const port = config.app.port;

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  // Connect to MongoDB if configured
  await connectMongoDB();

  // Start HTTP server
  const server = app.listen(port, () => {
    logger.info({ port, env: config.app.env }, "Alpha Chat API listening");
  });

  // Attach WebSocket server (shares same port via HTTP upgrade)
  createWsServer(server);

  // Admin seed — promuove "alpha" a super_admin se nessun admin esiste
  await seedAdminIfNeeded();

  // Dead Man Switch scheduler — controlla ogni 4 ore
  const DMS_INTERVAL_MS = 4 * 60 * 60 * 1000;
  setInterval(() => { void runDmsScheduler(); }, DMS_INTERVAL_MS).unref();
  logger.info("DMS scheduler started (interval: 4h)");

  // R2 temp/ cleanup scheduler — ogni ora, elimina upload orfani > 24h
  startTempCleanupScheduler();

  // R2 health scheduler — ping bucket ogni 5 minuti, log in R2EventModel
  startR2HealthScheduler();

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutdown signal received");

    server.close(async () => {
      logger.info("HTTP server closed");
      await disconnectMongoDB();
      logger.info("Graceful shutdown complete");
      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error("Graceful shutdown timeout — forcing exit");
      process.exit(1);
    }, 10_000).unref();
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((err) => {
  logger.fatal({ err }, "Fatal error during startup");
  process.exit(1);
});
