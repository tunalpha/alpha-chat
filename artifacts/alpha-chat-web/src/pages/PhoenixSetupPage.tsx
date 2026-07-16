/**
 * PhoenixSetupPage — Sprint 18
 * Configurazione Phoenix Code e Recovery Card (autenticato).
 */

import { useState, useEffect, useRef } from "react";
import RecoveryCard from "../components/RecoveryCard";

interface Props { onBack: () => void; }

interface RecoveryData {
  username: string;
  emergencyId: string;
  hasPhoenixCode: boolean;
  portalUrl: string;
}

const BASE = "/api/v1/phoenix";

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("alpha-chat-access-token");
  return fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

type View = "main" | "setup" | "change" | "card";

export default function PhoenixSetupPage({ onBack }: Props) {
  const [view, setView] = useState<View>("main");
  const [recovery, setRecovery] = useState<RecoveryData | null>(null);
  const [phoenixCode, setPhoenixCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    void loadRecovery();
  }, []);

  async function loadRecovery() {
    try {
      const res = await authFetch("/recovery-card");
      if (res.ok) setRecovery(await res.json());
    } catch { /* non blocca il render */ }
  }

  function showFeedback(type: "ok" | "err", msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3000);
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (phoenixCode.length < 20) {
      showFeedback("err", "Il Phoenix Code deve essere di almeno 20 caratteri.");
      return;
    }
    if (phoenixCode !== confirmCode) {
      showFeedback("err", "I due codici non coincidono.");
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch("/setup", {
        method: "POST",
        body: JSON.stringify({ phoenix_code: phoenixCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        showFeedback("err", data.error?.message ?? "Errore.");
        return;
      }
      showFeedback("ok", `Phoenix Code configurato. Emergency ID: ${data.emergency_id}`);
      setPhoenixCode(""); setConfirmCode("");
      await loadRecovery();
      setView("card");
    } catch {
      showFeedback("err", "Errore di connessione.");
    } finally {
      setLoading(false);
    }
  }

  // ── Setup form ──────────────────────────────────────────────────────────────
  if (view === "setup" || view === "change") {
    return (
      <div className="settings-root">
        <header className="settings-header">
          <button className="settings-back-btn" onClick={() => setView("main")} aria-label="Indietro">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="settings-title">{view === "change" ? "Cambia Phoenix Code" : "Configura Phoenix Code"}</h1>
        </header>
        <div className="settings-body">
          <div className="phoenix-setup-desc">
            Il Phoenix Code è una passphrase segreta di almeno 20 caratteri.
            Salvala in un posto sicuro offline: non è recuperabile e non viene mai trasmessa in chiaro.
          </div>
          <form onSubmit={handleSetup} className="phoenix-setup-form">
            <label className="phoenix-label">Phoenix Code</label>
            <input
              type="password"
              className="phoenix-input"
              value={phoenixCode}
              onChange={(e) => setPhoenixCode(e.target.value)}
              placeholder="Almeno 20 caratteri"
              autoComplete="off"
              required
            />
            <div className="phoenix-strength">
              <div className={`phoenix-strength-bar${phoenixCode.length >= 20 ? " ok" : phoenixCode.length >= 10 ? " mid" : ""}`}
                style={{ width: `${Math.min(100, (phoenixCode.length / 20) * 100)}%` }}
              />
            </div>
            <div className="phoenix-strength-label">
              {phoenixCode.length < 10 ? "Troppo corto" : phoenixCode.length < 20 ? `Ancora ${20 - phoenixCode.length} caratteri` : "✓ Lunghezza sufficiente"}
            </div>

            <label className="phoenix-label">Conferma Phoenix Code</label>
            <input
              type="password"
              className="phoenix-input"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              placeholder="Ripeti il codice"
              autoComplete="off"
              required
            />

            {feedback && (
              <div className={`phoenix-feedback ${feedback.type}`}>{feedback.msg}</div>
            )}

            <button
              type="submit"
              className="phoenix-btn-primary"
              disabled={loading || phoenixCode.length < 20}
            >
              {loading ? "Configurazione…" : "Salva Phoenix Code"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Recovery Card ────────────────────────────────────────────────────────────
  if (view === "card" && recovery) {
    return (
      <div className="settings-root">
        <header className="settings-header">
          <button className="settings-back-btn" onClick={() => setView("main")} aria-label="Indietro">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="settings-title">Recovery Card</h1>
        </header>
        <div className="settings-body" style={{ padding: "16px" }}>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 16 }}>
            Salva o stampa questa card e conservala offline in un posto sicuro.
          </p>
          <RecoveryCard
            username={recovery.username}
            emergencyId={recovery.emergencyId}
            portalUrl={recovery.portalUrl}
          />
          <button
            className="phoenix-btn-secondary"
            style={{ marginTop: 16 }}
            onClick={() => window.print()}
          >
            🖨 Stampa
          </button>
        </div>
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Phoenix Protocol</h1>
      </header>

      {feedback && (
        <div className={`phoenix-feedback-banner ${feedback.type}`}>{feedback.msg}</div>
      )}

      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">Protocollo di emergenza</div>

          <div className="phoenix-banner">
            <div className="phoenix-banner-icon">🔥</div>
            <div>
              <div className="phoenix-banner-title">Phoenix Protocol</div>
              <div className="phoenix-banner-desc">
                Se perdi il dispositivo o il tuo account viene compromesso, puoi bloccare o
                distruggere la tua identità digitale da qualsiasi browser usando il portale
                di emergenza e il tuo Phoenix Code.
              </div>
            </div>
          </div>

          <div
            className="settings-item clickable"
            onClick={() => setView(recovery?.hasPhoenixCode ? "change" : "setup")}
            role="button" tabIndex={0}
          >
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">
                {recovery?.hasPhoenixCode ? "Cambia Phoenix Code" : "Configura Phoenix Code"}
              </div>
              <div className="settings-item-value muted">
                {recovery?.hasPhoenixCode ? "Phoenix Code attivo ✓" : "Non configurato — richiesto per il portale di emergenza"}
              </div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron"><polyline points="9 18 15 12 9 6"/></svg>
          </div>

          {recovery?.hasPhoenixCode && (
            <div
              className="settings-item clickable"
              onClick={() => setView("card")}
              role="button" tabIndex={0}
            >
              <div className="settings-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <div className="settings-item-content">
                <div className="settings-item-label">Recovery Card</div>
                <div className="settings-item-value muted">
                  ID: {recovery.emergencyId}
                </div>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          )}

          <div
            className="settings-item clickable"
            onClick={() => { window.open("/emergency", "_blank"); }}
            role="button" tabIndex={0}
          >
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">Portale di emergenza</div>
              <div className="settings-item-value muted">alphachat.sbs/emergency</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      </div>
    </div>
  );
}
