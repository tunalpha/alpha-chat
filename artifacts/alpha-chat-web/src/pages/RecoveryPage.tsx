/**
 * RecoveryPage — Sprint 22
 * Pagina pubblica di recupero account (accessibile senza auth).
 * Metodo 1: Recovery Card (username + Emergency ID + Recovery Secret)
 * Metodo 2: Email di recupero (username + email → link monouso)
 */

import { useState } from "react";
import { apiRecoverByCard, apiRequestEmailRecovery, apiVerifyEmailToken } from "../lib/api";

type Method = "choose" | "card" | "email" | "email-sent" | "email-verify" | "success";

interface Props {
  onBack: () => void;
}

export default function RecoveryPage({ onBack }: Props) {
  const [method, setMethod]       = useState<Method>("choose");
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  // Card form
  const [cardUsername, setCardUsername]       = useState("");
  const [cardEmergencyId, setCardEmergencyId] = useState("");
  const [cardSecret, setCardSecret]           = useState("");

  // Email form
  const [emailUsername, setEmailUsername] = useState("");
  const [emailAddress, setEmailAddress]   = useState("");

  // Email verify form
  const [emailToken, setEmailToken] = useState("");

  async function handleCardSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiRecoverByCard(cardUsername, cardEmergencyId, cardSecret);
      setTempPassword(result.temp_password);
      setExpiresAt(result.expires_at);
      setMethod("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Credenziali non valide");
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequestEmailRecovery(emailUsername, emailAddress);
      setMethod("email-sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore invio email");
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiVerifyEmailToken(emailToken);
      setTempPassword(result.temp_password);
      setExpiresAt(result.expires_at);
      setMethod("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token non valido o scaduto");
    } finally {
      setLoading(false);
    }
  }

  const expiresFormatted = expiresAt
    ? new Date(expiresAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="recovery-page">
      <div className="recovery-box">
        {/* Header */}
        <div className="recovery-header">
          <button className="recovery-back" onClick={onBack}>← Accedi</button>
          <div className="recovery-logo">🔑</div>
          <h1 className="recovery-title">Recupera account</h1>
          <p className="recovery-subtitle">Alpha Chat non memorizza la tua password in chiaro.</p>
        </div>

        {/* Scelta metodo */}
        {method === "choose" && (
          <div className="recovery-methods">
            <button className="recovery-method-btn" onClick={() => setMethod("card")}>
              <div className="recovery-method-icon">🃏</div>
              <div>
                <div className="recovery-method-title">Recovery Card</div>
                <div className="recovery-method-desc">Usa Username, Emergency ID e Recovery Secret</div>
              </div>
              <span className="recovery-method-arrow">›</span>
            </button>
            <button className="recovery-method-btn" onClick={() => setMethod("email")}>
              <div className="recovery-method-icon">📧</div>
              <div>
                <div className="recovery-method-title">Email di recupero</div>
                <div className="recovery-method-desc">Solo se hai configurato un'email di recupero</div>
              </div>
              <span className="recovery-method-arrow">›</span>
            </button>
          </div>
        )}

        {/* Metodo 1: Recovery Card */}
        {method === "card" && (
          <form onSubmit={handleCardSubmit} className="recovery-form">
            <button type="button" className="recovery-back-method" onClick={() => { setMethod("choose"); setError(null); }}>← Indietro</button>
            <h2 className="recovery-form-title">🃏 Recovery Card</h2>
            <p className="recovery-form-desc">Inserisci i dati dalla tua Recovery Card.</p>

            <div className="recovery-field">
              <label className="recovery-label">Username</label>
              <input className="recovery-input" type="text" value={cardUsername} onChange={(e) => setCardUsername(e.target.value)} placeholder="il tuo username" required autoFocus autoCapitalize="none" />
            </div>
            <div className="recovery-field">
              <label className="recovery-label">Emergency ID</label>
              <input className="recovery-input recovery-mono" type="text" value={cardEmergencyId} onChange={(e) => setCardEmergencyId(e.target.value)} placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" required />
            </div>
            <div className="recovery-field">
              <label className="recovery-label">Recovery Secret</label>
              <input className="recovery-input recovery-mono" type="text" value={cardSecret} onChange={(e) => setCardSecret(e.target.value)} placeholder="es. 3vQB5AXoWyB6GVMBNTbVv..." required />
            </div>
            {error && <div className="recovery-error">{error}</div>}
            <button type="submit" className="recovery-submit" disabled={loading}>
              {loading ? "Verifica in corso…" : "Recupera account"}
            </button>
          </form>
        )}

        {/* Metodo 2: Email */}
        {method === "email" && (
          <form onSubmit={handleEmailRequest} className="recovery-form">
            <button type="button" className="recovery-back-method" onClick={() => { setMethod("choose"); setError(null); }}>← Indietro</button>
            <h2 className="recovery-form-title">📧 Email di recupero</h2>
            <p className="recovery-form-desc">Riceverai un link monouso valido 30 minuti.</p>

            <div className="recovery-field">
              <label className="recovery-label">Username</label>
              <input className="recovery-input" type="text" value={emailUsername} onChange={(e) => setEmailUsername(e.target.value)} placeholder="il tuo username" required autoCapitalize="none" />
            </div>
            <div className="recovery-field">
              <label className="recovery-label">Email di recupero</label>
              <input className="recovery-input" type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} placeholder="email@esempio.com" required />
            </div>
            {error && <div className="recovery-error">{error}</div>}
            <button type="submit" className="recovery-submit" disabled={loading}>
              {loading ? "Invio in corso…" : "Invia link di recupero"}
            </button>
          </form>
        )}

        {/* Email inviata */}
        {method === "email-sent" && (
          <div className="recovery-sent">
            <div className="recovery-sent-icon">📬</div>
            <h2>Email inviata</h2>
            <p>Se i dati sono corretti, riceverai un link entro pochi minuti. Il link scade dopo 30 minuti.</p>
            <div className="recovery-field" style={{ marginTop: 20 }}>
              <p style={{ fontSize: 13, color: "var(--text-3)" }}>Hai già il token? Inseriscilo qui:</p>
            </div>
            <form onSubmit={handleEmailVerify} className="recovery-form">
              <div className="recovery-field">
                <label className="recovery-label">Token di verifica</label>
                <input className="recovery-input recovery-mono" type="text" value={emailToken} onChange={(e) => setEmailToken(e.target.value)} placeholder="token ricevuto via email" required />
              </div>
              {error && <div className="recovery-error">{error}</div>}
              <button type="submit" className="recovery-submit" disabled={loading}>
                {loading ? "Verifica…" : "Verifica token"}
              </button>
            </form>
          </div>
        )}

        {/* Successo */}
        {method === "success" && tempPassword && (
          <div className="recovery-success">
            <div className="recovery-success-icon">✅</div>
            <h2>Account recuperato</h2>
            <p>Tutte le sessioni precedenti sono state revocate. Usa questa password temporanea per accedere:</p>
            <div className="recovery-temp-password">
              <div className="recovery-temp-label">Password temporanea</div>
              <div className="recovery-temp-value">{tempPassword}</div>
            </div>
            <p className="recovery-temp-expiry">
              ⏱ Scade alle <strong>{expiresFormatted}</strong>. Dopo il login ti verrà chiesto di impostarla nuova.
            </p>
            <div className="recovery-temp-warn">
              Questa password è mostrata UNA SOLA VOLTA. Usala subito per accedere.
            </div>
            <button className="recovery-submit" onClick={onBack}>
              Vai al login →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
