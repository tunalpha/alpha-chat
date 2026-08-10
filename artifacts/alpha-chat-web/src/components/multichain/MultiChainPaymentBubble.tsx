/**
 * MultiChainPaymentBubble — bolla per message_type: "mc_payment"
 *
 * Layout cp-bubble identico a ChatPaymentBubble:
 *   - header emozionale (emoji direzionale + titolo)
 *   - badge rete sotto l'header
 *   - importo grande
 *   - divider
 *   - status a due righe (titolo + sottotitolo)
 *   - link transazione con cp-scan-link
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

// ─── Variant mapping (cp-variant-*) ──────────────────────────────────────────

type CpVariant = "success" | "fail" | "neutral" | "waiting" | "refund";

function getVariant(status: MCStatus): CpVariant {
  switch (status) {
    case "released":        return "success";
    case "failed":
    case "expired":         return "fail";
    case "cancelled":       return "neutral";
    case "refunding":
    case "refunded":        return "refund";
    default:                return "waiting"; // awaiting_deposit, pending, detecting, releasing, waiting_for_gas
  }
}

function isAnimated(status: MCStatus): boolean {
  return ["awaiting_deposit", "pending", "detecting", "releasing", "refunding", "waiting_for_gas"].includes(status);
}

const STATUS_ICONS: Record<MCStatus, string> = {
  awaiting_deposit: "⏳",
  pending:          "🔍",
  detecting:        "🔍",
  releasing:        "⚡",
  released:         "✅",
  refunding:        "↩️",
  refunded:         "↩️",
  expired:          "⏱",
  failed:           "❌",
  cancelled:        "🚫",
  waiting_for_gas:  "⛽",
};

function isAntiLossReason(reason?: string | null): boolean {
  return reason === "NETWORK_COST_TOO_HIGH" || reason === "RPC_UNAVAILABLE";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data:    MCSystemMeta;
  isMine:  boolean;
  /** Apre il flusso di pagamento integrato — visibile al pagatore quando awaiting_deposit. */
  onPay?:  () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export const MultiChainPaymentBubble = memo(function MultiChainPaymentBubble({ data, isMine, onPay }: Props) {
  const { t } = useTranslation();
  const [status,              setStatus]              = useState<MCStatus>(data?.status ?? "awaiting_deposit");
  const [txHash,              setTxHash]              = useState<string | null>(data?.tx_hash_release ?? data?.tx_hash_deposit ?? null);
  const [waitingForGasReason, setWaitingForGasReason] = useState<string | null>(data?.waiting_for_gas_reason ?? null);
  const [copied,              setCopied]              = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sincronizza lo stato interno con gli aggiornamenti esterni (eventi WS via ChatPage).
  // Il parent aggiorna `data.status` quando riceve mc_payment.state_changed, ma
  // useState() si inizializza una sola volta al mount e non reagisce ai prop change.
  // Questo effetto garantisce che WS "released", "pending", ecc. si riflettano subito
  // nella bolla senza aspettare il prossimo ciclo di polling (30 s).
  useEffect(() => {
    if (data?.status && data.status !== status) {
      setStatus(data.status as MCStatus);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  // Sincronizza txHash dall'esterno (WS può portare tx_hash_release/deposit).
  useEffect(() => {
    const externalHash = data?.tx_hash_release ?? data?.tx_hash_deposit ?? null;
    if (externalHash && externalHash !== txHash) setTxHash(externalHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.tx_hash_release, data?.tx_hash_deposit]);

  // Auto-poll ogni 30 s finché non terminale.
  useEffect(() => {
    if (!data?.transfer_id) return;
    if (isMCTerminal(status)) return;
    pollRef.current = setInterval(async () => {
      try {
        const updated = status === "awaiting_deposit"
          ? await apiMCDetect(data.transfer_id)
          : await apiMCGet(data.transfer_id);
        // OBIETTIVO 4b: mai regredire a "awaiting_deposit" se lo stato interno
        // è già avanzato (es. WS ha portato "pending" ma poll vecchio risponde ancora).
        // La regressione causava: WS → "pending" → bolla mostra "Deposito rilevato"
        //                         → poll → apiMCDetect → 200 con "awaiting_deposit" → regressione.
        setStatus(prev =>
          prev !== "awaiting_deposit" && updated.status === "awaiting_deposit" ? prev : updated.status
        );
        if (updated.waitingForGasReason !== undefined) setWaitingForGasReason(updated.waitingForGasReason);
        if (updated.txHashRelease) setTxHash(updated.txHashRelease);
        else if (updated.txHashDeposit) setTxHash(updated.txHashDeposit);
        if (isMCTerminal(updated.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e: unknown) {
        // Se il transfer è stato eliminato (404 TRANSFER_NOT_FOUND) ferma il polling.
        const msg = (e as Error)?.message ?? "";
        if (/TRANSFER_NOT_FOUND/i.test(msg) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // altrimenti: errore transitorio — mantieni l'ultimo stato noto
      }
    }, 30_000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [status, data?.transfer_id]);

  // Guard DOPO tutti gli hook.
  if (!data?.transfer_id || !data?.status || !data?.gross_amount || !data?.net_amount) return null;

  const isRequest = data.is_request === true;
  const isPayer   = isRequest ? !isMine : isMine;

  async function handleCopy() {
    await navigator.clipboard.writeText(data.escrow_wallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ── Display values ──────────────────────────────────────────────────────────
  const networkLabel = MC_NETWORK_LABELS[data.network] ?? data.network;
  const networkIcon  = MC_NETWORK_ICONS[data.network]  ?? "🔗";
  const rawDec  = MC_DECIMALS[data.network] ?? 6;
  const dispDec = MC_DISPLAY_DECIMALS[data.network] ?? 6;

  const grossDisplay  = fmtDisplay(data.gross_amount, rawDec, dispDec);
  const netDisplay    = fmtDisplay(data.net_amount,   rawDec, dispDec);
  const minDepDisplay = data.min_deposit_amount
    ? fmtDisplay(data.min_deposit_amount, rawDec, dispDec)
    : grossDisplay;

  // Non-payer (destinatario / richiedente) vede sempre il NET: ciò che riceverà.
  // Payer (mittente) vede sempre il GROSS: ciò che deve inviare.
  // Nota: per recipient_exact, gross ≠ net (es. richiesta 0.99 USDT → payer invia 1 USDT).
  const displayAmount = !isPayer ? netDisplay : grossDisplay;

  // ── Variant & animated ──────────────────────────────────────────────────────
  const variant  = getVariant(status);
  const animated = isAnimated(status);
  const icon     = STATUS_ICONS[status] ?? "•";

  // ── Status label (titolo + sottotitolo) ─────────────────────────────────────
  const statusTitle = isAntiLossReason(waitingForGasReason) && status === "waiting_for_gas"
    ? t("multichain.statusTitleNetworkCostTooHigh")
    : t(`multichain.statusTitle_${status}` as never, { defaultValue: status });

  const statusSub = isAntiLossReason(waitingForGasReason) && status === "waiting_for_gas"
    ? t("multichain.networkCostTooHighMsg")
    : t(`multichain.statusSub_${status}` as never, { defaultValue: "" });

  // ── Header ─────────────────────────────────────────────────────────────────
  let directionEmoji: string;
  let directionTitle: string;
  if (isRequest) {
    directionEmoji = isMine ? "📤" : "📥";
    directionTitle = isMine ? t("multichain.bubbleRequested") : t("multichain.bubbleIncoming");
  } else {
    directionEmoji = isMine ? "💸" : "💰";
    directionTitle = isMine ? t("multichain.bubbleSent") : t("multichain.bubbleReceived");
  }

  // ── Sub (to/from) ───────────────────────────────────────────────────────────
  const note      = data.note ?? null;
  const isSuccess = status === "released";

  return (
    <div className={`cp-bubble mc-payment-bubble ${isMine ? "mine" : "theirs"} cp-variant-${variant}${isSuccess ? " mc-success-glow" : ""}`}>

      {/* Header: emoji direzionale + titolo */}
      <div className="cp-bubble-header">
        <span className="cp-coin" aria-hidden="true">{directionEmoji}</span>
        <span>{directionTitle}</span>
      </div>

      {/* Badge rete — piccolo, sotto l'header */}
      <div className="mc-network-badge" aria-label={`${networkLabel} ${data.asset}`}>
        <span aria-hidden="true">{networkIcon}</span>
        <span>{networkLabel} · {data.asset}</span>
      </div>

      {/* Importo grande */}
      <div className="cp-bubble-amount">
        {displayAmount}{" "}
        <span className="cp-bubble-unit">{data.asset}</span>
      </div>

      {/* Nota opzionale */}
      {note && (
        <div className="cp-bubble-note" aria-label={`Nota: ${note}`}>"{note}"</div>
      )}

      {/* Istruzioni escrow — visibile al payer quando awaiting_deposit */}
      {isPayer && status === "awaiting_deposit" && (
        <div className="mc-address-section">
          {/* ── Pulsante primario "Paga" (integrazione wallet/firma) ── */}
          {onPay && (
            <button
              type="button"
              className="mc-pay-btn-primary"
              onClick={onPay}
              aria-label={`Paga ${minDepDisplay} ${data.asset}`}
            >
              💸 {t("multichain.payNow", {
                amount: minDepDisplay,
                asset:  data.asset,
                defaultValue: `Paga ${minDepDisplay} ${data.asset}`,
              })}
            </button>
          )}

          {/* ── Fallback manuale: copia indirizzo (secondario) ── */}
          <details className="mc-address-fallback">
            <summary className="mc-address-fallback-toggle">
              {t("multichain.manualFallback", { defaultValue: "Invia manualmente…" })}
            </summary>
            <div className="mc-address-fallback-body">
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
            </div>
          </details>

          {data.expires_at && (
            <p className="mc-address-expiry-small">
              ⏰ {t("multichain.expiresAt")}{" "}
              {new Date(data.expires_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
            </p>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="cp-bubble-divider" role="separator" />

      {/* Status: icon + titolo + sottotitolo */}
      <div className="cp-bubble-status" aria-live="polite" aria-label={statusTitle}>
        {animated
          ? <span className="cp-spinner" aria-hidden="true" />
          : <span className="cp-status-icon" aria-hidden="true">{icon}</span>
        }
        <div className="cp-status-text-group">
          <span className="cp-status-title">{statusTitle}</span>
          {statusSub && <span className="cp-status-sub">{statusSub}</span>}
        </div>
      </div>

      {/* Link transazione — sotto la status bar */}
      {txHash && (
        <div className="cp-bubble-scan-links">
          <a
            href={explorerUrl(data.network, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="cp-scan-link"
            aria-label={t("multichain.explorerLink")}
            onClick={e => e.stopPropagation()}
          >
            {t("multichain.explorerLink")} ↗
          </a>
        </div>
      )}

    </div>
  );
});
