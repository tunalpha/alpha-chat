import app from "./app";
import { logger } from "./lib/logger";
import { config } from "./config";
import { connectMongoDB, disconnectMongoDB } from "./lib/mongodb";
import { createWsServer } from "./lib/ws-server";
import { runDmsScheduler } from "./services/dead-man-switch.service";
import { seedAdminIfNeeded } from "./routes/v1/admin.routes";
import { startTempCleanupScheduler } from "./schedulers/temp-cleanup.scheduler";
import { startR2HealthScheduler } from "./schedulers/r2-health.scheduler";
import { reconcilePendingPayments } from "./services/usda.service";
import { initCustodialService }    from "./payment/usda-custodial.service";
import { startPaymentScheduler }   from "./payment/payment-scheduler.service";

const port = config.app.port;

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  // Start HTTP server FIRST — before awaiting MongoDB — so that Cloud Run's
  // startup probe can reach /api/healthz immediately. The healthz handler is
  // stateless and needs no DB. Delaying listen() until after connectMongoDB()
  // (which includes serverSelection + connectTimeout + syncIndexes) can easily
  // exceed the probe timeout and cause a spurious promote-step failure.
  const server = app.listen(port, () => {
    logger.info({ port, env: config.app.env }, "Alpha Chat API listening");
  });

  // Attach WebSocket server (shares same port via HTTP upgrade)
  createWsServer(server);

  // Chat Payment Engine — valida ESCROW_MASTER_KEY fail-fast.
  // Se la chiave è assente o malformata il processo termina qui,
  // prima di accettare qualsiasi richiesta di pagamento. (ADR-003)
  initCustodialService();

  // Connect to MongoDB after the server is already accepting requests.
  // Individual API handlers will receive a Mongoose "not connected" error if
  // they fire before the connection is ready — those fail gracefully with 500
  // and will work on retry. This is far better than the whole deploy failing.
  await connectMongoDB();

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

  // USDA startup reconciliation — riavvia polling per pagamenti non-terminali
  // rimasti in sospeso prima di un riavvio del server. Fire-and-forget: non
  // blocca il boot anche se MongoDB non ha ancora processato gli indici.
  setTimeout(() => { void reconcilePendingPayments(); }, 5_000);

  // Chat Payment Engine scheduler — recovery + expiry (ADR-003: DB-driven, nessun timer critico).
  // Avviato dopo un breve delay per garantire che syncIndexes sia completato.
  setTimeout(() => { void startPaymentScheduler(); }, 8_000);

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
