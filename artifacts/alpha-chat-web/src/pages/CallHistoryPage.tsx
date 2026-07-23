/**
 * CallHistoryPage — Sprint 25
 * Cronologia chiamate: entrata, uscita, persa, rifiutata, audio, video, durata.
 * Mai registra contenuti delle conversazioni.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import { apiGetCallHistory, type CallLogEntry } from "../lib/api";

interface Props {
  onBack: () => void;
}

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
  if (diff < 60) return "Ora";
  if (diff < 3600) return `${Math.round(diff / 60)} min fa`;
  if (diff < 86400) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 604800) {
    return d.toLocaleDateString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function CallStatusIcon({ status, type, t }: { status: string; type: string; t: (k: string) => string }) {
  const icon = type === "video" ? "📹" : "📞";
  if (status === "completed")  return <span className="ch-status completed">{icon} {t("statusCompleted")}</span>;
  if (status === "missed")     return <span className="ch-status missed">📵 {t("statusMissed")}</span>;
  if (status === "declined")   return <span className="ch-status declined">🚫 {t("statusDeclined")}</span>;
  if (status === "cancelled")  return <span className="ch-status cancelled">↩ {t("statusCancelled")}</span>;
  return <span className="ch-status failed">⚠ {t("statusFailed")}</span>;
}

export default function CallHistoryPage({ onBack }: Props) {
  const { t } = useTranslation("calls");
  const { auth } = useAuth();
  const [calls, setCalls]   = useState<CallLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    apiGetCallHistory(50)
      .then((data) => setCalls(data))
      .catch(() => setError(t("historyLoadError")))
      .finally(() => setLoading(false));
  }, [auth]);

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

      <div className="ch-body">
        {loading && <p className="ch-empty">{t("loading")}</p>}
        {error   && <p className="ch-empty ch-error">{error}</p>}
        {!loading && !error && calls.length === 0 && (
          <div className="ch-empty-state">
            <div className="ch-empty-icon">📞</div>
            <p>{t("historyEmpty")}</p>
          </div>
        )}
        {calls.map((c) => {
          const isCaller  = c.caller_id === auth?.userId;
          const peerId    = isCaller ? c.callee_id : c.caller_id;
          const direction = isCaller ? t("outgoing") : t("incoming");
          return (
            <div key={String(c._id)} className="ch-item">
              <div className="ch-item-left">
                <div className="ch-peer-id">{peerId.slice(-6)}</div>
              </div>
              <div className="ch-item-center">
                <div className="ch-direction">{direction}</div>
                <CallStatusIcon status={c.status} type={c.call_type} t={t} />
              </div>
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
