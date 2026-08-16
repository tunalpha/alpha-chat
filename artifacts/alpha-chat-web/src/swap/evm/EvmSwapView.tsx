/**
 * EvmSwapView — UI EVM Swap con Li.Fi
 *
 * Design system: asw-* (nativi Alpha Chat — vedi AlphaWalletPage.css)
 * Zero Tailwind utility classes — zero import da payment engine / USDA / MultiChain.
 *
 * FUNZIONALITÀ:
 *   - Auto-detect chain attiva (via useActiveWalletChain)
 *   - Balance reale dei token (via RPC diretto)
 *   - Bottone MAX su token PAGA
 *   - TokenSelector con balance display
 */

import React, {
  useCallback, useEffect, useRef, useState,
} from "react";
import {
  ArrowUpDown, Loader2, CheckCircle, AlertTriangle,
  Copy, Check, ExternalLink, RefreshCw, Info, ChevronDown,
} from "lucide-react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { useEvmSwapState }  from "./useEvmSwapState.js";
import { TokenSelector }    from "./TokenSelector.js";
import {
  fromTokenUnits, getChainInfo, EVM_SWAP_CHAINS, getTokensForChain,
  LIFI_FEE, type EvmToken,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(fee: number) { return (fee * 100).toFixed(2) + "%"; }

function txUrl(chainId: number, txHash: string): string {
  const chain = getChainInfo(chainId);
  return chain ? `${chain.explorerUrl}/tx/${txHash}` : "#";
}

/** Colore e icona per chain */
const CHAIN_COLOR: Record<number, string> = {
  137: "#8247E5",
  56:  "#F3BA2F",
  1:   "#627EEA",
};

// ── Lettura balance via RPC ───────────────────────────────────────────────────

const CHAIN_RPC: Record<number, string> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  137: ((import.meta as any).env?.VITE_POLYGON_RPC as string | undefined) ?? "https://polygon-rpc.com",
  56:  "https://bsc-dataseed.binance.org/",
  1:   "https://eth.llamarpc.com",
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

function useEvmTokenBalances(chainId: number, address: string | undefined): Map<string, bigint> {
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map());

  useEffect(() => {
    if (!address) { setBalances(new Map()); return; }
    const rpcUrl = CHAIN_RPC[chainId];
    if (!rpcUrl) return;

    const tokens = getTokensForChain(chainId);
    let cancelled = false;

    Promise.allSettled(
      tokens.map(async (t) => {
        if (t.isNative) {
          const hex = await rpcPost<string>(rpcUrl, "eth_getBalance", [address, "latest"]);
          return [t.address, BigInt(hex)] as const;
        } else {
          const pad = address.slice(2).padStart(64, "0");
          const hex = await rpcPost<string>(rpcUrl, "eth_call", [
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
      setBalances(new Map(entries));
    }).catch(() => null);

    return () => { cancelled = true; };
  }, [chainId, address]);

  return balances;
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

// ── TokenCard ─────────────────────────────────────────────────────────────────

interface TokenCardProps {
  label:           string;
  chainId:         number;
  token:           EvmToken | null;
  amount?:         string;
  onAmountChange?: (v: string) => void;
  onTokenClick:    () => void;
  readOnly?:       boolean;
  balance?:        bigint;
  onMax?:          () => void;
}

function TokenCard({
  label, chainId, token, amount, onAmountChange, onTokenClick, readOnly, balance, onMax,
}: TokenCardProps) {
  const chain        = getChainInfo(chainId);
  const chainColor   = CHAIN_COLOR[chainId] ?? "#888";
  const hasBalance   = balance !== undefined;
  const balStr       = hasBalance && token ? fmtBal(balance, token.decimals) : null;
  const showMax      = hasBalance && onMax && onAmountChange && balStr !== "0" && balStr !== null && balance !== 0n;

  return (
    <div className="asw-card">
      <div className="asw-card-head">
        <span className="asw-card-label">{label}</span>
        {hasBalance && token && (
          <div className="asw-card-balance">
            <span>{balStr} {token.symbol}</span>
            {showMax && (
              <button className="asw-max-btn" onClick={onMax} type="button">MAX</button>
            )}
          </div>
        )}
      </div>
      <div className="asw-token-row">
        <button className="asw-token-btn" onClick={onTokenClick} aria-label={`Seleziona token ${label}`}>
          <div className="asw-token-icon" style={{ background: `${chainColor}22`, color: chainColor }}>
            {token ? token.symbol.slice(0, 2) : "?"}
          </div>
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
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amount ?? ""}
              onChange={e => {
                const val = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                onAmountChange(val);
              }}
              readOnly={readOnly}
              className="asw-amount-input"
              aria-label={`Importo ${label}`}
            />
          ) : (
            <span className="asw-amount-display">{amount ?? "—"}</span>
          )}
        </div>
      </div>
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

function EvmFailedView({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="asw-status-view">
      <div className="asw-status-icon asw-status-icon--error">
        <AlertTriangle size={36} />
      </div>
      <div>
        <p className="asw-status-title">Swap non riuscito</p>
        <p className="asw-status-sub">{error}</p>
      </div>
      <button onClick={onRetry} className="aw-btn aw-btn--primary" style={{ maxWidth: 300, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <RefreshCw size={16} /> Riprova
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface EvmSwapViewProps {
  onBack?: () => void;
}

export function EvmSwapView({ onBack }: EvmSwapViewProps) {
  const [sv, actions] = useEvmSwapState();
  const activeAccount  = useActiveAccount();
  const activeChain    = useActiveWalletChain();

  // Balance per i token sulla chain from
  const balances = useEvmTokenBalances(sv.fromChainId, activeAccount?.address);

  // Token selector state
  const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
  const [tokenSide, setTokenSide] = useState<"from" | "to">("from");

  // Quote display
  const toAmountDisplay = sv.quote
    ? parseFloat(fromTokenUnits(sv.quote.toAmount, sv.quote.toToken.decimals)).toFixed(6)
    : "";

  // Debounce quote
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFrom    = useRef("");
  const prevFTok    = useRef("");
  const prevTTok    = useRef("");

  useEffect(() => {
    if (!sv.fromAmount || sv.fromAmount === "0" || !sv.fromToken || !sv.toToken) return;
    if (!activeAccount?.address) return;

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
  }, [sv.fromAmount, sv.fromToken, sv.toToken, sv.phase, activeAccount?.address]);

  const handleTokenSelect = useCallback((token: EvmToken, chainId: number) => {
    if (tokenSide === "from") {
      actions.setFromChain(chainId);
      actions.setFromToken(token);
    } else {
      actions.setToChain(chainId);
      actions.setToToken(token);
    }
  }, [tokenSide, actions]);

  // MAX button: imposta l'intero balance come importo
  const handleMax = useCallback(() => {
    if (!sv.fromToken) return;
    const raw = balances.get(sv.fromToken.address);
    if (!raw || raw === 0n) return;
    const human = fromTokenUnits(raw.toString(), sv.fromToken.decimals);
    actions.setFromAmount(human);
  }, [sv.fromToken, balances, actions]);

  const quoteExpired = sv.quote && Date.now() > sv.quote.expiresAt;
  const isIdle       = sv.phase === "idle";
  const isQuoting    = sv.phase === "quoting";
  const hasQuote     = sv.phase === "quoted" && sv.quote != null && !quoteExpired;
  const isBusy       = ["approving", "signing", "submitted", "pending"].includes(sv.phase);

  const canSwap = hasQuote && !isBusy && !!activeAccount;

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
  const fromBal = sv.fromToken ? balances.get(sv.fromToken.address) : undefined;

  return (
    <div className="asw-content">
      <div className="asw-form">

        {/* Wallet non connesso */}
        {!activeAccount && (
          <div className="asw-alert asw-alert--warn">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Connetti il wallet EVM (ThirdWeb / WalletConnect) per effettuare swap.</span>
          </div>
        )}

        {/* Chain disconnessa rispetto alla chain attiva */}
        {activeAccount && activeChain && !EVM_SWAP_CHAINS.find(c => c.id === activeChain.id) && (
          <div className="asw-alert asw-alert--info">
            <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>La chain attiva ({activeChain.name ?? activeChain.id}) non è supportata. Usa Polygon, BSC o Ethereum.</span>
          </div>
        )}

        {/* PAGA card */}
        <TokenCard
          label="Paga"
          chainId={sv.fromChainId}
          token={sv.fromToken}
          amount={sv.fromAmount}
          onAmountChange={actions.setFromAmount}
          onTokenClick={() => { setTokenSide("from"); setTokenSelectorOpen(true); }}
          balance={fromBal}
          onMax={handleMax}
        />

        {/* Direction toggle */}
        <div className="asw-dir-wrap">
          <button
            onClick={actions.swapDirection}
            disabled={isBusy}
            className="asw-dir-btn"
            aria-label="Inverti direzione"
          >
            <ArrowUpDown size={16} />
          </button>
        </div>

        {/* RICEVI card */}
        <TokenCard
          label="Ricevi"
          chainId={sv.toChainId}
          token={sv.toToken}
          amount={isQuoting ? undefined : hasQuote ? toAmountDisplay : undefined}
          onAmountChange={undefined}
          onTokenClick={() => { setTokenSide("to"); setTokenSelectorOpen(true); }}
          readOnly
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
            <span>{sv.error.message}</span>
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

      </div>

      {/* Token selector sheet */}
      <TokenSelector
        open={tokenSelectorOpen}
        onClose={() => setTokenSelectorOpen(false)}
        onSelectToken={handleTokenSelect}
        currentChainId={tokenSide === "from" ? sv.fromChainId : sv.toChainId}
        side={tokenSide}
        otherToken={tokenSide === "from" ? sv.toToken ?? undefined : sv.fromToken ?? undefined}
        balances={balances}
        walletAddress={activeAccount?.address}
      />
    </div>
  );
}
