/**
 * R2 Health Scheduler — ping automatico bucket ogni 5 minuti.
 * Registra ogni check in R2EventModel per:
 *   - conteggio errori consecutivi (Bucket Health UI)
 *   - timestamp ultimo check automatico
 */

import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../lib/r2-client";
import { config } from "../config";
import { R2EventModel } from "../models/r2-event.model";
import { logger } from "../lib/logger";

const INTERVAL_MS  = 5 * 60 * 1_000; // 5 minuti
const FIRST_RUN_MS = 30_000;          // evita rumore allo startup

async function runHealthCheck(): Promise<void> {
  const start = Date.now();
  let status: "success" | "error" = "success";
  let errorMessage: string | undefined;

  try {
    await r2.send(new HeadObjectCommand({ Bucket: config.r2.bucket, Key: "_health_sentinel" }));
  } catch (err: unknown) {
    const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    // 404 = bucket raggiungibile, oggetto non esiste → healthy
    if (httpStatus !== 404) {
      status = "error";
      errorMessage = (err as Error).message ?? String(err);
    }
  }

  const duration_ms = Date.now() - start;

  R2EventModel.create({
    event_type: "HEALTH_CHECK",
    status,
    duration_ms,
    ...(errorMessage ? { error_message: errorMessage } : {}),
  }).catch((e) => logger.warn({ e }, "R2 health scheduler: persistenza event fallita (non fatale)"));

  if (status === "error") {
    logger.warn({ errorMessage, duration_ms }, "R2 health check: FAIL");
  }
}

export function startR2HealthScheduler(): void {
  setTimeout(() => {
    void runHealthCheck();
    setInterval(() => void runHealthCheck(), INTERVAL_MS).unref();
  }, FIRST_RUN_MS).unref();

  logger.info("R2 health scheduler avviato (intervallo: 5m)");
}
