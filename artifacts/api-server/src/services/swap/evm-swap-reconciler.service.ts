/**
 * Li.FI EVM Swap Reconciler
 *
 * Reconcile solo journal Li.FI esistenti. Non ottiene quote, non crea ordini e
 * non firma/broadcasta: il provider resta parked/disabled per i nuovi flussi.
 */
import pino from "pino";
import { evmSwapService } from "./evm-swap.service.js";
import { dispatchToOne } from "../push/PushDispatcher.js";

const logger = pino({ name: "evm-swap-reconciler" });
const INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycle(trigger: "startup" | "periodic"): Promise<void> {
  if (running) return;
  running = true;
  try {
    const swaps = await evmSwapService.getPendingForRecovery();
    const results = await Promise.allSettled(
      swaps.map(async (swap) => {
        const result = await evmSwapService.reconcileSwap(swap.routeId, swap.userId);
        if (result?.transitioned && ["completed", "failed", "refunded", "expired"].includes(result.swap.state)) {
          const lifecycle = result.swap.state as "completed" | "failed" | "refunded" | "expired";
          dispatchToOne(swap.userId, {
            type: "swap.lifecycle",
            recipientUserId: swap.userId,
            swapId: result.swap.swapId,
            lifecycle,
            fromToken: result.swap.fromToken,
            toToken: result.swap.toToken,
            fromAmount: result.swap.fromAmount,
            toAmount: result.swap.toAmount ?? "",
          });
        }
        return result?.transitioned ?? false;
      }),
    );
    const updated = results.filter(r => r.status === "fulfilled" && r.value).length;
    const failed = results.filter(r => r.status === "rejected").length;
    logger.info({ trigger, total: swaps.length, updated, failed }, "LIFI:RECONCILER:CYCLE_DONE");
  } finally {
    running = false;
  }
}

/** Singleton, idempotente e attivo anche con Li.FI disabled per i journal storici. */
export function startEvmSwapReconciler(): void {
  if (timer) return;
  void runCycle("startup").catch(err => logger.warn({ err }, "LIFI:RECONCILER:STARTUP_ERROR"));
  timer = setInterval(() => {
    void runCycle("periodic").catch(err => logger.warn({ err }, "LIFI:RECONCILER:CYCLE_ERROR"));
  }, INTERVAL_MS);
  timer.unref();
  logger.info({ intervalMs: INTERVAL_MS }, "LIFI:RECONCILER:STARTED");
}

export function stopEvmSwapReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}