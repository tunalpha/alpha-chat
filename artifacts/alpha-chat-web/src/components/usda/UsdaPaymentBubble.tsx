/**
 * UsdaPaymentBubble — bubble per message_type: "usda_send"
 *
 * Stile fintech premium: copy emozionale, emoji eleganti, nessun testo tecnico.
 * Tutti e 9 gli stati sono visualmente distinti e aggiornabili live via WS.
 */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { UsdaPaymentData, UsdaPaymentStatus } from "../../lib/usda-types";
import { USDA_STATUS_ICONS } from "../../lib/usda-types";

interface Props {
  data: UsdaPaymentData;
  isMine: boolean;
  onDetail?: (paymentId: string) => void;
}

type StatusClass = "ok" | "fail" | "refund" | "blockchain" | "in-progress" | "waiting";

function getStatusClass(status: UsdaPaymentStatus): StatusClass {
  switch (status) {
    case "confirmed":
    case "claimed":       return "ok";
    case "failed":        return "fail";
    case "refunded":      return "refund";
    case "pending":       return "blockchain";
    case "pending_claim": return "waiting";
    default:              return "in-progress";
  }
}

function isAnimated(status: UsdaPaymentStatus): boolean {
  return ["preparing", "signing", "submitting", "pending"].includes(status);
}

type TFunc = (key: string) => string;

function statusCopy(status: UsdaPaymentStatus, isMine: boolean, t: TFunc): string {
  switch (status) {
    case "preparing":     return t("usda.statusPreparing");
    case "signing":       return t("usda.statusSigning");
    case "submitting":    return t("usda.statusSubmitting");
    case "pending":       return t("usda.statusPending");
    case "confirmed":     return isMine ? t("usda.statusConfirmedMine") : t("usda.statusConfirmedTheirs");
    case "pending_claim": return t("usda.statusPendingClaim");
    case "claimed":       return t("usda.statusClaimed");
    case "refunded":      return t("usda.statusRefunded");
    case "failed":        return t("usda.statusFailedCopy");
    default:              return status;
  }
}

export const UsdaPaymentBubble = memo(function UsdaPaymentBubble({ data, isMine, onDetail }: Props) {
  const { t } = useTranslation();

  const statusClass = getStatusClass(data.status);
  const animated    = isAnimated(data.status);
  const copy        = statusCopy(data.status, isMine, t);

  const recipientName = data.recipient_name ?? data.recipient_id.slice(0, 8);
  const senderName    = data.sender_name    ?? data.sender_id.slice(0, 8);

  const isSuccess = data.status === "confirmed" || data.status === "claimed";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Pagamento USDA di ${data.amount} — ${copy}. ${t("usda.tapForDetails")}`}
      className={`usda-bubble usda-send ${isMine ? "mine" : "theirs"} ${isSuccess ? "success-glow" : ""}`}
      onClick={() => onDetail?.(data.payment_id)}
      onKeyDown={(e) => e.key === "Enter" && onDetail?.(data.payment_id)}
    >
      <div className="usda-bubble-header">
        <span className="usda-coin" aria-hidden="true">
          {isMine ? "💸" : "💰"}
        </span>
        <span className="usda-bubble-title">
          {isMine ? t("usda.sentTitle") : t("usda.receivedTitle")}
        </span>
      </div>

      <div className="usda-bubble-amount">
        {data.amount} <span className="usda-bubble-unit">USDA</span>
      </div>

      {isMine
        ? <div className="usda-bubble-sub">{t("usda.toPrefix")}{recipientName}</div>
        : <div className="usda-bubble-sub">{t("usda.fromPrefix")}{senderName}</div>
      }

      {data.note && (
        <div className="usda-bubble-note" aria-label={`Nota: ${data.note}`}>"{data.note}"</div>
      )}

      <div className={`usda-bubble-status ${statusClass}`} aria-live="polite" aria-label={copy}>
        {animated && <span className="usda-status-dot" aria-hidden="true" />}
        <span className="usda-status-icon" aria-hidden="true">{USDA_STATUS_ICONS[data.status]}</span>
        <span className="usda-status-text">{copy}</span>
      </div>

      {onDetail && (
        <div className="usda-bubble-tap-hint" aria-hidden="true">{t("usda.tapForDetails")}</div>
      )}
    </div>
  );
});
