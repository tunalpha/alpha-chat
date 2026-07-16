import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import RecoveryCardModal, { type RecoveryCardData } from "../components/RecoveryCardModal";
import type { RecoveryCardPayload } from "../lib/api";

interface Props {
  onRecover?: () => void;
}

export default function AuthPage({ onRecover }: Props) {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryCard, setRecoveryCard] = useState<RecoveryCardData | null>(null);

  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPwd, setShowLoginPwd] = useState(false);

  // Register form state
  const [regUsername, setRegUsername] = useState("");
  const [regDisplayName, setRegDisplayName] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [showRegPwd, setShowRegPwd] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login({ identifier: loginIdentifier, password: loginPassword });
    } catch (err: unknown) {
      setError((err as Error).message ?? "Errore di accesso");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await register({ username: regUsername, display_name: regDisplayName, password: regPassword });
      // Sprint 22: mostra Recovery Card se presente
      if (result?.recovery_card) {
        const rc = result.recovery_card;
        setRecoveryCard({
          username:        regUsername,
          emergency_id:    rc.emergency_id,
          recovery_secret: rc.recovery_secret,
          version:         rc.version,
          generated_at:    rc.generated_at,
          checksum:        rc.checksum,
        });
      }
    } catch (err: unknown) {
      setError((err as Error).message ?? "Errore di registrazione");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Alpha Chat"
            className="auth-logo-img"
          />
          <span className="auth-logo-text">Alpha Chat</span>
        </div>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === "login" ? "active" : ""}`}
            onClick={() => { setTab("login"); setError(""); }}
          >
            Accedi
          </button>
          <button
            className={`auth-tab ${tab === "register" ? "active" : ""}`}
            onClick={() => { setTab("register"); setError(""); }}
          >
            Registrati
          </button>
        </div>

        {/* Error */}
        {error && <div className="auth-error">{error}</div>}

        {/* Login Form */}
        {tab === "login" && (
          <form onSubmit={handleLogin} className="auth-form">
            <label className="auth-label">Username o Email</label>
            <input
              className="auth-input"
              type="text"
              value={loginIdentifier}
              onChange={(e) => setLoginIdentifier(e.target.value)}
              placeholder="marco"
              required
              autoFocus
            />
            <label className="auth-label">Password</label>
            <div className="pwd-wrapper">
              <input
                className="auth-input pwd-input"
                type={showLoginPwd ? "text" : "password"}
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                className="pwd-toggle"
                aria-label={showLoginPwd ? "Nascondi password" : "Mostra password"}
                onClick={() => setShowLoginPwd((v) => !v)}
              >
                {showLoginPwd ? (
                  /* eye-off */
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  /* eye */
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? "Accesso in corso..." : "Accedi"}
            </button>
          </form>
        )}

        {/* Register Form */}
        {tab === "register" && (
          <form onSubmit={handleRegister} className="auth-form">
            <label className="auth-label">Username</label>
            <input
              className="auth-input"
              type="text"
              value={regUsername}
              onChange={(e) => setRegUsername(e.target.value.toLowerCase())}
              placeholder="es. mario_rossi"
              pattern="[a-z0-9_.]+"
              minLength={3}
              maxLength={32}
              required
              autoFocus
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <label className="auth-label">Nome visualizzato</label>
            <input
              className="auth-input"
              type="text"
              value={regDisplayName}
              onChange={(e) => setRegDisplayName(e.target.value)}
              placeholder="Marco Rossi"
              minLength={1}
              maxLength={50}
              required
            />
            <label className="auth-label">Password</label>
            <div className="pwd-wrapper">
              <input
                className="auth-input pwd-input"
                type={showRegPwd ? "text" : "password"}
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="Min. 8 caratteri"
                minLength={8}
                required
              />
              <button
                type="button"
                className="pwd-toggle"
                aria-label={showRegPwd ? "Nascondi password" : "Mostra password"}
                onClick={() => setShowRegPwd((v) => !v)}
              >
                {showRegPwd ? (
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
                )}
              </button>
            </div>
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? "Registrazione..." : "Crea account"}
            </button>
          </form>
        )}

        <p className="auth-hint">
          {tab === "login" ? "Non hai un account? " : "Hai già un account? "}
          <button
            className="auth-link"
            onClick={() => { setTab(tab === "login" ? "register" : "login"); setError(""); }}
          >
            {tab === "login" ? "Registrati" : "Accedi"}
          </button>
        </p>
      </div>
    </div>
  );
}
