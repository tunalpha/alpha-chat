import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export default function AuthPage() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Login form state
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register form state
  const [regUsername, setRegUsername] = useState("");
  const [regDisplayName, setRegDisplayName] = useState("");
  const [regPassword, setRegPassword] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login({ username_or_email: loginUsername, password: loginPassword });
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
      await register({ username: regUsername, display_name: regDisplayName, password: regPassword });
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
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder="marco"
              required
              autoFocus
            />
            <label className="auth-label">Password</label>
            <input
              className="auth-input"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
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
              placeholder="marco"
              pattern="[a-z0-9_.]+"
              minLength={3}
              maxLength={32}
              required
              autoFocus
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
            <input
              className="auth-input"
              type="password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              placeholder="Min. 8 caratteri"
              minLength={8}
              required
            />
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? "Registrazione..." : "Crea account"}
            </button>
          </form>
        )}

        <p className="auth-hint">
          {tab === "login"
            ? "Non hai un account? "
            : "Hai già un account? "}
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
