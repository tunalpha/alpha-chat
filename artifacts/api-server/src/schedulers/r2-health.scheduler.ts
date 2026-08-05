/**
 * R2 Health Scheduler — ping automatico bucket ogni 15 minuti.
 *
 * Strategia di persistenza (ottimizzata per Compute Units):
 *   - scrive su DB solo quando lo stato CAMBIA (success→error o error→success)
 *   - scrive comunque ogni ora come heartbeat (per aggiornare "visto di recente" nella UI)
 *   - non scrive se lo stato è invariato da meno di 1 ora
 *
 * Il check HTTP viene comunque eseguito ogni 15 minuti per rilevare outage in tempo utile.
 * La funzione è esposta come export per consentire trigger manuali dall'area admin.
 */

import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../lib/r2-client";
import { config } from "../config";
import { R2EventModel } from "../models/r2-event.model";
import { logger } from "../lib/logger";

const INTERVAL_MS        = 15 * 60 * 1_000; // 15 minuti (era 5)
const FIRST_RUN_MS       = 30_000;           // evita rumore allo startup
const DB_HEARTBEAT_MS    = 60 * 60 * 1_000; // heartbeat minimo su DB ogni 1 ora

// Stato in memoria — persiste per tutta la vita del processo
let _lastStatus:     "success" | "error" | null = null;
let _lastDbWriteAt:  number                      = 0;

/**
 * Esegue un singolo health check su R2.
 * Può essere chiamato dallo scheduler o manualmente dall'admin API.
 */
export async function runR2HealthCheck(): Promise<{ status: "success" | "error"; duration_ms: number }> {
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
  const now         = Date.now();

  // Persiste su DB solo se:
  //   a) lo stato è cambiato rispetto all'ultimo check (evento significativo)
  //   b) non si scrive da più di 1 ora (heartbeat periodico per la UI admin)
  const stateChanged   = status !== _lastStatus;
  const heartbeatDue   = now - _lastDbWriteAt > DB_HEARTBEAT_MS;

  if (stateChanged || heartbeatDue) {
    _lastStatus    = status;
    _lastDbWriteAt = now;
    R2EventModel.create({
      event_type: "HEALTH_CHECK",
      status,
      duration_ms,
      ...(errorMessage ? { error_message: errorMessage } : {}),
    }).catch((e) => logger.warn({ e }, "R2 health scheduler: persistenza event fallita (non fatale)"));
  }

  if (status === "error") {
    logger.warn({ errorMessage, duration_ms }, "R2 health check: FAIL");
  } else {
    logger.debug({ duration_ms }, "R2 health check: ok");
  }

  return { status, duration_ms };
}

export function startR2HealthScheduler(): void {
  setTimeout(() => {
    void runR2HealthCheck();
    setInterval(() => void runR2HealthCheck(), INTERVAL_MS).unref();
  }, FIRST_RUN_MS).unref();

  logger.info("R2 health scheduler avviato (intervallo: 15m, DB write: solo su cambio stato o ogni 1h)");
}
