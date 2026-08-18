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
    const body = await res.json().catch(() => ({})) as {
      code?: string;
      error?: { code?: string };
    };
    // L'API usa il formato standard { error: { code, ... } }. Supportiamo anche
    // il vecchio formato piatto per non trasformare un errore utile in HTTP_400.
    const code = body.error?.code ?? body.code ?? `HTTP_${res.status}`;
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
  destinationAddr:     string | null;
  /** Indirizzo BTC destinazione per swap EVM→BTC (auto, mai da input) */
  btcDestinationAddr:  string | null;
}

export interface CnEvmSwapActions {
  setFromToken:    (t: CnEvmToken) => void;
  setToToken:      (t: CnEvmToken) => void;
  setFromAmount:   (a: string) => void;
  checkPair:       () => Promise<void>;
  fetchQuote:      () => Promise<void>;
  createExchange:  () => Promise<void>;
  /** Commit EVM→EVM: firma TX EVM → commit → polling. */
  commitAndSend:   (sendEvm: (depositEvmAddress: string, fromToken: CnEvmToken, amount: number) => Promise<string>) => Promise<void>;
  /** Commit BTC→EVM: chiamato dopo sendBtcForSwap → commit → polling. */
  commitBtcSwap:      (btcTxHash: string) => Promise<void>;
  /** Flusso completo BTC→EVM (signing → send → commit → poll). */
  commitAndSendBtc:   (sendBtc: (params: { toAddress: string; amountSat: bigint }) => Promise<string>) => Promise<void>;
  reset:           () => void;
}

const DEFAULT_FROM = CN_EVM_TOKENS.find(t => t.ticker === "pol") ?? CN_EVM_TOKENS[0]!;
const DEFAULT_TO   = CN_EVM_TOKENS.find(t => t.ticker === "usdcmatic") ?? CN_EVM_TOKENS[1]!;

const INITIAL_STATE: CnEvmSwapState = {
  uiState:            "idle",
  fromToken:          DEFAULT_FROM,
  toToken:            DEFAULT_TO,
  fromAmount:         "",
  quote:              null,
  exchange:           null,
  status:             null,
  error:              null,
  pairAvailable:      null,
  minAmount:          null,
  destinationAddr:    null,
  btcDestinationAddr: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChangeNowEvmSwapState(
  /** Indirizzo EVM automatico — Alpha Wallet o Reown (mai input manuale) */
  destinationAddress:    string | null | undefined,
  /** Indirizzo BTC automatico — Alpha Wallet (per swap EVM→BTC) */
  btcDestinationAddress: string | null | undefined = null
): [CnEvmSwapState, CnEvmSwapActions] {
  const [state, setState] = useState<CnEvmSwapState>({
    ...INITIAL_STATE,
    destinationAddr:    destinationAddress ?? null,
    btcDestinationAddr: btcDestinationAddress ?? null,
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef   = useRef(true);
  // Tiene traccia degli eventi già notificati — dedup in-memory aggiuntivo
  const notifiedRef  = useRef<Set<string>>(new Set());

  // ── Sync destinationAddress se cambia account ─────────────────────────────
  useEffect(() => {
    setState(prev => {
      // Se cambia indirizzo EVM durante uno swap non-terminale → invalida lo stato
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
          destinationAddr:    destinationAddress,
          btcDestinationAddr: btcDestinationAddress ?? null,
          error: "Account cambiato — ripeti il processo di swap.",
        };
      }
      return { ...prev, destinationAddr: destinationAddress ?? null };
    });
  }, [destinationAddress]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync btcDestinationAddress ────────────────────────────────────────────
  useEffect(() => {
    setState(prev => ({ ...prev, btcDestinationAddr: btcDestinationAddress ?? null }));
  }, [btcDestinationAddress]);

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
    toToken:   CnEvmToken,
    swapKind:  "evm" | "btc" = "evm"
  ) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const statusUrl = swapKind === "btc"
          ? `/swap/changenow/${swapId}/status`
          : `/swap/changenow/evm/${swapId}/status`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawData = await cnEvmRequest<{ ok: boolean; swap: any }>(statusUrl);

        // Adatta risposta BTC → forma CnEvmSwapStatusResult
        const rawSwap = rawData.swap;
        const adaptedSwap: CnEvmSwapStatusResult = swapKind === "btc"
          ? {
              swapId:             rawSwap.swapId,
              exchangeId:         rawSwap.exchangeId,
              cnStatus:           rawSwap.cnStatus,
              fromAmount:         rawSwap.fromAmount,
              estimatedToAmount:  rawSwap.estimatedToAmount,
              depositEvmAddress:  rawSwap.btcDepositAddress,
              destinationAddress: rawSwap.destinationEvmAddress,
              depositTxHash:      rawSwap.btcTxHash,
              destinationTxHash:  rawSwap.destinationTxHash,
              fundsCommitted:     rawSwap.fundsCommitted,
              fromTicker:         "btc",
              toTicker:           rawSwap.toTicker,
              refundDetails:      rawSwap.refundDetails ?? null,
              isTerminal:         rawSwap.isTerminal,
              isCompleted:        rawSwap.isCompleted,
            }
          : rawData.swap as CnEvmSwapStatusResult;

        const data = { ok: rawData.ok, swap: adaptedSwap };
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
      // BTC→EVM: usa endpoint BTC (/swap/changenow/pairs/:toTicker)
      // EVM→EVM: usa endpoint EVM (/swap/changenow/evm/pairs/:from/:to)
      const isBtcFrom = from.ticker === "btc";
      let available = false;
      let minAmount: number | null = null;

      if (isBtcFrom) {
        const data = await cnEvmRequest<{ ok: boolean; available: boolean; minAmountBtc?: number }>(
          `/swap/changenow/pairs/${to.ticker}`
        );
        if (!mountedRef.current) return;
        available = data.available;
        minAmount = data.minAmountBtc ?? null;
      } else {
        const data = await cnEvmRequest<{ ok: boolean; available: boolean; minAmount?: number }>(
          `/swap/changenow/evm/pairs/${from.ticker}/${to.ticker}`
        );
        if (!mountedRef.current) return;
        available = data.available;
        minAmount = data.minAmount ?? null;
      }

      setState(prev => ({
        ...prev,
        pairAvailable: available,
        minAmount,
        uiState:       available ? "ready" : "pair_unavailable",
        error:         available ? null : "Coppia non disponibile. Prova un'altra combinazione.",
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
      const isBtcFrom = from.ticker === "btc";
      let quote: CnEvmQuote;

      if (isBtcFrom) {
        // BTC→EVM: endpoint BTC restituisce { quote: { estimatedToAmount, fromAmount } }
        const data = await cnEvmRequest<{ ok: boolean; quote: { estimatedToAmount: number; fromAmount: number } }>(
          "/swap/changenow/quote",
          { method: "POST", body: JSON.stringify({ fromAmountBtc: amount, toTicker: to.ticker }) }
        );
        if (!mountedRef.current) return;
        quote = {
          fromTicker:        "btc",
          toTicker:          to.ticker,
          fromAmount:        data.quote.fromAmount,
          estimatedToAmount: data.quote.estimatedToAmount,
          minAmount:         state.minAmount ?? 0,
        };
      } else {
        // EVM→EVM
        const data = await cnEvmRequest<{ ok: boolean; quote: CnEvmQuote }>(
          "/swap/changenow/evm/quote",
          { method: "POST", body: JSON.stringify({ fromTicker: from.ticker, toTicker: to.ticker, fromAmount: amount }) }
        );
        if (!mountedRef.current) return;
        quote = data.quote;
      }

      setState(prev => ({
        ...prev,
        quote,
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
    const {
      quote, fromToken: from, toToken: to,
      destinationAddr, btcDestinationAddr,
    } = state;
    if (!quote || !from || !to) {
      setState(prev => ({ ...prev, error: "Ottieni prima una stima." }));
      return;
    }

    const isBtcFrom = from.ticker === "btc";
    const isBtcTo   = to.ticker   === "btc";

    // Guard indirizzo destinazione
    if (isBtcFrom || !isBtcTo) {
      // BTC→EVM o EVM→EVM: serve EVM address
      if (!destinationAddr || destinationAddr.length < 10) {
        setState(prev => ({
          ...prev,
          error: "Nessun wallet EVM connesso. Sblocca Alpha Wallet per continuare.",
        }));
        return;
      }
    }
    if (isBtcTo) {
      // EVM→BTC o BTC→EVM: serve BTC address
      if (!btcDestinationAddr || btcDestinationAddr.length < 10) {
        setState(prev => ({
          ...prev,
          error: "Nessun indirizzo BTC disponibile. Sblocca Alpha Wallet (BTC).",
        }));
        return;
      }
    }

    setState(prev => ({ ...prev, uiState: "creating", error: null }));
    try {
      let exchange: CnEvmCreateResult;

      if (isBtcFrom) {
        // BTC→EVM: endpoint BTC (/swap/changenow/create)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await cnEvmRequest<any>(
          "/swap/changenow/create",
          {
            method: "POST",
            body: JSON.stringify({
              fromAmountBtc:         quote.fromAmount,
              toTicker:              to.ticker,
              // Se TO=BTC (improbabile ma gestito): usa btcDestinationAddr
              destinationEvmAddress: isBtcTo
                ? btcDestinationAddr!
                : destinationAddr!,
            }),
          }
        );
        if (!mountedRef.current) return;
        exchange = {
          swapId:             data.swapId,
          exchangeId:         data.exchangeId,
          depositEvmAddress:  data.btcDepositAddress,   // BTC deposit address ChangeNOW
          expectedFromAmount: data.fromAmount,
          expectedToAmount:   data.estimatedToAmount,
          fromTicker:         "btc",
          toTicker:           to.ticker,
          destinationAddress: isBtcTo ? btcDestinationAddr! : destinationAddr!,
        };
      } else {
        // EVM→EVM o EVM→BTC: endpoint EVM
        //   destinationEvmAddress = btcAddr quando TO=BTC, altrimenti evmAddr
        //   refundEvmAddress      = sempre EVM address (source chain)
        const destinationForCreate = isBtcTo ? btcDestinationAddr! : destinationAddr!;
        const refundForCreate      = destinationAddr!;

        const data = await cnEvmRequest<CnEvmCreateResult & { ok: boolean }>(
          "/swap/changenow/evm/create",
          {
            method: "POST",
            body: JSON.stringify({
              fromTicker:            from.ticker,
              toTicker:              to.ticker,
              fromAmount:            quote.fromAmount,
              destinationEvmAddress: destinationForCreate,
              refundEvmAddress:      refundForCreate,
            }),
          }
        );
        if (!mountedRef.current) return;
        exchange = {
          ...data,
          destinationAddress: destinationForCreate,
        };
      }

      localStorage.setItem(CHANGENOW_EVM_SWAP_KEY, exchange.swapId);
      setState(prev => ({
        ...prev,
        exchange,
        uiState: "awaiting_deposit",
        error:   null,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState(prev => ({
        ...prev,
        uiState: "idle",
        error:   err instanceof Error ? err.message : "Errore creazione exchange.",
      }));
    }
  }, [state.quote, state.fromToken, state.toToken, state.destinationAddr, state.btcDestinationAddr]);

  /**
   * commitAndSend (EVM→EVM) — sequenza sicura anti-double-spend:
   *   1. Chiama sendEvm (firma e broadcast TX EVM nel wallet utente)
   *   2. POST /evm/:swapId/commit con depositTxHash (write-before-submit)
   *   3. Avvia polling
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
      _startPolling(exchange.swapId, from, to, "evm");
    } catch (err) {
      if (!mountedRef.current) return;
      const msg  = err instanceof Error ? err.message : "Errore durante l'invio dei token.";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any).code as string | undefined;
      // Pattern iOS-abort post-sign: continua il polling
      if (code === "EVM_SEND_UNCERTAIN" || msg.includes("UNCERTAIN") || msg.includes("Load failed")) {
        setState(prev => ({
          ...prev,
          uiState: "committed",
          error: "Connessione interrotta dopo la firma. Verifica il saldo e attendi.",
        }));
        if (exchange) _startPolling(exchange.swapId, from, to, "evm");
      } else {
        setState(prev => ({ ...prev, uiState: "awaiting_deposit", error: msg }));
      }
    }
  }, [state.exchange, state.fromToken, state.toToken, state.status, _startPolling]);

  /**
   * commitBtcSwap (BTC→EVM) — dopo sendBtcForSwap:
   *   1. POST /swap/changenow/:swapId/commit con btcTxHash
   *   2. Avvia polling via endpoint BTC
   */
  const commitBtcSwap = useCallback(async (btcTxHash: string) => {
    const { exchange, fromToken: from, toToken: to } = state;
    if (!exchange || !from || !to) {
      setState(prev => ({ ...prev, error: "Nessun exchange BTC attivo." }));
      return;
    }
    try {
      await cnEvmRequest<{ ok: boolean; fundsCommitted: true }>(
        `/swap/changenow/${exchange.swapId}/commit`,
        { method: "POST", body: JSON.stringify({ btcTxHash }) }
      );
      if (!mountedRef.current) return;
      setState(prev => ({ ...prev, uiState: "committed", error: null }));
      _startPolling(exchange.swapId, from, to, "btc");
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "Errore commit BTC.";
      // Pattern iOS-abort: continua il polling ugualmente
      if (msg.includes("UNCERTAIN") || msg.includes("Load failed")) {
        setState(prev => ({ ...prev, uiState: "committed", error: "Connessione interrotta. Attendi la conferma." }));
        _startPolling(exchange.swapId, from, to, "btc");
      } else {
        setState(prev => ({ ...prev, uiState: "awaiting_deposit", error: msg }));
      }
    }
  }, [state.exchange, state.fromToken, state.toToken, _startPolling]);

  /**
   * commitAndSendBtc (BTC→EVM) — flusso completo analogo a commitAndSend per EVM:
   *   1. Imposta uiState "signing"
   *   2. Chiama sendBtc (callback del wallet BTC) → btcTxHash
   *   3. POST /commit con btcTxHash
   *   4. Avvia polling BTC
   */
  const commitAndSendBtc = useCallback(async (
    sendBtc: (params: { toAddress: string; amountSat: bigint }) => Promise<string>
  ) => {
    const { exchange, fromToken: from, toToken: to } = state;
    if (!exchange || !from || !to) {
      setState(prev => ({ ...prev, error: "Nessun exchange attivo." }));
      return;
    }
    setState(prev => ({ ...prev, uiState: "signing", error: null }));
    try {
      const amountSat = BigInt(Math.round(exchange.expectedFromAmount * 1e8));
      const btcTxHash = await sendBtc({
        toAddress: exchange.depositEvmAddress,  // contiene btcDepositAddress
        amountSat,
      });
      if (!mountedRef.current) return;
      await cnEvmRequest<{ ok: boolean; fundsCommitted: true }>(
        `/swap/changenow/${exchange.swapId}/commit`,
        { method: "POST", body: JSON.stringify({ btcTxHash }) }
      );
      if (!mountedRef.current) return;
      setState(prev => ({ ...prev, uiState: "committed", error: null }));
      _startPolling(exchange.swapId, from, to, "btc");
    } catch (err) {
      if (!mountedRef.current) return;
      const msg  = err instanceof Error ? err.message : "Errore invio BTC.";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (err as any).code as string | undefined;
      if (code === "BTC_SEND_UNCERTAIN" || msg.includes("UNCERTAIN") || msg.includes("Load failed")) {
        setState(prev => ({
          ...prev,
          uiState: "committed",
          error:   "Connessione interrotta dopo la firma. Verifica il saldo e attendi.",
        }));
        if (exchange) _startPolling(exchange.swapId, from, to, "btc");
      } else {
        setState(prev => ({ ...prev, uiState: "awaiting_deposit", error: msg }));
      }
    }
  }, [state.exchange, state.fromToken, state.toToken, _startPolling]);

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
    commitBtcSwap,
    commitAndSendBtc,
    reset,
  };

  return [state, actions];
}
