/**
 * MultiChainPaymentBubble — bolla per message_type: "mc_payment"
 *
 * Stile visivo identico a UsdaPaymentBubble: classi usda-bubble, usda-bubble-header,
 * usda-bubble-amount, usda-bubble-status, usda-status-dot, success-glow.
 * Solo i dati dinamici cambiano (rete, asset, importo, stato, escrow, explorer link).
 *
 * ISOLAMENTO: solo JSX/CSS cambia. Logica, polling, dati: invariati.
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

// ─── Explorer URL ─────────────────────────────────────────────────────────────

function explorerUrl(network: string, txHash: string): string {
  switch (network) {
    case "polygon":  return `https://polygonscan.com/tx/${txHash}`;
    case "ethereum": return `https://etherscan.io/tx/${txHash}`;
    case "bsc":      return `https://bscscan.com/tx/${txHash}`;
    case "bitcoin":  return `https://blockstream.info/tx/${txHash}`;
    default:         return "#";
  }
}

// ─── Status helpers (mappa a classi CSS USDA) ─────────────────────────────────

type UsdaStatusClass = "ok" | "fail" | "refund" | "blockchain" | "in-progress" | "waiting";

function getStatusClass(status: MCStatus): UsdaStatusClass {
  switch (status) {
    case "released":       return "ok";
    case "failed":
    case "expired":        return "fail";
    case "refunding":
    case "refunded":       return "refund";
    case "detecting":      return "blockchain";
    case "waiting_for_gas": return "waiting";
    default:               return "in-progress"; // awaiting_deposit, releasing
  }
}

function isAnimated(status: MCStatus): boolean {
  return ["awaiting_deposit", "detecting", "releasing", "refunding", "waiting_for_gas"].includes(status);
}

const STATUS_ICONS: Record<MCStatus, string> = {
  awaiting_deposit: "⏳",
  detecting:        "🔍",
  releasing:        "🔄",
  released:         "✅",
  refunding:        "↩️",
  refunded:         "↩️",
  expired:          "⏱",
  failed:           "❌",
  waiting_for_gas:  "⛽",
};

/** Se il motivo è anti-loss (fee insufficiente o RPC irraggiungibile). */
function isAntiLossReason(reason?: string | null): boolean {
  return reason === "NETWORK_COST_TOO_HIGH" || reason === "RPC_UNAVAILABLE";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data:   MCSystemMeta;
  /** true = il messaggio chat è stato inviato dall'utente corrente */
  isMine: boolean;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export const MultiChainPaymentBubble = memo(function MultiChainPaymentBubble({ data, isMine }: Props) {
  // ── Hook — tutti PRIMA di qualsiasi early return (React Rules of Hooks) ──
  const { t } = useTranslation();
  const [status,              setStatus]              = useState<MCStatus>(data?.status ?? "awaiting_deposit");
  const [txHash,              setTxHash]              = useState<string | null>(data?.tx_hash_release ?? data?.tx_hash_deposit ?? null);
  const [waitingForGasReason, setWaitingForGasReason] = useState<string | null>(data?.waiting_for_gas_reason ?? null);
  const [copied,              setCopied]              = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-poll e detect ogni 30 s finché non terminale.
  useEffect(() => {
    if (!data?.transfer_id) return;
    if (isMCTerminal(status)) return;
    pollRef.current = setInterval(async () => {
      try {
        const updated = status === "awaiting_deposit"
          ? await apiMCDetect(data.transfer_id)
          : await apiMCGet(data.transfer_id);
        setStatus(updated.status);
        if (updated.waitingForGasReason !== undefined) setWaitingForGasReason(updated.waitingForGasReason);
        if (updated.txHashRelease) setTxHash(updated.txHashRelease);
        else if (updated.txHashDeposit) setTxHash(updated.txHashDeposit);
        if (isMCTerminal(updated.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch { /* silent — ultimo stato noto */ }
    }, 30_000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [status, data?.transfer_id]);

  // Guard DOPO tutti gli hook.
  if (!data?.transfer_id || !data?.status || !data?.gross_amount || !data?.net_amount) return null;

  const isRequest = data.is_request === true;
  /**
   * isPayer = true → l'utente corrente deve inviare i fondi all'escrow.
   *   Non-request, isMine:  io ho avviato il send → sono il payer.
   *   Request,     !isMine: l'altro ha richiesto   → io devo pagare.
   */
  const isPayer = isRequest ? !isMine : isMine;

  async function handleCopy() {
    await navigator.clipboard.writeText(data.escrow_wallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ── Valori display ─────────────────────────────────────────────────────────
  const networkLabel = MC_NETWORK_LABELS[data.network] ?? data.network;
  const networkIcon  = MC_NETWORK_ICONS[data.network]  ?? "🔗";
  const rawDec  = MC_DECIMALS[data.network] ?? 6;
  const dispDec = MC_DISPLAY_DECIMALS[data.network] ?? 6;

  const grossDisplay  = fmtDisplay(data.gross_amount, rawDec, dispDec);
  const netDisplay    = fmtDisplay(data.net_amount,   rawDec, dispDec);
  const minDepDisplay = data.min_deposit_amount
    ? fmtDisplay(data.min_deposit_amount, rawDec, dispDec)
    : grossDisplay;

  // Importo visualizzato: destinatario dopo rilascio vede il netto
  const displayAmount = (status === "released" && !isPayer) ? netDisplay : grossDisplay;

  // ── Status helpers ─────────────────────────────────────────────────────────
  const statusClass = getStatusClass(status);
  const animated    = isAnimated(status);
  const statusIcon  = STATUS_ICONS[status] ?? "•";

  const statusLabels: Record<MCStatus, string> = {
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
  const statusText = statusLabels[status] ?? status;

  const isSuccess = status === "released";

  // ── Titolo ─────────────────────────────────────────────────────────────────
  let bubbleTitle: string;
  if (isRequest) {
    bubbleTitle = isMine ? t("multichain.bubbleRequested") : t("multichain.bubbleIncoming");
  } else {
    bubbleTitle = isMine ? t("multichain.bubbleSent") : t("multichain.bubbleReceived");
  }

  // ── Nota ───────────────────────────────────────────────────────────────────
  const note = data.note ?? null;

  return (
    <div className={`usda-bubble usda-send ${isMine ? "mine" : "theirs"} ${isSuccess ? "success-glow" : ""}`}>

      {/* Header: rete + asset — identico alla struttura USDA */}
      <div className="usda-bubble-header">
        <span className="usda-coin" aria-hidden="true">{networkIcon}</span>
        <span>{networkLabel} · {data.asset}</span>
      </div>

      {/* Importo grande */}
      <div className="usda-bubble-amount">
        {displayAmount}{" "}
        <span className="usda-bubble-unit">{data.asset}</span>
      </div>

      {/* Sottotitolo: "Cripto inviata" / "Cripto ricevuta" ecc. */}
      <div className="usda-bubble-sub">{bubbleTitle}</div>

      {/* Nota opzionale */}
      {note && (
        <div className="usda-bubble-note" aria-label={`Nota: ${note}`}>"{note}"</div>
      )}

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

      {/* Anti-loss notice — visibile quando il release è bloccato per costo rete */}
      {status === "waiting_for_gas" && isAntiLossReason(waitingForGasReason) && (
        <div className="mc-antiloss-notice">
          <p className="mc-antiloss-title">{t("multichain.networkCostTooHighTitle")}</p>
          <p className="mc-antiloss-msg">{t("multichain.networkCostTooHighMsg")}</p>
        </div>
      )}

      {/* Status bar — identica a UsdaPaymentBubble */}
      <div
        className={`usda-bubble-status ${statusClass}`}
        aria-live="polite"
        aria-label={statusText}
      >
        {animated && <span className="usda-status-dot" aria-hidden="true" />}
        <span className="usda-status-icon" aria-hidden="true">{statusIcon}</span>
        <span className="usda-status-text">{statusText}</span>
      </div>

      {/* Explorer link — sotto la status bar come tap-hint */}
      {txHash && (
        <a
          className="usda-bubble-tap-hint"
          href={explorerUrl(data.network, txHash)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "block", textAlign: "right", marginTop: 4, textDecoration: "none", opacity: 0.6 }}
          onClick={e => e.stopPropagation()}
        >
          {t("multichain.explorerLink")} ↗
        </a>
      )}

    </div>
  );
});
