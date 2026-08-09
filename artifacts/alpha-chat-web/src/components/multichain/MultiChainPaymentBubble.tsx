/**
 * MultiChainPaymentBubble — bolla per message_type: "mc_payment"
 *
 * Mostra lo stato di un Multi-Chain transfer in chat.
 * Polling ogni 30 s finché lo stato non è terminale.
 *
 * isMine = true  → current user ha inviato il messaggio in chat
 *   mc_payment (is_request=false): io sono il mittente/pagante → vedo l'indirizzo escrow
 *   mc_payment (is_request=true):  io sono il richiedente     → vedo "In attesa del pagatore"
 *
 * isMine = false → il messaggio l'ha inviato l'altro utente
 *   mc_payment (is_request=false): l'altro è il pagante       → vedo "Pagamento in arrivo"
 *   mc_payment (is_request=true):  l'altro è il richiedente   → vedo l'indirizzo escrow
 *
 * ISOLAMENTO: nessuna dipendenza da USDA o altri payment flow.
 */

import { memo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  apiMCGet,
  apiMCDetect,
  isMCTerminal,
  fmtDisplay,
  MC_NETWORK_LABELS,
  MC_NETWORK_ICONS,
  MC_DECIMALS,
  MC_DISPLAY_DECIMALS,
  type MCSystemMeta,
  type MCStatus,
} from "../../lib/multichain-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function explorerUrl(network: string, txHash: string): string {
  switch (network) {
    case "polygon":  return `https://polygonscan.com/tx/${txHash}`;
    case "ethereum": return `https://etherscan.io/tx/${txHash}`;
    case "bsc":      return `https://bscscan.com/tx/${txHash}`;
    case "bitcoin":  return `https://blockstream.info/tx/${txHash}`;
    default:         return "#";
  }
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

/** Se il motivo è anti-loss (fee insufficiente o RPC irraggiungibile). */
function isAntiLossReason(reason?: string | null): boolean {
  return reason === "NETWORK_COST_TOO_HIGH" || reason === "RPC_UNAVAILABLE";
}

function StatusBadge({ status, waitingForGasReason }: {
  status: MCStatus;
  waitingForGasReason?: string | null;
}) {
  const { t } = useTranslation();
  const labels: Record<MCStatus, string> = {
    awaiting_deposit: t("multichain.statusAwaitingDeposit"),
    detecting:        t("multichain.statusDetecting"),
    releasing:        t("multichain.statusReleasing"),
    released:         t("multichain.statusReleased"),
    refunding:        t("multichain.statusRefunding"),
    refunded:         t("multichain.statusRefunded"),
    expired:          t("multichain.statusExpired"),
    failed:           t("multichain.statusFailed"),
    waiting_for_gas:  isAntiLossReason(waitingForGasReason)
      ? t("multichain.statusNetworkCostTooHigh")
      : t("multichain.statusWaitingForGas"),
  };
  return (
    <span className={`mc-status-badge mc-status-${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data:   MCSystemMeta;
  /** true = il messaggio chat è stato inviato dall'utente corrente */
  isMine: boolean;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export const MultiChainPaymentBubble = memo(function MultiChainPaymentBubble({ data, isMine }: Props) {
  // ── Tutti gli hook PRIMA di qualsiasi early return (React Rules of Hooks) ──
  const { t } = useTranslation();
  const [status,              setStatus]              = useState<MCStatus>(data?.status ?? "awaiting_deposit");
  const [txHash,              setTxHash]              = useState<string | null>(data?.tx_hash_release ?? data?.tx_hash_deposit ?? null);
  const [waitingForGasReason, setWaitingForGasReason] = useState<string | null>(data?.waiting_for_gas_reason ?? null);
  const [copied,              setCopied]              = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-poll e detect ogni 30 s finché non terminale.
  useEffect(() => {
    if (!data?.transfer_id) return;          // guard: metadati incompleti
    if (isMCTerminal(status)) return;
    pollRef.current = setInterval(async () => {
      try {
        const updated = status === "awaiting_deposit"
          ? await apiMCDetect(data.transfer_id)   // chiama blockchain
          : await apiMCGet(data.transfer_id);      // solo DB
        setStatus(updated.status);
        if (updated.waitingForGasReason !== undefined) setWaitingForGasReason(updated.waitingForGasReason);
        if (updated.txHashRelease) setTxHash(updated.txHashRelease);
        else if (updated.txHashDeposit) setTxHash(updated.txHashDeposit);
        if (isMCTerminal(updated.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch { /* silent — mostreremo l'ultimo stato noto */ }
    }, 30_000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [status, data?.transfer_id]);

  // Guard DOPO tutti gli hook — metadati incompleti o malformati.
  // IMPORTANTE: gross_amount/net_amount devono essere presenti prima di chiamare
  // fmtDisplay()/BigInt() più sotto — un valore undefined causerebbe TypeError e
  // abbatterebbe l'intera ChatPage (nessun error boundary).
  if (!data?.transfer_id || !data?.status || !data?.gross_amount || !data?.net_amount) return null;

  const isRequest = data.is_request === true;
  /**
   * isPayer = true → l'utente corrente deve inviare i fondi all'escrow.
   * Casi:
   *   - Non-request, isMine:  io ho avviato il send → sono il payer.
   *   - Request,     !isMine: l'altro ha richiesto   → io devo pagare.
   */
  const isPayer = isRequest ? !isMine : isMine;

  async function handleCopy() {
    await navigator.clipboard.writeText(data.escrow_wallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const networkLabel = MC_NETWORK_LABELS[data.network] ?? data.network;
  const networkIcon  = MC_NETWORK_ICONS[data.network]  ?? "🔗";
  const rawDec  = MC_DECIMALS[data.network] ?? 6;
  const dispDec = MC_DISPLAY_DECIMALS[data.network] ?? 6;

  const grossDisplay  = fmtDisplay(data.gross_amount, rawDec, dispDec);
  const netDisplay    = fmtDisplay(data.net_amount,   rawDec, dispDec);
  const minDepDisplay = data.min_deposit_amount
    ? fmtDisplay(data.min_deposit_amount, rawDec, dispDec)
    : grossDisplay;

  // Importo visualizzato: per il destinatario dopo il pagamento mostra il netto
  const displayAmount = (status === "released" && !isPayer) ? netDisplay : grossDisplay;

  // Titolo della bolla
  let bubbleTitle: string;
  if (isRequest) {
    bubbleTitle = isMine ? t("multichain.bubbleRequested") : t("multichain.bubbleIncoming");
  } else {
    bubbleTitle = isMine ? t("multichain.bubbleSent") : t("multichain.bubbleReceived");
  }

  return (
    <div className={`mc-bubble ${isMine ? "mine" : "theirs"} mc-status-variant-${status}`}>

      {/* Header: rete + badge stato */}
      <div className="mc-bubble-header">
        <span className="mc-bubble-network">{networkIcon} {networkLabel}</span>
        <StatusBadge status={status} waitingForGasReason={waitingForGasReason} />
      </div>

      {/* Importo */}
      <div className="mc-bubble-amount">
        {displayAmount}
        {" "}<span className="mc-bubble-asset">{data.asset}</span>
      </div>

      {/* Titolo */}
      <div className="mc-bubble-sub">{bubbleTitle}</div>

      {/* Indirizzo escrow — visibile al payer quando awaiting_deposit */}
      {isPayer && status === "awaiting_deposit" && (
        <div className="mc-address-section">
          <p className="mc-address-label">
            {t("multichain.depositInstructionsBubble", {
              amount: minDepDisplay,
              asset:  data.asset,
            })}
          </p>
          <div className="mc-address-box-small">
            <span className="mc-address-text-small">{data.escrow_wallet}</span>
          </div>
          <button type="button" className="mc-copy-btn-small" onClick={handleCopy}>
            {copied ? t("multichain.addressCopied") : t("multichain.copyAddress")}
          </button>
          {data.expires_at && (
            <p className="mc-address-expiry-small">
              ⏰ {t("multichain.expiresAt")}{" "}
              {new Date(data.expires_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
            </p>
          )}
        </div>
      )}

      {/* Anti-loss message — visibile quando il release è bloccato per costo rete */}
      {status === "waiting_for_gas" && isAntiLossReason(waitingForGasReason) && (
        <div className="mc-antiloss-notice">
          <p className="mc-antiloss-title">{t("multichain.networkCostTooHighTitle")}</p>
          <p className="mc-antiloss-msg">{t("multichain.networkCostTooHighMsg")}</p>
        </div>
      )}

      {/* Explorer link quando disponibile */}
      {txHash && (
        <a
          className="mc-explorer-link"
          href={explorerUrl(data.network, txHash)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("multichain.explorerLink")} ↗
        </a>
      )}

    </div>
  );
});
