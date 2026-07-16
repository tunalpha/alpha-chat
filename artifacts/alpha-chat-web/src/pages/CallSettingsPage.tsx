/**
 * CallSettingsPage — Sprint 25
 * Impostazioni chiamate: chi può chiamarmi, suoneria, modalità silenziosa.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { apiGetPrivacySettings, apiUpdatePrivacySettings } from "../lib/api";
import { getRingtone, setRingtone, RINGTONES, playRingPreview, type RingtoneId } from "../lib/notifSound";

interface Props {
  onBack: () => void;
}

export default function CallSettingsPage({ onBack }: Props) {
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

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Impostazioni chiamate</h1>
        {saved && <span className="settings-saved-badge">✓ Salvato</span>}
      </header>

      {/* Chi può chiamarmi */}
      <div className="settings-section">
        <div className="settings-section-title">Chi può chiamarmi</div>
        {(["everyone", "contacts", "nobody"] as const).map((opt) => (
          <button
            key={opt}
            className={`settings-item settings-item-radio${allowCallsFrom === opt ? " selected" : ""}`}
            onClick={() => void saveCallsFrom(opt)}
            disabled={saving}
          >
            <div className="settings-item-icon">
              {opt === "everyone" ? "🌐" : opt === "contacts" ? "👥" : "🚫"}
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">
                {opt === "everyone" ? "Tutti" : opt === "contacts" ? "Solo contatti" : "Nessuno"}
              </div>
              <div className="settings-item-value muted">
                {opt === "everyone"  ? "Chiunque può chiamarti" :
                 opt === "contacts"  ? "Solo utenti con cui hai conversato" :
                 "Nessuno può chiamarti"}
              </div>
            </div>
            {allowCallsFrom === opt && <span className="settings-check">✓</span>}
          </button>
        ))}
      </div>

      {/* Suoneria */}
      <div className="settings-section">
        <div className="settings-section-title">Suoneria</div>
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
        <div className="settings-section-title">Modalità silenziosa</div>
        <button
          className={`settings-item settings-item-radio${allowCallsFrom === "nobody" ? " selected" : ""}`}
          onClick={() => void saveCallsFrom("nobody")}
          disabled={saving}
        >
          <div className="settings-item-icon">🌙</div>
          <div className="settings-item-content">
            <div className="settings-item-label">Non disturbare</div>
            <div className="settings-item-value muted">Blocca tutte le chiamate in arrivo</div>
          </div>
          {allowCallsFrom === "nobody" && <span className="settings-check">✓</span>}
        </button>
      </div>
    </div>
  );
}
