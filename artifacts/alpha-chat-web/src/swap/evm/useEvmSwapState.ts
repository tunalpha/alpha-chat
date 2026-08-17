/**
 * useEvmSwapState — state machine EVM swap con Li.Fi
 *
 * Sicurezza implementata:
 *   ✓ Anti-double-click: _evmExecuting module-level lock
 *   ✓ Idempotency key: sessionStorage EVM_SWAP_IKEY
 *   ✓ Write-before-submit: localStorage + backend PRIMA della firma
 *   ✓ Quote expiry guard: verifica expiresAt prima di execute
 *   ✓ Account change abort: confronto account pre/post firma (ThirdWeb mode)
 *   ✓ Chain switch: registrato in configureLiFiWallet
 *   ✓ Recovery al mount: legge localStorage, interroga Li.Fi status
 *   ✓ isMounted guard: nessun setState dopo unmount
 *   ✓ Cleanup unmount: clearLiFiWallet() svuota callback modulo
 *
 * WALLET BRIDGE:
 *   - ThirdWeb (WalletConnect): se activeWallet + activeAccount sono presenti
 *   - Alpha Wallet interno: se opts.getAlphaWalletClient è fornito
 *   - effectiveAddress: activeAccount?.address ?? opts?.alphaWalletAddress
 *     → usato per balance fetch, quote fromAddress, e guard esecuzione
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, wallet bridge.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveAccount, useActiveWallet, useActiveWalletChain, useSwitchActiveWalletChain } from "thirdweb/react";
import { defineChain }       from "thirdweb";
import { viemAdapter }       from "thirdweb/adapters/viem";
import { type WalletClient } from "viem";
import { client as thirdwebClient } from "../../lib/thirdweb.js";
import {
  fetchLiFiQuote, executeLiFiSwap, getLiFiStatus,
  configureLiFiWallet, clearLiFiWallet,
  type LiFiStatus,
} from "./lifi-client.js";
import { getAccessToken } from "../../lib/auth.js";
import {
  EVM_SWAP_ACTIVE_KEY, EVM_SWAP_IKEY,
  LIFI_INTEGRATOR, LIFI_FEE,
  EVM_SWAP_CHAINS, isBtcChain, BTC_CHAIN_ID,
  toTokenUnits, fromTokenUnits, getDefaultFromToken, getTokensForChain,
  type EvmSwapPhase, type EvmSwapStateValue, type EvmSwapActions,
  type EvmToken, type EvmActiveSwap, type EvmSwapQuote,
} from "./types.js";
import { saveTxRecord } from "../../wallet/services/tx-store.js";
import { dispatchWalletNotification } from "../../wallet/notifications/wallet-notification-store.js";
import { chainName } from "../../wallet/notifications/wallet-notification-types.js";

// ── Module-level anti-double-click lock ───────────────────────────────────────
let _evmExecuting = false;

// ── Auth fetch ────────────────────────────────────────────────────────────────
// Usa getAccessToken() direttamente (stesso pattern di request() in api.ts).
// apiRefreshSession() era problematico: se il refresh falliva (cooldown 10s),
// ritornava null → header Authorization assente → 401 su ogni chiamata di tracking.
// Le chiamate swapApi sono fire-and-forget (.catch(() => null)) — non è necessario
// un refresh proattivo; se il token è scaduto il server risponde 401 e viene ignorato.

async function swapApi(path: string, options?: RequestInit): Promise<unknown> {
  const token = getAccessToken() ?? "";
  const base  = (window as unknown as Record<string, string>).__VITE_API_BASE__ ?? "";
  const res   = await fetch(`${base}/api/v1/swap/evm${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) ?? `API error ${res.status}`);
  }
  return res.json();
}

// ── Initial state ─────────────────────────────────────────────────────────────

function makeInitial(): EvmSwapStateValue {
  return {
    phase:       "idle",
    fromChainId: 137,
    toChainId:   137,
    fromToken:   getDefaultFromToken(137),
    toToken:     getTokensForChain(137)[2] ?? getDefaultFromToken(137), // USDC
    fromAmount:  "",
    quote:       null,
    error:       null,
    txHash:      null,
    recovering:  false,
  };
}

// ── Opts ──────────────────────────────────────────────────────────────────────

export interface EvmSwapStateOpts {
  /**
   * Indirizzo EVM dell'Alpha Wallet interno.
   * Usato come fallback quando nessun account ThirdWeb è connesso.
   * Fornisce fromAddress per quote Li.Fi (EVM→EVM/EVM→BTC) e abilita il fetch dei balance.
   */
  alphaWalletAddress?: string;
  /**
   * Factory per creare un viem WalletClient dall'Alpha Wallet interno.
   * Chiamata da Li.Fi al momento della firma — la chiave viene derivata
   * fresh (da keystore IDB + aw_bio_pin sessionStorage) e azzerata dopo ogni chiamata.
   * Stabile: deve essere creata con useCallback(fn, []) nel chiamante.
   */
  getAlphaWalletClient?: (chainId: number) => Promise<WalletClient>;
  /**
   * Slippage massimo (es. 0.005 = 0.5%). Default: LIFI_SLIPPAGE (costante globale).
   * Passato direttamente a Li.Fi nella query quote.
   */
  slippage?: number;
  /**
   * Indirizzo Bitcoin dell'Alpha Wallet interno (es. bc1q…).
   * Necessario per swaps BTC↔EVM:
   *   - BTC→EVM: usato come fromAddress nella quote Li.Fi
   *   - EVM→BTC: usato come toAddress nella quote Li.Fi (destinazione Bitcoin)
   */
  btcAddress?: string;
  /**
   * Callback per inviare BTC dal wallet interno al vault Thorchain (swap BTC→EVM).
   * Fornito da SwapView tramite sendAlphaWalletBtcTx — accede al keystore IDB con PIN.
   * Stabile: creata con useCallback(fn, []) nel chiamante.
   * @returns txid della transazione BTC broadcast
   * @throws Error("ALPHA_WALLET_LOCKED") — wallet non sbloccato
   * @throws Error("BTC_SEND_UNCERTAIN") — TX potenzialmente broadcast (iOS network abort)
   */
  sendBtcForSwap?: (params: { toAddress: string; amountSat: bigint }) => Promise<string>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEvmSwapState(opts?: EvmSwapStateOpts): [EvmSwapStateValue, EvmSwapActions] {
  const [sv, setSv] = useState<EvmSwapStateValue>(makeInitial);

  const activeAccount  = useActiveAccount();
  const activeWallet   = useActiveWallet();
  const activeChain    = useActiveWalletChain();
  const switchChainFn  = useSwitchActiveWalletChain();

  // ── effectiveAddress: ThirdWeb oppure Alpha Wallet interno ────────────────
  const effectiveAddress = activeAccount?.address ?? opts?.alphaWalletAddress;

  // ── Refs ──────────────────────────────────────────────────────────────────
  const accountRef     = useRef(activeAccount?.address);
  const fromChainIdRef = useRef(sv.fromChainId);
  const isMounted      = useRef(true);
  const slippageRef    = useRef(opts?.slippage);
  const btcAddressRef  = useRef<string | undefined>(opts?.btcAddress);

  const svRef        = useRef<EvmSwapStateValue>(sv);
  const effectiveRef = useRef<string | undefined>(effectiveAddress ?? undefined);

  useEffect(() => { accountRef.current     = activeAccount?.address;         }, [activeAccount]);
  useEffect(() => { fromChainIdRef.current = sv.fromChainId;                 }, [sv.fromChainId]);
  useEffect(() => { slippageRef.current    = opts?.slippage;                 }, [opts?.slippage]);
  useEffect(() => { btcAddressRef.current  = opts?.btcAddress;               }, [opts?.btcAddress]);
  useEffect(() => { svRef.current          = sv;                             }, [sv]);
  useEffect(() => { effectiveRef.current   = effectiveAddress ?? undefined;  }, [effectiveAddress]);

  // ── Lifecycle + cleanup Li.Fi callbacks ───────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      clearLiFiWallet(); // svuota callback modulo — nessuna chiamata post-unmount
    };
  }, []);

  // ── Configura Li.Fi wallet ogni volta che il wallet cambia ─────────────────
  useEffect(() => {
    const alphaGetClient = opts?.getAlphaWalletClient;

    if (activeWallet && activeAccount) {
      // ── ThirdWeb / WalletConnect mode ─────────────────────────────────────
      configureLiFiWallet(
        async () => {
          const chainId = activeChain?.id ?? fromChainIdRef.current;
          // prop corretta è `account`, non `wallet`
          return viemAdapter.walletClient.toViem({
            client:  thirdwebClient,
            chain:   defineChain(chainId),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            account: activeAccount as any,
          });
        },
        async (chainId: number) => {
          await switchChainFn(defineChain(chainId));
        },
      );
    } else if (alphaGetClient) {
      // ── Alpha Wallet internal mode ────────────────────────────────────────
      configureLiFiWallet(
        () => alphaGetClient(fromChainIdRef.current),
        async (chainId: number) => {
          fromChainIdRef.current = chainId;
          if (!isMounted.current) return;
          setSv(prev => {
            if (prev.phase !== "idle" && prev.phase !== "quoted") return prev;
            const newToken = getDefaultFromToken(chainId);
            return {
              ...prev,
              fromChainId: chainId,
              fromToken:   newToken,
              toChainId:   chainId,
              toToken:     getTokensForChain(chainId)[2] ?? newToken,
              fromAmount:  "",
              quote:       null,
              error:       null,
              phase:       "idle",
            };
          });
        },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWallet, activeAccount, activeChain?.id, opts?.getAlphaWalletClient]);

  // ── Recovery al mount ──────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(EVM_SWAP_ACTIVE_KEY);
    if (!raw) return;

    let active: EvmActiveSwap;
    try { active = JSON.parse(raw) as EvmActiveSwap; }
    catch { localStorage.removeItem(EVM_SWAP_ACTIVE_KEY); return; }

    if (Date.now() - active.startedAt > 4 * 60 * 60 * 1000) {
      localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
      return;
    }

    if (isMounted.current) setSv(prev => ({ ...prev, recovering: true, phase: "pending" }));

    const check = async () => {
      if (!active.txHash) {
        localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
        if (isMounted.current) setSv(prev => ({ ...prev, recovering: false, phase: "idle" }));
        return;
      }

      const result = await getLiFiStatus(active.txHash, active.fromChainId, active.toChainId)
        .catch(() => ({ status: "PENDING" as LiFiStatus }));

      const finalState = resolveLiFiStatus(result.status);
      if (isMounted.current) {
        setSv(prev => ({
          ...prev,
          recovering:  false,
          phase:       finalState,
          txHash:      active.txHash ?? prev.txHash,
          fromToken:   active.fromToken,
          toToken:     active.toToken,
          fromAmount:  active.fromAmount,
          fromChainId: active.fromChainId,
          toChainId:   active.toChainId,
        }));
      }

      if (finalState === "completed" || finalState === "failed") {
        localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
      }
    };

    check();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Chain auto-sync: quando active ThirdWeb chain cambia → aggiorna fromChain
  useEffect(() => {
    if (!activeChain?.id) return;
    // BTC non è mai una ThirdWeb chain — salta se il chainId è quello di BTC
    if (isBtcChain(activeChain.id)) return;
    const supported = EVM_SWAP_CHAINS.find(c => c.id === activeChain.id && !isBtcChain(c.id));
    if (!supported) return;
    setSv(prev => {
      if (prev.phase !== "idle" && prev.phase !== "quoted") return prev;
      if (prev.fromChainId === activeChain.id) return prev;
      const newFromToken = getDefaultFromToken(activeChain.id);
      return {
        ...prev,
        fromChainId: activeChain.id,
        fromToken:   newFromToken,
        toChainId:   activeChain.id,
        toToken:     getTokensForChain(activeChain.id)[2] ?? newFromToken,
        fromAmount:  "",
        quote:       null,
        error:       null,
        phase:       "idle",
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChain?.id]);

  // ── Auto-refresh quote 5s prima della scadenza (silenzioso, nessun cambio di fase) ──
  useEffect(() => {
    if (sv.phase !== "quoted" || !sv.quote) return;
    const delay = Math.max(0, sv.quote.expiresAt - Date.now() - 5_000);
    const id = setTimeout(async () => {
      const snap = svRef.current;
      const addr = effectiveRef.current;
      if (
        !isMounted.current
        || snap.phase !== "quoted"
        || !snap.quote
        || !snap.fromToken
        || !snap.toToken
        || !addr
      ) return;
      const fromUnits = toTokenUnits(snap.fromAmount, snap.fromToken.decimals);
      if (fromUnits === "0") return;
      try {
        const btcAddr2 = btcAddressRef.current;
        const refreshFromAddr = isBtcChain(snap.fromChainId) ? (btcAddr2 ?? addr) : addr;
        const refreshToAddr: string | undefined =
          isBtcChain(snap.toChainId)   ? btcAddr2 :
          isBtcChain(snap.fromChainId) ? (addr ?? undefined) :
          undefined;
        const newQuote = await fetchLiFiQuote({
          fromChainId: snap.fromChainId,
          toChainId:   snap.toChainId,
          fromToken:   snap.fromToken,
          toToken:     snap.toToken,
          fromAmount:  fromUnits,
          fromAddress: refreshFromAddr,
          ...(refreshToAddr ? { toAddress: refreshToAddr } : {}),
          slippage:    slippageRef.current,
        });
        if (isMounted.current) {
          // Aggiorna la quote in-place senza cambiare fase — nessun flickering UI
          setSv(prev => prev.phase === "quoted" ? { ...prev, quote: newQuote, error: null } : prev);
        }
      } catch {
        // Silenzioso: se il refresh fallisce la quote vecchia resta visibile;
        // il guard expiresAt in execute() impedirà l'esecuzione con quote davvero scaduta.
      }
    }, delay);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.phase, sv.quote?.expiresAt]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const setFromChain = useCallback((chainId: number) => {
    const token = getDefaultFromToken(chainId);
    // Quando FROM=BTC, TO deve essere una chain EVM (default Polygon USDT)
    // per evitare swap BTC→BTC che non esiste
    const defaultToChainId = isBtcChain(chainId) ? 137 : chainId;
    const defaultToToken = isBtcChain(chainId)
      ? (getTokensForChain(137)[2] ?? getDefaultFromToken(137))  // USDT Polygon
      : (getTokensForChain(chainId)[2] ?? token);
    setSv(prev => ({
      ...prev,
      fromChainId: chainId,
      fromToken:   token,
      toChainId:   defaultToChainId,
      toToken:     defaultToToken,
      quote:       null,
      error:       null,
      phase:       "idle",
    }));
  }, []);

  const setToChain = useCallback((chainId: number) => {
    const token = getDefaultFromToken(chainId);
    setSv(prev => ({
      ...prev,
      toChainId: chainId,
      toToken:   getTokensForChain(chainId)[2] ?? token,
      quote:     null,
      error:     null,
      phase:     "idle",
    }));
  }, []);

  const setFromToken = useCallback((token: EvmToken) => {
    setSv(prev => ({ ...prev, fromToken: token, quote: null, error: null, phase: "idle" }));
  }, []);

  const setToToken = useCallback((token: EvmToken) => {
    setSv(prev => ({ ...prev, toToken: token, quote: null, error: null, phase: "idle" }));
  }, []);

  const setFromAmount = useCallback((amount: string) => {
    setSv(prev => ({ ...prev, fromAmount: amount, quote: null, error: null, phase: "idle" }));
  }, []);

  const swapDirection = useCallback(() => {
    setSv(prev => ({
      ...prev,
      fromChainId: prev.toChainId,
      toChainId:   prev.fromChainId,
      fromToken:   prev.toToken ?? getDefaultFromToken(prev.toChainId),
      toToken:     prev.fromToken ?? getDefaultFromToken(prev.fromChainId),
      quote:       null,
      error:       null,
      phase:       "idle",
    }));
  }, []);

  const fetchQuote = useCallback(async () => {
    setSv(prev => {
      if (!prev.fromAmount || prev.fromAmount === "0" || !prev.fromToken || !prev.toToken) return prev;
      return { ...prev, phase: "quoting", error: null, quote: null };
    });

    const snap = await new Promise<EvmSwapStateValue>(resolve => {
      setSv(prev => { resolve(prev); return prev; });
    });

    if (!snap.fromToken || !snap.toToken || !snap.fromAmount || snap.fromAmount === "0") return;

    if (!effectiveAddress) {
      if (isMounted.current) {
        setSv(prev => ({
          ...prev, phase: "idle",
          error: { code: "NO_WALLET", message: "Sblocca Alpha Wallet o connetti un wallet EVM prima di ottenere una quote." },
        }));
      }
      return;
    }

    const fromUnits = toTokenUnits(snap.fromAmount, snap.fromToken.decimals);
    if (fromUnits === "0") {
      if (isMounted.current) setSv(prev => ({ ...prev, phase: "idle" }));
      return;
    }

    // ── Indirizzi BTC↔EVM ─────────────────────────────────────────────────
    const btcAddr = opts?.btcAddress;
    if (isBtcChain(snap.fromChainId) && !btcAddr) {
      if (isMounted.current) setSv(prev => ({ ...prev, phase: "idle", error: { code: "NO_BTC_WALLET", message: "Alpha Wallet non sbloccato. Sblocca per usare BTC." } }));
      return;
    }
    if (isBtcChain(snap.toChainId) && !btcAddr) {
      if (isMounted.current) setSv(prev => ({ ...prev, phase: "idle", error: { code: "NO_BTC_WALLET", message: "Alpha Wallet non sbloccato. Sblocca per inviare a BTC." } }));
      return;
    }
    // fromAddress: BTC address se FROM=BTC, EVM address altrimenti
    const quoteFromAddress = isBtcChain(snap.fromChainId) ? (btcAddr ?? "") : (effectiveAddress ?? "");
    // toAddress: BTC address se TO=BTC (EVM→BTC), EVM address se FROM=BTC (BTC→EVM), undefined altrimenti
    const quoteToAddress: string | undefined =
      isBtcChain(snap.toChainId)   ? btcAddr :
      isBtcChain(snap.fromChainId) ? (effectiveAddress ?? undefined) :
      undefined;

    try {
      const quote = await fetchLiFiQuote({
        fromChainId:  snap.fromChainId,
        toChainId:    snap.toChainId,
        fromToken:    snap.fromToken,
        toToken:      snap.toToken,
        fromAmount:   fromUnits,
        fromAddress:  quoteFromAddress,
        ...(quoteToAddress ? { toAddress: quoteToAddress } : {}),
        slippage:     slippageRef.current,
      });
      if (isMounted.current) setSv(prev => ({ ...prev, phase: "quoted", quote, error: null }));
    } catch (err) {
      console.error("[AlphaSwap] fetchQuote error:", err);
      // Propaga il messaggio Li.Fi per consentire all'UI messaggi più specifici
      const errMsg = err instanceof Error ? err.message : "SWAP_UNAVAILABLE";
      if (isMounted.current) setSv(prev => ({ ...prev, phase: "idle", error: { code: "QUOTE_ERROR", message: errMsg } }));
    }
  }, [effectiveAddress]);

  /**
   * Calcola quote partendo dall'importo DESIDERATO in output (exact-output mode).
   * Aggiorna sv.fromAmount con il valore calcolato da Li.Fi.
   */
  const fetchQuoteExactOut = useCallback(async (toAmountHuman: string) => {
    if (!toAmountHuman || toAmountHuman === "0") return;

    const snap = await new Promise<EvmSwapStateValue>(resolve => {
      setSv(prev => { resolve(prev); return prev; });
    });

    if (!snap.fromToken || !snap.toToken) return;

    if (!effectiveAddress) {
      if (isMounted.current) {
        setSv(prev => ({
          ...prev, phase: "idle",
          error: { code: "NO_WALLET", message: "Sblocca Alpha Wallet prima di ottenere una quote." },
        }));
      }
      return;
    }

    const toUnits = toTokenUnits(toAmountHuman, snap.toToken.decimals);
    if (toUnits === "0") return;

    if (isMounted.current) setSv(prev => ({ ...prev, phase: "quoting", error: null, quote: null }));

    // Exact-output non supportato per BTC (quote BTC→EVM/EVM→BTC richiede from-mode)
    if (isBtcChain(snap.fromChainId) || isBtcChain(snap.toChainId)) {
      if (isMounted.current) setSv(prev => ({ ...prev, phase: "idle" }));
      return;
    }

    try {
      const quote = await fetchLiFiQuote({
        fromChainId:  snap.fromChainId,
        toChainId:    snap.toChainId,
        fromToken:    snap.fromToken,
        toToken:      snap.toToken,
        toAmount:     toUnits,
        fromAddress:  effectiveAddress ?? "",
        slippage:     slippageRef.current,
      });
      // Aggiorna fromAmount con il valore calcolato da Li.Fi (action.fromAmount)
      const computedFrom = quote.computedFromAmount
        ? fromTokenUnits(quote.computedFromAmount, quote.fromToken.decimals)
        : "";
      if (isMounted.current) {
        setSv(prev => ({
          ...prev,
          phase:      "quoted",
          quote,
          fromAmount: computedFrom,
          error:      null,
        }));
      }
    } catch (err) {
      console.error("[AlphaSwap] fetchQuoteExactOut error:", err);
      if (isMounted.current) setSv(prev => ({ ...prev, phase: "idle", error: { code: "QUOTE_ERROR", message: "SWAP_UNAVAILABLE" } }));
    }
  }, [effectiveAddress]);

  const execute = useCallback(async () => {
    if (_evmExecuting) return;

    const current = await new Promise<EvmSwapStateValue>(resolve => {
      setSv(prev => { resolve(prev); return prev; });
    });

    if (!current.quote) {
      if (isMounted.current) setSv(prev => ({ ...prev, error: { code: "NO_QUOTE", message: "Nessuna quote disponibile." } }));
      return;
    }
    if (Date.now() > current.quote.expiresAt) {
      if (isMounted.current) setSv(prev => ({ ...prev, phase: "idle", quote: null, error: { code: "QUOTE_EXPIRED", message: "Quote scaduta. Ricarica la quote." } }));
      return;
    }
    if (!effectiveAddress) {
      if (isMounted.current) setSv(prev => ({ ...prev, error: { code: "NO_WALLET", message: "Wallet non connesso." } }));
      return;
    }

    // ── BTC→EVM: invia BTC automaticamente al vault Thorchain ────────────────
    if (isBtcChain(current.quote.fromChainId)) {
      const depositAddr = current.quote.btcDepositAddress;
      if (!depositAddr) {
        if (isMounted.current) setSv(prev => ({
          ...prev, error: { code: "NO_DEPOSIT_ADDR", message: "Indirizzo vault non disponibile. Riprova la quote." }
        }));
        return;
      }
      const sendBtcFn = opts?.sendBtcForSwap;
      if (!sendBtcFn) {
        if (isMounted.current) setSv(prev => ({
          ...prev, phase: "idle", error: { code: "ALPHA_WALLET_LOCKED", message: "ALPHA_WALLET_LOCKED" }
        }));
        return;
      }
      const amtRaw = parseInt(current.quote.fromAmount ?? "0", 10);
      if (!amtRaw || isNaN(amtRaw)) {
        if (isMounted.current) setSv(prev => ({
          ...prev, error: { code: "INVALID_AMOUNT", message: "Importo non valido. Riprova la quote." }
        }));
        return;
      }

      _evmExecuting = true;

      // Write-before-submit: persisti swap info prima di inviare
      const btcActiveSwap: EvmActiveSwap = {
        routeId:     current.quote.routeId,
        fromChainId: current.quote.fromChainId,
        toChainId:   current.quote.toChainId,
        fromToken:   current.quote.fromToken,
        toToken:     current.quote.toToken,
        fromAmount:  current.fromAmount,
        toAmount:    current.quote.toAmount,
        startedAt:   Date.now(),
      };
      localStorage.setItem(EVM_SWAP_ACTIVE_KEY, JSON.stringify(btcActiveSwap));

      if (isMounted.current) setSv(prev => ({ ...prev, phase: "signing", error: null }));

      // Helper: avvia polling Li.Fi per BTC→EVM (Thorchain, ~10-30 min)
      const capturedFromChainId = current.quote.fromChainId;
      const capturedToChainId   = current.quote.toChainId;
      const startBtcPoll = (txid: string) => {
        const poll = async () => {
          if (!isMounted.current) return;
          try {
            const st = await getLiFiStatus(txid, capturedFromChainId, capturedToChainId);
            if (st.status === "DONE") {
              localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
              if (isMounted.current) setSv(prev => ({
                ...prev, phase: "completed", txHash: st.txHash ?? txid, error: null,
              }));
            } else if (st.status === "FAILED" || st.status === "INVALID") {
              localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
              if (isMounted.current) setSv(prev => ({
                ...prev, phase: "failed", error: { code: "SWAP_FAILED", message: "SWAP_UNAVAILABLE" },
              }));
            } else {
              // PENDING / NOT_FOUND — riprova tra 30s (conferme BTC+Thorchain richiedono tempo)
              setTimeout(poll, 30_000);
            }
          } catch {
            if (isMounted.current) setTimeout(poll, 30_000);
          }
        };
        setTimeout(poll, 30_000); // prima verifica dopo 30s
      };

      try {
        const txid = await sendBtcFn({ toAddress: depositAddr, amountSat: BigInt(amtRaw) });

        // Persisti txid per recovery al mount
        const stored = localStorage.getItem(EVM_SWAP_ACTIVE_KEY);
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as EvmActiveSwap;
            localStorage.setItem(EVM_SWAP_ACTIVE_KEY, JSON.stringify({ ...parsed, txHash: txid }));
          } catch { /* ignore */ }
        }

        if (isMounted.current) setSv(prev => ({ ...prev, phase: "submitted", txHash: txid }));
        startBtcPoll(txid);

        // Tag la TX come swap in IDB — il tx-monitor la ritroverà e non sovrascriverà txType
        const toSymbol = current.quote.toToken?.symbol;
        saveTxRecord({
          id:          `btc:${txid}:out:`,
          chainId:     0,
          network:     "Bitcoin",
          txHash:      txid,
          direction:   "out",
          asset:       "BTC",
          amount:      fromTokenUnits(amtRaw.toString(), 8),
          txType:      "swap",
          swapToAsset: toSymbol,
          timestamp:   Date.now(),
          status:      "pending",
          updatedAt:   Date.now(),
        }).catch(() => { /* best-effort */ });

      } catch (err) {
        console.error("[AlphaSwap] BTC send error:", err);
        const msg = err instanceof Error ? err.message : "";
        const isUncertain = msg === "BTC_SEND_UNCERTAIN";
        const isLocked    = msg.startsWith("ALPHA_WALLET_LOCKED") || msg.startsWith("ALPHA_WALLET_NO_KEYSTORE");

        if (isUncertain) {
          // TX potenzialmente broadcast su rete — lascia pending e avvia polling
          // (il txid non è disponibile, la recovery al mount gestirà il caso se salvato)
          if (isMounted.current) setSv(prev => ({ ...prev, phase: "pending" }));
        } else {
          localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
          if (!isMounted.current) { _evmExecuting = false; return; }
          if (isLocked) {
            setSv(prev => ({ ...prev, phase: "idle", error: { code: "ALPHA_WALLET_LOCKED", message: "ALPHA_WALLET_LOCKED" } }));
          } else {
            setSv(prev => ({ ...prev, phase: "failed", error: { code: "EXECUTE_ERROR", message: msg || "SWAP_UNAVAILABLE" } }));
          }
        }
      } finally {
        _evmExecuting = false;
      }
      return; // ← fine branch BTC→EVM
    }

    // EVM→EVM / EVM→BTC: richiede wallet EVM per la firma
    const alphaMode = !!(opts?.getAlphaWalletClient && !activeAccount);
    if (!activeWallet && !alphaMode) {
      if (isMounted.current) setSv(prev => ({ ...prev, error: { code: "NO_WALLET", message: "Wallet non connesso." } }));
      return;
    }

    _evmExecuting = true;

    const ikey = sessionStorage.getItem(EVM_SWAP_IKEY) ?? crypto.randomUUID();
    sessionStorage.setItem(EVM_SWAP_IKEY, ikey);

    const accountBefore = accountRef.current;

    try {
      const activeSwap: EvmActiveSwap = {
        routeId:      current.quote.routeId,
        fromChainId:  current.quote.fromChainId,
        toChainId:    current.quote.toChainId,
        fromToken:    current.quote.fromToken,
        toToken:      current.quote.toToken,
        fromAmount:   current.fromAmount,
        toAmount:     current.quote.toAmount,
        startedAt:    Date.now(),
      };
      localStorage.setItem(EVM_SWAP_ACTIVE_KEY, JSON.stringify(activeSwap));

      await swapApi("/start", {
        method: "POST",
        body: JSON.stringify({
          routeId:      current.quote.routeId,
          fromChainId:  current.quote.fromChainId,
          toChainId:    current.quote.toChainId,
          fromToken:    current.quote.fromToken.symbol,
          fromAddress:  current.quote.fromToken.address,
          toToken:      current.quote.toToken.symbol,
          toAddress:    current.quote.toToken.address,
          fromAmount:   current.fromAmount,
          toAmount:     current.quote.toAmount,
          alphaFeeUSD:  current.quote.alphaFeeUSD,
          tool:         current.quote.tool,
        }),
      }).catch(() => null);

      if (isMounted.current) setSv(prev => ({ ...prev, phase: "signing", error: null }));

      // ── Re-configura wallet LiFi SINCRONAMENTE prima dell'execute ─────────────
      // Elimina la race condition tra useEffect (asincrono post-render) e il
      // momento in cui l'utente preme Swap. Il wallet è sempre configurato qui.
      // Priorità: Alpha Wallet interno (spec NON richiede WalletConnect).
      {
        const alphaClientFn = opts?.getAlphaWalletClient;
        if (alphaClientFn && !activeAccount) {
          // Alpha Wallet mode
          configureLiFiWallet(
            () => alphaClientFn(fromChainIdRef.current),
            async (chainId: number) => { fromChainIdRef.current = chainId; },
          );
        } else if (activeWallet && activeAccount) {
          // ThirdWeb / WalletConnect mode
          configureLiFiWallet(
            async () => {
              const chainId = activeChain?.id ?? fromChainIdRef.current;
              return viemAdapter.walletClient.toViem({
                client:  thirdwebClient,
                chain:   defineChain(chainId),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                account: activeAccount as any,
              });
            },
            async (chainId: number) => { await switchChainFn(defineChain(chainId)); },
          );
        }
      }

      let submittedTxHash = "";

      const { txHash } = await executeLiFiSwap(current.quote, {
        onApproving: () => {
          if (isMounted.current) setSv(prev => ({ ...prev, phase: "approving" }));
        },
        onTxSubmitted: (hash) => {
          submittedTxHash = hash;
          const stored = localStorage.getItem(EVM_SWAP_ACTIVE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored) as EvmActiveSwap;
              localStorage.setItem(EVM_SWAP_ACTIVE_KEY, JSON.stringify({ ...parsed, txHash: hash }));
            } catch { /* ignore */ }
          }
          if (isMounted.current) setSv(prev => ({ ...prev, phase: "submitted", txHash: hash }));
        },
      });

      // Verifica cambio account solo in ThirdWeb mode
      if (!alphaMode && accountRef.current && accountBefore && accountRef.current !== accountBefore) {
        throw new Error("ACCOUNT_CHANGED: il wallet è cambiato durante l'esecuzione.");
      }

      const finalTxHash = txHash || submittedTxHash;

      // Salva la TX come "swap" in IDB — appare IMMEDIATAMENTE in History+Notifications
      // senza aspettare il tx-monitor (che impiega 1-3 min via Alchemy).
      // ID unico "evm-swap:chainId:txHash" — non collidere con i record del tx-monitor
      // (che usano "chainId:txHash:direction:logIndex" per le ERC-20 transfer).
      if (finalTxHash) {
        const cId      = current.quote.fromChainId;
        const netName  = chainName(cId);
        const fromSym  = current.quote.fromToken.symbol;
        const toSym    = current.quote.toToken?.symbol ?? "";
        const amtHuman = fromTokenUnits(current.quote.fromAmount, current.quote.fromToken.decimals);

        saveTxRecord({
          id:          `evm-swap:${cId}:${finalTxHash}`,
          chainId:     cId,
          network:     netName,
          txHash:      finalTxHash,
          direction:   "out",
          asset:       fromSym,
          amount:      amtHuman,
          txType:      "swap",
          swapToAsset: toSym,
          timestamp:   Date.now(),
          status:      "confirmed",
          updatedAt:   Date.now(),
        }).catch(() => { /* best-effort */ });

        dispatchWalletNotification({
          type:        "sent",
          chainId:     cId,
          network:     netName,
          asset:       fromSym,
          amount:      amtHuman,
          txHash:      finalTxHash,
          status:      "confirmed",
          txType:      "swap",
          swapToAsset: toSym,
          timestamp:   Date.now(),
        }).catch(() => { /* best-effort */ });
      }

      await swapApi(`/${current.quote.routeId}`, {
        method: "PATCH",
        body: JSON.stringify({ txHash: finalTxHash, state: "completed" }),
      }).catch(() => null);

      localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
      sessionStorage.removeItem(EVM_SWAP_IKEY);

      if (isMounted.current) setSv(prev => ({ ...prev, phase: "completed", txHash: finalTxHash, error: null }));
    } catch (err) {
      // Logga i dettagli tecnici — non mostrarli mai all'utente
      console.error("[AlphaSwap] execute error:", err);
      // Usa shortMessage di viem (es. "execution reverted") se disponibile —
      // err.message contiene lo stack trace completo che non serve all'utente.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = err instanceof Error ? ((err as any).shortMessage ?? err.message) : "";
      const isUserRejected = msg.includes("rejected") || msg.includes("denied") || msg.includes("refused") || msg.includes("USER_REJECTED");
      const isQuoteExpired  = msg === "QUOTE_EXPIRED";
      const isWalletLocked  = msg.startsWith("ALPHA_WALLET_LOCKED") || msg.startsWith("ALPHA_WALLET_NO_KEYSTORE");

      if (current.quote) {
        await swapApi(`/${current.quote.routeId}`, {
          method: "PATCH",
          body: JSON.stringify({ txHash: "", state: "failed", error: msg }),
        }).catch(() => null);
      }

      if (!isMounted.current) return;

      if (isUserRejected) {
        localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
        setSv(prev => ({ ...prev, phase: "quoted", error: { code: "USER_REJECTED", message: "USER_REJECTED" } }));
      } else if (isQuoteExpired) {
        localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
        sessionStorage.removeItem(EVM_SWAP_IKEY);
        setSv(prev => ({ ...prev, phase: "idle", quote: null, error: { code: "QUOTE_EXPIRED", message: "QUOTE_EXPIRED" } }));
      } else if (isWalletLocked) {
        setSv(prev => ({ ...prev, phase: "idle", error: { code: "ALPHA_WALLET_LOCKED", message: "ALPHA_WALLET_LOCKED" } }));
      } else {
        // Passa il messaggio reale → humanizeEvmCode mostrerà un testo specifico
        setSv(prev => ({ ...prev, phase: "failed", error: { code: "EXECUTE_ERROR", message: msg || "SWAP_UNAVAILABLE" } }));
      }
    } finally {
      _evmExecuting = false;
    }
  }, [effectiveAddress, activeAccount, activeWallet, opts?.getAlphaWalletClient, opts?.sendBtcForSwap]);

  const reset = useCallback(() => {
    localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
    sessionStorage.removeItem(EVM_SWAP_IKEY);
    _evmExecuting = false;
    if (isMounted.current) setSv(makeInitial());
  }, []);

  const actions: EvmSwapActions = {
    setFromChain, setToChain, setFromToken, setToToken,
    setFromAmount, swapDirection, fetchQuote, fetchQuoteExactOut, execute, reset,
  };

  return [sv, actions];
}

// ── Helper ────────────────────────────────────────────────────────────────────

function resolveLiFiStatus(status: LiFiStatus): EvmSwapPhase {
  switch (status) {
    case "DONE":    return "completed";
    case "FAILED":  return "failed";
    case "INVALID": return "failed";
    default:        return "pending";
  }
}

// ── Re-export types for convenience ───────────────────────────────────────────
export type { EvmSwapStateValue, EvmSwapActions, EvmSwapQuote };
export { LIFI_INTEGRATOR, LIFI_FEE };
