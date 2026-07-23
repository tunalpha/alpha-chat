/**
 * SecurityTimelinePage — Sprint 19
 * Timeline degli eventi di sicurezza. Mai contenuti di conversazioni.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";

interface Props { onBack: () => void }

interface SecurityEvent {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

const BASE = "/api/v1/security-timeline";

export default function SecurityTimelinePage({ onBack }: Props) {
  const { t } = useTranslation("timeline");
  const { auth } = useAuth();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");

  // EVENT_LABELS inside component so t() works
  const EVENT_LABELS: Record<string, { emoji: string; label: string }> = {
    LOGIN:                    { emoji: "🔓", label: t("evtLogin") },
    LOGOUT:                   { emoji: "🔒", label: t("evtLogout") },
    LOGOUT_ALL:               { emoji: "🔒", label: t("evtLogoutAll") },
    NEW_DEVICE:               { emoji: "📱", label: t("evtNewDevice") },
    DEVICE_REMOVED:           { emoji: "🗑️", label: t("evtDeviceRemoved") },
    DEVICE_RENAMED:           { emoji: "✏️", label: t("evtDeviceRenamed") },
    IDENTITY_VERIFIED:        { emoji: "✅", label: t("evtIdentityVerified") },
    KEY_CHANGE:               { emoji: "🔑", label: t("evtKeyChange") },
    PASSWORD_CHANGED:         { emoji: "🔐", label: t("evtPasswordChanged") },
    PHOENIX_CODE_SET:         { emoji: "🔥", label: t("evtPhoenixCodeSet") },
    EMERGENCY_LOCK:           { emoji: "🚨", label: t("evtEmergencyLock") },
    PHOENIX_PROTOCOL:         { emoji: "💀", label: t("evtPhoenixProtocol") },
    DMS_CONFIGURED:           { emoji: "⏱️", label: t("evtDmsConfigured") },
    DMS_WARNING_SENT:         { emoji: "⚠️", label: t("evtDmsWarningSent") },
    DMS_ACTION_EXECUTED:      { emoji: "🔒", label: t("evtDmsActionExecuted") },
    RECOVERY_CONTACT_ADDED:   { emoji: "👤", label: t("evtRecoveryContactAdded") },
    RECOVERY_CONTACT_REMOVED: { emoji: "👤", label: t("evtRecoveryContactRemoved") },
    SESSION_REVOKED:          { emoji: "❌", label: t("evtSessionRevoked") },
    TWO_FA_ENABLED:           { emoji: "🔐", label: t("evtTwoFaEnabled") },
    TWO_FA_DISABLED:          { emoji: "🔓", label: t("evtTwoFaDisabled") },
  };

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
    } catch { setError(t("loadError")); }
    finally { setLoading(false); setLoadingMore(false); }
  }

  function loadMore() {
    const last = events[events.length - 1];
    if (last) void load(last.created_at);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function groupByDate(evts: SecurityEvent[]) {
    const groups: Record<string, SecurityEvent[]> = {};
    for (const e of evts) {
      const day = new Date(e.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
      if (!groups[day]) groups[day] = [];
      groups[day].push(e);
    }
    return groups;
  }

  const groups = groupByDate(events);

  return (
    <div className="st-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 className="settings-title">{t("title")}</h1>
      </header>

      <div className="st-body">
        <div className="st-disclaimer">
          📋 {t("disclaimer")}
        </div>

        {loading && <div className="st-loading">{t("loading")}</div>}
        {error && <div className="st-error">{error}</div>}

        {!loading && events.length === 0 && (
          <div className="st-empty">{t("empty")}</div>
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
            {loadingMore ? t("loading") : t("loadMore")}
          </button>
        )}
      </div>
    </div>
  );
}
