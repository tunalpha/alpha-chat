/**
 * LandingPage — prima schermata per utenti non autenticati.
 * Filosofia "bunker digitale": privacy by design, zero tracking, zero knowledge.
 * Il form di login/registrazione è accessibile cliccando l'icona profilo in alto a destra.
 */

import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export default function LandingPage() {
  const { login, register } = useAuth();
  const [showAuth, setShowAuth]   = useState(false);
  const [tab, setTab]             = useState<"login" | "register">("login");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);

  // Login
  const [loginId, setLoginId]     = useState("");
  const [loginPwd, setLoginPwd]   = useState("");
  const [showLoginPwd, setShowLoginPwd] = useState(false);

  // Register
  const [regUser, setRegUser]     = useState("");
  const [regName, setRegName]     = useState("");
  const [regPwd, setRegPwd]       = useState("");
  const [showRegPwd, setShowRegPwd]   = useState(false);

  function openAuth(defaultTab: "login" | "register" = "login") {
    setTab(defaultTab);
    setError("");
    setShowAuth(true);
  }

  function closeAuth() {
    setShowAuth(false);
    setError("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try { await login({ identifier: loginId, password: loginPwd }); }
    catch (err) { setError((err as Error).message ?? "Errore di accesso"); }
    finally { setLoading(false); }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try { await register({ username: regUser, display_name: regName, password: regPwd }); }
    catch (err) { setError((err as Error).message ?? "Errore di registrazione"); }
    finally { setLoading(false); }
  }

  const EyeIcon = ({ open }: { open: boolean }) => open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );

  return (
    <div className="landing">
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="landing-header">
        <div className="landing-logo-small">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="α" width="28" height="28" />
          <span>Alpha Chat</span>
        </div>
        <button
          className="landing-profile-btn"
          onClick={() => openAuth("login")}
          aria-label="Accedi o registrati"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </button>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <main className="landing-hero">
        {/* Sfondo decorativo */}
        <div className="landing-grid" aria-hidden="true">
          {Array.from({ length: 80 }).map((_, i) => (
            <div key={i} className="landing-grid-dot" />
          ))}
        </div>

        {/* Shield decorativo */}
        <div className="landing-shield" aria-hidden="true">
          <svg viewBox="0 0 120 140" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M60 4L8 26v44c0 30 22 56 52 66 30-10 52-36 52-66V26L60 4z"
              fill="url(#shieldGrad)"
              opacity="0.18"
            />
            <path
              d="M60 4L8 26v44c0 30 22 56 52 66 30-10 52-36 52-66V26L60 4z"
              stroke="url(#shieldGrad)"
              strokeWidth="2"
              opacity="0.5"
            />
            <defs>
              <linearGradient id="shieldGrad" x1="60" y1="4" x2="60" y2="136" gradientUnits="userSpaceOnUse">
                <stop stopColor="#7C3AED"/>
                <stop offset="1" stopColor="#C026D3"/>
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div className="landing-content">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Alpha Chat"
            className="landing-main-logo"
          />
          <h1 className="landing-title">Alpha Chat</h1>
          <p className="landing-tagline">Il tuo bunker digitale</p>
          <p className="landing-desc">
            Standard di sicurezza di livello militare.<br/>
            Comunicazioni protette. Nessun compromesso.
          </p>

          <div className="landing-badges">
            <span className="landing-badge">🔒 E2E cifrato</span>
            <span className="landing-badge">👁 Zero tracking</span>
            <span className="landing-badge">🛡 Privacy by design</span>
          </div>

          <div className="landing-cta-row">
            <button className="landing-cta-primary" onClick={() => openAuth("register")}>
              Crea account
            </button>
            <button className="landing-cta-secondary" onClick={() => openAuth("login")}>
              Accedi
            </button>
          </div>
        </div>
      </main>

      {/* ── Auth modal / bottom sheet ─────────────────────────────────────── */}
      {showAuth && (
        <div className="auth-modal-overlay" onClick={closeAuth}>
          <div className="auth-modal-sheet" onClick={(e) => e.stopPropagation()}>
            {/* Handle per il drag (visuale) */}
            <div className="auth-modal-handle" />

            {/* Close */}
            <button className="auth-modal-close" onClick={closeAuth} aria-label="Chiudi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            {/* Logo */}
            <div className="auth-modal-logo">
              <img src={`${import.meta.env.BASE_URL}logo.png`} alt="α" width="44" height="44" style={{ borderRadius: "50%" }} />
              <span>Alpha Chat</span>
            </div>

            {/* Tabs */}
            <div className="auth-tabs">
              <button className={`auth-tab ${tab === "login" ? "active" : ""}`}
                onClick={() => { setTab("login"); setError(""); }}>Accedi</button>
              <button className={`auth-tab ${tab === "register" ? "active" : ""}`}
                onClick={() => { setTab("register"); setError(""); }}>Registrati</button>
            </div>

            {error && <div className="auth-error">{error}</div>}

            {/* Login */}
            {tab === "login" && (
              <form onSubmit={handleLogin} className="auth-form">
                <label className="auth-label">Username o Email</label>
                <input className="auth-input" type="text" value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="marco" required autoFocus
                  autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} />

                <label className="auth-label">Password</label>
                <div className="pwd-wrapper">
                  <input className="auth-input pwd-input"
                    type={showLoginPwd ? "text" : "password"}
                    value={loginPwd}
                    onChange={(e) => setLoginPwd(e.target.value)}
                    placeholder="••••••••" required autoComplete="current-password" />
                  <button type="button" className="pwd-toggle"
                    aria-label={showLoginPwd ? "Nascondi" : "Mostra"}
                    onClick={() => setShowLoginPwd((v) => !v)}>
                    <EyeIcon open={showLoginPwd} />
                  </button>
                </div>

                <button className="auth-btn" type="submit" disabled={loading}>
                  {loading ? "Accesso…" : "Accedi"}
                </button>
              </form>
            )}

            {/* Register */}
            {tab === "register" && (
              <form onSubmit={handleRegister} className="auth-form">
                <label className="auth-label">Username</label>
                <input className="auth-input" type="text" value={regUser}
                  onChange={(e) => setRegUser(e.target.value.toLowerCase())}
                  placeholder="mario_rossi" pattern="[a-z0-9_.]+"
                  minLength={3} maxLength={32} required autoFocus
                  autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} />

                <label className="auth-label">Nome visualizzato</label>
                <input className="auth-input" type="text" value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Mario Rossi" minLength={1} maxLength={50} required />

                <label className="auth-label">Password</label>
                <div className="pwd-wrapper">
                  <input className="auth-input pwd-input"
                    type={showRegPwd ? "text" : "password"}
                    value={regPwd}
                    onChange={(e) => setRegPwd(e.target.value)}
                    placeholder="Min. 8 caratteri" minLength={8} required
                    autoComplete="new-password" />
                  <button type="button" className="pwd-toggle"
                    aria-label={showRegPwd ? "Nascondi" : "Mostra"}
                    onClick={() => setShowRegPwd((v) => !v)}>
                    <EyeIcon open={showRegPwd} />
                  </button>
                </div>

                <button className="auth-btn" type="submit" disabled={loading}>
                  {loading ? "Registrazione…" : "Crea account"}
                </button>
              </form>
            )}

            <p className="auth-hint">
              {tab === "login" ? "Non hai un account? " : "Hai già un account? "}
              <button className="auth-link"
                onClick={() => { setTab(tab === "login" ? "register" : "login"); setError(""); }}>
                {tab === "login" ? "Registrati" : "Accedi"}
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
