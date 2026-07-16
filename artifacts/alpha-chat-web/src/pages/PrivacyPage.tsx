import { useState, useEffect } from "react";
import {
  apiGetPrivacySettings,
  apiUpdatePrivacySettings,
  apiListBlocked,
  apiUnblockUser,
  type PrivacySettings,
  type BlockedUserEntry,
} from "../lib/api";

interface Props { onBack: () => void; }

type Visibility = "everyone" | "contacts" | "nobody";

const VISIBILITY_LABELS: Record<Visibility, string> = {
  everyone: "Tutti",
  contacts: "Contatti",
  nobody:   "Nessuno",
};

function VisibilitySelect({
  value,
  onChange,
  disabled,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="privacy-select"
      value={value}
      onChange={(e) => onChange(e.target.value as Visibility)}
      disabled={disabled}
    >
      {(["everyone", "contacts", "nobody"] as Visibility[]).map((v) => (
        <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`privacy-toggle${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      aria-checked={checked}
      role="switch"
    >
      <span className="privacy-toggle-thumb" />
    </button>
  );
}

export default function PrivacyPage({ onBack }: Props) {
  const [settings, setSettings]   = useState<PrivacySettings | null>(null);
  const [blocked, setBlocked]     = useState<BlockedUserEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [unblockedIds, setUnblockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [priv, bl] = await Promise.all([
          apiGetPrivacySettings(),
          apiListBlocked(),
        ]);
        setSettings(priv);
        setBlocked(bl);
      } catch {
        setError("Impossibile caricare le impostazioni privacy");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function patch(partial: Partial<PrivacySettings & { ghost_mode: boolean }>) {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiUpdatePrivacySettings(partial);
      setSettings(updated);
    } catch {
      setError("Salvataggio fallito — riprova");
    } finally {
      setSaving(false);
    }
  }

  async function handleGhostMode(on: boolean) {
    await patch({ ghost_mode: on });
  }

  async function handleUnblock(userId: string) {
    setUnblockedIds((prev) => new Set(prev).add(userId));
    try {
      await apiUnblockUser(userId);
      setBlocked((prev) => prev.filter((b) => b.user_id !== userId));
    } catch {
      setUnblockedIds((prev) => { const s = new Set(prev); s.delete(userId); return s; });
      setError("Impossibile sbloccare l'utente");
    }
  }

  if (loading) {
    return (
      <div className="settings-root">
        <header className="settings-header">
          <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="settings-title">Privacy e Sicurezza</h1>
        </header>
        <div className="settings-body" style={{ display: "flex", justifyContent: "center", paddingTop: 48 }}>
          <div className="privacy-loading-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="settings-root">
        <header className="settings-header">
          <button className="settings-back-btn" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="settings-title">Privacy e Sicurezza</h1>
        </header>
        <div className="settings-body">
          <p style={{ color: "var(--danger)", textAlign: "center", paddingTop: 32 }}>
            {error ?? "Errore sconosciuto"}
          </p>
        </div>
      </div>
    );
  }

  const ghostMode = settings.ghost_mode;

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Privacy e Sicurezza</h1>
      </header>

      <div className="settings-body">

        {/* Error banner */}
        {error && (
          <div className="privacy-error-banner">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* ── Ghost Mode ─────────────────────────────────────────────────── */}
        <div className={`privacy-ghost-card${ghostMode ? " active" : ""}`}>
          <div className="privacy-ghost-icon">
            {ghostMode ? "👻" : "🔮"}
          </div>
          <div className="privacy-ghost-content">
            <div className="privacy-ghost-title">Modalità Ghost</div>
            <div className="privacy-ghost-desc">
              {ghostMode
                ? "Sei invisibile — nessuno può vedere la tua presenza, letture o stato"
                : "Attiva per diventare completamente invisibile in un click"}
            </div>
          </div>
          <Toggle
            checked={ghostMode}
            onChange={handleGhostMode}
            disabled={saving}
          />
        </div>

        {/* ── Visibilità ─────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section-title">Visibilità</div>

          <div className="settings-item">
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">Ultimo accesso</div>
              <div className="settings-item-value muted">Chi può vedere quando sei stato online</div>
            </div>
            <VisibilitySelect
              value={settings.show_last_seen}
              onChange={(v) => void patch({ show_last_seen: v })}
              disabled={saving || ghostMode}
            />
          </div>

          <div className="settings-item">
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="3" fill="currentColor"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">Stato online</div>
              <div className="settings-item-value muted">Chi può vedere che sei online ora</div>
            </div>
            <VisibilitySelect
              value={settings.show_online_status}
              onChange={(v) => void patch({ show_online_status: v })}
              disabled={saving || ghostMode}
            />
          </div>

          <div className="settings-item">
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">Ricevute di lettura</div>
              <div className="settings-item-value muted">Mostra ✓✓ quando leggi i messaggi</div>
            </div>
            <Toggle
              checked={settings.show_read_receipts}
              onChange={(v) => void patch({ show_read_receipts: v })}
              disabled={saving || ghostMode}
            />
          </div>
        </div>

        {/* ── Permessi ───────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section-title">Permessi</div>

          <div className="settings-item">
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">Aggiunta ai gruppi</div>
              <div className="settings-item-value muted">Chi può aggiungerti nei gruppi</div>
            </div>
            <VisibilitySelect
              value={settings.allow_adding_to_groups}
              onChange={(v) => void patch({ allow_adding_to_groups: v })}
              disabled={saving || ghostMode}
            />
          </div>

          <div className="settings-item">
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">Chiamate</div>
              <div className="settings-item-value muted">Chi può chiamarti</div>
            </div>
            <VisibilitySelect
              value={settings.allow_calls_from}
              onChange={(v) => void patch({ allow_calls_from: v })}
              disabled={saving || ghostMode}
            />
          </div>
        </div>

        {/* ── Utenti bloccati ────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section-title">
            Utenti bloccati
            {blocked.length > 0 && (
              <span className="privacy-blocked-count">{blocked.length}</span>
            )}
          </div>

          {blocked.length === 0 ? (
            <div className="privacy-blocked-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32" style={{ opacity: 0.3 }}>
                <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
              <span>Nessun utente bloccato</span>
            </div>
          ) : (
            blocked.map((b) => (
              <div key={b.user_id} className={`settings-item${unblockedIds.has(b.user_id) ? " privacy-unblocking" : ""}`}>
                <div className="avatar avatar-sm">
                  {b.display_name[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="settings-item-content">
                  <div className="settings-item-label">{b.display_name}</div>
                  <div className="settings-item-value muted">@{b.username}</div>
                </div>
                <button
                  className="privacy-unblock-btn"
                  onClick={() => void handleUnblock(b.user_id)}
                  disabled={unblockedIds.has(b.user_id)}
                >
                  Sblocca
                </button>
              </div>
            ))
          )}
        </div>

        {/* ── Info ───────────────────────────────────────────────────────── */}
        <div className="privacy-hero" style={{ marginTop: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <p className="privacy-hero-text">
            Le tue conversazioni sono protette con crittografia end-to-end. Il server non legge mai i tuoi messaggi.
          </p>
        </div>

      </div>
    </div>
  );
}
