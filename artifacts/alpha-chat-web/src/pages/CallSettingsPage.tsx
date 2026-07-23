/**
 * CallSettingsPage — Sprint 25
 * Impostazioni chiamate: chi può chiamarmi, suoneria, modalità silenziosa.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import { apiGetPrivacySettings, apiUpdatePrivacySettings } from "../lib/api";
import { getRingtone, setRingtone, RINGTONES, playRingPreview, type RingtoneId } from "../lib/notifSound";

interface Props {
  onBack: () => void;
}

export default function CallSettingsPage({ onBack }: Props) {
  const { t } = useTranslation("calls");
  const { auth } = useAuth();
  const [allowCallsFrom, setAllowCallsFrom] = useState<"everyone" | "contacts" | "nobody">("contacts");
  const [ringtone, setRingtoneState]         = useState<RingtoneId>(getRingtone());
  const [saving, setSaving]                  = useState(false);
  const [saved, setSaved]                    = useState(false);

  useEffect(() => {
    if (!auth) return;
    apiGetPrivacySettings().then((s) => {
      if (s.allow_calls_from) setAllowCallsFrom(s.allow_calls_from as "everyone" | "contacts" | "nobody");
    }).catch(() => {});
  }, [auth]);

  async function saveCallsFrom(val: "everyone" | "contacts" | "nobody") {
    setAllowCallsFrom(val);
    setSaving(true);
    try {
      await apiUpdatePrivacySettings({ allow_calls_from: val });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  function handleRingtoneChange(id: RingtoneId) {
    setRingtone(id);
    setRingtoneState(id);
    void playRingPreview(id);
  }

  const WHO_OPTIONS = [
    { value: "everyone" as const, icon: "🌐", label: t("whoEveryone"), desc: t("whoEveryoneDesc") },
    { value: "contacts" as const, icon: "👥", label: t("whoContacts"),  desc: t("whoContactsDesc") },
    { value: "nobody"   as const, icon: "🚫", label: t("whoNobody"),    desc: t("whoNobodyDesc") },
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
        <h1 className="settings-title">{t("settingsTitle")}</h1>
        {saved && <span className="settings-saved-badge">✓ {t("saved", "Saved")}</span>}
      </header>

      {/* Chi può chiamarmi */}
      <div className="settings-section">
        <div className="settings-section-title">{t("whoCanCall")}</div>
        {WHO_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`settings-item settings-item-radio${allowCallsFrom === opt.value ? " selected" : ""}`}
            onClick={() => void saveCallsFrom(opt.value)}
            disabled={saving}
          >
            <div className="settings-item-icon">{opt.icon}</div>
            <div className="settings-item-content">
              <div className="settings-item-label">{opt.label}</div>
              <div className="settings-item-value muted">{opt.desc}</div>
            </div>
            {allowCallsFrom === opt.value && <span className="settings-check">✓</span>}
          </button>
        ))}
      </div>

      {/* Suoneria */}
      <div className="settings-section">
        <div className="settings-section-title">{t("ringtone")}</div>
        {RINGTONES.map((rt) => (
          <button
            key={rt.id}
            className={`settings-item settings-item-radio${ringtone === rt.id ? " selected" : ""}`}
            onClick={() => handleRingtoneChange(rt.id)}
          >
            <div className="settings-item-icon">🔔</div>
            <div className="settings-item-content">
              <div className="settings-item-label">{rt.label}</div>
            </div>
            {ringtone === rt.id && <span className="settings-check">✓</span>}
          </button>
        ))}
      </div>

      {/* Modalità silenziosa */}
      <div className="settings-section">
        <div className="settings-section-title">{t("dndTitle")}</div>
        <button
          className={`settings-item settings-item-radio${allowCallsFrom === "nobody" ? " selected" : ""}`}
          onClick={() => void saveCallsFrom("nobody")}
          disabled={saving}
        >
          <div className="settings-item-icon">🌙</div>
          <div className="settings-item-content">
            <div className="settings-item-label">{t("dndLabel")}</div>
            <div className="settings-item-value muted">{t("dndDesc")}</div>
          </div>
          {allowCallsFrom === "nobody" && <span className="settings-check">✓</span>}
        </button>
      </div>
    </div>
  );
}
