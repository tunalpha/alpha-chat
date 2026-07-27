/**
 * CallHistoryPage — registro chiamate completo
 * Filtri client-side: Tutte / Perse / Effettuate / Ricevute
 * Mostra: avatar, nome contatto, direzione, tipo (audio/video), stato, durata, data/ora.
 * Zero regressioni: nessuna logica chat o Signal toccata.
 */
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import { apiGetCallHistory, type CallLogEntry } from "../lib/api";

export interface PeerInfo {
  name: string;
  avatarUrl: string | null;
}

interface Props {
  onBack: () => void;
  peerMap: Record<string, PeerInfo>;
}

type FilterType = "all" | "missed" | "outgoing" | "incoming";

/* ─── helpers ────────────────────────────────────────────────────────────── */

function formatDuration(sec?: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60)    return "Ora";
  if (diff < 3600)  return `${Math.round(diff / 60)} min fa`;
  if (diff < 86400) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (diff < 604800)
    return d.toLocaleDateString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/* ─── sub-components ─────────────────────────────────────────────────────── */

function PeerAvatar({ info }: { info?: PeerInfo }) {
  const initial = info?.name?.[0]?.toUpperCase() ?? "?";
  if (info?.avatarUrl) {
    return <img src={info.avatarUrl} alt={info.name} className="ch-avatar-img" />;
  }
  return <div className="ch-avatar-initial">{initial}</div>;
}

function CallStatusBadge({ status, t }: { status: string; t: (k: string, fb?: string) => string }) {
  const map: Record<string, { cls: string; label: string }> = {
    completed: { cls: "completed", label: t("statusCompleted") },
    missed:    { cls: "missed",    label: t("missed") },
    declined:  { cls: "declined",  label: t("statusDeclined") },
    cancelled: { cls: "cancelled", label: t("statusCancelledCall") },
    failed:    { cls: "failed",    label: t("statusFailedCall") },
  };
  const { cls, label } = map[status] ?? { cls: "failed", label: status };
  return <span className={`ch-status ${cls}`}>{label}</span>;
}

/* ─── main component ─────────────────────────────────────────────────────── */

export default function CallHistoryPage({ onBack, peerMap }: Props) {
  const { t } = useTranslation("calls");
  const { auth } = useAuth();

  const [calls, setCalls]     = useState<CallLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<FilterType>("all");

  useEffect(() => {
    if (!auth) return;
    apiGetCallHistory(100)
      .then((data) => setCalls(data))
      .catch(() => setError(t("historyError")))
      .finally(() => setLoading(false));
  }, [auth, t]);

  const filtered = useMemo(() => {
    if (filter === "all") return calls;
    return calls.filter((c) => {
      const isCaller = c.caller_id === auth?.userId;
      if (filter === "missed")   return c.status === "missed";
      if (filter === "outgoing") return isCaller;
      if (filter === "incoming") return !isCaller;
      return true;
    });
  }, [calls, filter, auth?.userId]);

  const filters: { key: FilterType; label: string }[] = [
    { key: "all",      label: t("filterAll",      "Tutte") },
    { key: "missed",   label: t("filterMissed",   "Perse") },
    { key: "outgoing", label: t("filterOutgoing", "Effettuate") },
    { key: "incoming", label: t("filterIncoming", "Ricevute") },
  ];

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">{t("historyTitle")}</h1>
      </header>

      {/* ── filtri ─────────────────────────────────────────────────────────── */}
      <div className="ch-filters">
        {filters.map((f) => (
          <button
            key={f.key}
            className={`ch-filter-btn${filter === f.key ? " active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── lista ──────────────────────────────────────────────────────────── */}
      <div className="ch-body">
        {loading && <p className="ch-empty">{t("historyLoading")}</p>}
        {error   && <p className="ch-empty ch-error">{error}</p>}

        {!loading && !error && filtered.length === 0 && (
          <div className="ch-empty-state">
            <div className="ch-empty-icon">📞</div>
            <p>{t("historyEmpty")}</p>
          </div>
        )}

        {filtered.map((c) => {
          const isCaller = c.caller_id === auth?.userId;
          const peerId   = isCaller ? c.callee_id : c.caller_id;
          const info     = peerMap[peerId];
          const peerName = info?.name ?? `…${peerId.slice(-6)}`;

          return (
            <div key={String(c._id)} className="ch-item">
              {/* avatar */}
              <div className="ch-item-avatar">
                <PeerAvatar info={info} />
              </div>

              {/* centro: nome + meta */}
              <div className="ch-item-center">
                <div className="ch-peer-name">{peerName}</div>
                <div className="ch-item-meta">
                  <span className="ch-direction">
                    {isCaller ? t("directionOut") : t("directionIn")}
                  </span>
                  <span className="ch-type-icon" title={c.call_type}>
                    {c.call_type === "video" ? "📹" : "📞"}
                  </span>
                  <CallStatusBadge status={c.status} t={t} />
                </div>
              </div>

              {/* destra: data + durata */}
              <div className="ch-item-right">
                <div className="ch-date">{formatDate(c.started_at)}</div>
                {c.duration_sec ? (
                  <div className="ch-duration">{formatDuration(c.duration_sec)}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
