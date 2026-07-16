/**
 * RecoveryDashboardPage — Sprint 19 — Emergency Dashboard
 *
 * Aggregato: stato completo del Recovery & Continuity Center.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { type AppView } from "../App";

interface Props { onBack: () => void; onNavigate: (v: AppView) => void }

interface DashboardData {
  dms: {
    enabled: boolean;
    period_days: number;
    grace_days: number;
    action: string;
    days_until_warning: number | null;
    state: string;
  };
  contacts: { id: string; name: string; email: string }[];
  recovery_card: { username: string; emergencyId: string; hasPhoenixCode: boolean };
  account: { last_seen_at: string | null; created_at: string | null };
  sessions: { device_name: string; last_active_at: string | null }[];
}

function StatusBadge({ ok }: { ok: boolean }) {
  return <span className={`rd-badge${ok ? " rd-badge--ok" : " rd-badge--no"}`}>{ok ? "🟢 Configurato" : "🔴 Non configurato"}</span>;
}

export default function RecoveryDashboardPage({ onBack, onNavigate }: Props) {
  const { auth } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/recovery-dashboard", { headers: { Authorization: `Bearer ${auth?.accessToken}` } });
      if (!res.ok) throw new Error();
      setData(await res.json() as DashboardData);
    } catch { setError("Errore di caricamento."); }
    finally { setLoading(false); }
  }

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("it-IT") : "—";

  return (
    <div className="rd-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 className="settings-title">Recovery Center</h1>
      </header>

      <div className="rd-body">
        {loading && <div className="rd-loading">Caricamento…</div>}
        {error && <div className="rd-error">{error}</div>}

        {data && (
          <>
            {/* Panoramica sicurezza */}
            <div className="rd-section-title">Stato sicurezza</div>
            <div className="rd-status-grid">
              <div className="rd-status-card">
                <div className="rd-status-label">Phoenix Code</div>
                <StatusBadge ok={data.recovery_card.hasPhoenixCode} />
              </div>
              <div className="rd-status-card">
                <div className="rd-status-label">Emergency ID</div>
                <StatusBadge ok={!!data.recovery_card.emergencyId && data.recovery_card.emergencyId !== "—"} />
              </div>
              <div className="rd-status-card">
                <div className="rd-status-label">Dead Man Switch</div>
                <StatusBadge ok={data.dms.enabled} />
              </div>
              <div className="rd-status-card">
                <div className="rd-status-label">Recovery Contacts</div>
                <StatusBadge ok={data.contacts.length > 0} />
              </div>
            </div>

            {/* Account */}
            <div className="rd-section-title">Account</div>
            <div className="rd-card">
              <div className="rd-row"><span>Username</span><strong>@{data.recovery_card.username}</strong></div>
              <div className="rd-row"><span>Emergency ID</span><strong className="rd-mono">{data.recovery_card.emergencyId}</strong></div>
              <div className="rd-row"><span>Ultimo accesso</span><span>{fmt(data.account.last_seen_at)}</span></div>
              <div className="rd-row"><span>Account creato</span><span>{fmt(data.account.created_at)}</span></div>
            </div>

            {/* Dead Man Switch */}
            <div className="rd-section-title">Dead Man Switch</div>
            <div className="rd-card rd-card--clickable" onClick={() => onNavigate("dead-man-switch")}>
              {data.dms.enabled ? (
                <>
                  <div className="rd-row"><span>Stato</span><span className="rd-state-active">🟢 Attivo</span></div>
                  <div className="rd-row"><span>Periodo</span><span>{data.dms.period_days} giorni</span></div>
                  <div className="rd-row"><span>Grazia</span><span>{data.dms.grace_days} giorni</span></div>
                  <div className="rd-row"><span>Azione</span><span>{data.dms.action}</span></div>
                  {data.dms.days_until_warning !== null && (
                    <div className="rd-row"><span>Avviso tra</span><strong>{data.dms.days_until_warning} giorni</strong></div>
                  )}
                </>
              ) : (
                <div className="rd-row"><span>Stato</span><span className="rd-state-inactive">⚫ Non attivo</span></div>
              )}
              <div className="rd-chevron">›</div>
            </div>

            {/* Recovery Contacts */}
            <div className="rd-section-title">Recovery Contacts ({data.contacts.length}/5)</div>
            <div className="rd-card rd-card--clickable" onClick={() => onNavigate("recovery-contacts")}>
              {data.contacts.length === 0 ? (
                <div className="rd-empty-note">Nessun contatto configurato</div>
              ) : (
                data.contacts.map(c => (
                  <div key={c.id} className="rd-row"><span>{c.name}</span><span className="rd-muted">{c.email}</span></div>
                ))
              )}
              <div className="rd-chevron">›</div>
            </div>

            {/* Sessioni attive */}
            <div className="rd-section-title">Sessioni attive ({data.sessions.length})</div>
            <div className="rd-card">
              {data.sessions.length === 0 ? (
                <div className="rd-empty-note">Nessuna sessione</div>
              ) : (
                data.sessions.map((s, i) => (
                  <div key={i} className="rd-row">
                    <span>{s.device_name || "Dispositivo"}</span>
                    <span className="rd-muted">{s.last_active_at ? fmt(s.last_active_at) : "—"}</span>
                  </div>
                ))
              )}
            </div>

            {/* Azioni rapide */}
            <div className="rd-section-title">Azioni rapide</div>
            <div className="rd-actions">
              <button className="rd-action-btn" onClick={() => onNavigate("phoenix")}>🔑 Phoenix Protocol</button>
              <button className="rd-action-btn" onClick={() => onNavigate("devices")}>📱 Gestisci dispositivi</button>
              <button className="rd-action-btn" onClick={() => onNavigate("security-timeline")}>📋 Timeline sicurezza</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
