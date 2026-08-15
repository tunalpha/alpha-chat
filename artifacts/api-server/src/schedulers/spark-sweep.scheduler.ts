/**
 * spark-sweep.scheduler.ts — Auto-sweep scheduler
 *
 * Controlla il saldo del fee wallet ogni 15 minuti e accoda uno sweep
 * automatico se il saldo supera la soglia configurata.
 *
 * SICUREZZA: non accede al mnemonic direttamente (delegato all'executor).
 * ISOLAMENTO: non tocca payment engine, MultiChain, USDA, main wallet.
 */

import { logger }                   from "../lib/logger.js";
import { checkAndQueueAutoSweep }    from "../services/spark-sweep.service.js";
import { reconcileProcessingSweeps } from "../services/spark-sweep.service.js";

const SWEEP_CHECK_INTERVAL_MS  = 15 * 60 * 1000; // 15 minuti
const RECONCILE_ON_STARTUP_MS  = 5_000;           // 5s dopo l'avvio

export function startSparkSweepScheduler(): void {
  logger.info("[SparkSweepScheduler] Avviato (interval: 15min)");

  // Riconciliazione all'avvio: controlla operazioni stuck in processing
  setTimeout(() => {
    void reconcileProcessingSweeps().catch(e =>
      logger.error({ err: e }, "[SparkSweepScheduler] Riconciliazione avvio fallita"),
    );
  }, RECONCILE_ON_STARTUP_MS);

  // Controllo periodico auto-sweep
  const timer = setInterval(() => {
    void checkAndQueueAutoSweep().catch(e =>
      logger.error({ err: e }, "[SparkSweepScheduler] checkAndQueueAutoSweep fallito"),
    );
  }, SWEEP_CHECK_INTERVAL_MS);

  timer.unref(); // non blocca il processo su shutdown
}
