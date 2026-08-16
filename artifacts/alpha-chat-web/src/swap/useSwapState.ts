/**
 * useSwapState — state machine React per Alpha Swap
 *
 * ISOLAMENTO:
 * - Zero import da payment engine, USDA, MultiChain
 * - Zero import da chat-wallet-bridge
 * - Usa solo SwapRouter + providers
 *
 * Transizioni stato:
 *   idle → quoting → quoted → confirming → creating → created
 *        → sending_btc → awaiting_deposit → processing → completed
 *        ↘ failed / cancelled / expired / refunded
 *
 * BTC→LN: created → utente invia BTC on-chain → polling Boltz via backend
 * LN→BTC: confirming → completed (sincrono via Breez Spark)
 */

import { useState, useCallback, useRef } from "react";
import type { SwapRouter }    from "./SwapRouter.js";
import type { SwapQuote, SwapState, SwapError, SwapDirection } from "./types.js";

export interface SwapStateValue {
  direction:    SwapDirection;
  amountSat:    number;
  btcAddress:   string;    // per LN→BTC
  quote:        SwapQuote | null;
  state:        SwapState;
  error:        SwapError | null;
  swapId:       string | null;
  lockupAddress: string | null;  // per BTC→LN: address Boltz
  sendAmountSat: number | null;  // per BTC→LN: importo esatto da inviare
  txHash:       string | null;
}

export interface SwapActions {
  setDirection:  (d: SwapDirection) => void;
  setAmountSat:  (n: number) => void;
  setBtcAddress: (a: string) => void;
  fetchQuote:    () => Promise<void>;
  confirm:       () => void;
  execute:       (params?: { refundPubKey?: string; getMnemonic?: () => Promise<string> }) => Promise<void>;
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
};

export function useSwapState(router: SwapRouter | null): [SwapStateValue, SwapActions] {
  const [sv, setSv] = useState<SwapStateValue>(INITIAL);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  const _set = (patch: Partial<SwapStateValue>) =>
    setSv(prev => ({ ...prev, ...patch }));

  const _stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const setDirection = useCallback((d: SwapDirection) => {
    _set({ direction: d, quote: null, state: "idle", error: null, swapId: null, lockupAddress: null });
  }, []);

  const setAmountSat = useCallback((n: number) => {
    _set({ amountSat: n, quote: null, state: n > 0 ? "idle" : "idle", error: null });
  }, []);

  const setBtcAddress = useCallback((a: string) => {
    _set({ btcAddress: a, quote: null, error: null });
  }, []);

  const fetchQuote = useCallback(async () => {
    if (!router || sv.amountSat <= 0) return;
    _set({ state: "quoting", error: null, quote: null });
    try {
      const provider = router.resolve(sv.direction);
      const quote = await provider.getQuote({
        direction:       sv.direction,
        from_amount_sat: sv.amountSat,
        btc_address:     sv.btcAddress || undefined,
      });
      _set({ state: "quoted", quote });
    } catch (err) {
      _set({
        state: "failed",
        error: { code: "QUOTE_FAILED", message: (err as Error).message },
      });
    }
  }, [router, sv.direction, sv.amountSat, sv.btcAddress]);

  const confirm = useCallback(() => {
    if (sv.state === "quoted") _set({ state: "confirming" });
  }, [sv.state]);

  const execute = useCallback(async (params?: { refundPubKey?: string; getMnemonic?: () => Promise<string> }) => {
    if (!router || !sv.quote || sv.state !== "confirming") return;
    _set({ state: "creating", error: null });
    try {
      const provider = router.resolve(sv.direction);
      const result = await provider.execute({
        quote:          sv.quote,
        btc_address:    sv.btcAddress || undefined,
        refund_pub_key: params?.refundPubKey,
      });

      if (sv.direction === "btc_to_lightning") {
        // BTC→LN: mostra l'address Boltz da finanziare, avvia polling
        _set({
          state:         "created",
          swapId:        result.swap_id,
          lockupAddress: result.lockup_address ?? null,
          sendAmountSat: result.send_amount_sat ?? null,
        });
        _startPolling(router, result.swap_id, sv.direction);
      } else {
        // LN→BTC: eseguito via Breez Spark, già completato
        _stopPoll();
        _set({ state: "completed", swapId: result.swap_id });
      }
    } catch (err) {
      _set({
        state: "failed",
        error: { code: "EXECUTE_FAILED", message: (err as Error).message },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, sv.quote, sv.state, sv.direction, sv.btcAddress]);

  const pollStatus = useCallback(async () => {
    if (!router || !sv.swapId || sv.direction !== "btc_to_lightning") return;
    try {
      const provider = router.resolve(sv.direction);
      const status = await provider.getStatus(sv.swapId);
      const terminal: SwapState[] = ["completed", "failed", "refunded", "expired", "cancelled"];
      _set({ state: status.state as SwapState, txHash: status.tx_hash ?? sv.txHash });
      if (terminal.includes(status.state as SwapState)) _stopPoll();
    } catch {
      // poll silenzioso
    }
  }, [router, sv.swapId, sv.direction, sv.txHash]);

  function _startPolling(r: SwapRouter, swapId: string, direction: SwapDirection) {
    _stopPoll();
    if (direction !== "btc_to_lightning") return;
    pollRef.current = setInterval(async () => {
      try {
        const provider = r.resolve(direction);
        const status   = await provider.getStatus(swapId);
        const terminal: SwapState[] = ["completed", "failed", "refunded", "expired", "cancelled"];
        setSv(prev => ({
          ...prev,
          state:   status.state as SwapState,
          txHash:  status.tx_hash ?? prev.txHash,
        }));
        if (terminal.includes(status.state as SwapState)) _stopPoll();
      } catch {
        // poll silenzioso
      }
    }, 15_000);
  }

  const cancel = useCallback(() => {
    _stopPoll();
    _set({ state: "cancelled", error: null });
  }, []);

  const reset = useCallback(() => {
    _stopPoll();
    setSv(INITIAL);
  }, []);

  return [sv, { setDirection, setAmountSat, setBtcAddress, fetchQuote, confirm, execute, pollStatus, cancel, reset }];
}
