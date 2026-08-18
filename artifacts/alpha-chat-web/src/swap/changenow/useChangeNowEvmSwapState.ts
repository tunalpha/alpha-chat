/**
 * useChangeNowEvmSwapState — State machine per swap EVM→EVM via ChangeNOW
 *
 * ═══════════════════════════════════════════════════════════════
 *  SOURCE OF TRUTH: ChangeNOW API
 *
 *  REGOLA COMPLETED (ASSOLUTA):
 *    swap.isCompleted (calcolato dal backend):
 *      cnStatus === "finished"
 *      && destinationTxHash !== null
 *      && destinationTxHash !== depositTxHash
 *
 *  DESTINATION ADDRESS: automatico (mai da input utente).
 *    Priorità: alphaWalletAddress → activeEvmAddress (Reown)
 *
 *  CRONOLOGIA ALPHA — UN SOLO RECORD per swap:
 *    id = "cn_evm:{swapId}"
 *    Aggiornato idempotente a ogni cambio stato.
 *
 *  NOTIFICHE — dedup obbligatorio:
 *    txHash = "cn_evm:{swapId}:{eventType}" → mai doppio invio
 *
 *  RECOVERY: al mount, se localStorage ha "cn_evm_swap_active_id",
 *    recupera dal backend e riprende il polling senza nuovo exchange.
 *
 *  ISOLAMENTO: zero import da lifi-client, useEvmSwapState, payment engine,
 *    USDA, MultiChain, Spark. Usa saveTxRecord + dispatchWalletNotification.
 * ═══════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CnEvmToken,
  type CnEvmQuote,
  type CnEvmCreateResult,
  type CnEvmSwapStatusResult,
  type CnEvmUiState,
  CHANGENOW_EVM_SWAP_KEY,
  humanizeCnEvmError,
  isCnEvmTerminalUiState,
  cnEvmTokenByTicker,
  CN_EVM_TOKENS,
} from "./evm-types.js";
import { saveTxRecord } from "../../wallet/services/tx-store.js";
import { dispatchWalletNotification } from "../../wallet/notifications/wallet-notification-store.js";

// ── API helpers ───────────────────────────────────────────────────────────────

const TOKEN_KEY        = "ac_access_token";
const API_BASE         = "/api/v1";
const POLL_INTERVAL_MS = 15_000;

async function cnEvmRequest<T>(path: string, opts: RequestInit = {}): Promise<T> {
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
    const err = new Error(humanizeCnEvmError(code));
    (err as any).code = code;
    throw err;
  }
  return res.json() as Promise<T>;
}

// ── Notification dedup helper ─────────────────────────────────────────────────
// Usa un txHash sintetico "cn_evm:{swapId}:{eventType}" per garantire
// che ogni evento (confirming, completed, failed, ecc.) emetta al più
// UNA notifica, anche se il polling riceve più volte lo stesso stato.

async function _emitNotification(
  swapId:    string,
  eventType: "confirming" | "completed" | "failed" | "refunded" | "expired",
  fromToken: CnEvmToken,
  toToken:   CnEvmToken | undefined,
  swap:      CnEvmSwapStatusResult
): Promise<void> {
  // txHash sintetico — unico per (swap, eventType) → garantisce dedup
  const syntheticTxHash = `cn_evm:${swapId}:${eventType}`;

  // Per completed, usiamo destinationTxHash se disponibile
  const txHash =
    (eventType === "completed" && swap.destinationTxHash)
      ? swap.destinationTxHash
      : syntheticTxHash;

  const chainId = fromToken.chainId;
  const network = fromToken.network;

  if (eventType === "confirming") {
    await dispatchWalletNotification({
      type:    "pending",
      chainId,
      network,
      asset:   fromToken.symbol,
      amount:  String(swap.fromAmount),
      txHash,
      timestamp: Date.now(),
      status:  "pending",
      txType:  "swap",
      swapToAsset: toToken?.symbol,
    });
  } else if (eventType === "completed") {
    await dispatchWalletNotification({
      type:    "received",
      chainId: toToken?.chainId ?? chainId,
      network: toToken?.network ?? network,
      asset:   toToken?.symbol ?? swap.toTicker,
      amount:  String(swap.estimatedToAmount),
      txHash,
      timestamp: Date.now(),
      status:  "confirmed",
      txType:  "swap",
      swapToAsset: fromToken.symbol,
    });
  } else if (eventType === "failed" || eventType === "expired") {
    await dispatchWalletNotification({
      type:    "failed",
      chainId,
      network,
      asset:   fromToken.symbol,
      amount:  String(swap.fromAmount),
      txHash,
      timestamp: Date.now(),
      status:  "failed",
      txType:  "swap",
      swapToAsset: toToken?.symbol,
    });
  } else if (eventType === "refunded") {
    await dispatchWalletNotification({
      type:    "failed",
      chainId,
      network,
      asset:   fromToken.symbol,
      amount:  String(swap.fromAmount),
      txHash,
      timestamp: Date.now(),
      status:  "failed",
      txType:  "swap",
      swapToAsset: toToken?.symbol,
    });
  }
}

// ── History helper ────────────────────────────────────────────────────────────
// Un SOLO record logico per swap — aggiornato idempotente.
// Non-downgrade: se già "confirmed", non torna a "pending".

async function _updateHistory(
  swapId:    string,
  swap:      CnEvmSwapStatusResult,
  fromToken: CnEvmToken,
  toToken:   CnEvmToken | undefined
): Promise<void> {
  const id = `cn_evm:${swapId}`;
  const now = Date.now();

  const status =
    swap.isCompleted ? "confirmed"
    : (["failed","refunded","expired","error"].includes(swap.cnStatus)) ? "failed"
    : "pending";

  await saveTxRecord({
    id,
    chainId:      fromToken.chainId,
    network:      fromToken.network,
    // Usiamo depositTxHash quando disponibile; altrimenti swapId come placeholder
    txHash:       swap.depositTxHash ?? `cn_evm_placeholder:${swapId}`,
    direction:    "out",
    asset:        fromToken.symbol,
    amount:       String(swap.fromAmount),
    fromAddress:  swap.destinationAddress,        // indirizzo utente (source)
    toAddress:    swap.depositEvmAddress,         // indirizzo ChangeNOW
    timestamp:    now,
    status,
    txType:       "swap",
    swapToAsset:  toToken?.symbol ?? swap.toTicker,
    swapToAmount: swap.isCompleted ? String(swap.estimatedToAmount) : undefined,
    updatedAt:    now,
  });
}

// ── State ─────────────────────────────────────────────────────────────────────

export interface CnEvmSwapState {
  uiState:          CnEvmUiState;
  fromToken:        CnEvmToken | null;
  toToken:          CnEvmToken | null;
  fromAmount:       string;
  quote:            CnEvmQuote   | null;
  exchange:         CnEvmCreateResult | null;
  status:           CnEvmSwapStatusResult | null;
  error:            string | null;
  pairAvailable:    boolean | null;
  minAmount:        number | null;
  /** Indirizzo EVM destinazione (auto, mai da input) */
  destinationAddr:  string | null;
}

export interface CnEvmSwapActions {
  setFromToken:    (t: CnEvmToken) => void;
  setToToken:      (t: CnEvmToken) => void;
  setFromAmount:   (a: string) => void;
  checkPair:       () => Promise<void>;
  fetchQuote:      () => Promise<void>;
  createExchange:  () => Promise<void>;
  /**
   * Commit + inizio polling.
   * sendEvm firma e broadcasta la TX EVM e restituisce il txHash.
   */
  commitAndSend:   (sendEvm: (depositEvmAddress: string, fromToken: CnEvmToken, amount: number) => Promise<string>) => Promise<void>;
  reset:           () => void;
}

const DEFAULT_FROM = CN_EVM_TOKENS.find(t => t.ticker === "pol") ?? CN_EVM_TOKENS[0]!;
const DEFAULT_TO   = CN_EVM_TOKENS.find(t => t.ticker === "usdcmatic") ?? CN_EVM_TOKENS[1]!;

const INITIAL_STATE: CnEvmSwapState = {
  uiState:        "idle",
  fromToken:      DEFAULT_FROM,
  toToken:        DEFAULT_TO,
  fromAmount:     "",
  quote:          null,
  exchange:       null,
  status:         null,
  error:          null,
  pairAvailable:  null,
  minAmount:      null,
  destinationAddr: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChangeNowEvmSwapState(
  /** Indirizzo EVM automatico — Alpha Wallet o Reown (mai input manuale) */
  destinationAddress: string | null | undefined
): [CnEvmSwapState, CnEvmSwapActions] {
  const [state, setState] = useState<CnEvmSwapState>({
    ...INITIAL_STATE,
    destinationAddr: destinationAddress ?? null,
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef   = useRef(true);
  // Tiene traccia degli eventi già notificati — dedup in-memory aggiuntivo
  const notifiedRef  = useRef<Set<string>>(new Set());

  // ── Sync destinationAddress se cambia account ─────────────────────────────
  useEffect(() => {
    setState(prev => {
      // Se cambia indirizzo durante uno swap non-terminale → invalida lo stato
      if (
        prev.destinationAddr !== null
        && destinationAddress
        && prev.destinationAddr !== destinationAddress
        && prev.exchange !== null
        && !isCnEvmTerminalUiState(prev.uiState)
      ) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        localStorage.removeItem(CHANGENOW_EVM_SWAP_KEY);
        return {
          ...INITIAL_STATE,
          destinationAddr: destinationAddress,
          error: "Account cambiato — ripeti il processo di swap.",
        };
      }
      return { ...prev, destinationAddr: destinationAddress ?? null };
    });
  }, [destinationAddress]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // ── Recovery al mount ─────────────────────────────────────────────────────

  useEffect(() => {
    const savedId = localStorage.getItem(CHANGENOW_EVM_SWAP_KEY);
    if (!savedId) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await cnEvmRequest<{ ok: boolean; swap: CnEvmSwapStatusResult | null }>(
          "/swap/changenow/evm/active"
        );
        if (cancelled || !mountedRef.current) return;
        const swap = data.swap;
        if (swap && !swap.isTerminal) {
          const fromTok = cnEvmTokenByTicker(swap.fromTicker) ?? DEFAULT_FROM;
          const toTok   = cnEvmTokenByTicker(swap.toTicker) ?? DEFAULT_TO;
          setState(prev => ({
            ...prev,
            exchange: {
              swapId:             swap.swapId,
              exchangeId:         swap.exchangeId,
              depositEvmAddress:  swap.depositEvmAddress,
              expectedFromAmount: swap.fromAmount,
              expectedToAmount:   swap.estimatedToAmount,
              fromTicker:         swap.fromTicker,
              toTicker:           swap.toTicker,
              destinationAddress: swap.destinationAddress,
            },
            fromToken:   fromTok,
            toToken:     toTok,
            status:      swap,
            uiState:     swap.fundsCommitted ? "committed" : "awaiting_deposit",
            destinationAddr: swap.destinationAddress,
          }));
          if (swap.fundsCommitted) {
            _startPolling(swap.swapId, fromTok, toTok);
          }
        } else {
          localStorage.removeItem(CHANGENOW_EVM_SWAP_KEY);
        }
      } catch {
        if (!cancelled) localStorage.removeItem(CHANGENOW_EVM_SWAP_KEY);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────

  const _startPolling = useCallback((
    swapId:    string,
    fromToken: CnEvmToken,
    toToken:   CnEvmToken
  ) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const data = await cnEvmRequest<{ ok: boolean; swap: CnEvmSwapStatusResult }>(
          `/swap/changenow/evm/${swapId}/status`
        );
        if (!mountedRef.current) return;
        const swap = data.swap;

        // Aggiorna history (idempotente)
        await _updateHistory(swapId, swap, fromToken, toToken).catch(() => {});

        // Emetti notifiche (idempotente via dedupKey sintetico)
        const notifKey = (evt: string) => `${swapId}:${evt}`;

        if (
          ["confirming","verifying"].includes(swap.cnStatus)
          && !notifiedRef.current.has(notifKey("confirming"))
        ) {
          notifiedRef.current.add(notifKey("confirming"));
          await _emitNotification(swapId, "confirming", fromToken, toToken, swap).catch(() => {});
        }

        if (swap.isCompleted && !notifiedRef.current.has(notifKey("completed"))) {
          notifiedRef.current.add(notifKey("completed"));
          await _emitNotification(swapId, "completed", fromToken, toToken, swap).catch(() => {});
        }

        if (swap.cnStatus === "refunded" && !notifiedRef.current.has(notifKey("refunded"))) {
          notifiedRef.current.add(notifKey("refunded"));
          await _emitNotification(swapId, "refunded", fromToken, toToken, swap).catch(() => {});
        }

        if (
          ["failed","error"].includes(swap.cnStatus)
          && !notifiedRef.current.has(notifKey("failed"))
        ) {
          notifiedRef.current.add(notifKey("failed"));
          await _emitNotification(swapId, "failed", fromToken, toToken, swap).catch(() => {});
        }

        if (swap.cnStatus === "expired" && !notifiedRef.current.has(notifKey("expired"))) {
          notifiedRef.current.add(notifKey("expired"));
          await _emitNotification(swapId, "expired", fromToken, toToken, swap).catch(() => {});
        }

        setState(prev => ({ ...prev, status: swap }));

        if (swap.isCompleted) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          localStorage.removeItem(CHANGENOW_EVM_SWAP_KEY);
          setState(prev => ({ ...prev, uiState: "completed" }));
        } else if (swap.isTerminal) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          localStorage.removeItem(CHANGENOW_EVM_SWAP_KEY);
          const terminalUi: CnEvmUiState =
            swap.cnStatus === "refunded" ? "refunded"
            : swap.cnStatus === "expired" ? "expired"
            : "failed";
          setState(prev => ({ ...prev, uiState: terminalUi }));
        } else {
          const mid: CnEvmUiState =
            ["confirming","verifying"].includes(swap.cnStatus) ? "confirming"
            : swap.cnStatus === "exchanging" ? "exchanging"
            : swap.cnStatus === "sending"    ? "sending"
            : "committed";
          setState(prev => ({ ...prev, uiState: mid }));
        }
      } catch {
        // Errore polling — continua (resilienza rete)
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const setFromToken = useCallback((t: CnEvmToken) => {
    setState(prev => ({
      ...prev, fromToken: t, quote: null, pairAvailable: null,
      minAmount: null, error: null, uiState: "idle",
    }));
  }, []);

  const setToToken = useCallback((t: CnEvmToken) => {
    setState(prev => ({
      ...prev, toToken: t, quote: null, pairAvailable: null,
      minAmount: null, error: null, uiState: "idle",
    }));
  }, []);

  const setFromAmount = useCallback((a: string) => {
    setState(prev => ({ ...prev, fromAmount: a, quote: null, error: null }));
  }, []);

  const checkPair = useCallback(async () => {
    const from = state.fromToken;
    const to   = state.toToken;
    if (!from || !to) return;
    if (from.ticker === to.ticker) {
      setState(prev => ({
        ...prev,
        pairAvailable: false,
        uiState: "pair_unavailable",
        error: "Seleziona token diversi.",
      }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "checking_pair", error: null, pairAvailable: null }));
    try {
      const data = await cnEvmRequest<{ ok: boolean; available: boolean; minAmount?: number }>(
        `/swap/changenow/evm/pairs/${from.ticker}/${to.ticker}`
      );
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        pairAvailable: data.available,
        minAmount:     data.minAmount ?? null,
        uiState:       data.available ? "ready" : "pair_unavailable",
        error:         data.available ? null : "Coppia non disponibile. Prova un'altra combinazione.",
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        uiState: "error",
        error:   err instanceof Error ? err.message : "Errore verifica coppia.",
        pairAvailable: false,
      }));
    }
  }, [state.fromToken, state.toToken]);

  const fetchQuote = useCallback(async () => {
    const from   = state.fromToken;
    const to     = state.toToken;
    const amount = parseFloat(state.fromAmount);
    if (!from || !to || !amount || amount <= 0) {
      setState(prev => ({ ...prev, error: "Inserisci un importo valido." }));
      return;
    }
    if (state.minAmount && amount < state.minAmount) {
      setState(prev => ({
        ...prev,
        error: `Importo minimo: ${state.minAmount} ${from.symbol}`,
      }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "quoting", error: null }));
    try {
      const data = await cnEvmRequest<{ ok: boolean; quote: CnEvmQuote }>(
        "/swap/changenow/evm/quote",
        {
          method: "POST",
          body: JSON.stringify({ fromTicker: from.ticker, toTicker: to.ticker, fromAmount: amount }),
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
  }, [state.fromToken, state.toToken, state.fromAmount, state.minAmount]);

  const createExchange = useCallback(async () => {
    const { quote, fromToken: from, toToken: to, destinationAddr } = state;
    if (!quote || !from || !to) {
      setState(prev => ({ ...prev, error: "Ottieni prima una stima." }));
      return;
    }
    if (!destinationAddr || destinationAddr.length < 10) {
      setState(prev => ({
        ...prev,
        error: "Nessun wallet EVM connesso. Sblocca Alpha Wallet per continuare.",
      }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "creating", error: null }));
    try {
      const data = await cnEvmRequest<CnEvmCreateResult & { ok: boolean }>(
        "/swap/changenow/evm/create",
        {
          method: "POST",
          body: JSON.stringify({
            fromTicker:            from.ticker,
            toTicker:              to.ticker,
            fromAmount:            quote.fromAmount,
            destinationEvmAddress: destinationAddr,
            refundEvmAddress:      destinationAddr,
          }),
        }
      );
      if (!mountedRef.current) return;
      localStorage.setItem(CHANGENOW_EVM_SWAP_KEY, data.swapId);
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
  }, [state.quote, state.fromToken, state.toToken, state.destinationAddr]);

  /**
   * commitAndSend — sequenza sicura anti-double-spend:
   *   1. Chiama sendEvm (firma e broadcast TX EVM nel wallet utente)
   *   2. POST /commit con depositTxHash (write-before-submit)
   *   3. Avvia polling
   *
   * Il server NON fa mai il broadcast: solo il wallet dell'utente firma e invia.
   */
  const commitAndSend = useCallback(async (
    sendEvm: (depositEvmAddress: string, fromToken: CnEvmToken, amount: number) => Promise<string>
  ) => {
    const { exchange, fromToken: from, toToken: to } = state;
    if (!exchange || !from || !to) {
      setState(prev => ({ ...prev, error: "Nessun exchange attivo." }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "signing", error: null }));

    try {
      // 1. Firma e broadcast nel wallet utente → ottieni depositTxHash
      const depositTxHash = await sendEvm(
        exchange.depositEvmAddress,
        from,
        exchange.expectedFromAmount
      );

      if (!mountedRef.current) return;

      // 2. Commit sul backend (write-before-submit)
      await cnEvmRequest<{ ok: boolean; fundsCommitted: true }>(
        `/swap/changenow/evm/${exchange.swapId}/commit`,
        {
          method: "POST",
          body: JSON.stringify({ depositTxHash }),
        }
      );

      if (!mountedRef.current) return;

      // 3. Salva history con depositTxHash
      await _updateHistory(exchange.swapId, {
        ...((state.status) ?? {
          swapId:             exchange.swapId,
          exchangeId:         exchange.exchangeId,
          cnStatus:           "waiting",
          fromAmount:         exchange.expectedFromAmount,
          estimatedToAmount:  exchange.expectedToAmount,
          depositEvmAddress:  exchange.depositEvmAddress,
          destinationAddress: exchange.destinationAddress,
          depositTxHash,
          destinationTxHash:  null,
          fundsCommitted:     true,
          fromTicker:         exchange.fromTicker,
          toTicker:           exchange.toTicker,
          refundDetails:      null,
          isTerminal:         false,
          isCompleted:        false,
        }),
        depositTxHash,
        fundsCommitted: true,
      }, from, to).catch(() => {});

      setState(prev => ({ ...prev, uiState: "committed", error: null }));
      _startPolling(exchange.swapId, from, to);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg  = err instanceof Error ? err.message : "Errore durante l'invio dei token.";
      const code = (err as any).code as string | undefined;
      // Pattern iOS-abort post-sign: continua il polling
      if (code === "EVM_SEND_UNCERTAIN" || msg.includes("UNCERTAIN") || msg.includes("Load failed")) {
        setState(prev => ({
          ...prev,
          uiState: "committed",
          error: "Connessione interrotta dopo la firma. Verifica il saldo e attendi.",
        }));
        if (exchange) _startPolling(exchange.swapId, from, to);
      } else {
        setState(prev => ({ ...prev, uiState: "awaiting_deposit", error: msg }));
      }
    }
  }, [state.exchange, state.fromToken, state.toToken, state.status, _startPolling]);

  const reset = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    localStorage.removeItem(CHANGENOW_EVM_SWAP_KEY);
    notifiedRef.current.clear();
    setState({ ...INITIAL_STATE, destinationAddr: destinationAddress ?? null });
  }, [destinationAddress]);

  const actions: CnEvmSwapActions = {
    setFromToken,
    setToToken,
    setFromAmount,
    checkPair,
    fetchQuote,
    createExchange,
    commitAndSend,
    reset,
  };

  return [state, actions];
}
