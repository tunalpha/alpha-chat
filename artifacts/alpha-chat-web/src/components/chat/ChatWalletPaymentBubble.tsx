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
 *
 * HISTORY + NOTIFICATIONS SAFETY NET:
 *   Quando status diventa "confirmed" (da qualunque livello), questo componente
 *   bootstrappa il record IDB e la notifica se il tx-monitor non ha ancora girato.
 *   Idempotente: ref guard (sessione) + getTxRecordByHash (cross-sessione).
 */

import { useState, useEffect, useMemo, useRef } from "react";
import type { SupportedNetwork } from "../../wallet/bridge/chat-wallet-bridge";
import { NETWORK_CHAIN_IDS }    from "../../wallet/bridge/chat-wallet-bridge";
import { getTxRecordByHash, saveTxRecord, updateTxStatus } from "../../wallet/services/tx-store";
import { dispatchWalletNotification } from "../../wallet/notifications/wallet-notification-store";
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
  meta:          WalletPaymentMeta;
  isMine:        boolean;
  /** Callback opzionale chiamata dopo che il safety net ha confermato la TX.
   *  Il chiamante (es. ChatPage) può usarla per aggiornare il React state di History. */
  onConfirmed?:  () => void;
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

export function ChatWalletPaymentBubble({ meta, isMine, onConfirmed }: Props) {
  const { txHash, network, assetSymbol, amount, fee, explorerUrl } = meta;

  // Status live — controlla IDB e receipt direttamente, senza dipendere da txMonitor
  const status = useLiveTxStatus(txHash, network, meta.status);

  const netName = NETWORK_NAMES[network] ?? network;
  const netIcon = NETWORK_ICONS[network] ?? "⬡";

  // ── History + Notifications safety net ──────────────────────────────────
  //
  // Problema: useLiveTxStatus Level 2 (apiWalletGetEvmReceipt) risolve "confirmed"
  // senza creare il record IDB quando il tx-monitor non ha ancora girato. La bolla
  // mostra "Pagamento completato" ma History e Notifications restano vuote.
  //
  // Fix: quando status diventa "confirmed", bootstrappiamo il record IDB e la
  // notifica se non esistono ancora. Il tx-monitor rimane il path principale;
  // questo è un safety net che copre il gap di timing.
  //
  // Idempotenza garantita a due livelli:
  //   1. bootstrappedRef: session-level guard (stesso render multiplo → 1 sola volta)
  //   2. getTxRecordByHash: cross-session guard (reload → salta se già presente)
  //
  // direction = isMine ? "out" : "in"  (NON meta.direction, sempre "out")
  const bootstrappedRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "confirmed") return;
    if (!txHash) return;

    const chainId = (NETWORK_CHAIN_IDS as Record<string, number>)[network] ?? 0;
    if (chainId === 0) return; // Bitcoin: nessun receipt EVM disponibile

    const dir: "out" | "in" = isMine ? "out" : "in";
    const guardKey = `${chainId}:${txHash}:${dir}`;

    // Livello 1: se già bootstrappato in questa sessione, esci subito
    if (bootstrappedRef.current === guardKey) return;
    bootstrappedRef.current = guardKey;

    void (async () => {
      try {
        const now = Date.now();

        // ── Record IDB ────────────────────────────────────────────────────
        // Crea il record SOLO se non esiste già (tx-monitor o bridge potrebbero
        // averlo già scritto). Se esiste, lo lasciamo invariato.
        const existing = await getTxRecordByHash(txHash);
        if (!existing) {
          const id = `${chainId}:${txHash}:${dir}:`;
          await saveTxRecord({
            id,
            chainId,
            network:   netName,
            txHash,
            direction: dir,
            asset:     assetSymbol,
            amount,
            timestamp: now,
            status:    "confirmed",
            updatedAt: now,
          });
        }

        // ── Notifica ──────────────────────────────────────────────────────
        // Dispatcha SEMPRE: dispatchWalletNotification è idempotente via
        // buildDedupKey (chainId:txHash:type:logIndex). Se la notifica esiste
        // già (es. tx-monitor già passato), saveNotification restituisce false
        // e non crea duplicati.
        //
        // CRITICAL: questo è il SOLO punto che dispatcha la notifica per il
        // percorso outgoing del mittente — né il bridge né _reconcilePendingEvm
        // lo fanno. La notifica del mittente sarebbe persa finché _processEvmTx
        // non gira (timing Alchemy). Il dispatch qui garantisce che la notifica
        // esista non appena la TX è confirmed (via Level 1 IDB o Level 2 receipt).
        await dispatchWalletNotification({
          type:      isMine ? "sent" : "received",
          chainId,
          network:   netName,
          asset:     assetSymbol,
          amount,
          txHash,
          timestamp: now,
          status:    "confirmed",
        });

        // ── History refresh ───────────────────────────────────────────────
        // Notifica il chiamante (ChatPage → WalletContext) che il record IDB
        // è stato aggiornato/creato, così _refreshTxHistory() aggiorna React
        // state senza aspettare il prossimo onNewTransaction del tx-monitor.
        onConfirmed?.();

      } catch {
        // Safety net non-critico: il tx-monitor coprirà il gap nel prossimo ciclo
      }
    })();
  }, [status, txHash, network, isMine, assetSymbol, amount, netName, onConfirmed]);

  // Direzione — derivata da isMine (prospettiva del viewer) invece di meta.direction.
  // meta.direction è sempre "out" (prospettiva del mittente al momento della creazione):
  // usarla per il destinatario causerebbe "CRIPTO INVIATA" per chi la riceve.
  const effectiveDirection: "out" | "in" = isMine ? "out" : "in";
  const dirIcon = effectiveDirection === "out" ? "🚀" : "📩";
  const dirText = effectiveDirection === "out" ? "CRIPTO INVIATA" : "CRIPTO RICEVUTA";

  // Variant per colori status
  const variant  = status === "confirmed" ? "success" : status === "failed" ? "fail" : "waiting";
  const animated = status === "sent";

  const statusIcon  = useMemo(() => {
    if (status === "confirmed") return effectiveDirection === "out" ? "✅" : "💰";
    if (status === "failed")    return "❌";
    return "";
  }, [status, effectiveDirection]);

  const statusTitle = status === "confirmed" ? "Pagamento completato"
    : status === "failed" ? "Transazione fallita"
    : "In attesa di conferma…";

  const statusSub = status === "confirmed"
    ? (effectiveDirection === "out" ? "Fondi inviati con successo" : "Fondi ricevuti nel wallet")
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
