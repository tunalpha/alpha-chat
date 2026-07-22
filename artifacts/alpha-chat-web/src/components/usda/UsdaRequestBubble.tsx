/**
 * UsdaRequestBubble — bubble per message_type: "usda_request"
 *
 * Stile fintech premium: copy emozionale, CTA chiaro, nessun testo tecnico.
 */

import { memo, useState } from "react";
import type { UsdaPaymentData, UsdaPaymentStatus } from "../../lib/usda-types";
import { USDA_STATUS_ICONS } from "../../lib/usda-types";

interface Props {
  data: UsdaPaymentData;
  isMine: boolean;
  myUserId: string;
  onPay?: (paymentId: string) => Promise<void>;
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

function requestCopy(status: UsdaPaymentStatus, isMine: boolean): string {
  switch (status) {
    case "pending_claim": return isMine ? "⏳ In attesa che paghi" : "⏳ Richiesta in attesa";
    case "pending":       return "📡 Pagamento in corso…";
    case "confirmed":
    case "claimed":       return "🎉 Richiesta pagata con successo";
    case "refunded":      return "↩️ Importo rimborsato automaticamente";
    case "failed":        return "❌ Pagamento non riuscito";
    default:              return "✨ Elaborazione…";
  }
}

export const UsdaRequestBubble = memo(function UsdaRequestBubble({ data, isMine, myUserId, onPay, onDetail }: Props) {
  const [paying, setPaying] = useState(false);

  const statusClass    = getStatusClass(data.status);
  const copy           = requestCopy(data.status, isMine);
  const isPendingClaim = data.status === "pending_claim";
  const isAnimated     = ["pending", "preparing", "signing", "submitting"].includes(data.status);

  // Pulsante Paga: visibile solo al destinatario quando la richiesta è attiva
  const canPay = !isMine && isPendingClaim && myUserId === data.recipient_id;

  const requesterName = data.sender_name ?? data.sender_id.slice(0, 8);

  async function handlePay() {
    if (!onPay || paying) return;
    setPaying(true);
    try {
      await onPay(data.payment_id);
    } finally {
      setPaying(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={canPay ? -1 : 0}
      aria-label={`Richiesta USDA di ${data.amount} da ${requesterName} — ${copy}`}
      className={`usda-bubble usda-request ${isMine ? "mine" : "theirs"}`}
      onClick={() => !canPay && onDetail?.(data.payment_id)}
      onKeyDown={(e) => !canPay && e.key === "Enter" && onDetail?.(data.payment_id)}
    >
      <div className="usda-bubble-header">
        <span className="usda-coin" aria-hidden="true">💸</span>
        <span className="usda-bubble-title">Richiesta pagamento</span>
      </div>

      <div className="usda-bubble-amount">
        {data.amount} <span className="usda-bubble-unit">USDA</span>
      </div>

      {!isMine && (
        <div className="usda-bubble-sub">da {requesterName}</div>
      )}

      {data.note && (
        <div className="usda-bubble-note" aria-label={`Nota: ${data.note}`}>"{data.note}"</div>
      )}

      {isPendingClaim && data.claim_expires_at && (
        <div className="usda-bubble-expiry" aria-label={`Scade il ${new Date(data.claim_expires_at).toLocaleDateString("it-IT")}`}>
          ⏰ Scade il {new Date(data.claim_expires_at).toLocaleDateString("it-IT")}
        </div>
      )}

      <div className={`usda-bubble-status ${statusClass}`} aria-live="polite" aria-label={copy}>
        {isAnimated && <span className="usda-status-dot" aria-hidden="true" />}
        <span className="usda-status-icon" aria-hidden="true">{USDA_STATUS_ICONS[data.status]}</span>
        <span className="usda-status-text">{copy}</span>
      </div>

      {canPay && (
        <button
          type="button"
          className={`usda-pay-btn ${paying ? "paying" : ""}`}
          aria-label={`Paga ${data.amount} USDA a ${requesterName}`}
          disabled={paying}
          onClick={(e) => { e.stopPropagation(); void handlePay(); }}
        >
          {paying ? (
            <><span className="usda-pay-spinner" aria-hidden="true" /> Pagamento in corso…</>
          ) : (
            <>💸 Paga ora · {data.amount} USDA</>
          )}
        </button>
      )}

      {!canPay && onDetail && !isMine && !isPendingClaim && (
        <div className="usda-bubble-tap-hint" aria-hidden="true">Tocca per i dettagli →</div>
      )}
    </div>
  );
});
