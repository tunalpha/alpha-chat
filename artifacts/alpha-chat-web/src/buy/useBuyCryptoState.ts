/**
 * useBuyCryptoState — state machine per il flusso "Acquista con carta".
 *
 * INVARIANTI:
 *   • destinationAddress: solo dal server (mai input utente)
 *   • completed: solo con order.destinationTxHash presente
 *   • nessuna API key nel frontend
 *   • recovery su mount: se esiste un ordine attivo, ripristinarlo
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  apiBuyGetAssets,
  apiBuyGetQuote,
  apiBuyGetMethods,
  apiBuyCreateOrder,
  apiBuyGetOrder,
  apiBuyGetActiveOrder,
} from "./buy-api";
import type { BuyCryptoState, BuyAsset, BuyOrder } from "./types";
import { BUY_TERMINAL_STATUSES, humanizeBuyError } from "./types";
import { saveTxRecord }              from "../wallet/services/tx-store";
import { dispatchWalletNotification } from "../wallet/notifications/wallet-notification-store";

const POLL_INTERVAL_MS = 8_000;

const INITIAL_STATE: BuyCryptoState = {
  step:               "select",
  selectedAsset:      null,
  selectedFiat:       "EUR",
  fiatInput:          "",
  selectedMethod:     null,
  quote:              null,
  methods:            [],
  assets:             [],
  order:              null,
  destinationAddress: null,
  loading:            false,
  error:              null,
};

export function useBuyCryptoState() {
  const [state, setState] = useState<BuyCryptoState>(INITIAL_STATE);
  const pollTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted    = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void _init();
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  // ── Inizializzazione: carica assets + recovery ordine attivo ──────────────

  const _init = useCallback(async () => {
    _setLoading(true);
    try {
      const [assetsRes, activeRes] = await Promise.all([
        apiBuyGetAssets(),
        apiBuyGetActiveOrder(),
      ]);
      if (!mounted.current) return;

      if (activeRes.order && !BUY_TERMINAL_STATUSES.includes(activeRes.order.status)) {
        // Recovery: ordine attivo in corso
        _set({
          assets:             assetsRes.assets,
          order:              activeRes.order as BuyOrder,
          destinationAddress: activeRes.order.destinationAddress,
          step:               _stepFromStatus(activeRes.order as BuyOrder),
          loading:            false,
        });
        _startPolling(activeRes.order.id);
      } else {
        _set({ assets: assetsRes.assets, loading: false });
      }
    } catch {
      if (mounted.current) _set({ loading: false });
    }
  }, []);

  // ── Fetch quote ──────────────────────────────────────────────────────────

  const fetchQuote = useCallback(async () => {
    const s = _getState();
    if (!s.selectedAsset || !s.fiatInput || Number(s.fiatInput) <= 0) return;

    _set({ loading: true, error: null });
    try {
      const res = await apiBuyGetQuote({
        fiatCurrency:  s.selectedFiat,
        fiatAmount:    Number(s.fiatInput),
        cryptoAsset:   s.selectedAsset.asset,
        cryptoNetwork: s.selectedAsset.network,
      });
      if (!mounted.current) return;

      // Carica anche metodi di pagamento
      let methods = s.methods;
      try {
        const mRes = await apiBuyGetMethods(s.selectedFiat);
        methods = mRes.methods;
      } catch { /* metodi non disponibili — non bloccare */ }

      _set({
        quote:              res.quote,
        destinationAddress: res.destinationAddress,
        methods,
        step:               "quote",
        loading:            false,
      });
    } catch (err: any) {
      if (!mounted.current) return;
      _set({ loading: false, error: humanizeBuyError(err?.code), step: "error" });
    }
  }, []);

  // ── Crea ordine ──────────────────────────────────────────────────────────

  const createOrder = useCallback(async () => {
    const s = _getState();
    if (!s.selectedAsset || !s.quote || !s.selectedMethod) return;

    _set({ loading: true, error: null });
    try {
      const res = await apiBuyCreateOrder({
        fiatCurrency:     s.selectedFiat,
        fiatAmount:       Number(s.fiatInput),
        cryptoAsset:      s.selectedAsset.asset,
        cryptoNetwork:    s.selectedAsset.network,
        destinationChain: s.selectedAsset.network,
        paymentMethod:    s.selectedMethod,
        quoteId:          s.quote.quoteId ?? undefined,
      });
      if (!mounted.current) return;

      _set({
        order:   res.order,
        step:    "payment",
        loading: false,
      });

      // Apri paymentUrl in nuova tab
      if (res.order.paymentUrl) {
        window.open(res.order.paymentUrl, "_blank", "noopener,noreferrer");
      }

      _startPolling(res.order.id);
    } catch (err: any) {
      if (!mounted.current) return;
      _set({ loading: false, error: humanizeBuyError(err?.code), step: "error" });
    }
  }, []);

  // ── Polling status ───────────────────────────────────────────────────────

  const _startPolling = useCallback((orderId: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      if (!mounted.current) { clearInterval(pollTimer.current!); return; }
      try {
        const res = await apiBuyGetOrder(orderId);
        if (!mounted.current) return;
        const newStep = _stepFromStatus(res.order);
        _set({ order: res.order, step: newStep });
        if (BUY_TERMINAL_STATUSES.includes(res.order.status)) {
          clearInterval(pollTimer.current!);
          pollTimer.current = null;
          // Salva in History + notifica solo su completato con TX hash
          if (res.order.status === "completed" && res.order.destinationTxHash) {
            const networkChainId = _networkToChainId(res.order.cryptoNetwork);
            void saveTxRecord({
              id:          `buy:${res.order.id}`,
              chainId:     networkChainId,
              network:     res.order.cryptoNetwork,
              txHash:      res.order.destinationTxHash,
              direction:   "in",
              asset:       res.order.cryptoAsset,
              amount:      String(res.order.cryptoAmountReceived ?? res.order.estimatedCryptoAmount ?? ""),
              timestamp:   Date.now(),
              status:      "confirmed",
              updatedAt:   Date.now(),
            }).catch(() => {});
            void dispatchWalletNotification({
              type:      "received",
              chainId:   _networkToChainId(res.order.cryptoNetwork),
              network:   res.order.cryptoNetwork,
              asset:     res.order.cryptoAsset,
              amount:    String(res.order.cryptoAmountReceived ?? res.order.estimatedCryptoAmount ?? ""),
              txHash:    res.order.destinationTxHash,
              timestamp: Date.now(),
              status:    "confirmed",
            }).catch(() => {});
          }
        }
      } catch { /* continua polling */ }
    }, POLL_INTERVAL_MS);
  }, []);

  // ── Azioni utente ────────────────────────────────────────────────────────

  const selectAsset   = useCallback((asset: BuyAsset)  => _set({ selectedAsset: asset, quote: null, step: "select" }), []);
  const setFiatInput  = useCallback((v: string)         => _set({ fiatInput: v, quote: null }), []);
  const setFiat       = useCallback((f: string)         => _set({ selectedFiat: f, quote: null }), []);
  const selectMethod  = useCallback((id: string)        => _set({ selectedMethod: id }), []);
  const reset         = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setState(INITIAL_STATE);
    void _init();
  }, [_init]);

  // ── Helpers interni ──────────────────────────────────────────────────────

  // Ref per leggere lo state corrente dentro callback async
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const _getState = () => stateRef.current;

  function _set(patch: Partial<BuyCryptoState>) {
    setState(prev => ({ ...prev, ...patch }));
  }
  function _setLoading(v: boolean) { _set({ loading: v }); }

  return {
    state,
    actions: { selectAsset, setFiatInput, setFiat, selectMethod, fetchQuote, createOrder, reset },
  };
}

function _networkToChainId(network: string): number {
  switch (network.toLowerCase()) {
    case "polygon":  return 137;
    case "ethereum": return 1;
    case "bsc":      return 56;
    case "bitcoin":  return 0;
    default:         return 137;
  }
}

function _stepFromStatus(order: BuyOrder): BuyCryptoState["step"] {
  switch (order.status) {
    case "completed": return "done";
    case "failed":
    case "expired":
    case "refunded":  return "error";
    case "awaiting_payment": return "payment";
    case "payment_processing":
    case "crypto_processing": return "processing";
    default:          return "processing";
  }
}
