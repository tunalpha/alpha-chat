/**
 * useChangeNowSwapState — State machine BTC→any EVM token via ChangeNOW
 *
 * Versione estesa: tutti gli 8 ticker verificati (non solo USDT).
 *
 * ═══════════════════════════════════════════════════════════════
 *  REGOLA DOUBLE-SEND (ASSOLUTA):
 *    1. Recovery su mount: se cn_swap_active_id in localStorage
 *       → recupera swap dal backend → NESSUN nuovo send
 *    2. commitFunds() PRIMA del broadcast BTC (write-before-submit)
 *    3. fundsCommitted=true → blocco assoluto su nuovo exchange
 *
 *  REGOLA COMPLETED (ASSOLUTA):
 *    isCompleted = cnStatus=finished && destinationTxHash presente
 *                  && destinationTxHash !== btcTxHash
 *
 *  DESTINATION ADDRESS: sempre alphaWalletAddress (EVM unificato).
 *    MAI da input utente.
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
  type CnBtcDestToken,
  CN_BTC_DEST_TOKENS,
  CHANGENOW_SWAP_ACTIVE_KEY,
  isCnTerminal,
  humanizeCnError,
} from "./types.js";

// ── API helpers ───────────────────────────────────────────────────────────────

const TOKEN_KEY        = "ac_access_token";
const API_BASE         = "/api/v1";
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
  uiState:       CnUiState;
  selectedToken: CnBtcDestToken;   // token destinazione selezionato
  amountBtc:     string;
  quote:         CnQuote   | null;
  exchange:      CnCreateResult | null;
  status:        CnSwapStatusResult | null;
  error:         string | null;
  pairAvailable: boolean | null;
  /** Minimo BTC dinamico da ChangeNOW API — null finché checkPair non è completato */
  minAmountBtc:  number | null;
}

export interface CnSwapActions {
  setToken:       (token: CnBtcDestToken) => void;
  setAmountBtc:   (amount: string) => void;
  checkPair:      () => Promise<void>;
  fetchQuote:     () => Promise<void>;
  createExchange: (destinationEvmAddress: string) => Promise<void>;
  commitAndSend:  (sendBtc: (depositAddress: string, amountBtc: number) => Promise<string>) => Promise<void>;
  reset:          () => void;
}

const DEFAULT_TOKEN: CnBtcDestToken =
  CN_BTC_DEST_TOKENS.find(t => t.ticker === "usdtmatic")
  ?? CN_BTC_DEST_TOKENS[0]!;

const INITIAL_STATE: CnSwapState = {
  uiState:       "idle",
  selectedToken: DEFAULT_TOKEN,
  amountBtc:     "",
  quote:         null,
  exchange:      null,
  status:        null,
  error:         null,
  pairAvailable: null,
  minAmountBtc:  null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChangeNowSwapState(): [CnSwapState, CnSwapActions] {
  const [state, setState] = useState<CnSwapState>(INITIAL_STATE);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef   = useRef(true);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // ── Recovery su mount ────────────────────────────────────────────────────

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
          // Ricostruisci il token dal ticker salvato
          const token = CN_BTC_DEST_TOKENS.find(t => t.ticker === data.swap!.toTicker)
            ?? DEFAULT_TOKEN;
          setState(prev => ({
            ...prev,
            selectedToken: token,
            exchange: {
              swapId:            data.swap!.swapId,
              exchangeId:        data.swap!.exchangeId,
              btcDepositAddress: data.swap!.btcDepositAddress,
              estimatedToAmount: data.swap!.estimatedToAmount,
              fromAmount:        data.swap!.fromAmount,
              toTicker:          data.swap!.toTicker,
              toAsset:           data.swap!.toAsset,
              toChain:           data.swap!.toChain,
              toChainName:       data.swap!.toChainName,
            },
            status:  data.swap!,
            uiState: data.swap!.fundsCommitted ? "committed" : "awaiting_deposit",
          }));
          if (data.swap!.fundsCommitted) {
            _startPolling(data.swap!.swapId);
          }
        } else {
          localStorage.removeItem(CHANGENOW_SWAP_ACTIVE_KEY);
        }
      } catch {
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
          const mid: CnUiState =
            data.swap.cnStatus === "confirming" ? "confirming"
            : data.swap.cnStatus === "exchanging" ? "exchanging"
            : data.swap.cnStatus === "sending"    ? "sending"
            : "committed";
          setState(prev => ({ ...prev, uiState: mid }));
        }
      } catch {
        // Polling error silenzioso — continua
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const setToken = useCallback((token: CnBtcDestToken) => {
    setState(prev => ({
      ...prev,
      selectedToken: token,
      quote:         null,
      pairAvailable: null,
      minAmountBtc:  null,
      error:         null,
    }));
  }, []);

  const setAmountBtc = useCallback((amount: string) => {
    setState(prev => ({ ...prev, amountBtc: amount, quote: null, error: null }));
  }, []);

  const checkPair = useCallback(async () => {
    setState(prev => ({ ...prev, uiState: "checking_pair", error: null, pairAvailable: null }));
    try {
      const data = await cnRequest<{ ok: boolean; available: boolean; minAmountBtc?: number }>(
        `/swap/changenow/pairs/${state.selectedToken.ticker}`
      );
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        pairAvailable: data.available,
        minAmountBtc:  data.available ? (data.minAmountBtc ?? null) : null,
        uiState: data.available ? "idle" : "pair_unavailable",
        error: data.available ? null : `La coppia BTC→${state.selectedToken.symbol} non è disponibile.`,
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
  }, [state.selectedToken.ticker, state.selectedToken.symbol]);

  const fetchQuote = useCallback(async () => {
    const amountNum = parseFloat(state.amountBtc);
    if (!amountNum || amountNum <= 0) {
      setState(prev => ({ ...prev, error: "Inserisci un importo valido." }));
      return;
    }
    // Validazione minimo dinamico da ChangeNOW — usa il valore numerico reale (no arrotondamento)
    if (state.minAmountBtc !== null && amountNum < state.minAmountBtc) {
      setState(prev => ({
        ...prev,
        error: `Importo minimo: ${state.minAmountBtc} BTC per questa coppia`,
      }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "quoting", error: null }));
    try {
      const data = await cnRequest<{ ok: boolean; quote: CnQuote }>(
        "/swap/changenow/quote",
        {
          method: "POST",
          body:   JSON.stringify({ fromAmountBtc: amountNum, toTicker: state.selectedToken.ticker }),
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
        error: err instanceof Error ? err.message : "Errore nella stima.",
      }));
    }
  }, [state.amountBtc, state.selectedToken.ticker]);

  const createExchange = useCallback(async (destinationEvmAddress: string) => {
    if (!state.quote) { setState(prev => ({ ...prev, error: "Ottieni prima una stima." })); return; }
    if (!destinationEvmAddress || destinationEvmAddress.length < 10) {
      setState(prev => ({ ...prev, error: "Sblocca Alpha Wallet per continuare." }));
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
            toTicker:              state.selectedToken.ticker,
            destinationEvmAddress,
          }),
        }
      );
      if (!mountedRef.current) return;
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
        error: err instanceof Error ? err.message : "Errore creazione exchange.",
      }));
    }
  }, [state.quote, state.selectedToken.ticker]);

  const commitAndSend = useCallback(async (
    sendBtc: (depositAddress: string, amountBtc: number) => Promise<string>
  ) => {
    if (!state.exchange) {
      setState(prev => ({ ...prev, error: "Nessun exchange attivo." }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "signing", error: null }));

    try {
      const btcTxHash = await sendBtc(
        state.exchange.btcDepositAddress,
        state.exchange.fromAmount
      );

      if (!mountedRef.current) return;

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
      const msg  = err instanceof Error ? err.message : "Errore invio BTC.";
      const code = (err as any).code as string | undefined;
      if (code === "BTC_SEND_UNCERTAIN" || msg.includes("UNCERTAIN")) {
        setState(prev => ({
          ...prev,
          uiState: "committed",
          error:   "Connessione interrotta dopo la firma. Verifica il saldo e attendi.",
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

  const actions: CnSwapActions = {
    setToken,
    setAmountBtc,
    checkPair,
    fetchQuote,
    createExchange,
    commitAndSend,
    reset,
  };

  return [state, actions];
}
