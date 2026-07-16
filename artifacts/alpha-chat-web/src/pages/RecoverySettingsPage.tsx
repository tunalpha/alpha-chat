/**
 * RecoverySettingsPage — Sprint 22
 * Dashboard recovery + impostazioni (email, rigenera card).
 * Accessibile da Impostazioni → Sicurezza.
 */

import { useState, useEffect } from "react";
import {
  apiGetRecoveryStatus,
  apiSetRecoveryEmail,
  apiRegenerateRecoveryCard,
  type RecoveryStatus,
} from "../lib/api";
import RecoveryCardModal, { type RecoveryCardData } from "../components/RecoveryCardModal";
import { useAuth } from "../contexts/AuthContext";

interface Props {
  onBack: () => void;
}

export default function RecoverySettingsPage({ onBack }: Props) {
  const { auth } = useAuth();
  const [status, setStatus]           = useState<RecoveryStatus | null>(null);
  const [loading, setLoading]         = useState(true);
  const [emailInput, setEmailInput]   = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError]   = useState<string | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [newCard, setNewCard]         = useState<RecoveryCardData | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  useEffect(() => {
    void apiGetRecoveryStatus().then((s) => { setStatus(s); setLoading(false); });
  }, []);

  async function handleSetEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailLoading(true);
    try {
      await apiSetRecoveryEmail(emailInput);
      setEmailSuccess(true);
      setStatus((prev) => prev ? { ...prev, has_recovery_email: true } : prev);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Errore");
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleRegenerate() {
    setRegenLoading(true);
    try {
      const payload = await apiRegenerateRecoveryCard();
      const card: RecoveryCardData = {
        username:        auth?.username ?? "",
        emergency_id:    payload.emergency_id,
        recovery_secret: payload.recovery_secret,
        version:         payload.version,
        generated_at:    payload.generated_at,
        checksum:        payload.checksum,
      };
      setNewCard(card);
      setStatus((prev) => prev ? {
        ...prev,
        has_recovery_card: true,
        card_version: payload.version,
        card_generated_at: payload.generated_at,
      } : prev);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Errore rigenerazione");
    } finally {
      setRegenLoading(false);
      setConfirmRegen(false);
    }
  }

  if (loading) return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span>Recovery</span>
      </div>
      <div style={{ padding: 32, color: "var(--text-3)" }}>Caricamento…</div>
    </div>
  );

  return (
    <div className="settings-page">
      {/* Header */}
      <div className="settings-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span>🔑 Recovery Account</span>
      </div>

      <div className="settings-body" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>

        {/* Dashboard stato */}
        <div className="rs-section">
          <div className="rs-section-title">Stato Recovery</div>
          <div className="rs-status-grid">
            <StatusItem icon={status?.has_recovery_card ? "✅" : "❌"} label="Recovery Card" value={status?.has_recovery_card ? `v${status.card_version ?? "?"}` : "Non configurata"} />
            <StatusItem icon={status?.has_recovery_email ? "✅" : "⚠️"} label="Email recupero" value={status?.has_recovery_email ? (status.recovery_email_masked ?? "Configurata") : "Non configurata"} />
            <StatusItem icon={status?.has_phoenix_code ? "✅" : "⚪"} label="Phoenix Code" value={status?.has_phoenix_code ? "Configurato" : "Non configurato"} />
            {status?.card_generated_at && (
              <StatusItem icon="🕐" label="Ultima card" value={new Date(status.card_generated_at).toLocaleDateString("it-IT")} />
            )}
            {status?.last_recovery_at && (
              <StatusItem icon="🛡️" label="Ultimo recupero" value={new Date(status.last_recovery_at).toLocaleDateString("it-IT")} />
            )}
          </div>
        </div>

        {/* Email recupero */}
        <div className="rs-section">
          <div className="rs-section-title">Email di recupero <span className="rs-optional">(opzionale)</span></div>
          <p className="rs-desc">
            L'email serve esclusivamente come metodo aggiuntivo di recupero.<br />
            Alpha Chat continua a funzionare anche senza email.
          </p>
          {emailSuccess ? (
            <div className="rs-success">✅ Email di recupero salvata.</div>
          ) : (
            <form onSubmit={handleSetEmail} className="rs-email-form">
              <input
                className="rs-input"
                type="email"
                placeholder="email@esempio.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                required
              />
              <button type="submit" className="rs-btn" disabled={emailLoading}>
                {emailLoading ? "…" : "Salva"}
              </button>
            </form>
          )}
          {emailError && <div className="rs-error">{emailError}</div>}
        </div>

        {/* Rigenera Recovery Card */}
        <div className="rs-section rs-section-danger">
          <div className="rs-section-title">Rigenera Recovery Card</div>
          <p className="rs-desc">
            La card attuale diventerà <strong>immediatamente invalida</strong>.
            La nuova card sarà mostrata una sola volta.
          </p>
          {!confirmRegen ? (
            <button className="rs-btn-danger" onClick={() => setConfirmRegen(true)}>
              🔄 Rigenera Recovery Card
            </button>
          ) : (
            <div className="rs-confirm">
              <span>Sei sicuro? La vecchia card sarà invalidata.</span>
              <button className="rs-confirm-yes" onClick={handleRegenerate} disabled={regenLoading}>
                {regenLoading ? "Rigenerazione…" : "Sì, rigenera"}
              </button>
              <button className="rs-confirm-no" onClick={() => setConfirmRegen(false)}>Annulla</button>
            </div>
          )}
        </div>

      </div>

      {/* Modal nuova card */}
      {newCard && (
        <RecoveryCardModal
          card={newCard}
          onConfirm={() => setNewCard(null)}
        />
      )}
    </div>
  );
}

function StatusItem({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rs-status-item">
      <span className="rs-status-icon">{icon}</span>
      <div>
        <div className="rs-status-label">{label}</div>
        <div className="rs-status-value">{value}</div>
      </div>
    </div>
  );
}
