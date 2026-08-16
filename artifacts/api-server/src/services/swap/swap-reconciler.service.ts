/**
 * SwapReconciler — scheduler per riconciliazione swap non-terminali
 *
 * RESPONSABILITÀ:
 *   1. Al restart del backend: riconcilia IMMEDIATAMENTE tutti gli swap non-terminali
 *   2. Ogni 30s: poll Boltz per ogni swap non-terminale, aggiorna stato MongoDB
 *   3. Swap bloccati in "submitted" (>5 min senza boltz_swap_id) → cancelled
 *   4. Swap expired/failed_permanent: nessuna azione (terminali)
 *   5. Swap refund_pending: log di alert (refund manuale richiesto — task futuro)
 *
 * ISOLAMENTO:
 *   - Zero import da payment engine, USDA, MultiChain, Spark, treasury
 *   - Usa solo: swap.service (reconcileSwap, getNonTerminalSwaps)
 *
 * GARANZIA:
 *   - Singleton: mai due scheduler concorrenti
 *   - Un crash del backend non perde swap: al restart, riconcilia tutto
 *   - Un errore Boltz non blocca il ciclo: viene loggato e si riprova al prossimo tick
 *
 * SWAP_ENABLED=false: lo scheduler gira comunque per riconciliare swap esistenti.
 */

import pino from "pino";
import { reconcileSwap, getNonTerminalSwaps } from "./swap.service.js";

const logger = pino({ name: "swap-reconciler" });

const RECONCILE_INTERVAL_MS = 30_000;  // 30 secondi
const MAX_CONCURRENT_RECONCILE = 5;    // max swap in parallelo per ciclo

let _schedulerHandle: ReturnType<typeof setInterval> | null = null;
let _isRunning = false;  // lock anti-overlap

/**
 * Avvia il reconciler scheduler.
 * Chiamato da index.ts all'avvio del server.
 * Idempotente: chiamate multiple non creano duplicati.
 */
export function startSwapReconciler(): void {
  if (_schedulerHandle) {
    logger.warn("SWAP:RECONCILER:ALREADY_STARTED — ignorato");
    return;
  }

  logger.info({ intervalMs: RECONCILE_INTERVAL_MS }, "SWAP:RECONCILER:STARTING");

  // ── Riconciliazione immediata al startup (recovery dopo restart) ──────────
  _runReconcileCycle("startup").catch(err => {
    logger.error({ err: (err as Error).message }, "SWAP:RECONCILER:STARTUP_ERROR");
  });

  // ── Cicli periodici ────────────────────────────────────────────────────────
  _schedulerHandle = setInterval(() => {
    _runReconcileCycle("periodic").catch(err => {
      logger.error({ err: (err as Error).message }, "SWAP:RECONCILER:CYCLE_ERROR");
    });
  }, RECONCILE_INTERVAL_MS);

  logger.info("SWAP:RECONCILER:STARTED");
}

/**
 * Ferma lo scheduler (usato nei test).
 */
export function stopSwapReconciler(): void {
  if (_schedulerHandle) {
    clearInterval(_schedulerHandle);
    _schedulerHandle = null;
    logger.info("SWAP:RECONCILER:STOPPED");
  }
}

/**
 * Esegue un singolo ciclo di riconciliazione.
 * Protetto da lock anti-overlap.
 */
async function _runReconcileCycle(trigger: "startup" | "periodic"): Promise<void> {
  if (_isRunning) {
    logger.debug("SWAP:RECONCILER:CYCLE_SKIPPED — ciclo precedente ancora in corso");
    return;
  }

  _isRunning = true;
  const start = Date.now();

  try {
    const swaps = await getNonTerminalSwaps();

    if (swaps.length === 0) {
      logger.debug({ trigger }, "SWAP:RECONCILER:CYCLE_EMPTY");
      return;
    }

    logger.info({ trigger, count: swaps.length }, "SWAP:RECONCILER:CYCLE_START");

    let updated = 0;
    let errors  = 0;

    // Processa in batch da MAX_CONCURRENT_RECONCILE (rate-limiting vs Boltz)
    for (let i = 0; i < swaps.length; i += MAX_CONCURRENT_RECONCILE) {
      const batch = swaps.slice(i, i + MAX_CONCURRENT_RECONCILE);
      const results = await Promise.allSettled(
        batch.map(swap => reconcileSwap(swap)),
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value.updated) updated++;
        if (r.status === "rejected") {
          errors++;
          logger.warn({ err: (r.reason as Error)?.message }, "SWAP:RECONCILER:ITEM_ERROR");
        }
      }

      // Piccola pausa tra batch (rate limiting)
      if (i + MAX_CONCURRENT_RECONCILE < swaps.length) {
        await _sleep(500);
      }
    }

    const durationMs = Date.now() - start;
    logger.info({ trigger, total: swaps.length, updated, errors, durationMs }, "SWAP:RECONCILER:CYCLE_DONE");

    // Alert per swap in refund_pending (non gestito automaticamente)
    const refundPending = swaps.filter(s => s.state === "refund_pending");
    if (refundPending.length > 0) {
      logger.warn(
        { count: refundPending.length, swapIds: refundPending.map(s => s._id) },
        "SWAP:RECONCILER:REFUND_PENDING_ALERT — swap bloccate con deposito ricevuto, Lightning fallita. Intervento manuale richiesto.",
      );
    }

  } finally {
    _isRunning = false;
  }
}

function _sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
