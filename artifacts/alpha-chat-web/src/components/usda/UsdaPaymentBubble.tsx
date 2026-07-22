/**
 * UsdaPaymentBubble — bubble per message_type: "usda_send"
 *
 * Tutti e 9 gli stati sono visualmente distinti.
 * Lo stato si aggiorna in-place tramite WS event "usda.payment.update".
 */

import { memo } from "react";
import type { UsdaPaymentData, UsdaPaymentStatus } from "../../lib/usda-types";
import { USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../../lib/usda-types";

interface Props {
  data: UsdaPaymentData;
  isMine: boolean;
  onDetail?: (paymentId: string) => void;
}

type StatusClass = "ok" | "fail" | "refund" | "blockchain" | "in-progress" | "waiting";

function getStatusClass(status: UsdaPaymentStatus): StatusClass {
  switch (status) {
    case "confirmed":
    case "claimed":      return "ok";
    case "failed":       return "fail";
    case "refunded":     return "refund";
    case "pending":      return "blockchain";
    case "pending_claim":return "waiting";
    default:             return "in-progress"; // preparing, signing, submitting
  }
}

function isAnimated(status: UsdaPaymentStatus): boolean {
  return ["preparing", "signing", "submitting", "pending"].includes(status);
}

/** Testo evento per la riga di stato — leggibile senza documentazione */
function statusCopy(status: UsdaPaymentStatus, isMine: boolean): string {
  switch (status) {
    case "preparing":    return "Preparazione…";
    case "signing":      return "Firma in corso…";
    case "submitting":   return "Invio alla rete…";
    case "pending":      return "In attesa conferma blockchain";
    case "confirmed":    return isMine ? "✅ Confermato sulla blockchain" : "✅ Ricevuto e confermato";
    case "pending_claim":return "⏳ In attesa della riscossione";
    case "claimed":      return "✅ Pagamento riscosso";
    case "refunded":     return "↩ Rimborso automatico";
    case "failed":       return "❌ Pagamento fallito";
    default:             return USDA_STATUS_LABELS[status] ?? status;
  }
}

export const UsdaPaymentBubble = memo(function UsdaPaymentBubble({ data, isMine, onDetail }: Props) {
  const statusClass = getStatusClass(data.status);
  const animated    = isAnimated(data.status);
  const copy        = statusCopy(data.status, isMine);

  const recipientName = data.recipient_name ?? data.recipient_id.slice(0, 8);
  const senderName    = data.sender_name    ?? data.sender_id.slice(0, 8);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Pagamento USDA di ${data.amount} — ${copy}. Tocca per i dettagli`}
      className={`usda-bubble usda-send ${isMine ? "mine" : "theirs"}`}
      onClick={() => onDetail?.(data.payment_id)}
      onKeyDown={(e) => e.key === "Enter" && onDetail?.(data.payment_id)}
    >
      <div className="usda-bubble-header">
        <span className="usda-coin" aria-hidden="true">💰</span>
        <span className="usda-bubble-title">
          {isMine ? "Hai inviato" : "Hai ricevuto"}
        </span>
      </div>

      <div className="usda-bubble-amount">{data.amount} <span className="usda-bubble-unit">USDA</span></div>

      {isMine
        ? <div className="usda-bubble-sub">a {recipientName}</div>
        : <div className="usda-bubble-sub">da {senderName}</div>
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
        <div className="usda-bubble-tap-hint" aria-hidden="true">Tocca per i dettagli →</div>
      )}
    </div>
  );
});
