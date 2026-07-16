/**
 * SecuritySettingsPage — Sprint 17
 * Impostazioni PIN, biometria, timeout, panic mode.
 */

import { useState, useEffect } from "react";
import { useLock } from "../contexts/LockContext";
import { useAuth } from "../contexts/AuthContext";
import PinPad from "../components/PinPad";
import { TIMEOUT_OPTIONS } from "../lib/security/lock-settings";

interface Props {
  onBack: () => void;
}

type SubView = "main" | "setup-pin-new" | "setup-pin-confirm" | "change-pin-old" | "change-pin-new" | "change-pin-confirm";

export default function SecuritySettingsPage({ onBack }: Props) {
  const { auth } = useAuth();
  const {
    hasPINSet,
    hasBiometricSet,
    canUseBiometric,
    settings,
    changeSettings,
    setupNewPIN,
    enableBiometric,
    disableBiometric,
    clearPIN,
    tryUnlockWithPIN,
    lock,
  } = useLock();

  const [subView, setSubView] = useState<SubView>("main");
  const [pendingPIN, setPendingPIN] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [bioLoading, setBioLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  // --- PIN Setup ---
  const handleNewPIN = (pin: string) => {
    setPinError(null);
    setPendingPIN(pin);
    setSubView("setup-pin-confirm");
  };

  const handleConfirmPIN = async (pin: string) => {
    if (pin !== pendingPIN) {
      setPinError("I PIN non coincidono. Riprova.");
      setSubView("setup-pin-new");
      setPendingPIN("");
      return;
    }
    await setupNewPIN(pin);
    setPendingPIN("");
    setSubView("main");
    showFeedback("PIN impostato con successo ✓");
    // Blocca subito l'app per confermare il funzionamento
    setTimeout(() => lock(), 800);
  };

  // --- Change PIN ---
  const handleOldPIN = async (pin: string) => {
    if (!auth?.userId) return;
    const ok = await tryUnlockWithPIN(pin);
    if (!ok) {
      setPinError("PIN errato.");
      return;
    }
    setPinError(null);
    setSubView("change-pin-new");
  };

  const handleChangePINNew = (pin: string) => {
    setPinError(null);
    setPendingPIN(pin);
    setSubView("change-pin-confirm");
  };

  const handleChangePINConfirm = async (pin: string) => {
    if (pin !== pendingPIN) {
      setPinError("I PIN non coincidono.");
      setSubView("change-pin-new");
      setPendingPIN("");
      return;
    }
    await setupNewPIN(pin);
    setPendingPIN("");
    setSubView("main");
    showFeedback("PIN aggiornato ✓");
  };

  // --- Biometria ---
  const handleBioToggle = async () => {
    if (hasBiometricSet) {
      disableBiometric();
      showFeedback("Biometria disabilitata");
    } else {
      setBioLoading(true);
      const ok = await enableBiometric();
      setBioLoading(false);
      if (ok) {
        showFeedback("Biometria abilitata ✓");
      } else {
        showFeedback("Biometria non disponibile su questo dispositivo");
      }
    }
  };

  // --- Sub-views (PIN pad) ---
  if (subView !== "main") {
    const config: Record<SubView, { label: string; onComplete: (p: string) => void }> = {
      "setup-pin-new":     { label: "Scegli un PIN a 6 cifre", onComplete: handleNewPIN },
      "setup-pin-confirm": { label: "Conferma il PIN",          onComplete: handleConfirmPIN },
      "change-pin-old":    { label: "Inserisci il PIN attuale", onComplete: handleOldPIN },
      "change-pin-new":    { label: "Scegli il nuovo PIN",      onComplete: handleChangePINNew },
      "change-pin-confirm":{ label: "Conferma il nuovo PIN",    onComplete: handleChangePINConfirm },
      main: { label: "", onComplete: () => {} },
    };
    const { label, onComplete } = config[subView];

    return (
      <div className="settings-root">
        <header className="settings-header">
          <button
            className="settings-back-btn"
            onClick={() => { setSubView("main"); setPinError(null); setPendingPIN(""); }}
            aria-label="Indietro"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="settings-title">Sicurezza</h1>
        </header>
        <div className="settings-body" style={{ justifyContent: "center", alignItems: "center", display: "flex", flex: 1 }}>
          <PinPad
            label={label}
            onComplete={onComplete}
            error={pinError}
          />
        </div>
      </div>
    );
  }

  // --- Main ---
  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Sicurezza dispositivo</h1>
      </header>

      {feedback && <div className="security-feedback">{feedback}</div>}

      <div className="settings-body">

        {/* PIN */}
        <div className="settings-section">
          <div className="settings-section-title">Blocco app</div>

          <div
            className="settings-item"
            onClick={() => setSubView(hasPINSet ? "change-pin-old" : "setup-pin-new")}
            role="button"
            tabIndex={0}
          >
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">{hasPINSet ? "Cambia PIN" : "Imposta PIN"}</div>
              <div className="settings-item-value muted">
                {hasPINSet ? "PIN di sblocco attivo" : "Proteggi l'app con un PIN a 6 cifre"}
              </div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>

          {hasPINSet && (
            <div
              className="settings-item danger"
              onClick={() => { if (confirm("Rimuovere il PIN? L'app non sarà più protetta.")) { clearPIN(); showFeedback("PIN rimosso"); } }}
              role="button"
              tabIndex={0}
            >
              <div className="settings-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </div>
              <div className="settings-item-content">
                <div className="settings-item-label">Rimuovi PIN</div>
              </div>
            </div>
          )}
        </div>

        {/* Biometria — solo se il PIN è impostato */}
        {hasPINSet && canUseBiometric && (
          <div className="settings-section">
            <div className="settings-section-title">Biometria</div>
            <div className="settings-item" onClick={handleBioToggle} role="button" tabIndex={0}>
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
                <div className="settings-item-label">Face ID / Touch ID</div>
                <div className="settings-item-value muted">
                  {bioLoading ? "Configurazione…" : hasBiometricSet ? "Attivo" : "Non configurato"}
                </div>
              </div>
              <div className={`security-toggle${hasBiometricSet ? " on" : ""}`} aria-checked={hasBiometricSet} role="switch">
                <div className="security-toggle-thumb" />
              </div>
            </div>
          </div>
        )}

        {/* Timeout */}
        {hasPINSet && (
          <div className="settings-section">
            <div className="settings-section-title">Blocco automatico</div>
            <div className="settings-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
              <div className="settings-item-label">Blocca dopo</div>
              <div className="security-timeout-grid">
                {TIMEOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt.ms}
                    className={`security-timeout-chip${settings.autoLockMs === opt.ms ? " active" : ""}`}
                    onClick={() => changeSettings({ autoLockMs: opt.ms })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </div>
              <div className="settings-item-content">
                <div className="settings-item-label">Schermata privacy</div>
                <div className="settings-item-value muted">Nascondi contenuto in background</div>
              </div>
              <button
                className={`security-toggle${settings.privacyScreen ? " on" : ""}`}
                onClick={() => changeSettings({ privacyScreen: !settings.privacyScreen })}
                aria-checked={settings.privacyScreen}
                role="switch"
              >
                <div className="security-toggle-thumb" />
              </button>
            </div>
          </div>
        )}

        {/* Panic Mode */}
        {hasPINSet && (
          <div className="settings-section">
            <div className="settings-section-title">Emergency</div>
            <div className="settings-item">
              <div className="settings-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </div>
              <div className="settings-item-content">
                <div className="settings-item-label">Panic Mode</div>
                <div className="settings-item-value muted">
                  Tieni premuto il lucchetto 3s per bloccare e cancellare la sessione
                </div>
              </div>
              <button
                className={`security-toggle${settings.panicEnabled ? " on" : ""}`}
                onClick={() => changeSettings({ panicEnabled: !settings.panicEnabled })}
                aria-checked={settings.panicEnabled}
                role="switch"
              >
                <div className="security-toggle-thumb" />
              </button>
            </div>
          </div>
        )}

        {!hasPINSet && (
          <div className="security-empty-hint">
            Imposta un PIN per abilitare il blocco automatico, la biometria e la schermata privacy.
          </div>
        )}
      </div>
    </div>
  );
}
