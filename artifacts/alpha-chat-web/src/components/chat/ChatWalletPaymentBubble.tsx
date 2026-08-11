/**
 * ChatWalletPaymentBubble — Phase G
 *
 * Bubble in-chat per messaggi di tipo "wallet_payment" (Alpha Wallet self-custodial).
 * SEPARATO da MultiChainPaymentBubble (Payment Engine custodiale).
 *
 * ISOLAMENTO: importa solo il tipo pubblico da bridge, nessun wallet internal.
 */

import { useMemo } from "react";
import type { SupportedNetwork } from "../../wallet/bridge/chat-wallet-bridge";
import "./ChatWalletPaymentBubble.css";

// ─── Tipi ─────────────────────────────────────────────────────────────────

export type WalletPaymentBubbleStatus = "sent" | "confirmed" | "failed";

export interface WalletPaymentMeta {
  txHash:      string;
  network:     SupportedNetwork;
  assetSymbol: string;
  amount:      string;
  fee?:        string;
  direction:   "in" | "out";
  status:      WalletPaymentBubbleStatus;
  explorerUrl: string;
}

interface Props {
  meta:      WalletPaymentMeta;
  isMine:    boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const NETWORK_NAMES: Record<SupportedNetwork, string> = {
  ethereum: "Ethereum",
  polygon:  "Polygon",
  bsc:      "BSC",
  bitcoin:  "Bitcoin",
};

const NETWORK_COLORS: Record<SupportedNetwork, string> = {
  ethereum: "#627EEA",
  polygon:  "#8247E5",
  bsc:      "#F3BA2F",
  bitcoin:  "#F7931A",
};

function truncateHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= head + tail + 3) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

function statusIcon(status: WalletPaymentBubbleStatus, direction: "in" | "out"): string {
  if (status === "failed") return "❌";
  if (status === "confirmed") return direction === "in" ? "💰" : "✅";
  return direction === "in" ? "📩" : "📤";
}

function statusLabel(status: WalletPaymentBubbleStatus): string {
  if (status === "confirmed") return "Confermata";
  if (status === "failed")    return "Fallita";
  return "In attesa di conferma…";
}

// ─── Component ────────────────────────────────────────────────────────────

export function ChatWalletPaymentBubble({ meta, isMine }: Props) {
  const { txHash, network, assetSymbol, amount, fee, direction, status, explorerUrl } = meta;

  const netColor = NETWORK_COLORS[network];
  const netName  = NETWORK_NAMES[network];
  const icon     = useMemo(() => statusIcon(status, direction), [status, direction]);

  const dirLabel = direction === "out" ? "Inviato" : "Ricevuto";
  const bubbleCls = `wallet-pay-bubble ${isMine ? "mine" : "theirs"} status-${status}`;

  return (
    <div className={bubbleCls}>
      {/* Header ─────────────────────────────────────────────────────── */}
      <div className="wpb-header">
        <span className="wpb-icon">{icon}</span>
        <span className="wpb-dir">{dirLabel}</span>
        <span
          className="wpb-network"
          style={{ background: `${netColor}22`, color: netColor, border: `1px solid ${netColor}55` }}
        >
          {netName}
        </span>
      </div>

      {/* Amount ─────────────────────────────────────────────────────── */}
      <div className="wpb-amount">
        <span className="wpb-amount-value">{amount}</span>
        <span className="wpb-amount-symbol">{assetSymbol}</span>
      </div>

      {/* Fee ─────────────────────────────────────────────────────────── */}
      {fee && (
        <div className="wpb-fee">Platform fee: {fee} {assetSymbol}</div>
      )}

      {/* Status ─────────────────────────────────────────────────────── */}
      <div className={`wpb-status wpb-status--${status}`}>
        {statusLabel(status)}
      </div>

      {/* Explorer link ───────────────────────────────────────────────── */}
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="wpb-explorer"
        title="Vedi su blockchain explorer"
      >
        🔗 {truncateHash(txHash)}
      </a>
    </div>
  );
}
