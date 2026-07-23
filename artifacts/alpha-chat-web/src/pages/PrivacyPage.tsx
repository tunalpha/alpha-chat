import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  apiGetPrivacySettings,
  apiUpdatePrivacySettings,
  apiListBlocked,
  apiUnblockUser,
  type PrivacySettings,
  type BlockedUserEntry,
} from "../lib/api";
import { useLock } from "../contexts/LockContext";
import { TIMEOUT_OPTIONS } from "../lib/security/lock-settings";

interface Props { onBack: () => void; }

type Visibility = "everyone" | "contacts" | "nobody";

function VisibilitySelect({
  value,
  onChange,
  disabled,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("privacy");
  const VISIBILITY_LABELS: Record<Visibility, string> = {
    everyone: t("everyone"),
    contacts: t("contacts"),
    nobody:   t("nobody"),
  };
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

// Subset dei timeout mostrati nella sezione Face ID (come richiesto)
const FACE_ID_TIMEOUT_OPTIONS = TIMEOUT_OPTIONS.filter((o) =>
  [0, 60_000, 5 * 60_000, 15 * 60_000].includes(o.ms),
);

export default function PrivacyPage({ onBack }: Props) {
  const { t } = useTranslation("privacy");

  // ── Lock / biometria ──────────────────────────────────────────────────────
  const {
    canUseBiometric,
    biometricOnlyEnabled,
    enableBiometricOnly,
    disableBiometricOnly,
    settings: lockSettings,
    changeSettings: changeLockSettings,
  } = useLock();
  const [bioLoading, setBioLoading]   = useState(false);
  const [bioFeedback, setBioFeedback] = useState<string | null>(null);

  async function handleFaceIdToggle() {
    setBioFeedback(null);
    if (biometricOnlyEnabled) {
      disableBiometricOnly();
      setBioFeedback(t("faceIdDisabled"));
      setTimeout(() => setBioFeedback(null), 2500);
    } else {
      setBioLoading(true);
      const ok = await enableBiometricOnly();
      setBioLoading(false);
      if (!ok) setBioFeedback(t("faceIdNotAvailable"));
    }
  }

  // ── Privacy settings (backend) ────────────────────────────────────────────
  const [settings, setSettings]   = useState<PrivacySettings | null>(null);
  const [blocked, setBlocked]     = useState<BlockedUserEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [unblockedIds, setUnblockedIds] = useState<Set<string>>(new Set());
  const [preciseLoc, setPreciseLoc]     = useState(
    () => localStorage.getItem("ac_precise_location") !== "false"
  );

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
        setError(t("errorLoad"));
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
      setError(t("errorSave"));
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
      setError(t("errorUnblock"));
    }
  }

  if (loading) {
    return (
      <div className="settings-root">
        <header className="settings-header">
          <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="settings-title">{t("titleFull")}</h1>
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
          <h1 className="settings-title">{t("titleFull")}</h1>
        </header>
        <div className="settings-body">
          <p style={{ color: "var(--danger)", textAlign: "center", paddingTop: 32 }}>
            {error ?? t("errorUnknown")}
          </p>
        </div>
      </div>
    );
  }

  const ghostMode = settings.ghost_mode;

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">{t("titleFull")}</h1>
      </header>

      <div className="settings-body">

        {/* ── Posizione ──────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section-title">{t("sectionLocation")}</div>
          <div className="settings-item">
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">{t("preciseLocation")}</div>
              <div className="settings-item-value muted">
                {preciseLoc
                  ? t("locationGps")
                  : t("locationRounded")}
              </div>
            </div>
            <Toggle
              checked={preciseLoc}
              onChange={(on) => {
                localStorage.setItem("ac_precise_location", on ? "true" : "false");
                setPreciseLoc(on);
              }}
              disabled={saving}
            />
          </div>
        </div>

        {/* ── Face ID / Touch ID ─────────────────────────────────────────── */}
        {canUseBiometric && (
          <div className="settings-section">
            <div className="settings-section-title">{t("sectionFaceId")}</div>

            {bioFeedback && (
              <div className="privacy-error-banner" style={{ background: "var(--accent-alpha, rgba(99,102,241,.12))", borderColor: "var(--accent)" }}>
                <span>✓ {bioFeedback}</span>
                <button onClick={() => setBioFeedback(null)}>✕</button>
              </div>
            )}

            {/* Toggle principale */}
            <div className="settings-item">
              <div className="settings-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1z"/>
                  <path d="M8.5 9.5c0-1.933 1.567-3.5 3.5-3.5s3.5 1.567 3.5 3.5"/>
                  <path d="M6 12c0-3.314 2.686-6 6-6s6 2.686 6 6"/>
                  <path d="M3.5 12c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5"/>
                  <circle cx="12" cy="12" r="1"/>
                </svg>
              </div>
              <div className="settings-item-content">
                <div className="settings-item-label">{t("enableFaceId")}</div>
                <div className="settings-item-value muted">
                  {bioLoading
                    ? t("faceIdConfiguring")
                    : biometricOnlyEnabled
                      ? t("faceIdActive")
                      : t("faceIdSubtitle")}
                </div>
              </div>
              <Toggle
                checked={biometricOnlyEnabled}
                onChange={() => { void handleFaceIdToggle(); }}
                disabled={bioLoading}
              />
            </div>

            {/* Timeout — visibile solo quando Face ID è attivo */}
            {biometricOnlyEnabled && (
              <div className="settings-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                <div className="settings-item-label">{t("requireAfterInactivity")}</div>
                <div className="security-timeout-grid">
                  {FACE_ID_TIMEOUT_OPTIONS.map((opt) => (
                    <button
                      key={opt.ms}
                      className={`security-timeout-chip${lockSettings.autoLockMs === opt.ms ? " active" : ""}`}
                      onClick={() => changeLockSettings({ autoLockMs: opt.ms })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="privacy-faceid-note">
              {t("faceIdNote")}
            </div>
          </div>
        )}

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
            <div className="privacy-ghost-title">{t("ghostModeTitle")}</div>
            <div className="privacy-ghost-desc">
              {ghostMode
                ? t("ghostModeActive")
                : t("ghostModeInactive")}
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
          <div className="settings-section-title">{t("sectionVisibility")}</div>

          <div className="settings-item">
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">{t("lastSeen")}</div>
              <div className="settings-item-value muted">{t("lastSeenDesc")}</div>
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
              <div className="settings-item-label">{t("onlineStatus")}</div>
              <div className="settings-item-value muted">{t("onlineStatusDesc")}</div>
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
              <div className="settings-item-label">{t("readReceipts")}</div>
              <div className="settings-item-value muted">{t("readReceiptsDesc")}</div>
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
          <div className="settings-section-title">{t("sectionPermissions")}</div>

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
              <div className="settings-item-label">{t("addToGroups")}</div>
              <div className="settings-item-value muted">{t("addToGroupsDesc")}</div>
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
              <div className="settings-item-label">{t("callsTitle")}</div>
              <div className="settings-item-value muted">{t("callsDesc")}</div>
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
            {t("sectionBlocked")}
            {blocked.length > 0 && (
              <span className="privacy-blocked-count">{blocked.length}</span>
            )}
          </div>

          {blocked.length === 0 ? (
            <div className="privacy-blocked-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32" style={{ opacity: 0.3 }}>
                <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
              <span>{t("noBlocked")}</span>
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
                  {t("unblock")}
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
            {t("e2eNote")}
          </p>
        </div>

      </div>
    </div>
  );
}
