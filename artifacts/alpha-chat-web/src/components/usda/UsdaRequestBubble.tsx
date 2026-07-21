/**
 * UsdaRequestBubble — bubble per message_type: "usda_request"
 *
 * Mostra la richiesta di pagamento con pulsante [Paga] per il destinatario.
 */

import type { UsdaPaymentData } from "../../lib/usda-types";
import { USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../../lib/usda-types";

interface Props {
  data: UsdaPaymentData;
  isMine: boolean;
  myUserId: string;
  onPay?: (paymentId: string) => void;
  onDetail?: (paymentId: string) => void;
}

export function UsdaRequestBubble({ data, isMine, myUserId, onPay, onDetail }: Props) {
  const icon  = USDA_STATUS_ICONS[data.status] ?? "💸";
  const label = USDA_STATUS_LABELS[data.status] ?? data.status;

  const isPendingClaim = data.status === "pending_claim";
  const isConfirmed    = data.status === "confirmed" || data.status === "claimed";
  const isRefunded     = data.status === "refunded";
  const isFailed       = data.status === "failed";

  // Il pulsante [Paga] è visibile SOLO al destinatario quando la richiesta è pending
  const canPay = !isMine && isPendingClaim && myUserId === data.recipient_id;

  const requesterName = data.sender_name ?? data.sender_id.slice(0, 8);

  return (
    <div
      className={`usda-bubble usda-request ${isMine ? "mine" : "theirs"}`}
      onClick={() => !canPay && onDetail?.(data.payment_id)}
    >
      <div className="usda-bubble-header">
        <span className="usda-coin">💸</span>
        <span className="usda-bubble-title">Richiesta pagamento</span>
      </div>
      <div className="usda-bubble-amount">{data.amount} USDA</div>
      {!isMine && <div className="usda-bubble-sub">da {requesterName}</div>}
      {data.note && <div className="usda-bubble-note">"{data.note}"</div>}

      {data.claim_expires_at && isPendingClaim && (
        <div className="usda-bubble-expiry">
          Scadenza: {new Date(data.claim_expires_at).toLocaleDateString("it-IT")}
        </div>
      )}

      <div className={`usda-bubble-status ${isConfirmed ? "ok" : isFailed ? "fail" : isRefunded ? "refund" : "pending"}`}>
        <span className="usda-status-icon">{icon}</span>
        <span>{label}</span>
      </div>

      {canPay && (
        <button
          className="usda-pay-btn"
          onClick={(e) => {
            e.stopPropagation();
            onPay?.(data.payment_id);
          }}
        >
          Paga
        </button>
      )}
    </div>
  );
}
