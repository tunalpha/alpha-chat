/**
 * EvmSwapView — UI EVM Swap con Li.Fi
 *
 * Design system: asw-* (nativi Alpha Chat — vedi AlphaWalletPage.css)
 * Zero Tailwind utility classes — zero import da payment engine / USDA / MultiChain.
 *
 * WALLET BRIDGE:
 *   - Se l'Alpha Wallet interno è sbloccato, usa il suo indirizzo EVM
 *     (alphaWalletAddress prop proveniente da SwapView → WalletContext)
 *   - Se è presente anche un account ThirdWeb (WalletConnect), quello ha priorità
 *   - effectiveAddress = activeAccount?.address ?? alphaWalletAddress
 *   - Il messaggio "collega wallet" appare SOLO quando effectiveAddress è assente
 *     per più di 3 secondi (evita falso positivo durante il reconnect)
 *
 * FUNZIONALITÀ:
 *   - Balance reale dei token (via RPC diretto con effectiveAddress)
 *   - Bottone MAX con riserva gas per token nativi
 *   - Quote Li.Fi automatica al cambio importo/token
 *   - Auto-detect chain attiva (via useActiveWalletChain, ThirdWeb mode)
 */

import React, {
  useCallback, useEffect, useRef, useState,
} from "react";
import {
  ArrowUpDown, Loader2, CheckCircle, AlertTriangle,
  Copy, Check, ExternalLink, RefreshCw, Info, ChevronDown, ChevronRight, X,
} from "lucide-react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { type WalletClient } from "viem";
import { useEvmSwapState }  from "./useEvmSwapState.js";
import { TokenSelector }    from "./TokenSelector.js";
import {
  fromTokenUnits, toTokenUnits, getChainInfo, EVM_SWAP_CHAINS, getTokensForChain,
  LIFI_FEE, type EvmToken,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(fee: number) { return (fee * 100).toFixed(2) + "%"; }

function txUrl(chainId: number, txHash: string): string {
  const chain = getChainInfo(chainId);
  return chain ? `${chain.explorerUrl}/tx/${txHash}` : "#";
}

/** Colore chain */
const CHAIN_COLOR: Record<number, string> = {
  137: "#8247E5",
  56:  "#F3BA2F",
  1:   "#627EEA",
};

// ── Lettura balance via RPC ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _VITE_POLY = ((import.meta as any).env?.VITE_POLYGON_RPC as string | undefined);

/** Lista ordinata di RPC per chain — il primo che risponde viene usato */
const CHAIN_RPC: Record<number, string[]> = {
  137: [_VITE_POLY ?? "https://polygon-rpc.com"],
  56:  ["https://bsc-dataseed.binance.org/", "https://bsc-dataseed1.ninicoin.io/"],
  // Ethereum: più fallback perché cloudflare può bloccare Safari iOS
  1:   [
    "https://rpc.ankr.com/eth",
    "https://ethereum-rpc.publicnode.com",
    "https://1rpc.io/eth",
    "https://cloudflare-eth.com",
  ],
};

async function rpcPost<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json() as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.result as T;
}

/** Prova ogni RPC nell'ordine finché uno risponde */
async function rpcPostWithFallback<T>(chainId: number, method: string, params: unknown[]): Promise<T> {
  const urls = CHAIN_RPC[chainId] ?? [];
  let lastErr: unknown;
  for (const url of urls) {
    try {
      return await rpcPost<T>(url, method, params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`No RPC available for chain ${chainId}`);
}

interface BalancesState {
  map:     Map<string, bigint>;
  loading: boolean;
}

function useEvmTokenBalances(chainId: number, address: string | undefined): BalancesState {
  const [state, setState] = useState<BalancesState>({ map: new Map(), loading: false });

  useEffect(() => {
    if (!address) { setState({ map: new Map(), loading: false }); return; }
    if (!CHAIN_RPC[chainId]?.length) return;

    const tokens = getTokensForChain(chainId);
    let cancelled = false;
    setState(prev => ({ ...prev, loading: true }));

    Promise.allSettled(
      tokens.map(async (t) => {
        if (t.isNative) {
          const hex = await rpcPostWithFallback<string>(chainId, "eth_getBalance", [address, "latest"]);
          return [t.address, BigInt(hex ?? "0x0")] as const;
        } else {
          const pad = address.slice(2).padStart(64, "0");
          const hex = await rpcPostWithFallback<string>(chainId, "eth_call", [
            { to: t.address, data: `0x70a08231${pad}` }, "latest",
          ]);
          return [t.address, BigInt(hex || "0x0")] as const;
        }
      }),
    ).then(results => {
      if (cancelled) return;
      const entries: [string, bigint][] = [];
      for (const r of results) {
        if (r.status === "fulfilled") entries.push(r.value);
      }
      setState({ map: new Map(entries), loading: false });
    }).catch(() => {
      if (!cancelled) setState(prev => ({ ...prev, loading: false }));
    });

    return () => { cancelled = true; };
  }, [chainId, address]);

  return state;
}

/** Formatta balance in human-readable, con max 6 cifre significative */
function fmtBal(raw: bigint | undefined, decimals: number): string {
  if (raw === undefined || raw === 0n) return "0";
  const human = fromTokenUnits(raw.toString(), decimals);
  const n = parseFloat(human);
  if (n === 0) return "0";
  if (n < 0.000001) return "<0.000001";
  return n.toFixed(Math.min(6, decimals));
}

// Riserva gas per token nativi (MAX non deve azzerare il gas)
// ETH: 0.003 ETH copre ~150k gas a 20 gwei ($5.70 a $1900/ETH)
const GAS_RESERVE: Record<number, bigint> = {
  137: 20000000000000000n,   // 0.02 POL  (Polygon — gas economico)
  56:  5000000000000000n,    // 0.005 BNB (BSC)
  1:   3000000000000000n,    // 0.003 ETH (Ethereum — ridotto da 0.005)
};

// ── Hook: prezzo token in USD e EUR (via Li.Fi + exchangerate-api) ─────────────

type FiatCurrency = "USD" | "EUR" | "";

interface TokenPriceState {
  priceUSD: number | null;
  priceEUR: number | null;
  loading:  boolean;
}

function useTokenPrice(chainId: number, token: EvmToken | null): TokenPriceState {
  const [state, setState] = useState<TokenPriceState>({ priceUSD: null, priceEUR: null, loading: false });

  useEffect(() => {
    if (!token) { setState({ priceUSD: null, priceEUR: null, loading: false }); return; }
    let cancelled = false;
    setState(prev => ({ ...prev, loading: true }));

    (async () => {
      try {
        const addr = token.isNative ? "0x0000000000000000000000000000000000000000" : token.address;
        const res  = await fetch(
          `https://li.quest/v1/token?chain=${chainId}&token=${addr}`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json() as { priceUSD?: string };
        const usd  = parseFloat(data.priceUSD ?? "0");
        if (!isFinite(usd) || usd <= 0) return;

        let eurRate = 0.92;
        try {
          const fx = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(3000) });
          if (fx.ok) {
            const fxData = await fx.json() as { rates?: Record<string, number> };
            eurRate = fxData.rates?.EUR ?? 0.92;
          }
        } catch { /* usa tasso fisso */ }

        if (!cancelled) setState({ priceUSD: usd, priceEUR: usd * eurRate, loading: false });
      } catch {
        if (!cancelled) setState(prev => ({ ...prev, loading: false }));
      }
    })();

    return () => { cancelled = true; };
  }, [chainId, token?.address]);

  return state;
}

// ── TokenCard ─────────────────────────────────────────────────────────────────

const PCT_OPTIONS: [number, string][] = [[10, "10%"], [25, "25%"], [50, "50%"], [100, "MAX"]];

interface TokenCardProps {
  label:            string;
  chainId:          number;
  token:            EvmToken | null;
  amount?:          string;
  onAmountChange?:  (v: string) => void;
  onTokenClick:     () => void;
  readOnly?:        boolean;
  balance?:         bigint;
  balLoading?:      boolean;
  /** Callback bottoni percentuale (pct = 10 | 25 | 50 | 100) */
  onPct?:           (pct: number) => void;
  exceedsBalance?:  boolean;
  // Fiat toggle
  fiatCurrency?:    FiatCurrency;
  priceUSD?:        number | null;
  priceEUR?:        number | null;
  onFiatToggle?:    (c: FiatCurrency) => void;
}

/** Icona token: <img> con logoURI se disponibile, altrimenti cerchio colorato */
function TokenIcon({ token, chainId }: { token: EvmToken | null; chainId: number }) {
  const chainColor = CHAIN_COLOR[chainId] ?? "#888";
  const [imgError, setImgError] = useState(false);

  if (token?.logoURI && !imgError) {
    return (
      <img
        src={token.logoURI}
        alt={token.symbol}
        className="asw-token-icon asw-token-icon--img"
        onError={() => setImgError(true)}
        style={{ objectFit: "cover", borderRadius: "50%" }}
      />
    );
  }
  return (
    <div className="asw-token-icon" style={{ background: `${chainColor}22`, color: chainColor }}>
      {token ? token.symbol.slice(0, 3) : "?"}
    </div>
  );
}

function TokenCard({
  label, chainId, token, amount, onAmountChange, onTokenClick,
  readOnly, balance, balLoading, onPct, exceedsBalance,
  fiatCurrency, priceUSD, priceEUR, onFiatToggle,
}: TokenCardProps) {
  const chain        = getChainInfo(chainId);
  const chainColor   = CHAIN_COLOR[chainId] ?? "#888";
  const hasBalance   = balance !== undefined;
  const balStr       = hasBalance && token ? fmtBal(balance, token.decimals) : null;
  const hasPct       = !!onPct && hasBalance && (balance ?? 0n) > 0n;
  const hasFiatToggle = !!onFiatToggle && (priceUSD ?? 0) > 0;
  const inFiatMode   = hasFiatToggle && !!fiatCurrency;
  const price        = fiatCurrency === "EUR" ? priceEUR : (fiatCurrency === "USD" ? priceUSD : null);

  // Fiat input locale (non sincronizzato col crypto amount, che è la source of truth)
  const [fiatInput, setFiatInput] = useState("");
  const prevCryptoRef = useRef("");
  // Se l'amount crypto cambia esternamente (pct / quote), reset fiat input
  useEffect(() => {
    if ((amount ?? "") !== prevCryptoRef.current) {
      prevCryptoRef.current = amount ?? "";
      if (inFiatMode) setFiatInput("");
    }
  }, [amount, inFiatMode]);

  // Fiat hint sotto il campo crypto (solo crypto mode)
  const fiatHint = !inFiatMode && price && price > 0 && amount && parseFloat(amount) > 0
    ? `≈ ${fiatCurrency === "EUR" ? "€" : "$"}${(parseFloat(amount) * price).toFixed(2)}`
    : null;

  const handleFiatChange = (raw: string) => {
    // iOS Italian keyboard emette la virgola come separatore decimale — normalizza prima
    const cleaned = raw.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    setFiatInput(cleaned);
    if (onAmountChange && price && price > 0) {
      const n = parseFloat(cleaned);
      if (isFinite(n) && n > 0) {
        onAmountChange((n / price).toFixed(8));
      } else {
        onAmountChange("");
      }
    }
  };

  return (
    <div className="asw-card" style={exceedsBalance ? { borderColor: "#f87171", borderWidth: 1, borderStyle: "solid" } : undefined}>

      {/* Header: label + toggle €/$ + saldo */}
      <div className="asw-card-head">
        <span className="asw-card-label">{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>

          {/* Fiat toggle pill — $ verde, € viola */}
          {hasFiatToggle && onFiatToggle && (
            <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,.07)", borderRadius: 10, padding: "2px 3px" }}>
              {(["USD", "EUR"] as const).map(c => {
                const isActive = fiatCurrency === c;
                const accentBg = c === "USD" ? "#16a34a" : "#6366f1";
                const accentTxt = c === "USD" ? "#22c55e" : "#a5b4fc";
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { onFiatToggle(fiatCurrency === c ? "" : c); setFiatInput(""); }}
                    style={{
                      fontSize: 12, fontWeight: 800, padding: "2px 9px", borderRadius: 8,
                      border: "none", cursor: "pointer", lineHeight: "18px",
                      background: isActive ? accentBg : "transparent",
                      color: isActive ? "#fff" : accentTxt,
                      transition: "background .15s",
                      letterSpacing: ".5px",
                    }}
                  >
                    {c === "USD" ? "$" : "€"}
                  </button>
                );
              })}
            </div>
          )}

          {/* Saldo */}
          {token && (
            <div className="asw-card-balance">
              {balLoading ? (
                <span style={{ fontSize: 12, color: "rgba(255,255,255,.35)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Loader2 size={11} style={{ animation: "aw-spin .8s linear infinite" }} /> Saldo…
                </span>
              ) : balStr !== null ? (
                <span style={{ fontSize: 12, color: "rgba(255,255,255,.4)" }}>
                  {balStr} {token.symbol}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Token selector + importo */}
      <div className="asw-token-row">
        <button className="asw-token-btn" onClick={onTokenClick} aria-label={`Seleziona token ${label}`}>
          <TokenIcon token={token} chainId={chainId} />
          <div className="asw-token-info">
            <div className="asw-token-name">
              {token?.symbol ?? "—"}
              <ChevronDown size={14} className="asw-token-chevron" />
            </div>
            <div className="asw-token-network">
              <span className="asw-net-dot" style={{ background: chainColor }} />
              {chain?.name ?? chainId}
            </div>
          </div>
        </button>

        <div className="asw-amount-col">
          {onAmountChange ? (
            inFiatMode ? (
              /* Modalità fiat: input in €/$ con hint crypto sotto */
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,.4)" }}>
                    {fiatCurrency === "EUR" ? "€" : "$"}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={fiatInput}
                    onChange={e => handleFiatChange(e.target.value)}
                    className="asw-amount-input"
                    aria-label={`Importo in ${fiatCurrency}`}
                    style={{ maxWidth: 130 }}
                  />
                </div>
                {amount && parseFloat(amount) > 0 && (
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.3)", paddingRight: 2 }}>
                    ≈ {parseFloat(amount).toFixed(6)} {token?.symbol ?? ""}
                  </span>
                )}
              </div>
            ) : (
              /* Modalità crypto standard */
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={amount ?? ""}
                  onChange={e => {
                    // iOS Italian keyboard → normalizza virgola a punto
                    const val = e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                    onAmountChange(val);
                  }}
                  readOnly={readOnly}
                  className="asw-amount-input"
                  aria-label={`Importo ${label}`}
                />
                {fiatHint && (
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.3)", paddingRight: 2 }}>
                    {fiatHint}
                  </span>
                )}
              </div>
            )
          ) : (
            <span className="asw-amount-display">{amount ?? "—"}</span>
          )}
        </div>
      </div>

      {/* Bottoni percentuale 10% / 25% / 50% / MAX */}
      {hasPct && (
        <div style={{
          display: "flex", gap: 6, marginTop: 10,
          paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.07)",
        }}>
          {PCT_OPTIONS.map(([pct, lbl]) => (
            <button
              key={pct}
              type="button"
              onClick={() => { onPct!(pct); if (inFiatMode && onFiatToggle) onFiatToggle(""); }}
              style={{
                flex: 1, fontSize: 12, fontWeight: 600, padding: "5px 0",
                borderRadius: 8, border: "1px solid rgba(255,255,255,.12)",
                background: "rgba(255,255,255,.06)", color: "rgba(255,255,255,.7)",
                cursor: "pointer", letterSpacing: ".2px", transition: "background .12s",
              }}
              onPointerEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,.14)")}
              onPointerLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,.06)")}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fee preview ───────────────────────────────────────────────────────────────

function EvmFeePreview({ quote }: { quote: NonNullable<ReturnType<typeof useEvmSwapState>[0]["quote"]> }) {
  const toHuman = fromTokenUnits(quote.toAmount, quote.toToken.decimals);
  const toMin   = fromTokenUnits(quote.toAmountMin, quote.toToken.decimals);

  return (
    <div className="asw-info-box">
      <div className="asw-info-row">
        <span className="asw-info-label">Riceverai circa</span>
        <span className="asw-info-value" style={{ fontWeight: 700 }}>{parseFloat(toHuman).toFixed(6)} {quote.toToken.symbol}</span>
      </div>
      <div className="asw-info-row">
        <span className="asw-info-label">Minimo garantito</span>
        <span className="asw-info-value">{parseFloat(toMin).toFixed(6)} {quote.toToken.symbol}</span>
      </div>
      <div className="asw-info-row">
        <span className="asw-info-label">Fee Alpha ({fmtPct(LIFI_FEE)})</span>
        <span className="asw-info-value asw-info-value--fee">≈ ${quote.alphaFeeUSD}</span>
      </div>
      {parseFloat(quote.gasCostUSD) > 0 && (
        <div className="asw-info-row">
          <span className="asw-info-label">Gas stimato</span>
          <span className="asw-info-value">≈ ${quote.gasCostUSD}</span>
        </div>
      )}
      <hr className="asw-info-sep" />
      <div className="asw-info-row asw-info-row--total">
        <span className="asw-info-label" style={{ fontWeight: 600, color: "rgba(255,255,255,.75)" }}>Fee totale</span>
        <span className="asw-info-value" style={{ fontWeight: 700 }}>≈ ${quote.totalFeeUSD}</span>
      </div>
      <div className="asw-info-row">
        <span className="asw-info-label">Provider</span>
        <span className="asw-provider-chip">🔀 {quote.tool}</span>
      </div>
      <div className="asw-info-row">
        <span className="asw-info-label">Slippage</span>
        <span className="asw-info-value">{(quote.slippage * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ── Pending / Completed / Failed views ───────────────────────────────────────

function EvmPendingView({ txHash, fromChainId, onBack }: { txHash: string | null; fromChainId: number; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (txHash) navigator.clipboard.writeText(txHash).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="asw-status-view">
      <div className="asw-status-icon asw-status-icon--pending">
        <Loader2 size={36} style={{ animation: "aw-spin .8s linear infinite" }} />
      </div>
      <div>
        <p className="asw-status-title">Swap in corso…</p>
        <p className="asw-status-sub">La transazione è stata inviata. Attendi la conferma on-chain.</p>
      </div>
      {txHash && (
        <div className="asw-mono-box" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span>{txHash.slice(0, 18)}…{txHash.slice(-14)}</span>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button onClick={copy} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--accent,#6366f1)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copiato" : "Copia"}
            </button>
            <a href={txUrl(fromChainId, txHash)} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--accent,#6366f1)", textDecoration: "none" }}>
              <ExternalLink size={13} /> Explorer
            </a>
          </div>
        </div>
      )}
      <button onClick={onBack} className="aw-btn aw-btn--secondary" style={{ maxWidth: 280 }}>
        Torna alla home
      </button>
    </div>
  );
}

function EvmCompletedView({ txHash, fromChainId, toToken, toAmount, onDone }: {
  txHash: string | null; fromChainId: number; toToken: EvmToken | null;
  toAmount: string; onDone: () => void;
}) {
  return (
    <div className="asw-status-view">
      <div className="asw-status-icon asw-status-icon--success">
        <CheckCircle size={36} />
      </div>
      <div>
        <p className="asw-status-title">Swap completato!</p>
        {toToken && parseFloat(toAmount) > 0 && (
          <p className="asw-status-amount">≈ {parseFloat(toAmount).toFixed(6)} {toToken.symbol}</p>
        )}
        <p className="asw-status-sub" style={{ marginTop: 8 }}>I token sono stati inviati al tuo wallet.</p>
      </div>
      {txHash && (
        <a href={txUrl(fromChainId, txHash)} target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--accent,#6366f1)", textDecoration: "none" }}>
          <ExternalLink size={14} /> Vedi su explorer
        </a>
      )}
      <button onClick={onDone} className="aw-btn aw-btn--primary" style={{ maxWidth: 300 }}>
        Fatto
      </button>
    </div>
  );
}

function EvmFailedView({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div className="asw-status-view">
      <div className="asw-status-icon asw-status-icon--error">
        <AlertTriangle size={36} />
      </div>
      <div>
        <p className="asw-status-title">Swap non riuscito</p>
        <p className="asw-status-sub">{humanizeEvmError(error ?? "SWAP_UNAVAILABLE")}</p>
      </div>
      <button onClick={onRetry} className="aw-btn aw-btn--primary" style={{ maxWidth: 300, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <RefreshCw size={16} /> Riprova
      </button>
    </div>
  );
}

// ── Slippage modal ────────────────────────────────────────────────────────────

const SLIPPAGE_PRESETS = [0.005, 0.01, 0.02, 0.03, 0.04, 0.05] as const;

function SlippageModal({ current, onConfirm, onClose }: {
  current: number;
  onConfirm: (v: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number>(current);
  const [customRaw, setCustomRaw] = useState(
    SLIPPAGE_PRESETS.includes(current as typeof SLIPPAGE_PRESETS[number]) ? "" : (current * 100).toFixed(1),
  );
  const effectiveSlippage = customRaw
    ? Math.min(Math.max(parseFloat(customRaw) / 100 || current, 0.001), 0.5)
    : selected;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%", maxWidth: 480, margin: "0 auto",
          background: "#1a1a2e", borderRadius: "20px 20px 0 0",
          padding: "24px 20px 36px",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ fontSize: 17, fontWeight: 700, color: "#fff", margin: 0 }}>Slippage massimo</p>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,.5)", cursor: "pointer", padding: 4 }}>
            <X size={20} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,.45)", marginBottom: 20, lineHeight: 1.5 }}>
          La transazione non può essere processata se i cambi del prezzo sono più sfavorevoli di questa percentuale.
        </p>

        {/* Preset grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
          {SLIPPAGE_PRESETS.map(v => {
            const isActive = !customRaw && selected === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => { setSelected(v); setCustomRaw(""); }}
                style={{
                  padding: "10px 0", borderRadius: 12, fontSize: 15, fontWeight: 600,
                  border: isActive ? "none" : "1px solid rgba(255,255,255,.15)",
                  background: isActive ? "var(--accent,#6366f1)" : "rgba(255,255,255,.05)",
                  color: isActive ? "#fff" : "rgba(255,255,255,.7)",
                  cursor: "pointer", transition: "background .12s",
                }}
              >
                {(v * 100).toFixed(1).replace(".0", "")}%
              </button>
            );
          })}
        </div>

        {/* Custom input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(255,255,255,.07)", borderRadius: 12,
          padding: "10px 14px", marginBottom: 20,
          border: customRaw ? "1px solid var(--accent,#6366f1)" : "1px solid rgba(255,255,255,.1)",
        }}>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Personalizzato"
            value={customRaw}
            onChange={e => {
              const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
              setCustomRaw(v);
              if (v) setSelected(-1);
            }}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 15, color: "#fff", fontFamily: "inherit",
            }}
          />
          <span style={{ fontSize: 15, color: "rgba(255,255,255,.5)", fontWeight: 600 }}>%</span>
        </div>

        {/* Conferma */}
        <button
          onClick={() => { onConfirm(effectiveSlippage); onClose(); }}
          className="aw-btn aw-btn--primary"
        >
          Conferma
        </button>
      </div>
    </div>
  );
}

// ── EVM error humanizer ───────────────────────────────────────────────────────

function humanizeEvmError(raw: string): string {
  // I codici sono già sanitizzati da useEvmSwapState (USER_REJECTED, ALPHA_WALLET_LOCKED…)
  // Per qualsiasi altro contenuto, il fallback di humanizeEvmCode è già generico.
  return humanizeEvmCode(raw ?? "");
}

function humanizeEvmCode(code: string): string {
  switch (code) {
    case "USER_REJECTED":
      return "Firma annullata. Puoi riprovare quando vuoi.";
    case "QUOTE_EXPIRED":
      return "La quote è scaduta. Ricarica per ottenerne una nuova.";
    case "NO_WALLET":
    case "ALPHA_WALLET_LOCKED":
      return "Sblocca Alpha Wallet con il PIN prima di procedere.";
    case "SWAP_UNAVAILABLE":
      return "Swap non disponibile al momento. Riprova tra qualche istante.";
    default: {
      // Messaggi Li.Fi specifici (passati direttamente come message) → parsing testuale
      const lower = code.toLowerCase();
      if (lower.includes("min") && (lower.includes("amount") || lower.includes("requirement"))) {
        return "Importo troppo basso per questo swap. Prova un importo maggiore.";
      }
      if (lower.includes("no route") || lower.includes("no routes") || lower.includes("not found")) {
        return "Nessuna route disponibile per questa coppia. Prova un importo o token diverso.";
      }
      if (lower.includes("insufficient funds") || lower.includes("insufficient balance") || lower.includes("not enough") || lower.includes("exceeds balance")) {
        return "Saldo insufficiente per gas + importo. Riduci l'importo.";
      }
      if (lower.includes("insufficient liquidity") || lower.includes("liquidity")) {
        return "Liquidità insufficiente. Prova un importo minore.";
      }
      if (lower.includes("wallet non configurato") || lower.includes("wallet not configured") || lower.includes("configurelifi")) {
        return "Wallet non configurato. Riprova.";
      }
      // Fallback generico
      return "Swap non disponibile al momento. Riprova tra qualche istante.";
    }
  }
}

// ── EVM Swap History (mini sezione collassabile) ─────────────────────────────

interface _EvmSwapRecord {
  _id: string;
  fromToken: string; toToken: string;
  fromChainId: number; toChainId: number;
  fromAmount: string; toAmount?: string;
  state: "pending" | "completed" | "failed";
  txHash?: string;
  startedAt: string;
}

async function _fetchEvmHistory(): Promise<_EvmSwapRecord[]> {
  const token = localStorage.getItem("ac_access_token");
  const res = await fetch("/api/v1/swap/evm/history", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json() as { ok: boolean; swaps: _EvmSwapRecord[] };
  return Array.isArray(data.swaps) ? data.swaps : [];
}

const _CNAME: Record<number, string> = { 1: "Eth", 137: "Pol", 56: "BSC" };

function EvmSwapHistorySection({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<_EvmSwapRecord[] | null>(null);
  const [open, setOpen]   = useState(false);
  const loadedKey = useRef(-1);

  useEffect(() => {
    if (!open) return;
    // Ricarica ogni volta che la sezione si apre O refreshKey cambia (nuovo swap completato)
    if (items !== null && loadedKey.current === refreshKey) return;
    loadedKey.current = refreshKey;
    _fetchEvmHistory().then(setItems).catch(() => setItems([]));
  }, [open, refreshKey, items]);

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: "6px 2px", borderTop: "1px solid rgba(255,255,255,.07)",
        }}
      >
        <span style={{ fontSize: 13, color: "rgba(255,255,255,.45)", fontWeight: 600 }}>
          Cronologia swap EVM
        </span>
        <ChevronDown size={15} style={{
          color: "rgba(255,255,255,.3)",
          transform: open ? "rotate(180deg)" : "none",
          transition: "transform .2s",
        }} />
      </button>

      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {items === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0", color: "rgba(255,255,255,.35)", fontSize: 12 }}>
              <Loader2 size={13} style={{ animation: "aw-spin .8s linear infinite" }} /> Caricamento…
            </div>
          ) : items.length === 0 ? (
            <p style={{ fontSize: 12, color: "rgba(255,255,255,.35)", padding: "6px 0", margin: 0 }}>Nessun swap EVM ancora</p>
          ) : (
            items.slice(0, 8).map(it => {
              const ok = it.state === "completed";
              const ko = it.state === "failed";
              const dot = ok ? "#22c55e" : ko ? "#f87171" : "rgba(255,255,255,.45)";
              const lbl = ok ? "✓" : ko ? "✗" : "…";
              const date = new Date(it.startedAt).toLocaleDateString("it-IT", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              });
              const cross = it.fromChainId !== it.toChainId;
              const chainNote = cross
                ? ` (${_CNAME[it.fromChainId] ?? it.fromChainId}→${_CNAME[it.toChainId] ?? it.toChainId})`
                : "";
              return (
                <div key={it._id} style={{
                  background: "rgba(255,255,255,.04)", borderRadius: 10,
                  padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,.8)", margin: 0 }}>
                      {it.fromToken} → {it.toToken}
                      {cross && <span style={{ fontSize: 11, color: "rgba(255,255,255,.35)", fontWeight: 400 }}>{chainNote}</span>}
                    </p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,.35)", margin: "2px 0 0" }}>{date}</p>
                  </div>
                  <span style={{ fontSize: 15, color: dot, fontWeight: 700, lineHeight: 1 }}>{lbl}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface EvmSwapViewProps {
  onBack?: () => void;
  /** Indirizzo EVM dell'Alpha Wallet interno (da WalletContext via SwapView) */
  alphaWalletAddress?: string;
  /**
   * Factory per il viem WalletClient dell'Alpha Wallet (da SwapView).
   * Stabile: creata con useCallback(fn, []) in SwapView.
   */
  getAlphaWalletClient?: (chainId: number) => Promise<WalletClient>;
}

export function EvmSwapView({ onBack, alphaWalletAddress, getAlphaWalletClient }: EvmSwapViewProps) {
  const [slippage, setSlippage] = useState(0.005); // 0.5% default
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [sv, actions] = useEvmSwapState({ alphaWalletAddress, getAlphaWalletClient, slippage });

  // ThirdWeb hooks (usati in modalità WalletConnect, se attiva)
  const activeAccount = useActiveAccount();
  const activeChain   = useActiveWalletChain();

  // effectiveAddress: ThirdWeb oppure Alpha Wallet interno (unica source of truth per UI)
  const effectiveAddress = activeAccount?.address ?? alphaWalletAddress;

  // Balance per i token sulla chain "from" — usa effectiveAddress
  const balancesState = useEvmTokenBalances(sv.fromChainId, effectiveAddress);

  // Prezzo token from (per toggle fiat €/$)
  const tokenPrice = useTokenPrice(sv.fromChainId, sv.fromToken);

  // Stato toggle fiat: "" = crypto; "USD" = dollari; "EUR" = euro
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrency>("");

  // Token selector state
  const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
  const [tokenSide, setTokenSide] = useState<"from" | "to">("from");

  // ── Exact-output mode (RICEVI editabile) ────────────────────────────────────
  // "from" = utente ha digitato in PAGA  (calcola quanto riceve)
  // "to"   = utente ha digitato in RICEVI (calcola quanto deve inviare)
  const [amountMode, setAmountMode] = useState<"from" | "to">("from");
  const [toInput, setToInput] = useState("");

  // Wallet warning: appare SOLO quando effectiveAddress è assente per più di 3s
  const [showWalletHint, setShowWalletHint] = useState(false);
  useEffect(() => {
    if (effectiveAddress) { setShowWalletHint(false); return; }
    const t = setTimeout(() => setShowWalletHint(true), 3000);
    return () => clearTimeout(t);
  }, [effectiveAddress]);

  // Dopo completion: forza un ciclo del tx-monitor (aggiorna cronologia Alpha Wallet)
  // + incrementa historyRefreshKey per ricaricare la cronologia EVM inline
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const prevPhase = useRef(sv.phase);
  useEffect(() => {
    if (prevPhase.current !== "completed" && sv.phase === "completed") {
      setHistoryRefreshKey(k => k + 1);
      // Lazy-import del txMonitor. Se il monitor è già avviato usa forcePoll(),
      // altrimenti pollWithAddress() esegue un poll one-shot con l'address corrente
      // (fix: forcePoll era no-op se il monitor non era ancora partito).
      import("../../wallet/monitoring/tx-monitor.js")
        .then(({ txMonitor }) => {
          if (effectiveAddress) {
            void txMonitor.pollWithAddress(effectiveAddress);
          } else {
            void txMonitor.forcePoll();
          }
        })
        .catch(() => {});
    }
    prevPhase.current = sv.phase;
  }, [sv.phase, effectiveAddress]);

  // Quote display (from-mode)
  const toAmountDisplay = sv.quote
    ? parseFloat(fromTokenUnits(sv.quote.toAmount, sv.quote.toToken.decimals)).toFixed(6)
    : "";

  // Quote display per PAGA (to-mode): computed fromAmount da Li.Fi
  const fromAmountDisplay = amountMode === "to" && sv.quote?.computedFromAmount && sv.quote.fromToken
    ? parseFloat(fromTokenUnits(sv.quote.computedFromAmount, sv.quote.fromToken.decimals)).toFixed(6)
    : undefined;

  // Debounce from-mode quote
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFrom      = useRef("");
  const prevFTok      = useRef("");
  const prevTTok      = useRef("");

  // Debounce to-mode quote
  const debounceToRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevToInput   = useRef("");

  useEffect(() => {
    if (amountMode !== "from") return;
    if (!sv.fromAmount || sv.fromAmount === "0" || !sv.fromToken || !sv.toToken) return;
    if (!effectiveAddress) return;

    const fromKey = sv.fromToken.chainId + sv.fromToken.address;
    const toKey   = sv.toToken.chainId   + sv.toToken.address;
    const changed = sv.fromAmount !== prevFrom.current
                  || fromKey      !== prevFTok.current
                  || toKey        !== prevTTok.current;
    if (!changed) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      prevFrom.current = sv.fromAmount;
      prevFTok.current = fromKey;
      prevTTok.current = toKey;
      if (sv.phase === "idle") actions.fetchQuote();
    }, 700);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountMode, sv.fromAmount, sv.fromToken, sv.toToken, sv.phase, effectiveAddress]);

  useEffect(() => {
    if (amountMode !== "to") return;
    if (!toInput || toInput === "0" || !sv.fromToken || !sv.toToken) return;
    if (!effectiveAddress) return;

    if (toInput === prevToInput.current) return;

    if (debounceToRef.current) clearTimeout(debounceToRef.current);
    debounceToRef.current = setTimeout(() => {
      prevToInput.current = toInput;
      actions.fetchQuoteExactOut(toInput);
    }, 700);

    return () => { if (debounceToRef.current) clearTimeout(debounceToRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountMode, toInput, sv.fromToken, sv.toToken, effectiveAddress]);

  const handleTokenSelect = useCallback((token: EvmToken, chainId: number) => {
    if (tokenSide === "from") {
      // Auto-swap: se l'utente sceglie lo stesso token che è già in RICEVI → inverti
      const sameAsTo = sv.toToken
        && sv.toToken.chainId === chainId
        && sv.toToken.address.toLowerCase() === token.address.toLowerCase();
      if (sameAsTo && sv.fromToken) {
        actions.setToChain(sv.fromChainId);
        actions.setToToken(sv.fromToken);
      }
      actions.setFromChain(chainId);
      actions.setFromToken(token);
    } else {
      // Auto-swap: se l'utente sceglie lo stesso token che è già in PAGA → inverti
      const sameAsFrom = sv.fromToken
        && sv.fromToken.chainId === chainId
        && sv.fromToken.address.toLowerCase() === token.address.toLowerCase();
      if (sameAsFrom && sv.toToken) {
        actions.setFromChain(sv.toChainId);
        actions.setFromToken(sv.toToken);
      }
      actions.setToChain(chainId);
      actions.setToToken(token);
    }
    // Reset mode su cambio token
    setAmountMode("from");
    setToInput("");
  }, [tokenSide, actions, sv.fromToken, sv.toToken, sv.fromChainId, sv.toChainId]);

  const handleFromAmountChange = useCallback((val: string) => {
    setAmountMode("from");
    setToInput("");
    actions.setFromAmount(val);
  }, [actions]);

  const handleToAmountChange = useCallback((val: string) => {
    setAmountMode("to");
    setToInput(val);
    // Resetta fromAmount nel state (sarà calcolato dalla quote)
    actions.setFromAmount("");
  }, [actions]);

  // Messaggio gas insufficiente per chip % (mostrato temporaneamente)
  const [gasWarning, setGasWarning] = useState<string | null>(null);
  const gasWarnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showGasWarning = useCallback((msg: string) => {
    if (gasWarnTimerRef.current) clearTimeout(gasWarnTimerRef.current);
    setGasWarning(msg);
    gasWarnTimerRef.current = setTimeout(() => setGasWarning(null), 4000);
  }, []);

  // Bottoni % (10 / 25 / 50 / 100=MAX) con riserva gas per token nativi
  const handlePct = useCallback((pct: number) => {
    if (!sv.fromToken) return;
    const raw = balancesState.map.get(sv.fromToken.address);
    if (!raw || raw === 0n) return;

    let spendable = raw;
    if (sv.fromToken.isNative) {
      const reserve = GAS_RESERVE[sv.fromChainId] ?? 10000000000000000n;
      if (raw <= reserve) {
        const reserveHuman = parseFloat(fromTokenUnits(reserve.toString(), sv.fromToken.decimals)).toFixed(4);
        showGasWarning(
          `Saldo ${sv.fromToken.symbol} insufficiente per coprire il gas. ` +
          `Riserva minima: ${reserveHuman} ${sv.fromToken.symbol}.`
        );
        return;
      }
      spendable = raw - reserve;
    }
    if (spendable <= 0n) return;

    const fraction = BigInt(pct);
    const portion  = (spendable * fraction) / 100n;
    if (portion <= 0n) return;

    setGasWarning(null);
    const human = fromTokenUnits(portion.toString(), sv.fromToken.decimals);
    setAmountMode("from");
    setToInput("");
    setFiatCurrency("");        // torna in modalità crypto dopo pct
    actions.setFromAmount(human);
  }, [sv.fromToken, sv.fromChainId, balancesState.map, actions, showGasWarning]);

  // ── Balance guard ────────────────────────────────────────────────────────────
  const fromBal = sv.fromToken ? balancesState.map.get(sv.fromToken.address) : undefined;
  const amountExceedsBalance = (() => {
    if (fromBal === undefined || !sv.fromToken) return false;
    // In from-mode: verifica sv.fromAmount
    // In to-mode: verifica computed fromAmount dalla quote
    const amountStr = amountMode === "from"
      ? sv.fromAmount
      : (sv.quote?.computedFromAmount ? fromTokenUnits(sv.quote.computedFromAmount, sv.fromToken.decimals) : "");
    if (!amountStr || amountStr === "0") return false;
    try {
      const amountRaw = BigInt(toTokenUnits(amountStr, sv.fromToken.decimals));
      return amountRaw > fromBal;
    } catch { return false; }
  })();

  const quoteExpired = sv.quote && Date.now() > sv.quote.expiresAt;
  const isIdle       = sv.phase === "idle";
  const isQuoting    = sv.phase === "quoting";
  const hasQuote     = sv.phase === "quoted" && sv.quote != null && !quoteExpired;
  const isBusy       = ["approving", "signing", "submitted", "pending"].includes(sv.phase);

  // canSwap: richiede effectiveAddress, quote valida e importo NON superiore al saldo
  const canSwap = hasQuote && !isBusy && !!effectiveAddress && !amountExceedsBalance;

  // ── Recovery spinner ───────────────────────────────────────────────────────
  if (sv.recovering) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, color: "rgba(255,255,255,.5)" }}>
        <Loader2 size={22} style={{ animation: "aw-spin .8s linear infinite" }} />
        <span style={{ fontSize: 14 }}>Verifica swap in corso…</span>
      </div>
    );
  }

  // ── Pending / submitted ────────────────────────────────────────────────────
  if (sv.phase === "pending" || sv.phase === "submitted") {
    return (
      <div className="asw-content">
        <EvmPendingView txHash={sv.txHash} fromChainId={sv.fromChainId} onBack={onBack ?? actions.reset} />
      </div>
    );
  }

  // ── Completed ──────────────────────────────────────────────────────────────
  if (sv.phase === "completed") {
    return (
      <div className="asw-content">
        <EvmCompletedView
          txHash={sv.txHash}
          fromChainId={sv.fromChainId}
          toToken={sv.toToken}
          toAmount={sv.quote ? fromTokenUnits(sv.quote.toAmount, sv.quote.toToken.decimals) : "0"}
          onDone={actions.reset}
        />
      </div>
    );
  }

  // ── Failed ─────────────────────────────────────────────────────────────────
  if (sv.phase === "failed") {
    return (
      <div className="asw-content">
        <EvmFailedView error={sv.error?.message ?? "Si è verificato un errore."} onRetry={actions.reset} />
      </div>
    );
  }

  // ── Action required ────────────────────────────────────────────────────────
  if (sv.phase === "action_required") {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <div className="asw-status-icon asw-status-icon--pending">
            <Info size={32} />
          </div>
          <div>
            <p className="asw-status-title">Azione richiesta</p>
            <p className="asw-status-sub">Controlla il tuo wallet per un'azione richiesta (es. cambio di rete).</p>
          </div>
          <button onClick={actions.reset} className="aw-btn aw-btn--secondary" style={{ maxWidth: 200 }}>
            Annulla
          </button>
        </div>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  // fromBal è già calcolato sopra per il balance guard

  // Importo da mostrare in PAGA: se siamo in to-mode e c'è una quote, mostriamo il fromAmount calcolato
  const pagaDisplayAmount = amountMode === "to"
    ? (fromAmountDisplay ?? sv.fromAmount)
    : sv.fromAmount;

  // Importo da mostrare in RICEVI: se siamo in to-mode → toInput; altrimenti fromQuote
  const riceviDisplayAmount = amountMode === "to"
    ? toInput
    : (isQuoting ? undefined : (hasQuote ? toAmountDisplay : undefined));

  return (
    <div className="asw-content">
      <div className="asw-form">

        {/* Wallet non disponibile — hint dopo 3s, solo se nessun wallet (né ThirdWeb né Alpha) */}
        {showWalletHint && !effectiveAddress && (
          <div className="asw-alert asw-alert--info">
            <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Per effettuare swap sblocca Alpha Wallet con il PIN oppure connetti un wallet EVM (WalletConnect) dalla sezione Pagamenti.</span>
          </div>
        )}

        {/* Chain ThirdWeb disconnessa rispetto alle chain supportate */}
        {activeAccount && activeChain && !EVM_SWAP_CHAINS.find(c => c.id === activeChain.id) && (
          <div className="asw-alert asw-alert--info">
            <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>La chain attiva ({activeChain.name ?? activeChain.id}) non è supportata. Usa Polygon, BSC o Ethereum.</span>
          </div>
        )}

        {/* PAGA card — in to-mode è read-only (importo calcolato da Li.Fi) */}
        <TokenCard
          label="Paga"
          chainId={sv.fromChainId}
          token={sv.fromToken}
          amount={pagaDisplayAmount}
          onAmountChange={amountMode === "to" ? undefined : handleFromAmountChange}
          readOnly={amountMode === "to"}
          onTokenClick={() => { setTokenSide("from"); setTokenSelectorOpen(true); }}
          balance={fromBal}
          balLoading={balancesState.loading}
          onPct={amountMode !== "to" ? handlePct : undefined}
          exceedsBalance={amountExceedsBalance}
          fiatCurrency={fiatCurrency}
          priceUSD={tokenPrice.priceUSD}
          priceEUR={tokenPrice.priceEUR}
          onFiatToggle={(c) => { setFiatCurrency(c); setAmountMode("from"); setToInput(""); }}
        />

        {/* Guard saldo insufficiente */}
        {amountExceedsBalance && !balancesState.loading && (
          <div className="asw-alert asw-alert--error" style={{ marginTop: -8 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Saldo insufficiente. Inserisci un importo minore o premi MAX.</span>
          </div>
        )}

        {/* Warning gas insufficiente (chip %) */}
        {gasWarning && (
          <div className="asw-alert asw-alert--warn" style={{ marginTop: -8 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{gasWarning}</span>
          </div>
        )}

        {/* Direction toggle */}
        <div className="asw-dir-wrap">
          <button
            onClick={() => {
              actions.swapDirection();
              setAmountMode("from");
              setToInput("");
            }}
            disabled={isBusy}
            className="asw-dir-btn"
            aria-label="Inverti direzione"
          >
            <ArrowUpDown size={16} />
          </button>
        </div>

        {/* RICEVI card — editabile per exact-output mode */}
        <TokenCard
          label="Ricevi"
          chainId={sv.toChainId}
          token={sv.toToken}
          amount={riceviDisplayAmount}
          onAmountChange={handleToAmountChange}
          onTokenClick={() => { setTokenSide("to"); setTokenSelectorOpen(true); }}
        />
        {isQuoting && (
          <div className="asw-amount-loading" style={{ padding: "0 4px" }}>
            <Loader2 size={14} style={{ animation: "aw-spin .8s linear infinite" }} />
            <span>Calcolo quote in corso…</span>
          </div>
        )}

        {/* Fee preview */}
        {hasQuote && sv.quote && <EvmFeePreview quote={sv.quote} />}

        {/* Quote scaduta */}
        {sv.quote && quoteExpired && (
          <div className="asw-alert asw-alert--warn">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Quote scaduta. Aggiorno automaticamente.</span>
          </div>
        )}

        {/* Errore */}
        {sv.error && (sv.phase === "idle" || sv.phase === "quoted") && (
          <div className="asw-alert asw-alert--error">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{humanizeEvmError(sv.error.message)}</span>
          </div>
        )}

        {/* Fee info */}
        {hasQuote && (
          <div className="asw-alert asw-alert--info">
            <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>La fee Alpha ({fmtPct(LIFI_FEE)}) viene raccolta automaticamente tramite Li.Fi. Nessuna transazione aggiuntiva.</span>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={actions.execute}
          disabled={!canSwap || isBusy}
          className="aw-btn aw-btn--primary"
          style={{ marginTop: 4, opacity: (!canSwap || isBusy) ? 0.4 : 1, cursor: (!canSwap || isBusy) ? "not-allowed" : "pointer" }}
        >
          {sv.phase === "approving" ? (
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Loader2 size={18} style={{ animation: "aw-spin .8s linear infinite" }} /> Approvazione token…
            </span>
          ) : sv.phase === "signing" ? (
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Loader2 size={18} style={{ animation: "aw-spin .8s linear infinite" }} /> In attesa della firma…
            </span>
          ) : "Scambia"}
        </button>

        {/* Slippage row */}
        <button
          type="button"
          onClick={() => setSlippageOpen(true)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%", background: "none", border: "none", cursor: "pointer",
            padding: "10px 2px", borderBottom: "1px solid rgba(255,255,255,.07)",
          }}
        >
          <span style={{ fontSize: 14, color: "rgba(255,255,255,.55)" }}>Slippage</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14, color: "rgba(255,255,255,.8)", fontWeight: 600 }}>
            {(slippage * 100).toFixed(1).replace(".0", "")}%
            <ChevronRight size={15} style={{ color: "rgba(255,255,255,.35)" }} />
          </span>
        </button>

        {/* Hints */}
        {isIdle && (!sv.fromAmount || sv.fromAmount === "0") && (
          <p className="asw-hint">Inserisci un importo per vedere la quote</p>
        )}

        {/* Cross-chain note */}
        {sv.fromChainId !== sv.toChainId && (
          <p className="asw-disclaimer">
            Swap cross-chain: da {getChainInfo(sv.fromChainId)?.name} a {getChainInfo(sv.toChainId)?.name}.
            Potrebbe richiedere qualche minuto.
          </p>
        )}

        {/* Disclaimer */}
        {hasQuote && (
          <p className="asw-disclaimer">
            A causa delle fluttuazioni dei tassi di cambio, potrebbe esserci una piccola differenza tra l'importo ricevuto e l'importo stimato.
          </p>
        )}

        {/* Cronologia swap EVM (collassabile) */}
        <EvmSwapHistorySection refreshKey={historyRefreshKey} />

      </div>

      {/* Token selector sheet */}
      <TokenSelector
        open={tokenSelectorOpen}
        onClose={() => setTokenSelectorOpen(false)}
        onSelectToken={handleTokenSelect}
        currentChainId={tokenSide === "from" ? sv.fromChainId : sv.toChainId}
        side={tokenSide}
        otherToken={tokenSide === "from" ? sv.toToken ?? undefined : sv.fromToken ?? undefined}
        balances={balancesState.map}
        walletAddress={effectiveAddress}
      />

      {/* Slippage modal */}
      {slippageOpen && (
        <SlippageModal
          current={slippage}
          onConfirm={(v) => { setSlippage(v); }}
          onClose={() => setSlippageOpen(false)}
        />
      )}
    </div>
  );
}
