/**
 * UsdaHistory — cronologia USDA con filtri.
 */

import { useState, useEffect, useRef } from "react";
import { apiUsdaGetHistory } from "../../lib/usda-api";
import type { UsdaPaymentData } from "../../lib/usda-types";
import { USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../../lib/usda-types";

type Filter = "all" | "sent" | "received" | "pending" | "claimed" | "refunded";

interface Props {
  onClose: () => void;
  onDetail: (paymentId: string) => void;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",      label: "Tutti"     },
  { key: "sent",     label: "Inviati"   },
  { key: "received", label: "Ricevuti"  },
  { key: "pending",  label: "Pending"   },
  { key: "claimed",  label: "Riscossi"  },
  { key: "refunded", label: "Rimborsati"},
];

export function UsdaHistory({ onClose, onDetail }: Props) {
  const [filter,   setFilter]   = useState<Filter>("all");
  const [payments, setPayments] = useState<UsdaPaymentData[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    apiUsdaGetHistory({ type: filter === "all" ? undefined : filter, limit: 30, skip: 0 })
      .then((res) => { setPayments(res.payments); setTotal(res.total); })
      .catch((err: Error) => { if (err.name !== "AbortError") setError(err.message); })
      .finally(() => setLoading(false));

    return () => { abortRef.current?.abort(); };
  }, [filter]);

  return (
    <div className="usda-history-modal" role="dialog" aria-modal="true" aria-label="Cronologia pagamenti USDA">
      <div className="usda-history-header">
        <button
          type="button"
          className="usda-history-close"
          aria-label="Chiudi cronologia"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <span className="usda-history-title">💰 Cronologia USDA</span>
      </div>

      <div
        className="usda-history-filters"
        role="tablist"
        aria-label="Filtri transazioni"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`usda-filter-btn ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="usda-history-empty" role="status" aria-label="Caricamento in corso">
          <span className="usda-loading-dots" aria-hidden="true" />
          Caricamento…
        </div>
      )}
      {error && (
        <div className="usda-error" style={{ margin: "12px 16px" }} role="alert">{error}</div>
      )}
      {!loading && !error && payments.length === 0 && (
        <div className="usda-history-empty">Nessuna transazione</div>
      )}

      <div className="usda-history-list" role="list">
        {payments.map((p) => (
          <button
            key={p.payment_id}
            type="button"
            role="listitem"
            className="usda-history-item"
            aria-label={`${p.kind === "request" ? "Richiesta" : "Pagamento"} di ${p.amount} USDA — ${USDA_STATUS_LABELS[p.status]}`}
            onClick={() => onDetail(p.payment_id)}
          >
            <div className="usda-history-icon" aria-hidden="true">
              {p.kind === "request" ? "💸" : "💰"}
            </div>
            <div className="usda-history-info">
              <div className="usda-history-amount">{p.amount} USDA</div>
              <div className="usda-history-name">
                {p.sender_name ?? p.sender_id.slice(0, 8)} →{" "}
                {p.recipient_name ?? p.recipient_id.slice(0, 8)}
              </div>
              {p.note && <div className="usda-history-note">"{p.note}"</div>}
            </div>
            <div className="usda-history-status" aria-hidden="true">
              <span>{USDA_STATUS_ICONS[p.status]}</span>
              <span className="usda-history-status-label">{USDA_STATUS_LABELS[p.status]}</span>
            </div>
          </button>
        ))}
      </div>

      {total > payments.length && (
        <div className="usda-history-more" aria-live="polite">
          {total - payments.length} altre transazioni
        </div>
      )}
    </div>
  );
}
