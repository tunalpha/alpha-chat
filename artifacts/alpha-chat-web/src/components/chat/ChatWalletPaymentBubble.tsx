/**
 * ChatWalletPaymentBubble — Phase G
 *
 * Bubble in-chat per messaggi 🔐WALLETPAY: (Alpha Wallet self-custodial).
 * Usa le stesse classi CSS cp-bubble del MultiChain bubble per consistenza visiva.
 *
 * ISOLAMENTO: importa solo il tipo pubblico da bridge e tx-store.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import type { SupportedNetwork } from "../../wallet/bridge/chat-wallet-bridge";
import { getTxRecordByHash } from "../../wallet/services/tx-store";
import { txMonitor } from "../../wallet/monitoring/tx-monitor";
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

const NETWORK_ICONS: Record<SupportedNetwork, string> = {
  ethereum: "⬡",
  polygon:  "🔵",
  bsc:      "🟡",
  bitcoin:  "🟠",
};

// ─── Live-status hook ─────────────────────────────────────────────────────
//
// Il meta.status è congelato nel JSON Signal all'invio (= "sent").
// Il tx-monitor aggiorna IDB quando la TX si conferma on-chain.
// Questo hook legge IDB al mount e ri-controlla ogni 15s finché non finale.
//

function useLiveTxStatus(txHash: string, initial: WalletPaymentBubbleStatus): WalletPaymentBubbleStatus {
  const [liveStatus, setLiveStatus] = useState<WalletPaymentBubbleStatus>(initial);
  // Ref per evitare stale closure nell'interval: reflect sempre il valore corrente
  const statusRef = useRef<WalletPaymentBubbleStatus>(initial);

  useEffect(() => {
    if (initial === "confirmed" || initial === "failed") return;

    let active = true;

    const check = async () => {
      try {
        const record = await getTxRecordByHash(txHash);
        if (!active) return;
        if (record?.status === "confirmed") {
          statusRef.current = "confirmed";
          setLiveStatus("confirmed");
        } else if (record?.status === "failed") {
          statusRef.current = "failed";
          setLiveStatus("failed");
        }
      } catch { /* IDB non disponibile */ }
    };

    void check();

    const timer = setInterval(() => {
      // Usa il ref — nessuna stale closure
      if (statusRef.current === "confirmed" || statusRef.current === "failed") {
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

  // Status live da IDB — sovrascrive il valore congelato nel JSON Signal.
  const status = useLiveTxStatus(txHash, meta.status);

  const netName = NETWORK_NAMES[network] ?? network;
  const netIcon = NETWORK_ICONS[network] ?? "⬡";

  // Direzione
  const dirIcon = direction === "out" ? "🚀" : "📩";
  const dirText = direction === "out" ? "CRIPTO INVIATA" : "CRIPTO RICEVUTA";

  // Variant per colori status
  const variant  = status === "confirmed" ? "success" : status === "failed" ? "fail" : "waiting";
  const animated = status === "sent";

  const statusIcon  = useMemo(() => {
    if (status === "confirmed") return direction === "out" ? "✅" : "💰";
    if (status === "failed")    return "❌";
    return "";
  }, [status, direction]);

  const statusTitle = status === "confirmed" ? "Pagamento completato"
    : status === "failed" ? "Transazione fallita"
    : "In attesa di conferma…";

  const statusSub = status === "confirmed"
    ? (direction === "out" ? "Fondi inviati con successo" : "Fondi ricevuti nel wallet")
    : status === "failed" ? "Controlla l'explorer per i dettagli"
    : null;

  const glowCls   = status === "confirmed" ? " mc-success-glow" : "";
  const bubbleCls = `cp-bubble ${isMine ? "mine" : "theirs"} cp-variant-${variant}${glowCls}`;

  return (
    <div className={bubbleCls}>

      {/* Header: icona direzione + label */}
      <div className="cp-bubble-header">
        <span className="cp-coin">{dirIcon}</span>
        <span>{dirText}</span>
      </div>

      {/* Badge rete + asset */}
      <div className="mc-network-badge">
        {netIcon} {netName} · {assetSymbol}
      </div>

      {/* Importo grande */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
        <span className="cp-bubble-amount">{amount}</span>
        <span className="cp-bubble-unit">{assetSymbol}</span>
      </div>

      {/* Platform fee (opzionale) */}
      {fee && (
        <div className="cp-bubble-note">Platform fee: {fee} {assetSymbol}</div>
      )}

      {/* Divisore */}
      <div className="cp-bubble-divider" role="separator" />

      {/* Status */}
      <div className="cp-bubble-status" aria-live="polite" aria-label={statusTitle}>
        {animated
          ? <span className="cp-spinner" aria-hidden="true" />
          : <span className="cp-status-icon" aria-hidden="true">{statusIcon}</span>
        }
        <div className="cp-status-text-group">
          <span className="cp-status-title">{statusTitle}</span>
          {statusSub && <span className="cp-status-sub">{statusSub}</span>}
        </div>
      </div>

      {/* Link explorer */}
      <div className="cp-bubble-scan-links">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="cp-scan-link"
          aria-label="Vedi transazione sull'explorer"
          onClick={e => e.stopPropagation()}
        >
          Vedi transazione ↗
        </a>
      </div>

    </div>
  );
}
