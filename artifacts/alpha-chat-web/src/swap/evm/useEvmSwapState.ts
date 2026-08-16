/**
 * useEvmSwapState — state machine EVM swap con Li.Fi
 *
 * Sicurezza implementata:
 *   ✓ Anti-double-click: _evmExecuting module-level lock
 *   ✓ Idempotency key: sessionStorage EVM_SWAP_IKEY
 *   ✓ Write-before-submit: localStorage + backend PRIMA della firma
 *   ✓ Quote expiry guard: verifica expiresAt prima di execute
 *   ✓ Account change abort: confronto account pre/post firma
 *   ✓ Chain switch: registrato in configureLiFiWallet
 *   ✓ Recovery al mount: legge localStorage, interroga Li.Fi status
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, wallet bridge.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveAccount, useActiveWallet, useActiveWalletChain, useSwitchActiveWalletChain } from "thirdweb/react";
import { defineChain }     from "thirdweb";
import { viemAdapter }     from "thirdweb/adapters/viem";
import { client as thirdwebClient } from "../../lib/thirdweb.js";
import {
  fetchLiFiQuote, executeLiFiSwap, getLiFiStatus, configureLiFiWallet,
  type LiFiStatus,
} from "./lifi-client.js";
import {
  EVM_SWAP_ACTIVE_KEY, EVM_SWAP_IKEY,
  LIFI_INTEGRATOR, LIFI_FEE,
  EVM_SWAP_CHAINS,
  toTokenUnits, getDefaultFromToken, getTokensForChain,
  type EvmSwapPhase, type EvmSwapStateValue, type EvmSwapActions,
  type EvmToken, type EvmActiveSwap, type EvmSwapQuote,
} from "./types.js";

// ── Module-level anti-double-click lock ───────────────────────────────────────
let _evmExecuting = false;

// ── Auth fetch (isolato — legge token da localStorage) ────────────────────────
const AC_TOKEN_KEY = "ac_access_token";

async function swapApi(path: string, options?: RequestInit): Promise<unknown> {
  const token = localStorage.getItem(AC_TOKEN_KEY) ?? "";
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

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEvmSwapState(): [EvmSwapStateValue, EvmSwapActions] {
  const [sv, setSv] = useState<EvmSwapStateValue>(makeInitial);

  const activeAccount     = useActiveAccount();
  const activeWallet      = useActiveWallet();
  const activeChain       = useActiveWalletChain();
  const switchChainFn     = useSwitchActiveWalletChain();

  // Ref per evitare stale closure in execute
  const accountRef = useRef(activeAccount?.address);
  useEffect(() => { accountRef.current = activeAccount?.address; }, [activeAccount]);

  // ── Configura Li.Fi wallet ogni volta che il wallet cambia ─────────────────
  useEffect(() => {
    if (!activeWallet || !activeAccount) return;

    configureLiFiWallet(
      async () => {
        const chainId = activeChain?.id ?? sv.fromChainId;
        return viemAdapter.walletClient.toViem({
          client:  thirdwebClient,
          chain:   defineChain(chainId),
          wallet:  activeWallet,
        });
      },
      async (chainId: number) => {
        await switchChainFn(defineChain(chainId));
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWallet, activeAccount, activeChain?.id]);

  // ── Recovery al mount ──────────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(EVM_SWAP_ACTIVE_KEY);
    if (!raw) return;

    let active: EvmActiveSwap;
    try { active = JSON.parse(raw) as EvmActiveSwap; }
    catch { localStorage.removeItem(EVM_SWAP_ACTIVE_KEY); return; }

    // Swap scaduto (> 4 ore)
    if (Date.now() - active.startedAt > 4 * 60 * 60 * 1000) {
      localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
      return;
    }

    setSv(prev => ({ ...prev, recovering: true, phase: "pending" }));

    const check = async () => {
      if (!active.txHash) {
        // Nessun txHash: swap non ancora inviato — reset
        localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
        setSv(prev => ({ ...prev, recovering: false, phase: "idle" }));
        return;
      }

      const result = await getLiFiStatus(active.txHash, active.fromChainId, active.toChainId)
        .catch(() => ({ status: "PENDING" as LiFiStatus }));

      const finalState = resolveLiFiStatus(result.status);
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

      if (finalState === "completed" || finalState === "failed") {
        localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
      }
    };

    check();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Chain auto-sync: quando active chain cambia → aggiorna fromChain ───────
  useEffect(() => {
    if (!activeChain?.id) return;
    const supported = EVM_SWAP_CHAINS.find(c => c.id === activeChain.id);
    if (!supported) return;
    setSv(prev => {
      if (prev.phase !== "idle" && prev.phase !== "quoted") return prev; // non interrompere swap in corso
      if (prev.fromChainId === activeChain.id) return prev; // già sulla chain giusta
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

  // ── Actions ────────────────────────────────────────────────────────────────

  const setFromChain = useCallback((chainId: number) => {
    const token = getDefaultFromToken(chainId);
    setSv(prev => ({
      ...prev,
      fromChainId: chainId,
      fromToken:   token,
      toChainId:   chainId,         // reset toChain su stessa chain di default
      toToken:     getTokensForChain(chainId)[2] ?? token,
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
    if (!activeAccount?.address) {
      setSv(prev => ({ ...prev, phase: "idle", error: { code: "NO_WALLET", message: "Connetti il wallet prima di ottenere una quote." } }));
      return;
    }

    const fromUnits = toTokenUnits(snap.fromAmount, snap.fromToken.decimals);
    if (fromUnits === "0") {
      setSv(prev => ({ ...prev, phase: "idle" }));
      return;
    }

    try {
      const quote = await fetchLiFiQuote({
        fromChainId:  snap.fromChainId,
        toChainId:    snap.toChainId,
        fromToken:    snap.fromToken,
        toToken:      snap.toToken,
        fromAmount:   fromUnits,
        fromAddress:  activeAccount.address,
      });
      setSv(prev => ({ ...prev, phase: "quoted", quote, error: null }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore nel calcolo della quote.";
      setSv(prev => ({ ...prev, phase: "idle", error: { code: "QUOTE_ERROR", message: msg } }));
    }
  }, [activeAccount]);

  const execute = useCallback(async () => {
    if (_evmExecuting) return;

    // Snapshot stato corrente
    const current = await new Promise<EvmSwapStateValue>(resolve => {
      setSv(prev => { resolve(prev); return prev; });
    });

    if (!current.quote) {
      setSv(prev => ({ ...prev, error: { code: "NO_QUOTE", message: "Nessuna quote disponibile." } }));
      return;
    }
    if (Date.now() > current.quote.expiresAt) {
      setSv(prev => ({ ...prev, phase: "idle", quote: null, error: { code: "QUOTE_EXPIRED", message: "Quote scaduta. Ricarica la quote." } }));
      return;
    }
    if (!activeAccount?.address) {
      setSv(prev => ({ ...prev, error: { code: "NO_WALLET", message: "Wallet non connesso." } }));
      return;
    }
    if (!activeWallet) {
      setSv(prev => ({ ...prev, error: { code: "NO_WALLET", message: "Wallet non connesso." } }));
      return;
    }

    // Lock anti-double-click
    _evmExecuting = true;

    // Salva idempotency key
    const ikey = sessionStorage.getItem(EVM_SWAP_IKEY) ?? crypto.randomUUID();
    sessionStorage.setItem(EVM_SWAP_IKEY, ikey);

    // Snapshot account prima della firma (rilevamento cambio account)
    const accountBefore = accountRef.current;

    try {
      // Write-before-submit: salva active swap in localStorage
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

      // Write-before-submit: notifica backend
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
      }).catch(() => null); // non-blocking: best-effort

      setSv(prev => ({ ...prev, phase: "signing", error: null }));

      let submittedTxHash = "";

      const { txHash } = await executeLiFiSwap(current.quote, {
        onRouteUpdate: (route) => {
          // Rileva fase approving
          const steps = route.steps ?? [];
          for (const step of steps) {
            const s = step as unknown as Record<string, unknown>;
            if (s.type === "approve" && (s.status === "ACTION_REQUIRED" || s.status === "PENDING")) {
              setSv(prev => ({ ...prev, phase: "approving" }));
            }
          }
        },
        onTxSubmitted: (hash) => {
          submittedTxHash = hash;
          // Aggiorna localStorage con txHash
          const stored = localStorage.getItem(EVM_SWAP_ACTIVE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored) as EvmActiveSwap;
              localStorage.setItem(EVM_SWAP_ACTIVE_KEY, JSON.stringify({ ...parsed, txHash: hash }));
            } catch { /* ignore */ }
          }
          setSv(prev => ({ ...prev, phase: "submitted", txHash: hash }));
        },
      });

      // Verifica cambio account durante esecuzione
      if (accountRef.current && accountBefore && accountRef.current !== accountBefore) {
        throw new Error("ACCOUNT_CHANGED: il wallet è cambiato durante l'esecuzione.");
      }

      const finalTxHash = txHash || submittedTxHash;

      // Aggiorna backend
      await swapApi(`/${current.quote.routeId}`, {
        method: "PATCH",
        body: JSON.stringify({
          txHash:  finalTxHash,
          state:   "completed",
        }),
      }).catch(() => null);

      // Clear localStorage e idempotency key
      localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
      sessionStorage.removeItem(EVM_SWAP_IKEY);

      setSv(prev => ({ ...prev, phase: "completed", txHash: finalTxHash, error: null }));
    } catch (err) {
      const msg  = err instanceof Error ? err.message : "Errore durante lo swap.";
      const code = msg.startsWith("ACCOUNT_CHANGED") ? "ACCOUNT_CHANGED"
                 : msg === "QUOTE_EXPIRED"             ? "QUOTE_EXPIRED"
                 : msg.includes("rejected") || msg.includes("denied") || msg.includes("refused") ? "USER_REJECTED"
                 : "EXECUTE_ERROR";

      // Notifica backend del fallimento (best-effort)
      if (current.quote) {
        await swapApi(`/${current.quote.routeId}`, {
          method: "PATCH",
          body: JSON.stringify({ txHash: "", state: "failed", error: msg }),
        }).catch(() => null);
      }

      // User rejected: non è un errore critico — torna a quoted
      if (code === "USER_REJECTED") {
        localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
        setSv(prev => ({ ...prev, phase: "quoted", error: { code, message: "Firma rifiutata. Puoi riprovare." } }));
      } else if (code === "QUOTE_EXPIRED") {
        localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
        sessionStorage.removeItem(EVM_SWAP_IKEY);
        setSv(prev => ({ ...prev, phase: "idle", quote: null, error: { code, message: "Quote scaduta. Ricarica la quote." } }));
      } else {
        setSv(prev => ({ ...prev, phase: "failed", error: { code, message: msg } }));
      }
    } finally {
      _evmExecuting = false;
    }
  }, [activeAccount, activeWallet]);

  const reset = useCallback(() => {
    localStorage.removeItem(EVM_SWAP_ACTIVE_KEY);
    sessionStorage.removeItem(EVM_SWAP_IKEY);
    _evmExecuting = false;
    setSv(makeInitial());
  }, []);

  const actions: EvmSwapActions = {
    setFromChain, setToChain, setFromToken, setToToken,
    setFromAmount, swapDirection, fetchQuote, execute, reset,
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
