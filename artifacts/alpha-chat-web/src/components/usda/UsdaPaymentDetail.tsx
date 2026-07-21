/**
 * UsdaPaymentDetail — modal dettaglio pagamento.
 * Si apre toccando una bubble USDA.
 */

import { useEffect, useState } from "react";
import { apiUsdaGetPayment } from "../../lib/usda-api";
import type { UsdaPaymentData } from "../../lib/usda-types";
import { USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../../lib/usda-types";

interface Props {
  paymentId: string;
  onClose: () => void;
}

// Polygon Explorer base URL (mock — sostituire con la chain reale)
const EXPLORER_BASE = "https://polygonscan.com/tx/";

function abbrev(s: string, chars = 8): string {
  if (!s || s.length <= chars * 2) return s;
  return `${s.slice(0, chars)}…${s.slice(-4)}`;
}

export function UsdaPaymentDetail({ paymentId, onClose }: Props) {
  const [data, setData] = useState<UsdaPaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiUsdaGetPayment(paymentId)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [paymentId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="usda-detail" onClick={(e) => e.stopPropagation()}>
        <div className="usda-detail-header">
          <button className="usda-detail-close" onClick={onClose}>✕</button>
          <span className="usda-detail-title">Pagamento USDA</span>
        </div>

        {loading && <div className="usda-detail-loading">Caricamento…</div>}
        {error   && <div className="usda-error">{error}</div>}

        {data && (
          <>
            <div className="usda-detail-icon">
              {data.kind === "request" ? "💸" : "💰"}
            </div>
            <div className="usda-detail-amount">{data.amount} USDA</div>
            <div className={`usda-detail-status ${data.status}`}>
              {USDA_STATUS_ICONS[data.status]} {USDA_STATUS_LABELS[data.status]}
            </div>

            <div className="usda-detail-rows">
              <div className="usda-detail-row">
                <span>Tipo</span>
                <span>{data.kind === "request" ? "Richiesta" : "Pagamento"}</span>
              </div>
              <div className="usda-detail-row">
                <span>Mittente</span>
                <span>{data.sender_name ?? abbrev(data.sender_id)}</span>
              </div>
              <div className="usda-detail-row">
                <span>Destinatario</span>
                <span>{data.recipient_name ?? abbrev(data.recipient_id)}</span>
              </div>
              {data.fee && data.fee !== "0" && (
                <div className="usda-detail-row">
                  <span>Commissione</span>
                  <span>{data.fee} USDA</span>
                </div>
              )}
              {data.note && (
                <div className="usda-detail-row">
                  <span>Nota</span>
                  <span>{data.note}</span>
                </div>
              )}
              {data.tx_hash && (
                <div className="usda-detail-row">
                  <span>Hash</span>
                  <a
                    href={`${EXPLORER_BASE}${data.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="usda-detail-hash"
                  >
                    {abbrev(data.tx_hash, 10)}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginLeft: 4 }}>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
                </div>
              )}
              {data.claim_expires_at && (
                <div className="usda-detail-row">
                  <span>Scadenza</span>
                  <span>{new Date(data.claim_expires_at).toLocaleDateString("it-IT")}</span>
                </div>
              )}
              {data.claimed_at && (
                <div className="usda-detail-row">
                  <span>Riscosso il</span>
                  <span>{new Date(data.claimed_at).toLocaleString("it-IT")}</span>
                </div>
              )}
              {data.refunded_at && (
                <div className="usda-detail-row">
                  <span>Rimborsato il</span>
                  <span>{new Date(data.refunded_at).toLocaleString("it-IT")}</span>
                </div>
              )}
              {data.created_at && (
                <div className="usda-detail-row">
                  <span>Data</span>
                  <span>{new Date(data.created_at).toLocaleString("it-IT")}</span>
                </div>
              )}
            </div>

            {data.tx_hash && (
              <a
                href={`${EXPLORER_BASE}${data.tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="usda-explorer-btn"
              >
                🔗 Apri Explorer
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
