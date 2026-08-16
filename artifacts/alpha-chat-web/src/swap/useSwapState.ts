/**
 * useSwapState — state machine React per Alpha Swap
 *
 * ISOLAMENTO:
 * - Zero import da payment engine, USDA, MultiChain
 * - Zero import da chat-wallet-bridge
 * - Usa solo SwapRouter + providers + /api/v1/swap/*
 *
 * HARDENING:
 *   1. Recovery al mount: GET /active → se esiste uno swap BTC→LN in corso, lo riprende
 *   2. failed_recoverable ≠ errore definitivo: mostra "in riconciliazione" non "swap fallito"
 *   3. Idempotency key: gestita dal BoltzBtcLnProvider (sessionStorage)
 *   4. Polling robusto: continua anche se il frontend era offline
 *   5. Reset: pulisce idempotency key per permettere nuovi swap
 *
 * Transizioni stato (state machine completa):
 *   idle → quoting → quoted → confirming → creating
 *        → submitted (swap in DB, Boltz non ancora risposto)
 *        → created (lockup address disponibile)
 *        → detected (deposito in mempool)
 *        → processing (Boltz sta pagando Lightning)
 *        → completed ✓
 *        → failed_recoverable (errore rete — reconciler riprova, NON mostrare "failed")
 *        → failed_permanent / expired / refund_pending / refunded / cancelled
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { SwapRouter }    from "./SwapRouter.js";
import type { SwapQuote, SwapState, SwapError, SwapDirection, ActiveBtcLnSwap } from "./types.js";
import { TERMINAL_SWAP_STATES, RECOVERABLE_SWAP_STATES } from "./types.js";

const SWAP_API = "/api/v1/swap";

async function swapFetch<T>(path: string): Promise<T | null> {
  const token = localStorage.getItem("ac_access_token");
  const res = await fetch(`${SWAP_API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 204) return null;
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

export interface SwapStateValue {
  direction:    SwapDirection;
  amountSat:    number;
  btcAddress:   string;
  quote:        SwapQuote | null;
  state:        SwapState;
  error:        SwapError | null;
  swapId:       string | null;
  lockupAddress: string | null;
  sendAmountSat: number | null;
  txHash:       string | null;
  recovering:   boolean;   // true mentre si controlla lo swap attivo al mount
}

export interface SwapActions {
  setDirection:  (d: SwapDirection) => void;
  setAmountSat:  (n: number) => void;
  setBtcAddress: (a: string) => void;
  fetchQuote:    () => Promise<void>;
  confirm:       () => void;
  execute:       () => Promise<void>;
  pollStatus:    () => Promise<void>;
  cancel:        () => void;
  reset:         () => void;
}

const INITIAL: SwapStateValue = {
  direction:     "btc_to_lightning",
  amountSat:     0,
  btcAddress:    "",
  quote:         null,
  state:         "idle",
  error:         null,
  swapId:        null,
  lockupAddress: null,
  sendAmountSat: null,
  txHash:        null,
  recovering:    false,
};

export function useSwapState(router: SwapRouter | null): [SwapStateValue, SwapActions] {
  const [sv, setSv] = useState<SwapStateValue>(INITIAL);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const routerRef   = useRef<SwapRouter | null>(router);
  routerRef.current = router;

  const _set = useCallback((patch: Partial<SwapStateValue>) =>
    setSv(prev => ({ ...prev, ...patch })), []);

  const _stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Recovery al mount: controlla se c'è uno swap BTC→LN attivo ────────────
  useEffect(() => {
    let cancelled = false;
    _set({ recovering: true });

    swapFetch<ActiveBtcLnSwap>("/active")
      .then(active => {
        if (cancelled || !active) return;

        // Swap attivo trovato — riprendi la UI dallo stato reale
        _set({
          recovering:    false,
          state:         active.state as SwapState,
          swapId:        active.swap_id,
          lockupAddress: active.boltz_lockup_address ?? null,
          sendAmountSat: active.expected_amount_sat ?? active.from_amount_sat,
          txHash:        active.tx_hash_deposit ?? null,
          error:         active.error_message
            ? { code: active.error_message.includes("BOLTZ") ? active.error_message : "PROVIDER_ERROR", message: active.error_message }
            : null,
        });

        // Se lo stato è ancora in corso (non terminale), riprendi il polling
        if (RECOVERABLE_SWAP_STATES.includes(active.state as SwapState) &&
            !TERMINAL_SWAP_STATES.includes(active.state as SwapState)) {
          _startPollingById(active.swap_id);
        }
      })
      .catch(() => _set({ recovering: false }));

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDirection = useCallback((d: SwapDirection) => {
    _set({ direction: d, quote: null, state: "idle", error: null, swapId: null, lockupAddress: null });
  }, [_set]);

  const setAmountSat = useCallback((n: number) => {
    _set({ amountSat: n, quote: null, state: "idle", error: null });
  }, [_set]);

  const setBtcAddress = useCallback((a: string) => {
    _set({ btcAddress: a, quote: null, error: null });
  }, [_set]);

  const fetchQuote = useCallback(async () => {
    if (!routerRef.current) return;
    const { amountSat, direction, btcAddress } = sv;
    if (amountSat <= 0) return;
    _set({ state: "quoting", error: null, quote: null });
    try {
      const provider = routerRef.current.resolve(direction);
      const quote = await provider.getQuote({
        direction,
        from_amount_sat: amountSat,
        btc_address:     btcAddress || undefined,
      });
      _set({ state: "quoted", quote });
    } catch (err) {
      _set({ state: "idle", error: { code: "QUOTE_FAILED", message: (err as Error).message } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.amountSat, sv.direction, sv.btcAddress, _set]);

  const confirm = useCallback(() => {
    if (sv.state === "quoted") _set({ state: "confirming" });
  }, [sv.state, _set]);

  const execute = useCallback(async () => {
    if (!routerRef.current || !sv.quote || sv.state !== "confirming") return;
    _set({ state: "creating", error: null });
    try {
      const provider = routerRef.current.resolve(sv.direction);
      const result = await provider.execute({
        quote:       sv.quote,
        btc_address: sv.btcAddress || undefined,
      });

      if (sv.direction === "btc_to_lightning") {
        // BTC→LN: mostra stato attuale (submitted o created)
        const nextState: SwapState =
          result.state === "submitted" || result.state === "failed_recoverable"
            ? (result.state as SwapState)
            : "created";

        _set({
          state:         nextState,
          swapId:        result.swap_id,
          lockupAddress: result.lockup_address ?? null,
          sendAmountSat: result.send_amount_sat ?? null,
        });

        // Avvia polling anche se submitted (il reconciler potrebbe passare a created)
        _startPollingById(result.swap_id);
      } else {
        _stopPoll();
        _set({ state: "completed", swapId: result.swap_id });
      }
    } catch (err) {
      _set({
        state: "idle",
        error: { code: "EXECUTE_FAILED", message: (err as Error).message },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.quote, sv.state, sv.direction, sv.btcAddress, _set]);

  const pollStatus = useCallback(async () => {
    const { swapId, direction } = sv;
    if (!routerRef.current || !swapId || direction !== "btc_to_lightning") return;
    try {
      const provider = routerRef.current.resolve(direction);
      const status = await provider.getStatus(swapId);
      const newState = status.state as SwapState;

      setSv(prev => ({
        ...prev,
        state:         newState,
        txHash:        status.tx_hash ?? prev.txHash,
        lockupAddress: (status as { lockup_address?: string }).lockup_address ?? prev.lockupAddress,
        sendAmountSat: (status as { send_amount_sat?: number }).send_amount_sat ?? prev.sendAmountSat,
      }));

      if (TERMINAL_SWAP_STATES.includes(newState)) _stopPoll();
    } catch {
      // poll silenzioso — errori di rete non fermano il polling
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.swapId, sv.direction, _set, _stopPoll]);

  function _startPollingById(swapId: string) {
    _stopPoll();
    pollRef.current = setInterval(async () => {
      const r = routerRef.current;
      if (!r) return;
      try {
        const provider = r.resolve("btc_to_lightning");
        const status   = await provider.getStatus(swapId);
        const newState = status.state as SwapState;

        setSv(prev => ({
          ...prev,
          state:         newState,
          txHash:        status.tx_hash ?? prev.txHash,
          lockupAddress: (status as { lockup_address?: string }).lockup_address ?? prev.lockupAddress,
          sendAmountSat: (status as { send_amount_sat?: number }).send_amount_sat ?? prev.sendAmountSat,
        }));

        if (TERMINAL_SWAP_STATES.includes(newState)) _stopPoll();
      } catch {
        // Errore di rete — continua polling (non è un errore definitivo)
      }
    }, 15_000);
  }

  const cancel = useCallback(() => {
    _stopPoll();
    _set({ state: "cancelled", error: null });
  }, [_set, _stopPoll]);

  const reset = useCallback(() => {
    _stopPoll();
    // Pulisce idempotency key per permettere un nuovo swap
    const r = routerRef.current;
    if (r) {
      try {
        const boltz = r.resolve("btc_to_lightning") as { clearIdempotencyKey?: () => void };
        boltz.clearIdempotencyKey?.();
      } catch { /* provider potrebbe non avere clearIdempotencyKey */ }
    }
    setSv(INITIAL);
  }, [_stopPoll]);

  return [sv, { setDirection, setAmountSat, setBtcAddress, fetchQuote, confirm, execute, pollStatus, cancel, reset }];
}
