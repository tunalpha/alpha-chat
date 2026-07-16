/**
 * ForcePasswordChangePage — Sprint 22 completion
 *
 * Pagina obbligatoria mostrata dopo login con password temporanea.
 * L'utente NON può accedere ad altre schermate finché non cambia password.
 */

import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { apiChangeTempPasswordAuth } from "../lib/api";

// Indicatore robustezza password
function PasswordStrength({ password }: { password: string }) {
  const score = getScore(password);
  const labels = ["", "Debole", "Discreta", "Buona", "Ottima"];
  const colors = ["", "#ef4444", "#f97316", "#eab308", "#22c55e"];
  const label = labels[score] ?? "";
  const color = colors[score] ?? "";

  return password.length === 0 ? null : (
    <div className="fpc-strength">
      <div className="fpc-strength-bars">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="fpc-strength-bar" style={{ background: i <= score ? color : "var(--border)" }} />
        ))}
      </div>
      <span className="fpc-strength-label" style={{ color }}>{label}</span>
    </div>
  );
}

function getScore(pwd: string): number {
  if (pwd.length < 8) return 1;
  let score = 0;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return Math.min(Math.max(score, 1), 4);
}

interface Props {
  onComplete: () => void;
  onLogout: () => void;
}

export default function ForcePasswordChangePage({ onComplete, onLogout }: Props) {
  const { clearPasswordChangeRequired } = useAuth();
  const [current, setCurrent]     = useState("");
  const [newPwd, setNewPwd]       = useState("");
  const [confirm, setConfirm]     = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [done, setDone]           = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPwd.length < 12) {
      setError("La nuova password deve essere di almeno 12 caratteri.");
      return;
    }
    if (newPwd !== confirm) {
      setError("Le password non coincidono.");
      return;
    }
    if (newPwd === current) {
      setError("La nuova password non può essere uguale a quella temporanea.");
      return;
    }

    setLoading(true);
    try {
      await apiChangeTempPasswordAuth(current, newPwd, confirm);
      clearPasswordChangeRequired();
      setDone(true);
      // Breve pausa prima di rientrare nella chat
      setTimeout(() => onComplete(), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante il cambio password.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="fpc-page">
        <div className="fpc-card fpc-done">
          <div className="fpc-done-icon">✅</div>
          <h2>Password aggiornata</h2>
          <p>Accesso in corso…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fpc-page">
      <div className="fpc-card">
        {/* Header */}
        <div className="fpc-header">
          <div className="fpc-lock-icon">🔐</div>
          <h1 className="fpc-title">Proteggi nuovamente il tuo account</h1>
          <p className="fpc-subtitle">
            Hai effettuato l'accesso con una password temporanea.<br />
            Per motivi di sicurezza devi impostarne una nuova prima di continuare.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="fpc-form">
          {/* Password attuale (temporanea) */}
          <div className="fpc-field">
            <label className="fpc-label">Password attuale (temporanea)</label>
            <div className="fpc-pwd-wrapper">
              <input
                className="fpc-input"
                type={showCurrent ? "text" : "password"}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="La password ricevuta via recupero"
                required
                autoComplete="current-password"
              />
              <button type="button" className="fpc-eye" onClick={() => setShowCurrent((v) => !v)}>
                {showCurrent ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {/* Nuova password */}
          <div className="fpc-field">
            <label className="fpc-label">Nuova password</label>
            <div className="fpc-pwd-wrapper">
              <input
                className="fpc-input"
                type={showNew ? "text" : "password"}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="Minimo 12 caratteri"
                required
                minLength={12}
                autoComplete="new-password"
              />
              <button type="button" className="fpc-eye" onClick={() => setShowNew((v) => !v)}>
                {showNew ? "🙈" : "👁"}
              </button>
            </div>
            <PasswordStrength password={newPwd} />
          </div>

          {/* Conferma password */}
          <div className="fpc-field">
            <label className="fpc-label">Conferma nuova password</label>
            <input
              className={`fpc-input ${confirm && confirm !== newPwd ? "fpc-input-error" : ""}`}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Ripeti la nuova password"
              required
              autoComplete="new-password"
            />
            {confirm && confirm !== newPwd && (
              <span className="fpc-hint-error">Le password non coincidono</span>
            )}
          </div>

          {error && <div className="fpc-error">{error}</div>}

          <button
            type="submit"
            className="fpc-submit"
            disabled={loading || newPwd.length < 12 || newPwd !== confirm}
          >
            {loading ? "Aggiornamento in corso…" : "Imposta nuova password"}
          </button>
        </form>

        {/* Solo logout è consentito */}
        <div className="fpc-footer">
          <button className="fpc-logout" onClick={onLogout}>
            Esci dall'account
          </button>
        </div>
      </div>
    </div>
  );
}
