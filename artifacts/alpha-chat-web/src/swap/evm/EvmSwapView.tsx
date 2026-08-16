/**
 * EvmSwapView — UI EVM Swap con Li.Fi
 *
 * Copre tutti gli stati della state machine:
 *   idle, quoting, quoted, approving, signing, submitted, pending, completed, failed, action_required
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain.
 */

import React, {
  useCallback, useEffect, useRef, useState,
} from "react";
import {
  ArrowUpDown, Loader2, CheckCircle, AlertTriangle,
  Copy, Check, ExternalLink, RefreshCw, Info, ChevronDown,
} from "lucide-react";
import { useActiveAccount } from "thirdweb/react";
import { useEvmSwapState }  from "./useEvmSwapState.js";
import { TokenSelector }    from "./TokenSelector.js";
import {
  fromTokenUnits, getChainInfo, EVM_SWAP_CHAINS,
  LIFI_FEE, type EvmToken,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(fee: number) { return (fee * 100).toFixed(2) + "%"; }

function txUrl(chainId: number, txHash: string): string {
  const chain = getChainInfo(chainId);
  if (!chain) return "#";
  return `${chain.explorerUrl}/tx/${txHash}`;
}

const CHAIN_COLOR: Record<number, string> = {
  137: "#8247E5",
  56:  "#F3BA2F",
  1:   "#627EEA",
};
const CHAIN_ICON: Record<number, string> = {
  137: "🟣", 56: "🟡", 1: "🔵",
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface TokenCardProps {
  label:     string;
  chainId:   number;
  token:     EvmToken | null;
  amount?:   string;      // human amount (stringa)
  onAmountChange?: (v: string) => void;
  onTokenClick:    () => void;
  readOnly?:       boolean;
}

function TokenCard({ label, chainId, token, amount, onAmountChange, onTokenClick, readOnly }: TokenCardProps) {
  const chain = getChainInfo(chainId);
  return (
    <div className="bg-card border border-border/30 rounded-2xl p-4">
      <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">{label}</p>
      <div className="flex items-center justify-between gap-3">
        {/* Token selector */}
        <button
          onClick={onTokenClick}
          className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity"
          aria-label={`Seleziona token ${label}`}
        >
          <div className="w-11 h-11 rounded-full bg-muted/50 flex items-center justify-center text-sm font-bold shrink-0 border border-border/20">
            {token ? token.symbol.slice(0, 2) : "?"}
          </div>
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-1.5">
              <p className="font-bold text-base">{token?.symbol ?? "—"}</p>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span style={{ color: CHAIN_COLOR[chainId] }} className="text-xs">
                {CHAIN_ICON[chainId]}
              </span>
              <p className="text-xs text-muted-foreground truncate">{chain?.name ?? chainId}</p>
            </div>
          </div>
        </button>

        {/* Amount */}
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
            className="bg-transparent text-right text-2xl font-bold w-36 outline-none text-foreground placeholder:text-muted-foreground/40"
            aria-label={`Importo ${label}`}
          />
        ) : (
          <p className="text-2xl font-bold text-muted-foreground/40 shrink-0">
            {amount ?? "—"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Fee preview ───────────────────────────────────────────────────────────────

function EvmFeePreview({ quote }: { quote: NonNullable<ReturnType<typeof useEvmSwapState>[0]["quote"]> }) {
  const toHuman = fromTokenUnits(quote.toAmount, quote.toToken.decimals);
  const toMin   = fromTokenUnits(quote.toAmountMin, quote.toToken.decimals);

  return (
    <div className="bg-muted/15 border border-border/20 rounded-xl px-4 py-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Riceverai circa</span>
        <span className="text-sm font-bold">{parseFloat(toHuman).toFixed(6)} {quote.toToken.symbol}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Minimo garantito</span>
        <span className="text-xs">{parseFloat(toMin).toFixed(6)} {quote.toToken.symbol}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Fee Alpha ({fmtPct(LIFI_FEE)})</span>
        <span className="text-xs text-orange-400 font-medium">≈ ${quote.alphaFeeUSD}</span>
      </div>
      {parseFloat(quote.gasCostUSD) > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Gas stimato</span>
          <span className="text-xs">≈ ${quote.gasCostUSD}</span>
        </div>
      )}
      <div className="border-t border-border/20 pt-2 flex justify-between items-center">
        <span className="text-xs font-semibold">Fee totale</span>
        <span className="text-xs">≈ ${quote.totalFeeUSD}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Provider</span>
        <span className="text-xs text-muted-foreground capitalize">{quote.tool}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Slippage</span>
        <span className="text-xs text-muted-foreground">{(quote.slippage * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ── In-progress / completed / failed ─────────────────────────────────────────

function EvmPendingView({ txHash, fromChainId, onBack }: { txHash: string | null; fromChainId: number; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (txHash) navigator.clipboard.writeText(txHash).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6">
      <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
      <div>
        <p className="font-bold text-xl mb-2">Swap in corso…</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          La transazione è stata inviata. Attendi la conferma on-chain.
        </p>
      </div>
      {txHash && (
        <div className="w-full bg-muted/20 rounded-xl p-3 space-y-2">
          <p className="text-xs text-muted-foreground font-mono break-all">{txHash.slice(0, 16)}…{txHash.slice(-12)}</p>
          <div className="flex gap-2 justify-center">
            <button onClick={copy} className="flex items-center gap-1 text-xs text-primary">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copiato" : "Copia"}
            </button>
            <a
              href={txUrl(fromChainId, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary"
            >
              <ExternalLink className="w-3 h-3" /> Explorer
            </a>
          </div>
        </div>
      )}
      <button onClick={onBack} className="w-full py-3 rounded-2xl border border-border/30 text-sm text-muted-foreground hover:bg-muted/20">
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
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6">
      <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
        <CheckCircle className="w-10 h-10 text-green-400" />
      </div>
      <div>
        <p className="font-bold text-xl mb-2">Swap completato!</p>
        {toToken && parseFloat(toAmount) > 0 && (
          <p className="text-2xl font-bold text-green-400 mt-1">
            ≈ {parseFloat(toAmount).toFixed(6)} {toToken.symbol}
          </p>
        )}
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
          I token sono stati inviati al tuo wallet.
        </p>
      </div>
      {txHash && (
        <a
          href={txUrl(fromChainId, txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-primary underline"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Vedi su explorer
        </a>
      )}
      <button
        onClick={onDone}
        className="w-full max-w-xs py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base active:scale-[0.98] transition-transform"
      >
        Fatto
      </button>
    </div>
  );
}

function EvmFailedView({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-5">
      <AlertTriangle className="w-12 h-12 text-destructive" />
      <div>
        <p className="font-bold text-lg mb-2">Swap non riuscito</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 w-full max-w-xs py-4 rounded-2xl bg-primary text-primary-foreground font-bold justify-center"
      >
        <RefreshCw className="w-4 h-4" /> Riprova
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface EvmSwapViewProps {
  /** Callback opzionale quando l'utente vuole tornare indietro */
  onBack?: () => void;
}

export function EvmSwapView({ onBack }: EvmSwapViewProps) {
  const [sv, actions] = useEvmSwapState();
  const activeAccount  = useActiveAccount();

  // Selettore token
  const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
  const [tokenSide, setTokenSide] = useState<"from" | "to">("from");

  // Quote display: importo toToken in human-readable
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

  const quoteExpired = sv.quote && Date.now() > sv.quote.expiresAt;
  const isIdle       = sv.phase === "idle";
  const isQuoting    = sv.phase === "quoting";
  const hasQuote     = sv.phase === "quoted" && sv.quote != null && !quoteExpired;
  const isBusy       = ["approving", "signing", "submitted", "pending"].includes(sv.phase);

  const canSwap = hasQuote && !isBusy && !!activeAccount;

  // ── Recovery spinner ───────────────────────────────────────────────────────
  if (sv.recovering) {
    return (
      <div className="flex-1 flex items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span className="text-sm">Verifica swap in corso…</span>
      </div>
    );
  }

  // ── Pending / submitted ────────────────────────────────────────────────────
  if (sv.phase === "pending" || sv.phase === "submitted") {
    return (
      <EvmPendingView
        txHash={sv.txHash}
        fromChainId={sv.fromChainId}
        onBack={onBack ?? actions.reset}
      />
    );
  }

  // ── Completed ──────────────────────────────────────────────────────────────
  if (sv.phase === "completed") {
    return (
      <EvmCompletedView
        txHash={sv.txHash}
        fromChainId={sv.fromChainId}
        toToken={sv.toToken}
        toAmount={sv.quote ? fromTokenUnits(sv.quote.toAmount, sv.quote.toToken.decimals) : "0"}
        onDone={actions.reset}
      />
    );
  }

  // ── Failed ─────────────────────────────────────────────────────────────────
  if (sv.phase === "failed") {
    return (
      <EvmFailedView
        error={sv.error?.message ?? "Si è verificato un errore."}
        onRetry={actions.reset}
      />
    );
  }

  // ── Action required ────────────────────────────────────────────────────────
  if (sv.phase === "action_required") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-5">
        <Info className="w-12 h-12 text-blue-400" />
        <div>
          <p className="font-bold text-lg mb-2">Azione richiesta</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Controlla il tuo wallet per un'azione richiesta (es. cambio di rete).
          </p>
        </div>
        <button onClick={actions.reset} className="text-xs text-primary underline">Annulla</button>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-4 space-y-3 pb-8">

        {/* Wallet not connected */}
        {!activeAccount && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
            <p className="text-xs text-orange-400">
              Connetti il wallet EVM (ThirdWeb / WalletConnect) per effettuare swap.
            </p>
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
        />

        {/* Toggle direction */}
        <div className="flex justify-center -my-1">
          <button
            onClick={actions.swapDirection}
            disabled={isBusy}
            className="w-10 h-10 rounded-full bg-card border border-border/30 flex items-center justify-center hover:bg-muted/50 active:scale-90 transition-all z-10 disabled:opacity-30"
            aria-label="Inverti direzione"
          >
            <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* RICEVI card */}
        <TokenCard
          label="Ricevi"
          chainId={sv.toChainId}
          token={sv.toToken}
          amount={
            isQuoting   ? undefined
            : hasQuote  ? toAmountDisplay
            : undefined
          }
          onAmountChange={undefined}
          onTokenClick={() => { setTokenSide("to"); setTokenSelectorOpen(true); }}
          readOnly
        />
        {isQuoting && (
          <div className="flex items-center gap-2 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Calcolo quote in corso…</p>
          </div>
        )}

        {/* Fee preview */}
        {hasQuote && sv.quote && <EvmFeePreview quote={sv.quote} />}

        {/* Quote scaduta */}
        {sv.quote && quoteExpired && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
            <p className="text-xs text-orange-400">Quote scaduta. Aggiorno automaticamente.</p>
          </div>
        )}

        {/* Errore */}
        {sv.error && (sv.phase === "idle" || sv.phase === "quoted") && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive leading-relaxed">{sv.error.message}</p>
          </div>
        )}

        {/* Nota fee */}
        {hasQuote && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-400 leading-relaxed">
              La fee Alpha ({fmtPct(LIFI_FEE)}) viene raccolta automaticamente tramite Li.Fi.
              Nessuna transazione aggiuntiva.
            </p>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={actions.execute}
          disabled={!canSwap || isBusy}
          className={`w-full py-4 rounded-2xl font-bold text-base transition-all mt-2
            ${canSwap && !isBusy
              ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
              : "bg-muted/40 text-muted-foreground cursor-not-allowed"
            }`}
        >
          {sv.phase === "approving" ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Approvazione token…
            </span>
          ) : sv.phase === "signing" ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> In attesa della firma…
            </span>
          ) : (
            "Scambia"
          )}
        </button>

        {/* Hint */}
        {isIdle && (!sv.fromAmount || sv.fromAmount === "0") && (
          <p className="text-center text-xs text-muted-foreground/60">
            Inserisci un importo per vedere la quote
          </p>
        )}

        {/* Nota cross-chain */}
        {sv.fromChainId !== sv.toChainId && (
          <p className="text-center text-[10px] text-muted-foreground/60 px-2 leading-relaxed">
            Swap cross-chain: da {getChainInfo(sv.fromChainId)?.name} a {getChainInfo(sv.toChainId)?.name}.
            Potrebbe richiedere qualche minuto.
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
      />
    </div>
  );
}
