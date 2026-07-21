/**
 * UsdaHistory — cronologia USDA con filtri.
 * Apribile dal profilo della chat.
 */

import { useState, useEffect } from "react";
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
  const [filter, setFilter] = useState<Filter>("all");
  const [payments, setPayments] = useState<UsdaPaymentData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiUsdaGetHistory({
      type: filter === "all" ? undefined : filter,
      limit: 30,
      skip: 0,
    })
      .then((res) => { setPayments(res.payments); setTotal(res.total); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div className="usda-history-modal">
      <div className="usda-history-header">
        <button className="usda-history-close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <span className="usda-history-title">💰 Cronologia USDA</span>
      </div>

      <div className="usda-history-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`usda-filter-btn ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="usda-history-empty">Caricamento…</div>}
      {error   && <div className="usda-error" style={{ margin: "12px 16px" }}>{error}</div>}

      {!loading && !error && payments.length === 0 && (
        <div className="usda-history-empty">Nessuna transazione</div>
      )}

      <div className="usda-history-list">
        {payments.map((p) => (
          <button
            key={p.payment_id}
            className="usda-history-item"
            onClick={() => onDetail(p.payment_id)}
          >
            <div className="usda-history-icon">
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
            <div className="usda-history-status">
              <span>{USDA_STATUS_ICONS[p.status]}</span>
              <span className="usda-history-status-label">{USDA_STATUS_LABELS[p.status]}</span>
            </div>
          </button>
        ))}
      </div>

      {total > payments.length && (
        <div className="usda-history-more">{total - payments.length} altre transazioni</div>
      )}
    </div>
  );
}
