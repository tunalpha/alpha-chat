/**
 * UsdaPaymentDetail — viewer dettaglio pagamento.
 *
 * Stile fintech premium: success celebration, copy emozionale, nessun errore tecnico.
 */

import { useEffect, useState, useRef } from "react";
import { apiUsdaGetPayment, apiUsdaGetInfo } from "../../lib/usda-api";
import { humanizeUsdaError } from "../../lib/usda-errors";
import type { UsdaPaymentData, UsdaBackendInfo } from "../../lib/usda-types";
import { USDA_STATUS_ICONS } from "../../lib/usda-types";

interface Props {
  paymentId: string;
  onClose: () => void;
}

function abbrev(s: string, chars = 8): string {
  if (!s || s.length <= chars * 2 + 1) return s;
  return `${s.slice(0, chars)}…${s.slice(-6)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    preparing:     "✨ Preparazione…",
    signing:       "🔐 Firma in corso…",
    submitting:    "📡 Invio…",
    pending:       "⛓️ Conferma blockchain…",
    confirmed:     "🎉 Completato",
    pending_claim: "⏳ In attesa di riscossione",
    claimed:       "🎉 Riscosso",
    refunded:      "↩️ Rimborsato",
    failed:        "❌ Non riuscito",
  };
  return map[status] ?? status;
}

export function UsdaPaymentDetail({ paymentId, onClose }: Props) {
  const [data,    setData]    = useState<UsdaPaymentData | null>(null);
  const [info,    setInfo]    = useState<UsdaBackendInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current = new AbortController();
    Promise.all([
      apiUsdaGetPayment(paymentId),
      apiUsdaGetInfo().catch(() => null),
    ])
      .then(([payment, backendInfo]) => { setData(payment); setInfo(backendInfo); })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(humanizeUsdaError(err.message));
      })
      .finally(() => setLoading(false));
    return () => { abortRef.current?.abort(); };
  }, [paymentId]);

  const explorerBase = info?.explorer ? `${info.explorer}/tx/` : null;
  const isSuccess    = data?.status === "confirmed" || data?.status === "claimed";
  const isFailed     = data?.status === "failed";
  const isRefunded   = data?.status === "refunded";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Dettaglio pagamento USDA"
      onClick={onClose}
    >
      <div className="usda-detail" onClick={(e) => e.stopPropagation()}>
        <div className="usda-detail-header">
          <button type="button" className="usda-detail-close" aria-label="Chiudi" onClick={onClose}>✕</button>
          <span className="usda-detail-title">
            {data?.kind === "request" ? "💸 Richiesta USDA" : "💰 Pagamento USDA"}
          </span>
        </div>

        {loading && (
          <div className="usda-detail-loading" role="status" aria-label="Caricamento">
            <span className="usda-loading-dots" aria-hidden="true" /> Caricamento…
          </div>
        )}
        {error && (
          <div className="usda-detail-error-card" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {data && (
          <>
            {/* Celebration banner — successo */}
            {isSuccess && (
              <div className="usda-detail-success-banner" role="status">
                <span aria-hidden="true">🎉</span>
                <div>
                  <strong>Pagamento completato con successo!</strong>
                  <p>La ricevuta blockchain è disponibile qui sotto.</p>
                </div>
              </div>
            )}

            {/* Banner rimborso */}
            {isRefunded && (
              <div className="usda-detail-refund-banner" role="status">
                <span aria-hidden="true">↩️</span>
                <div>
                  <strong>Importo rimborsato automaticamente</strong>
                  <p>Il pagamento non è stato riscosso entro la scadenza.</p>
                </div>
              </div>
            )}

            {/* Banner fallito */}
            {isFailed && (
              <div className="usda-detail-failed-banner" role="alert">
                <span aria-hidden="true">❌</span>
                <div>
                  <strong>Pagamento non riuscito</strong>
                  <p>Se il problema persiste, contatta il supporto AlphaChat.</p>
                </div>
              </div>
            )}

            {/* Importo + stato */}
            <div className="usda-detail-icon" aria-hidden="true">
              {data.kind === "request" ? "💸" : "💰"}
            </div>
            <div className="usda-detail-amount" aria-label={`${data.amount} USDA`}>
              {data.amount} <span className="usda-detail-currency">USDA</span>
            </div>
            <div className={`usda-detail-status ${data.status}`} aria-label={`Stato: ${statusLabel(data.status)}`}>
              <span aria-hidden="true">{USDA_STATUS_ICONS[data.status]}</span>
              {statusLabel(data.status)}
            </div>

            {/* Ricevuta */}
            <div className="usda-detail-rows" role="list">
              <div className="usda-detail-row" role="listitem">
                <span>Tipo</span>
                <strong>{data.kind === "request" ? "Richiesta" : "Pagamento"}</strong>
              </div>
              <div className="usda-detail-row" role="listitem">
                <span>Mittente</span>
                <strong>{data.sender_name ?? abbrev(data.sender_id)}</strong>
              </div>
              <div className="usda-detail-row" role="listitem">
                <span>Destinatario</span>
                <strong>{data.recipient_name ?? abbrev(data.recipient_id)}</strong>
              </div>
              {data.fee && data.fee !== "0" && (
                <div className="usda-detail-row" role="listitem">
                  <span>Commissione</span>
                  <strong>{data.fee} USDA</strong>
                </div>
              )}
              {data.note && (
                <div className="usda-detail-row" role="listitem">
                  <span>Nota</span>
                  <span>"{data.note}"</span>
                </div>
              )}
              {data.tx_hash && (
                <div className="usda-detail-row" role="listitem">
                  <span>Hash</span>
                  {explorerBase ? (
                    <a
                      href={`${explorerBase}${data.tx_hash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="usda-detail-hash"
                      aria-label={`Apri transazione su ${info?.network}`}
                    >
                      {abbrev(data.tx_hash, 10)}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11" aria-hidden="true">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </a>
                  ) : (
                    <span className="usda-detail-mono">{abbrev(data.tx_hash, 10)}</span>
                  )}
                </div>
              )}
              {info && (
                <div className="usda-detail-row" role="listitem">
                  <span>Rete</span>
                  <strong>🟣 {info.network}</strong>
                </div>
              )}
              {data.created_at && (
                <div className="usda-detail-row" role="listitem">
                  <span>Data</span>
                  <span>{fmtDate(data.created_at)}</span>
                </div>
              )}
              {data.claim_expires_at && (
                <div className="usda-detail-row" role="listitem">
                  <span>⏰ Scadenza</span>
                  <span>{fmtDate(data.claim_expires_at)}</span>
                </div>
              )}
              {data.claimed_at && (
                <div className="usda-detail-row" role="listitem">
                  <span>Riscosso il</span>
                  <span>{fmtDate(data.claimed_at)}</span>
                </div>
              )}
              {data.refunded_at && (
                <div className="usda-detail-row" role="listitem">
                  <span>↩️ Rimborsato il</span>
                  <span>{fmtDate(data.refunded_at)}</span>
                </div>
              )}
            </div>

            {/* CTA Explorer */}
            {isSuccess && data.tx_hash && explorerBase && (
              <a
                href={`${explorerBase}${data.tx_hash}`}
                target="_blank" rel="noopener noreferrer"
                className="usda-explorer-btn"
                aria-label={`Apri su ${info?.network ?? "Explorer"}`}
              >
                🔗 Verifica su PolygonScan
              </a>
            )}

            {isSuccess && (
              <div className="usda-receipt-badge" aria-label="Pagamento completato con successo">
                ✅ Ricevuta blockchain disponibile
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
