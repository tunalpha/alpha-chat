/**
 * CoinIcon — logo reale della criptovaluta con fallback prima lettera.
 * Condiviso tra AlphaWalletPage, ChatWalletPaySheet,
 * MultiChainSendSheet e MultiChainPayRequestSheet.
 *
 * Uso:
 *   <CoinIcon symbol="USDT" size={32} />
 *   <CoinIcon symbol="POL"  size={20} />
 */

import { useState } from "react";

const COIN_LOGOS: Record<string, string> = {
  eth:   "/coin-icons/eth.png",
  btc:   "/coin-icons/btc.png",
  bnb:   "/coin-icons/bnb.png",
  pol:   "/coin-icons/pol.png",
  matic: "/coin-icons/pol.png",
  usdt:  "/coin-icons/usdt.png",
  usdc:  "/coin-icons/usdc.png",
  usda:  "/logo.png",
};

interface CoinIconProps {
  symbol: string;
  /** Diameter in px — default 32 */
  size?: number;
  /** Optional small badge text (emoji) shown bottom-right */
  badge?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function CoinIcon({ symbol, size = 32, badge, className, style }: CoinIconProps) {
  const url = COIN_LOGOS[symbol.toLowerCase()] ?? null;
  const [failed, setFailed] = useState(false);

  const wrapStyle: React.CSSProperties = {
    position: "relative",
    display:  "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width:  size,
    height: size,
    flexShrink: 0,
    ...style,
  };

  const fallbackStyle: React.CSSProperties = {
    width:  size,
    height: size,
    borderRadius: "50%",
    background: "rgba(128,128,128,0.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size * 0.44,
    fontWeight: 700,
    color: "#ccc",
  };

  const badgeStyle: React.CSSProperties = {
    position:   "absolute",
    bottom:     -2,
    right:      -2,
    fontSize:   size * 0.38,
    lineHeight: 1,
  };

  return (
    <div style={wrapStyle} className={className}>
      {url && !failed
        ? (
          <img
            src={url}
            alt={symbol}
            width={size}
            height={size}
            style={{ borderRadius: "50%", objectFit: "cover", display: "block" }}
            onError={() => setFailed(true)}
          />
        )
        : <div style={fallbackStyle}>{symbol.charAt(0).toUpperCase()}</div>
      }
      {badge && <span style={badgeStyle}>{badge}</span>}
    </div>
  );
}

/** Symbol of the native coin for a given MC network */
export const NETWORK_COIN: Partial<Record<string, string>> = {
  polygon:  "POL",
  ethereum: "ETH",
  bsc:      "BNB",
  bitcoin:  "BTC",
};
