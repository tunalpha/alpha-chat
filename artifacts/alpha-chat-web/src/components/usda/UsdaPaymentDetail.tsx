/**
 * UsdaPaymentDetail — viewer dettaglio pagamento.
 *
 * Mostra: importo, mittente, destinatario, stato, hash, fee, network, explorer, data.
 * L'URL explorer viene dal backend via /info — nessun valore hardcoded.
 */

import { useEffect, useState, useRef } from "react";
import { apiUsdaGetPayment, apiUsdaGetInfo } from "../../lib/usda-api";
import type { UsdaPaymentData, UsdaBackendInfo } from "../../lib/usda-types";
import { USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../../lib/usda-types";

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
      .catch((err: Error) => { if (err.name !== "AbortError") setError(err.message); })
      .finally(() => setLoading(false));
    return () => { abortRef.current?.abort(); };
  }, [paymentId]);

  // Explorer URL dal backend — nessun valore hardcoded
  const explorerBase = info?.explorer ? `${info.explorer}/tx/` : null;

  const isConfirmed = data?.status === "confirmed" || data?.status === "claimed";

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
          <button
            type="button"
            className="usda-detail-close"
            aria-label="Chiudi dettaglio"
            onClick={onClose}
          >✕</button>
          <span className="usda-detail-title">
            {data?.kind === "request" ? "Richiesta USDA" : "Pagamento USDA"}
          </span>
        </div>

        {loading && (
          <div className="usda-detail-loading" role="status" aria-label="Caricamento">
            <span className="usda-loading-dots" aria-hidden="true" /> Caricamento…
          </div>
        )}
        {error && <div className="usda-error" style={{ margin: "12px 20px" }} role="alert">{error}</div>}

        {data && (
          <>
            {/* Importo + stato */}
            <div className="usda-detail-icon" aria-hidden="true">
              {data.kind === "request" ? "💸" : "💰"}
            </div>
            <div className="usda-detail-amount" aria-label={`${data.amount} USDA`}>
              {data.amount} <span className="usda-detail-currency">USDA</span>
            </div>
            <div className={`usda-detail-status ${data.status}`} aria-label={`Stato: ${USDA_STATUS_LABELS[data.status]}`}>
              <span aria-hidden="true">{USDA_STATUS_ICONS[data.status]}</span>
              {USDA_STATUS_LABELS[data.status]}
            </div>

            {/* Ricevuta completa */}
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
                  <span>{data.note}</span>
                </div>
              )}

              {/* Blockchain data */}
              {data.tx_hash && (
                <div className="usda-detail-row" role="listitem">
                  <span>Hash</span>
                  {explorerBase ? (
                    <a
                      href={`${explorerBase}${data.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="usda-detail-hash"
                      aria-label={`Apri transazione ${abbrev(data.tx_hash)} su ${info?.network}`}
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
                  <strong>{info.network} (chain {info.chainId})</strong>
                </div>
              )}

              {/* Date */}
              {data.created_at && (
                <div className="usda-detail-row" role="listitem">
                  <span>Data</span>
                  <span>{fmtDate(data.created_at)}</span>
                </div>
              )}
              {data.claim_expires_at && (
                <div className="usda-detail-row" role="listitem">
                  <span>Scadenza riscossione</span>
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
                  <span>Rimborsato il</span>
                  <span>{fmtDate(data.refunded_at)}</span>
                </div>
              )}
            </div>

            {/* CTA Explorer — visibile solo se confermato e hash disponibile */}
            {isConfirmed && data.tx_hash && explorerBase && (
              <a
                href={`${explorerBase}${data.tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="usda-explorer-btn"
                aria-label={`Apri su ${info?.network ?? "Explorer"}`}
              >
                🔗 Apri su {info?.network ?? "Explorer"}
              </a>
            )}

            {/* Receipt summary */}
            {isConfirmed && (
              <div className="usda-receipt-badge" aria-label="Pagamento completato con successo">
                ✅ Ricevuta disponibile
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
