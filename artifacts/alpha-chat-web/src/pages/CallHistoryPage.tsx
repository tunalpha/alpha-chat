/**
 * CallHistoryPage — registro chiamate completo
 * Tap su una riga → action sheet con "Richiama" e "Manda messaggio".
 * Zero regressioni: nessuna logica chat o Signal toccata.
 */
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import { useCall } from "../contexts/CallContext";
import { apiGetCallHistory, type CallLogEntry } from "../lib/api";

export interface PeerInfo {
  name: string;
  avatarUrl: string | null;
  conversationId?: string;
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

/* ─── action sheet ───────────────────────────────────────────────────────── */

interface SheetEntry {
  peerId: string;
  peerName: string;
  callType: "audio" | "video";
  conversationId?: string;
}

interface ActionSheetProps {
  entry: SheetEntry;
  onClose: () => void;
  onCall: (peerId: string, peerName: string, callType: "audio" | "video") => void;
  onMessage: (conversationId: string) => void;
}

function CallActionSheet({ entry, onClose, onCall, onMessage }: ActionSheetProps) {
  return (
    <>
      {/* backdrop */}
      <div className="ch-sheet-backdrop" onClick={onClose} />

      <div className="ch-sheet" role="dialog" aria-modal="true">
        {/* handle bar */}
        <div className="ch-sheet-handle" />

        {/* header: avatar + nome */}
        <div className="ch-sheet-header">
          <div className="ch-sheet-avatar-wrap">
            <PeerAvatar info={{ name: entry.peerName, avatarUrl: null }} />
          </div>
          <span className="ch-sheet-peer-name">{entry.peerName}</span>
        </div>

        {/* azioni */}
        <button
          className="ch-sheet-action"
          onClick={() => { onCall(entry.peerId, entry.peerName, entry.callType); onClose(); }}
        >
          <span className="ch-sheet-action-icon">
            {entry.callType === "video"
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07
                           A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.38
                           2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0
                           .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.4a16 16 0 0 0 6 6
                           l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0
                           2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
            }
          </span>
          <span className="ch-sheet-action-label">Richiama</span>
          <svg className="ch-sheet-action-chevron" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
               strokeLinejoin="round" width="16" height="16">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <button
          className="ch-sheet-action"
          disabled={!entry.conversationId}
          onClick={() => {
            if (entry.conversationId) { onMessage(entry.conversationId); onClose(); }
          }}
        >
          <span className="ch-sheet-action-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span className="ch-sheet-action-label">Manda messaggio</span>
          <svg className="ch-sheet-action-chevron" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
               strokeLinejoin="round" width="16" height="16">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <button className="ch-sheet-cancel" onClick={onClose}>
          Annulla
        </button>
      </div>
    </>
  );
}

/* ─── main component ─────────────────────────────────────────────────────── */

export default function CallHistoryPage({ onBack, peerMap }: Props) {
  const { t } = useTranslation("calls");
  const { auth } = useAuth();
  const { initiateCall } = useCall();

  const [calls, setCalls]           = useState<CallLogEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [filter, setFilter]         = useState<FilterType>("all");
  const [sheetEntry, setSheetEntry] = useState<SheetEntry | null>(null);

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
      // "Perse" include: chiamate "missed" + chiamate "cancelled" uscenti
      // (caller ha riattaccato prima che l'altro rispondesse)
      if (filter === "missed")   return c.status === "missed" ||
        (c.status === "cancelled" && c.caller_id === auth?.userId);
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

  /* ── handlers action sheet ──────────────────────────────────────────────── */

  function handleCallBack(peerId: string, peerName: string, callType: "audio" | "video") {
    void initiateCall(peerId, peerName, callType);
    onBack(); // torna alla chat view (la UI chiamata si sovrappone)
  }

  function handleMessage(conversationId: string) {
    // Dispatcha evento intercettato da ChatPage per aprire la conversazione
    window.dispatchEvent(
      new CustomEvent("push:open-conversation", { detail: { convId: conversationId } }),
    );
    onBack();
  }

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
          const isMissed =
            c.status === "missed" ||
            (c.status === "cancelled" && c.caller_id === auth?.userId);

          return (
            <button
              key={String(c._id)}
              className={`ch-item ch-item--btn${isMissed ? " ch-item--missed" : ""}`}
              onClick={() =>
                setSheetEntry({
                  peerId,
                  peerName,
                  callType: c.call_type as "audio" | "video",
                  conversationId: info?.conversationId,
                })
              }
            >
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

              {/* chevron tap hint */}
              <svg className="ch-item-chevron" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                   strokeLinejoin="round" width="14" height="14">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          );
        })}
      </div>

      {/* ── action sheet ───────────────────────────────────────────────────── */}
      {sheetEntry && (
        <CallActionSheet
          entry={sheetEntry}
          onClose={() => setSheetEntry(null)}
          onCall={handleCallBack}
          onMessage={handleMessage}
        />
      )}
    </div>
  );
}
