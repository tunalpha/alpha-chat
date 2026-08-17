/**
 * TokenSelector — selezione token per EVM Swap
 *
 * Sheet bottom-up nativo Alpha Chat (asw-* CSS).
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain.
 */

import React, { useState, useMemo } from "react";
import { X, Search } from "lucide-react";
import {
  EVM_SWAP_CHAINS, EVM_SWAP_TOKENS, BTC_CHAIN_ID, isBtcChain,
  fromTokenUnits,
  type EvmToken, type EvmChainInfo,
} from "./types.js";

const CHAIN_COLOR: Record<number, string> = {
  137:         "#8247E5",
  56:          "#F3BA2F",
  1:           "#627EEA",
  [BTC_CHAIN_ID]: "#F7931A",
};

/** Icona token: <img> con logoURI se disponibile, altrimenti cerchio colorato */
function TokenLogoIcon({ token, chainId }: { token: EvmToken; chainId: number }) {
  const [imgError, setImgError] = useState(false);
  const color = CHAIN_COLOR[chainId] ?? "#888";

  if (token.logoURI && !imgError) {
    return (
      <img
        src={token.logoURI}
        alt={token.symbol}
        className="asw-token-list-icon"
        style={{ objectFit: "cover", borderRadius: "50%", padding: 0 }}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className="asw-token-list-icon" style={{ background: `${color}22`, color }}>
      {token.symbol.slice(0, 3)}
    </div>
  );
}

interface TokenSelectorProps {
  open:           boolean;
  onClose:        () => void;
  onSelectToken:  (token: EvmToken, chainId: number) => void;
  currentChainId: number;
  side:           "from" | "to";
  otherToken?:    EvmToken;
  /** Balance per address token → bigint */
  balances?:      Map<string, bigint>;
  /** Wallet address (per sapere se mostrare balance) */
  walletAddress?: string;
}

const CHAIN_ICONS: Record<number, string> = {
  137:         "🟣",
  56:          "🟡",
  1:           "🔵",
};

// Icona Bitcoin logo inline (data URI) — usata al posto dell'emoji per il BTC chain pill
const BTC_LOGO_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23F7931A'/%3E%3Cpath fill='%23fff' d='M22.5 14.3c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6-.5-.1.7-2.6-1.7-.4-.7 2.7-1-.3-2.3-.6-.5 1.9s1.3.3 1.2.3c.7.2.8.7.8 1l-.8 3.3.3.1-.3-.1-1.1 4.5c-.1.3-.4.7-.9.5l-1.3-.3-.9 2 2.2.6.5.1-.7 2.8 1.7.4.7-2.8.5.1-.7 2.7 1.7.4.7-2.8c2.9.5 5.1.3 6-2.3.7-2.1-.1-3.3-1.5-4.1 1.1-.2 1.9-1 2.1-2.6zm-3.8 5.3c-.5 2.1-4 1-5.1.7l.9-3.7c1.1.3 4.7.8 4.2 3zm.5-5.3c-.5 1.9-3.5 1-4.5.7l.8-3.3c1 .3 4.2.7 3.7 2.6z'/%3E%3C/svg%3E";

function fmtBal(raw: bigint | undefined, decimals: number): string | null {
  if (raw === undefined) return null;
  if (raw === 0n) return "0";
  const human = fromTokenUnits(raw.toString(), decimals);
  const n = parseFloat(human);
  if (n === 0) return "0";
  if (n < 0.000001) return "<0.000001";
  return n.toFixed(6).replace(/\.?0+$/, "");
}

export function TokenSelector({
  open, onClose, onSelectToken, currentChainId, side, otherToken, balances, walletAddress,
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

  const title = side === "from" ? "Seleziona token da inviare" : "Seleziona token da ricevere";
  const hasWallet = !!walletAddress;

  return (
    <div className="asw-sheet-backdrop" onClick={onClose}>
      <div className="asw-sheet" onClick={e => e.stopPropagation()}>
        <div className="asw-sheet-handle" />

        {/* Header */}
        <div className="asw-sheet-header">
          <p className="asw-sheet-title">{title}</p>
          <button className="asw-close-btn" onClick={onClose} aria-label="Chiudi">
            <X size={16} />
          </button>
        </div>

        {/* Chain selector */}
        <div className="asw-chain-bar">
          {EVM_SWAP_CHAINS.map((chain: EvmChainInfo) => (
            <button
              key={chain.id}
              onClick={() => setSelectedChain(chain.id)}
              className={`asw-chain-pill${selectedChain === chain.id ? " asw-chain-pill--active" : ""}`}
              style={selectedChain === chain.id ? { backgroundColor: `${CHAIN_COLOR[chain.id]}33`, borderColor: CHAIN_COLOR[chain.id] } : undefined}
            >
              {isBtcChain(chain.id)
                ? <img src={BTC_LOGO_URI} alt="BTC" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                : <span>{CHAIN_ICONS[chain.id] ?? "⬡"}</span>
              }
              {chain.name}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="asw-search-row">
          <div className="asw-search-box">
            <Search size={15} style={{ color: "rgba(255,255,255,.4)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Cerca token…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="asw-search-input"
              autoFocus
            />
          </div>
        </div>

        {/* Token list */}
        <div className="asw-token-list">
          {tokens.length === 0 ? (
            <p className="asw-hint" style={{ padding: "32px 0" }}>Nessun token trovato.</p>
          ) : (
            tokens.map(token => {
              const rawBal  = balances?.get(token.address);
              const balStr  = (hasWallet && selectedChain === token.chainId)
                ? fmtBal(rawBal, token.decimals)
                : null;
              const hasBal  = balStr !== null && balStr !== "0";

              return (
                <button
                  key={`${token.chainId}-${token.address}`}
                  onClick={() => {
                    onSelectToken(token, selectedChain);
                    onClose();
                  }}
                  className="asw-token-list-item"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <TokenLogoIcon token={token} chainId={token.chainId} />

                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="asw-token-list-name">{token.symbol}</span>
                        {token.isNative && <span className="asw-native-badge">Native</span>}
                      </div>
                      <p className="asw-token-list-sub">{token.name}</p>
                    </div>
                  </div>

                  <div className="asw-token-list-right">
                    {balStr !== null ? (
                      <>
                        <p className={`asw-token-list-bal${!hasBal ? "" : ""}`} style={{ color: hasBal ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.35)" }}>
                          {balStr}
                        </p>
                        <p className="asw-token-list-bal-sub">{token.symbol}</p>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,.3)" }}>—</span>
                    )}
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
