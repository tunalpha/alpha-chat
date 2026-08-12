/**
 * ChatWalletPaymentBubble — Phase G
 *
 * Bubble in-chat per messaggi 🔐WALLETPAY: (Alpha Wallet self-custodial).
 * Usa le stesse classi CSS cp-bubble del MultiChain bubble per consistenza visiva.
 *
 * ISOLAMENTO: importa solo il tipo pubblico da bridge e tx-store.
 *
 * STATUS RESOLUTION (doppio livello, senza dipendere da txMonitor):
 *   1. IDB locale (getTxRecordByHash) — istantaneo
 *   2. eth_getTransactionReceipt diretto via backend — fallback se IDB = pending
 *      Aggiorna anche IDB così i check successivi sono veloci.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import type { SupportedNetwork } from "../../wallet/bridge/chat-wallet-bridge";
import { NETWORK_CHAIN_IDS }    from "../../wallet/bridge/chat-wallet-bridge";
import { getTxRecordByHash, updateTxStatus } from "../../wallet/services/tx-store";
import { apiWalletGetEvmReceipt } from "../../lib/alpha-wallet-api";
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
// Strategia a DUE LIVELLI — indipendente da txMonitor:
//
//   Livello 1: IDB locale via getTxRecordByHash (istantaneo, zero rete)
//   Livello 2: eth_getTransactionReceipt via backend (solo se IDB dice pending)
//              → aggiorna anche IDB così il check successivo è veloce
//
// Questo garantisce l'aggiornamento anche se:
//   - txMonitor non è in esecuzione (wallet locked, background PWA)
//   - la cache PWA ha una versione vecchia del monitor
//   - il range di blocchi Alchemy non include la TX
//

function useLiveTxStatus(
  txHash:  string,
  network: SupportedNetwork,
  initial: WalletPaymentBubbleStatus,
): WalletPaymentBubbleStatus {
  const [liveStatus, setLiveStatus] = useState<WalletPaymentBubbleStatus>(initial);
  // useRef per evitare stale closure nell'interval
  const statusRef = useRef<WalletPaymentBubbleStatus>(initial);

  useEffect(() => {
    if (initial === "confirmed" || initial === "failed") return;

    let active = true;
    // chainId 0 = Bitcoin (no receipt disponibile)
    const chainId = (NETWORK_CHAIN_IDS as Record<string, number>)[network] ?? 0;

    const resolve = (s: "confirmed" | "failed") => {
      statusRef.current = s;
      setLiveStatus(s);
    };

    const check = async () => {
      try {
        // ── Livello 1: IDB locale ────────────────────────────────────────
        const record = await getTxRecordByHash(txHash);
        if (!active) return;

        if (record?.status === "confirmed") { resolve("confirmed"); return; }
        if (record?.status === "failed")    { resolve("failed");    return; }

        // ── Livello 2: receipt diretto via backend ───────────────────────
        // Solo EVM (chainId > 0). BTC si aggiorna solo tramite txMonitor.
        if (chainId <= 0) return;

        const receipt = await apiWalletGetEvmReceipt(chainId, txHash);
        if (!active) return;

        if (receipt.status === "confirmed" || receipt.status === "failed") {
          // Persisti in IDB: aggiorna il record esistente se trovato,
          // altrimenti la prossima lettura IDB sarà ancora pending ma
          // il check receipt si ri-attiverà e lo risolverà.
          if (record?.id) {
            await updateTxStatus(record.id, receipt.status);
          }
          resolve(receipt.status);
        }
        // receipt.status === "pending" → TX ancora in mempool, riprova al prossimo ciclo

      } catch { /* IDB non disponibile o errore rete — riprova al ciclo successivo */ }
    };

    // Check immediato al mount
    void check();

    // Poi ogni 15s finché non finale (usa ref per evitare stale closure)
    const timer = setInterval(() => {
      if (statusRef.current === "confirmed" || statusRef.current === "failed") {
        clearInterval(timer);
        return;
      }
      void check();
    }, 15_000);

    return () => { active = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash, network, initial]);

  return liveStatus;
}

// ─── Component ────────────────────────────────────────────────────────────

export function ChatWalletPaymentBubble({ meta, isMine }: Props) {
  const { txHash, network, assetSymbol, amount, fee, direction, explorerUrl } = meta;

  // Status live — controlla IDB e receipt direttamente, senza dipendere da txMonitor
  const status = useLiveTxStatus(txHash, network, meta.status);

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
