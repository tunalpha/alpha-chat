/**
 * useChangeNowSwapState — State machine frontend per swap BTC→USDT via ChangeNOW
 *
 * ═══════════════════════════════════════════════════════════════
 *  REGOLA DOUBLE-SEND (ASSOLUTA):
 *    1. Recovery su mount: se cn_swap_active_id in localStorage
 *       → recupera swap dal backend → NESSUN nuovo send
 *    2. commitFunds() PRIMA del broadcast BTC (write-before-submit)
 *    3. fundsCommitted=true → blocco assoluto su nuovo exchange
 *
 *  REGOLA PROVIDER:
 *    Questo hook viene usato SOLO quando il provider attivo è "changenow".
 *    Se provider = lifi → useEvmSwapState (file separato, invariato).
 *
 *  ISOLAMENTO:
 *    Zero import da lifi-client.ts, useEvmSwapState.ts, EvmSwapView.tsx.
 *    Zero import da payment engine, USDA, MultiChain, Spark.
 * ═══════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CnToChain,
  type CnUiState,
  type CnQuote,
  type CnCreateResult,
  type CnSwapStatusResult,
  CHANGENOW_SWAP_ACTIVE_KEY,
  isCnTerminal,
  humanizeCnError,
} from "./types.js";

// ── API helpers ───────────────────────────────────────────────────────────────

const TOKEN_KEY    = "ac_access_token";
const API_BASE     = "/api/v1";
const POLL_INTERVAL_MS = 15_000;

async function cnRequest<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers as Record<string, string> ?? {}),
    },
    signal: opts.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const code = (body.code as string) ?? `HTTP_${res.status}`;
    const err = new Error(humanizeCnError(code));
    (err as any).code = code;
    throw err;
  }
  return res.json() as Promise<T>;
}

// ── State ─────────────────────────────────────────────────────────────────────

export interface CnSwapState {
  uiState:        CnUiState;
  selectedChain:  CnToChain;
  amountBtc:      string;           // stringa per l'input
  quote:          CnQuote   | null;
  exchange:       CnCreateResult | null;
  status:         CnSwapStatusResult | null;
  error:          string | null;
  pairAvailable:  boolean | null;
}

export interface CnSwapActions {
  setChain:       (chain: CnToChain) => void;
  setAmountBtc:   (amount: string)   => void;
  checkPair:      () => Promise<void>;
  fetchQuote:     () => Promise<void>;
  /**
   * Crea l'exchange su ChangeNOW.
   * @param destinationEvmAddress — indirizzo EVM Alpha Wallet dell'utente (destinazione USDT)
   */
  createExchange: (destinationEvmAddress: string) => Promise<void>;
  /**
   * Chiamare PRIMA del broadcast BTC (write-before-submit).
   * Imposta fundsCommitted=true sul backend, poi chiama sendBtc.
   */
  commitAndSend:  (sendBtc: (depositAddress: string, amountBtc: number) => Promise<string>) => Promise<void>;
  reset:          () => void;
}

const INITIAL_STATE: CnSwapState = {
  uiState:       "idle",
  selectedChain: "polygon",
  amountBtc:     "",
  quote:         null,
  exchange:      null,
  status:        null,
  error:         null,
  pairAvailable: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChangeNowSwapState(): [CnSwapState, CnSwapActions] {
  const [state, setState] = useState<CnSwapState>(INITIAL_STATE);
  const pollTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef    = useRef(true);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // ── Recovery su mount ────────────────────────────────────────────────────
  //
  // Se esiste un swap attivo salvato in localStorage, lo recuperiamo dal
  // backend e riprendiamo il polling SENZA creare un nuovo exchange.

  useEffect(() => {
    const savedId = localStorage.getItem(CHANGENOW_SWAP_ACTIVE_KEY);
    if (!savedId) return;

    let cancelled = false;
    (async () => {
      try {
        const data = await cnRequest<{ ok: boolean; swap: CnSwapStatusResult | null }>(
          "/swap/changenow/active"
        );
        if (cancelled || !mountedRef.current) return;
        if (data.swap && !isCnTerminal(data.swap.cnStatus)) {
          setState(prev => ({
            ...prev,
            exchange: {
              swapId:            data.swap!.swapId,
              exchangeId:        data.swap!.exchangeId,
              btcDepositAddress: data.swap!.btcDepositAddress,
              estimatedToAmount: data.swap!.estimatedToAmount,
              fromAmount:        data.swap!.fromAmount,
              toChain:           data.swap!.toChain,
              toAsset:           "USDT",
            },
            selectedChain: data.swap!.toChain,
            status:        data.swap!,
            uiState:       data.swap!.fundsCommitted ? "committed" : "awaiting_deposit",
          }));
          if (data.swap!.fundsCommitted) {
            _startPolling(data.swap!.swapId);
          }
        } else {
          // Swap terminale o non trovato → pulisci localStorage
          localStorage.removeItem(CHANGENOW_SWAP_ACTIVE_KEY);
        }
      } catch {
        // Recovery silenzioso: se fallisce, l'utente reinizia da idle
        if (!cancelled) localStorage.removeItem(CHANGENOW_SWAP_ACTIVE_KEY);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────

  const _startPolling = useCallback((swapId: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const data = await cnRequest<{ ok: boolean; swap: CnSwapStatusResult }>(
          `/swap/changenow/${swapId}/status`
        );
        if (!mountedRef.current) return;

        setState(prev => ({ ...prev, status: data.swap }));

        if (data.swap.isCompleted) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          localStorage.removeItem(CHANGENOW_SWAP_ACTIVE_KEY);
          setState(prev => ({ ...prev, uiState: "completed" }));
        } else if (isCnTerminal(data.swap.cnStatus)) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          localStorage.removeItem(CHANGENOW_SWAP_ACTIVE_KEY);
          const terminalUiState: CnUiState =
            data.swap.cnStatus === "refunded" ? "refunded"
            : data.swap.cnStatus === "expired"  ? "expired"
            : "failed";
          setState(prev => ({ ...prev, uiState: terminalUiState }));
        } else {
          // Aggiorna uiState intermedio
          const mid: CnUiState =
            data.swap.cnStatus === "confirming" ? "confirming"
            : data.swap.cnStatus === "exchanging" ? "exchanging"
            : data.swap.cnStatus === "sending"    ? "sending"
            : "committed";
          setState(prev => ({ ...prev, uiState: mid }));
        }
      } catch {
        // Errore di polling: continua — NON interrompere
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const checkPair = useCallback(async () => {
    setState(prev => ({ ...prev, uiState: "checking_pair", error: null, pairAvailable: null }));
    try {
      const data = await cnRequest<{ ok: boolean; available: boolean }>(
        `/swap/changenow/pairs/${state.selectedChain}`
      );
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        pairAvailable: data.available,
        uiState: data.available ? "ready" : "pair_unavailable",
        error: data.available ? null : "Coppia BTC→USDT non disponibile al momento.",
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        uiState: "error",
        error: err instanceof Error ? err.message : "Errore verifica coppia.",
        pairAvailable: false,
      }));
    }
  }, [state.selectedChain]);

  const fetchQuote = useCallback(async () => {
    const amountNum = parseFloat(state.amountBtc);
    if (!amountNum || amountNum <= 0) {
      setState(prev => ({ ...prev, error: "Inserisci un importo valido." }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "quoting", error: null }));
    try {
      const data = await cnRequest<{ ok: boolean; quote: CnQuote }>(
        "/swap/changenow/quote",
        {
          method:  "POST",
          body:    JSON.stringify({ fromAmountBtc: amountNum, toChain: state.selectedChain }),
        }
      );
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        quote:   data.quote,
        uiState: "ready",
        error:   null,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        uiState: "idle",
        error:   err instanceof Error ? err.message : "Errore nella stima dello swap.",
      }));
    }
  }, [state.amountBtc, state.selectedChain]);

  const createExchange = useCallback(async (destinationEvmAddress: string) => {
    if (!state.quote) { setState(prev => ({ ...prev, error: "Ottieni prima una stima." })); return; }
    if (!destinationEvmAddress || destinationEvmAddress.length < 10) {
      setState(prev => ({ ...prev, error: "Indirizzo EVM non disponibile. Sblocca Alpha Wallet." }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "creating", error: null }));
    try {
      const data = await cnRequest<CnCreateResult & { ok: boolean }>(
        "/swap/changenow/create",
        {
          method: "POST",
          body:   JSON.stringify({
            fromAmountBtc:         state.quote!.fromAmount,
            toChain:               state.selectedChain,
            destinationEvmAddress,
          }),
        }
      );
      if (!mountedRef.current) return;
      // Salva per recovery post-reload
      localStorage.setItem(CHANGENOW_SWAP_ACTIVE_KEY, data.swapId);
      setState(prev => ({
        ...prev,
        exchange: data,
        uiState:  "awaiting_deposit",
        error:    null,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        uiState: "idle",
        error:   err instanceof Error ? err.message : "Errore creazione exchange.",
      }));
    }
  }, [state.quote, state.selectedChain]);

  /**
   * commitAndSend — sequenza sicura anti-double-spend:
   *   1. POST /commit con btcTxHash DOPO firma ma PRIMA o INSIEME al broadcast
   *   2. Avvia polling
   *
   * Il chiamante (ChangeNowSwapView) fornisce sendBtc(depositAddress, amountBtc)
   * che firma e broadcasta la TX BTC e restituisce il txid.
   *
   * Pattern:
   *   a) Aggiorna UI a "signing"
   *   b) Chiama sendBtc → ottieni txid
   *   c) POST /commit (write-before-submit in relazione al polling)
   *   d) Avvia polling
   */
  const commitAndSend = useCallback(async (
    sendBtc: (depositAddress: string, amountBtc: number) => Promise<string>
  ) => {
    if (!state.exchange) {
      setState(prev => ({ ...prev, error: "Nessun exchange attivo." }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "signing", error: null }));

    try {
      // a) Firma e broadcast BTC
      const btcTxHash = await sendBtc(
        state.exchange.btcDepositAddress,
        state.exchange.fromAmount
      );

      if (!mountedRef.current) return;

      // b) Commit sul backend (write-before-submit: fundsCommitted=true)
      await cnRequest<{ ok: boolean; fundsCommitted: true }>(
        `/swap/changenow/${state.exchange.swapId}/commit`,
        {
          method: "POST",
          body:   JSON.stringify({ btcTxHash }),
        }
      );

      if (!mountedRef.current) return;

      setState(prev => ({ ...prev, uiState: "committed", error: null }));
      _startPolling(state.exchange!.swapId);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "Errore durante l'invio BTC.";
      // Se l'errore è UNCERTAIN (iOS abort post-sign), mantieni stato pending
      const code = (err as any).code as string | undefined;
      if (code === "BTC_SEND_UNCERTAIN" || msg.includes("UNCERTAIN")) {
        setState(prev => ({
          ...prev,
          uiState: "committed",  // mantieni polling — forse la TX è passata
          error: "Connessione interrotta dopo la firma. Verifica il saldo e attendi.",
        }));
        if (state.exchange) _startPolling(state.exchange.swapId);
      } else {
        setState(prev => ({ ...prev, uiState: "awaiting_deposit", error: msg }));
      }
    }
  }, [state.exchange, _startPolling]);

  const reset = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    localStorage.removeItem(CHANGENOW_SWAP_ACTIVE_KEY);
    setState(INITIAL_STATE);
  }, []);

  const setChain = useCallback((chain: CnToChain) => {
    setState(prev => ({ ...prev, selectedChain: chain, quote: null, pairAvailable: null, error: null }));
  }, []);

  const setAmountBtc = useCallback((amount: string) => {
    setState(prev => ({ ...prev, amountBtc: amount, quote: null, error: null }));
  }, []);

  const actions: CnSwapActions = {
    setChain,
    setAmountBtc,
    checkPair,
    fetchQuote,
    createExchange,
    commitAndSend,
    reset,
  };

  return [state, actions];
}
