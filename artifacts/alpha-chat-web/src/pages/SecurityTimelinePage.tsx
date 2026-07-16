/**
 * SecurityTimelinePage — Sprint 19
 * Timeline degli eventi di sicurezza. Mai contenuti di conversazioni.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";

interface Props { onBack: () => void }

interface SecurityEvent {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

const EVENT_LABELS: Record<string, { emoji: string; label: string }> = {
  LOGIN:                    { emoji: "🔓", label: "Accesso effettuato" },
  LOGOUT:                   { emoji: "🔒", label: "Disconnessione" },
  LOGOUT_ALL:               { emoji: "🔒", label: "Disconnessione da tutti i dispositivi" },
  NEW_DEVICE:               { emoji: "📱", label: "Nuovo dispositivo" },
  DEVICE_REMOVED:           { emoji: "🗑️", label: "Dispositivo rimosso" },
  DEVICE_RENAMED:           { emoji: "✏️", label: "Dispositivo rinominato" },
  IDENTITY_VERIFIED:        { emoji: "✅", label: "Identità verificata" },
  KEY_CHANGE:               { emoji: "🔑", label: "Cambio chiavi" },
  PASSWORD_CHANGED:         { emoji: "🔐", label: "Password modificata" },
  PHOENIX_CODE_SET:         { emoji: "🔥", label: "Phoenix Code configurato" },
  EMERGENCY_LOCK:           { emoji: "🚨", label: "Emergency Lock attivato" },
  PHOENIX_PROTOCOL:         { emoji: "💀", label: "Phoenix Protocol eseguito" },
  DMS_CONFIGURED:           { emoji: "⏱️", label: "Dead Man Switch configurato" },
  DMS_WARNING_SENT:         { emoji: "⚠️", label: "Avviso DMS inviato" },
  DMS_ACTION_EXECUTED:      { emoji: "🔒", label: "Azione DMS eseguita" },
  RECOVERY_CONTACT_ADDED:   { emoji: "👤", label: "Recovery Contact aggiunto" },
  RECOVERY_CONTACT_REMOVED: { emoji: "👤", label: "Recovery Contact rimosso" },
  SESSION_REVOKED:          { emoji: "❌", label: "Sessione revocata" },
  TWO_FA_ENABLED:           { emoji: "🔐", label: "2FA attivato" },
  TWO_FA_DISABLED:          { emoji: "🔓", label: "2FA disattivato" },
};

const BASE = "/api/v1/security-timeline";

export default function SecurityTimelinePage({ onBack }: Props) {
  const { auth } = useAuth();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void load(); }, []);

  async function load(before?: string) {
    if (before) setLoadingMore(true); else setLoading(true);
    try {
      const url = before ? `${BASE}?limit=30&before=${encodeURIComponent(before)}` : `${BASE}?limit=30`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${auth?.accessToken}` } });
      const data = await res.json() as { events: SecurityEvent[] };
      const newEvents = data.events;
      if (before) setEvents(e => [...e, ...newEvents]);
      else setEvents(newEvents);
      setHasMore(newEvents.length === 30);
    } catch { setError("Errore di caricamento."); }
    finally { setLoading(false); setLoadingMore(false); }
  }

  function loadMore() {
    const last = events[events.length - 1];
    if (last) void load(last.created_at);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function groupByDate(events: SecurityEvent[]) {
    const groups: Record<string, SecurityEvent[]> = {};
    for (const e of events) {
      const day = new Date(e.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
      if (!groups[day]) groups[day] = [];
      groups[day].push(e);
    }
    return groups;
  }

  const groups = groupByDate(events);

  return (
    <div className="st-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 className="settings-title">Timeline Sicurezza</h1>
      </header>

      <div className="st-body">
        <div className="st-disclaimer">
          📋 Solo eventi tecnici. Mai contenuti di conversazioni.
        </div>

        {loading && <div className="st-loading">Caricamento…</div>}
        {error && <div className="st-error">{error}</div>}

        {!loading && events.length === 0 && (
          <div className="st-empty">Nessun evento registrato.</div>
        )}

        {Object.entries(groups).map(([day, dayEvents]) => (
          <div key={day} className="st-group">
            <div className="st-group-label">{day}</div>
            <div className="st-group-events">
              {dayEvents.map(ev => {
                const info = EVENT_LABELS[ev.event_type] ?? { emoji: "ℹ️", label: ev.event_type };
                return (
                  <div key={ev.id} className="st-event">
                    <div className="st-event-dot" />
                    <div className="st-event-icon">{info.emoji}</div>
                    <div className="st-event-body">
                      <div className="st-event-label">{info.label}</div>
                      {ev.metadata && Object.keys(ev.metadata).length > 0 && ev.event_type === "NEW_DEVICE" && (
                        <div className="st-event-meta">{String(ev.metadata["device_name"] ?? "")}</div>
                      )}
                      <div className="st-event-time">{formatDate(ev.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {hasMore && !loading && (
          <button className="st-load-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Caricamento…" : "Carica altri"}
          </button>
        )}
      </div>
    </div>
  );
}
