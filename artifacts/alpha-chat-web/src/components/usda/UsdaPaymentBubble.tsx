/**
 * UsdaPaymentBubble — bubble per message_type: "usda_send"
 *
 * Renderizza un pagamento USDA con stato animato.
 * Lo stato si aggiorna in-place tramite WS event "usda.payment.update".
 */

import type { UsdaPaymentData } from "../../lib/usda-types";
import { USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../../lib/usda-types";

interface Props {
  data: UsdaPaymentData;
  isMine: boolean;
  onDetail?: (paymentId: string) => void;
}

export function UsdaPaymentBubble({ data, isMine, onDetail }: Props) {
  const icon   = USDA_STATUS_ICONS[data.status] ?? "⏳";
  const label  = USDA_STATUS_LABELS[data.status] ?? data.status;
  const isConfirmed  = data.status === "confirmed" || data.status === "claimed";
  const isRefunded   = data.status === "refunded";
  const isFailed     = data.status === "failed";
  const isPending    = !isConfirmed && !isRefunded && !isFailed;

  const recipientName = data.recipient_name ?? data.recipient_id.slice(0, 8);
  const senderName    = data.sender_name    ?? data.sender_id.slice(0, 8);

  return (
    <div
      className={`usda-bubble usda-send ${isMine ? "mine" : "theirs"}`}
      onClick={() => onDetail?.(data.payment_id)}
    >
      <div className="usda-bubble-header">
        <span className="usda-coin">💰</span>
        <span className="usda-bubble-title">
          {isMine ? "Hai inviato" : "Hai ricevuto"}
        </span>
      </div>
      <div className="usda-bubble-amount">{data.amount} USDA</div>
      {isMine
        ? <div className="usda-bubble-sub">a {recipientName}</div>
        : <div className="usda-bubble-sub">da {senderName}</div>
      }
      {data.note && <div className="usda-bubble-note">"{data.note}"</div>}
      <div className={`usda-bubble-status ${isConfirmed ? "ok" : isFailed ? "fail" : isRefunded ? "refund" : "pending"}`}>
        <span className="usda-status-icon">{icon}</span>
        <span>{label}</span>
        {isPending && <span className="usda-status-spinner" />}
      </div>
      {onDetail && (
        <div className="usda-bubble-tap-hint">Tocca per i dettagli →</div>
      )}
    </div>
  );
}
