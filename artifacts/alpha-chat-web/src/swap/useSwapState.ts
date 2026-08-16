/**
 * useSwapState — state machine React per Alpha Swap
 *
 * ISOLAMENTO:
 * - Zero import da payment engine, USDA, MultiChain
 * - Zero import da chat-wallet-bridge
 * - Usa solo SwapRouter + providers + /api/v1/swap/*
 *
 * HARDENING:
 *   1. Recovery BTC→LN al mount: GET /active → riprende swap in corso
 *   2. Recovery LN→BTC al mount: legge localStorage → detecta completato/incerto
 *   3. failed_recoverable ≠ errore definitivo: mostra "in riconciliazione"
 *   4. Idempotency key: gestita da BreezSparkBtcLnProvider (localStorage persistente)
 *   5. TIMEOUT_UNCERTAIN: stato "lnbtc_unknown" — non permette retry automatico
 *   6. Reset: pulisce stato LN→BTC per permettere nuovi swap
 *
 * Transizioni stato BTC→LN:
 *   idle → quoting → quoted → confirming → creating
 *        → submitted → created → detected → processing
 *        → completed ✓
 *        → failed_recoverable → failed_permanent / expired / refund_pending / refunded / cancelled
 *
 * Transizioni stato LN→BTC:
 *   idle → quoting → quoted → confirming → creating
 *        → completed ✓
 *        → lnbtc_unknown (timeout — stato incerto)
 *        → idle + error (errore definitivo)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { SwapRouter }    from "./SwapRouter.js";
import type { SwapQuote, SwapState, SwapError, SwapDirection, ActiveBtcLnSwap } from "./types.js";
import { TERMINAL_SWAP_STATES, RECOVERABLE_SWAP_STATES } from "./types.js";
import { readLnBtcRecovery, clearLnBtcState } from "./providers/BreezSparkBtcLnProvider.js";

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
  recovering:   boolean;
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

/** Opzioni passate da SwapView per auto-risoluzione degli indirizzi. */
export interface SwapStateOpts {
  /**
   * BTC→LN: genera una BOLT11 invoice dall'interno del wallet Lightning
   * dell'utente per `amountSat`. Il sistema la inietta nel quote prima
   * di chiamare provider.execute(), eliminando l'input manuale.
   */
  generateLightningInvoice?: (amountSat: number) => Promise<string>;
  /**
   * LN→BTC: indirizzo BTC on-chain del wallet Alpha dell'utente.
   * Viene auto-impostato come destinazione per swap Lightning→BTC.
   */
  walletBtcAddress?: string;
}

export function useSwapState(router: SwapRouter | null, opts?: SwapStateOpts): [SwapStateValue, SwapActions] {
  const [sv, setSv] = useState<SwapStateValue>(INITIAL);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const routerRef   = useRef<SwapRouter | null>(router);
  routerRef.current = router;

  const _set = useCallback((patch: Partial<SwapStateValue>) =>
    setSv(prev => ({ ...prev, ...patch })), []);

  const _stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Recovery al mount ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // ── 1. LN→BTC recovery — sincrono (solo localStorage) ─────────────────────
    const lnBtcRecovery = readLnBtcRecovery();

    if (lnBtcRecovery.state !== "not_started") {
      if (
        lnBtcRecovery.state === "completed" ||
        lnBtcRecovery.state === "completed_unrecorded"
      ) {
        // Pagamento completato — mostra schermata successo
        clearLnBtcState(); // pulizia (backend ha già il record o lo avrà al prossimo retry)
        _set({
          recovering:  false,
          direction:   "lightning_to_btc",
          state:       "completed",
          swapId:      lnBtcRecovery.payment_id ?? "recovered",
        });
        return;
      }

      if (lnBtcRecovery.state === "in_progress" || lnBtcRecovery.state === "unknown") {
        // In_progress = lock fresco ma la promise è andata (crash/chiusura).
        // Non possiamo sapere se spark.send() è andato a buon fine — stato incerto.
        _set({
          recovering:  false,
          direction:   "lightning_to_btc",
          state:       "lnbtc_unknown",
          swapId:      "uncertain",
          error: {
            code:    "TIMEOUT_UNCERTAIN",
            message:
              lnBtcRecovery.state === "in_progress"
                ? "L'app è stata chiusa durante il pagamento. Verifica il tuo saldo Lightning e l'indirizzo BTC di destinazione."
                : "Il pagamento non ha risposto entro i 60 secondi. Verifica manualmente prima di riprovare.",
          },
        });
        return;
      }
    }

    // ── 2. BTC→LN recovery — asincrono (API call) ─────────────────────────────
    _set({ recovering: true });

    swapFetch<ActiveBtcLnSwap>("/active")
      .then(active => {
        if (cancelled) return;
        if (!active) {
          _set({ recovering: false });
          return;
        }

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

        if (
          RECOVERABLE_SWAP_STATES.includes(active.state as SwapState) &&
          !TERMINAL_SWAP_STATES.includes(active.state as SwapState)
        ) {
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

      // ── BTC→LN: genera invoice Lightning automaticamente ─────────────────────
      // La invoice BOLT11 viene creata dal wallet Spark interno per `to_amount_sat`
      // (i sat che l'utente riceverà in Lightning). Non viene richiesto alcun
      // indirizzo manuale — il sistema risolve la destinazione internamente.
      let quoteForExec = sv.quote;
      if (sv.direction === "btc_to_lightning" && opts?.generateLightningInvoice) {
        const bolt11 = await opts.generateLightningInvoice(sv.quote.to_amount_sat);
        quoteForExec = { ...sv.quote, lightning_invoice: bolt11 };
      }

      // ── LN→BTC: usa btcAddress dal wallet Alpha (già auto-impostato in stato) ─
      const result = await provider.execute({
        quote:       quoteForExec,
        btc_address: sv.btcAddress || opts?.walletBtcAddress || undefined,
      });

      if (sv.direction === "btc_to_lightning") {
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

        _startPollingById(result.swap_id);
      } else {
        // LN→BTC — sincrono: già completed
        _stopPoll();
        _set({ state: "completed", swapId: result.swap_id });
      }
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : JSON.stringify(err) || "Errore sconosciuto";

      if (msg.startsWith("TIMEOUT_UNCERTAIN")) {
        // Stato incerto: la PWA non deve permettere retry automatico
        _set({
          state:  "lnbtc_unknown",
          swapId: "uncertain",
          error: {
            code:    "TIMEOUT_UNCERTAIN",
            message: "Il pagamento non ha risposto entro 60 secondi. Verifica manualmente prima di riprovare.",
          },
        });
      } else {
        _set({
          state: "idle",
          error: { code: "EXECUTE_FAILED", message: msg },
        });
      }
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
      // poll silenzioso
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
        // Errore di rete — continua polling
      }
    }, 15_000);
  }

  const cancel = useCallback(() => {
    _stopPoll();
    _set({ state: "cancelled", error: null });
  }, [_set, _stopPoll]);

  const reset = useCallback(() => {
    _stopPoll();
    // Pulisce idempotency key BTC→LN (Boltz)
    const r = routerRef.current;
    if (r) {
      try {
        const boltz = r.resolve("btc_to_lightning") as { clearIdempotencyKey?: () => void };
        boltz.clearIdempotencyKey?.();
      } catch { /* provider potrebbe non avere clearIdempotencyKey */ }
    }
    // Pulisce stato LN→BTC (localStorage persistente)
    clearLnBtcState();
    setSv(INITIAL);
  }, [_stopPoll]);

  return [sv, { setDirection, setAmountSat, setBtcAddress, fetchQuote, confirm, execute, pollStatus, cancel, reset }];
}
