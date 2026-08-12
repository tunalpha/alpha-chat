/**
 * ChatWalletPaymentBubble — Phase G
 *
 * Bubble in-chat per messaggi di tipo "wallet_payment" (Alpha Wallet self-custodial).
 * SEPARATO da MultiChainPaymentBubble (Payment Engine custodiale).
 *
 * ISOLAMENTO: importa solo il tipo pubblico da bridge, nessun wallet internal.
 */

import { useMemo, useState, useEffect } from "react";
import type { SupportedNetwork } from "../../wallet/bridge/chat-wallet-bridge";
import { getTxRecordByHash } from "../../wallet/services/tx-store";
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

// ─── Live-status hook ─────────────────────────────────────────────────────
//
// La bubble riceve `meta.status = "sent"` congelato nel JSON Signal al momento
// dell'invio. Il tx-monitor aggiorna IDB (tx-store) quando la TX viene
// confermata on-chain, ma la bubble non lo sa. Questo hook legge IDB una volta
// al mount (e ripete ogni 15s mentre è "pending/sent") per aggiornare lo status.
//

function useLiveTxStatus(txHash: string, initial: WalletPaymentBubbleStatus): WalletPaymentBubbleStatus {
  const [liveStatus, setLiveStatus] = useState<WalletPaymentBubbleStatus>(initial);

  useEffect(() => {
    // Se lo status iniziale è già finale, non serve polling.
    if (initial === "confirmed" || initial === "failed") return;

    let active = true;

    const check = async () => {
      try {
        const record = await getTxRecordByHash(txHash);
        if (!active) return;
        if (record?.status === "confirmed") setLiveStatus("confirmed");
        else if (record?.status === "failed") setLiveStatus("failed");
        // "pending" → rimane "sent" (in attesa)
      } catch { /* IDB non disponibile — nessun wallet caricato */ }
    };

    void check();

    // Ricontrolla ogni 15 s finché non siamo in stato finale
    const timer = setInterval(() => {
      if (liveStatus === "confirmed" || liveStatus === "failed") {
        clearInterval(timer);
        return;
      }
      void check();
    }, 15_000);

    return () => { active = false; clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash, initial]);

  return liveStatus;
}

// ─── Component ────────────────────────────────────────────────────────────

export function ChatWalletPaymentBubble({ meta, isMine }: Props) {
  const { txHash, network, assetSymbol, amount, fee, direction, explorerUrl } = meta;

  // Usa lo status live da IDB — sovrascrive il valore congelato nel JSON Signal.
  const status = useLiveTxStatus(txHash, meta.status);

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
