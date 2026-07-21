/**
 * Temp Cleanup Scheduler
 *
 * Elimina ogni ora gli oggetti R2 sotto il prefisso temp/ più vecchi di 24 ore.
 * Questi file sono upload interrotti dove sia l'upload R2 che il rollback delete
 * sono falliti (difesa in profondità contro file orfani).
 */

import { cleanupTempObjects } from "../services/storage.service";
import { logger } from "../lib/logger";

const INTERVAL_MS = 60 * 60 * 1_000; // 1 ora

export function startTempCleanupScheduler(): void {
  const run = async () => {
    try {
      const deleted = await cleanupTempObjects();
      if (deleted > 0) {
        logger.info({ deleted }, "R2 temp/ cleanup: oggetti eliminati");
      }
    } catch (err) {
      // Non fatale: loggato ma non rilanciato per non interrompere il processo
      logger.warn({ err }, "R2 temp/ cleanup fallito (non fatale)");
    }
  };

  // Prima esecuzione subito, poi ogni ora
  void run();
  setInterval(() => { void run(); }, INTERVAL_MS);
  logger.info("R2 temp/ cleanup scheduler avviato (intervallo: 1h)");
}
