/**
 * TokenSelector — selezione token per EVM Swap
 *
 * Sheet bottom-up con lista token per chain selezionata.
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain.
 */

import React, { useState, useMemo } from "react";
import { X, Search, ChevronRight } from "lucide-react";
import {
  EVM_SWAP_CHAINS, EVM_SWAP_TOKENS,
  type EvmToken, type EvmChainInfo,
} from "./types.js";

interface TokenSelectorProps {
  open:          boolean;
  onClose:       () => void;
  onSelectToken: (token: EvmToken, chainId: number) => void;
  currentChainId: number;
  /** "from" | "to" — usato per il titolo */
  side:          "from" | "to";
  /** Token già selezionato sull'altro lato (per evitare stesso token same-chain) */
  otherToken?:   EvmToken;
}

const CHAIN_ICONS: Record<number, string> = {
  137: "🟣",
  56:  "🟡",
  1:   "🔵",
};

export function TokenSelector({
  open, onClose, onSelectToken, currentChainId, side, otherToken,
}: TokenSelectorProps) {
  const [selectedChain, setSelectedChain] = useState<number>(currentChainId);
  const [query, setQuery] = useState("");

  const tokens = useMemo(() => {
    const list = EVM_SWAP_TOKENS.filter(t => t.chainId === selectedChain);
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter(t =>
      t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    );
  }, [selectedChain, query]);

  if (!open) return null;

  const title = side === "from" ? "Paga con" : "Ricevi";

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="relative bg-background border-t border-border/30 rounded-t-3xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
          <p className="font-bold text-base">{title}</p>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted/50 transition-colors"
            aria-label="Chiudi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chain selector */}
        <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-none border-b border-border/10">
          {EVM_SWAP_CHAINS.map((chain: EvmChainInfo) => (
            <button
              key={chain.id}
              onClick={() => setSelectedChain(chain.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all
                ${selectedChain === chain.id
                  ? "text-white"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                }`}
              style={selectedChain === chain.id ? { backgroundColor: chain.color } : undefined}
            >
              <span>{CHAIN_ICONS[chain.id] ?? "⬡"}</span>
              {chain.name}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-4 py-2">
          <div className="flex items-center gap-2 bg-muted/20 border border-border/20 rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Cerca token…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              autoFocus
            />
          </div>
        </div>

        {/* Token list */}
        <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-1">
          {tokens.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Nessun token trovato.</p>
          ) : (
            tokens.map(token => {
              const isSameAsOther =
                otherToken &&
                otherToken.chainId === token.chainId &&
                otherToken.address.toLowerCase() === token.address.toLowerCase();

              return (
                <button
                  key={`${token.chainId}-${token.address}`}
                  onClick={() => {
                    onSelectToken(token, selectedChain);
                    onClose();
                  }}
                  disabled={!!isSameAsOther}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl transition-colors
                    ${isSameAsOther
                      ? "opacity-30 cursor-not-allowed"
                      : "hover:bg-muted/30 active:bg-muted/50"
                    }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Token icon placeholder */}
                    <div className="w-10 h-10 rounded-full bg-muted/40 border border-border/20 flex items-center justify-center text-sm font-bold shrink-0">
                      {token.symbol.slice(0, 2)}
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-sm">{token.symbol}</p>
                      <p className="text-xs text-muted-foreground">{token.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    {token.isNative && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                        Native
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
