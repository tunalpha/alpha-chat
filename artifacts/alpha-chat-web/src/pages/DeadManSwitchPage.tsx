/**
 * DeadManSwitchPage — Sprint 19
 * Configurazione del Dead Man Switch.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";

interface Props { onBack: () => void }

interface DmsStatus {
  enabled: boolean;
  period_days: number;
  grace_days: number;
  action: "none" | "lock" | "notify_only";
  last_check_in_at: string;
  warning_sent_at: string | null;
  grace_started_at: string | null;
  days_until_warning: number | null;
  state: "inactive" | "active" | "warning_sent" | "grace_period";
}

const PERIOD_OPTIONS = [
  { value: 30,  label: "30 giorni" },
  { value: 60,  label: "60 giorni" },
  { value: 90,  label: "90 giorni" },
  { value: 180, label: "180 giorni" },
];
const GRACE_OPTIONS = [
  { value: 3,  label: "3 giorni" },
  { value: 7,  label: "7 giorni" },
  { value: 14, label: "14 giorni" },
  { value: 30, label: "30 giorni" },
];
const ACTION_OPTIONS = [
  { value: "notify_only", label: "Solo notifica email",          desc: "Invia un avviso. Nessuna azione automatica." },
  { value: "lock",        label: "Emergency Lock automatico",    desc: "Disconnette tutti i dispositivi. Account recuperabile." },
  { value: "none",        label: "Disattivato",                  desc: "Nessuna azione, nessun avviso." },
];

const BASE = "/api/v1/dead-man-switch";

export default function DeadManSwitchPage({ onBack }: Props) {
  const { auth } = useAuth();
  const [status, setStatus] = useState<DmsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [enabled, setEnabled]       = useState(false);
  const [periodDays, setPeriodDays] = useState(90);
  const [graceDays, setGraceDays]   = useState(7);
  const [action, setAction]         = useState<"none" | "lock" | "notify_only">("notify_only");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(BASE, { headers: { Authorization: `Bearer ${auth?.accessToken}` } });
      const data = await res.json() as DmsStatus;
      setStatus(data);
      setEnabled(data.enabled);
      setPeriodDays(data.period_days);
      setGraceDays(data.grace_days);
      setAction(data.action);
    } catch { setError("Errore di caricamento."); }
    finally { setLoading(false); }
  }

  async function save() {
    setSaving(true); setError(""); setSuccess("");
    try {
      const res = await fetch(BASE, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth?.accessToken}` },
        body: JSON.stringify({ enabled, period_days: periodDays, grace_days: graceDays, action }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json() as DmsStatus;
      setStatus(data);
      setSuccess("Configurazione salvata.");
    } catch { setError("Errore durante il salvataggio."); }
    finally { setSaving(false); }
  }

  function stateLabel(s: DmsStatus["state"]) {
    if (!enabled) return null;
    const map = { inactive: null, active: "🟢 Attivo", warning_sent: "🟡 Avviso inviato", grace_period: "🔴 Periodo di grazia" } as const;
    return map[s];
  }

  return (
    <div className="dms-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 className="settings-title">Dead Man Switch</h1>
      </header>

      <div className="dms-body">
        {/* Hero */}
        <div className="dms-hero">
          <div className="dms-hero-icon">⏱️</div>
          <p className="dms-hero-text">
            Se non accedi ad Alpha Chat entro il periodo configurato, il sistema invia un avviso
            e — dopo un periodo di grazia — esegue l'azione scelta.
          </p>
          <div className="dms-warning-box">
            ⚠️ La <strong>distruzione definitiva</strong> dell'account richiede sempre conferma manuale tramite Phoenix Protocol. Il Dead Man Switch non può avviarla automaticamente.
          </div>
        </div>

        {loading ? (
          <div className="dms-loading">Caricamento…</div>
        ) : (
          <>
            {/* Stato attuale */}
            {status && stateLabel(status.state) && (
              <div className="dms-status-bar">{stateLabel(status.state)}</div>
            )}
            {status?.days_until_warning !== null && status?.days_until_warning !== undefined && (
              <div className="dms-countdown">
                Avviso tra <strong>{status.days_until_warning} giorni</strong>
                {status.last_check_in_at && (
                  <span> · Ultimo accesso: {new Date(status.last_check_in_at).toLocaleDateString("it-IT")}</span>
                )}
              </div>
            )}

            {/* Toggle abilitazione */}
            <div className="dms-section">
              <div className="dms-toggle-row">
                <div>
                  <div className="dms-toggle-label">Dead Man Switch</div>
                  <div className="dms-toggle-desc">Attiva il monitoraggio di inattività</div>
                </div>
                <button
                  className={`dms-toggle${enabled ? " dms-toggle--on" : ""}`}
                  onClick={() => setEnabled(e => !e)}
                  aria-pressed={enabled}
                >
                  <span className="dms-toggle-thumb" />
                </button>
              </div>
            </div>

            {enabled && (
              <>
                {/* Periodo di inattività */}
                <div className="dms-section">
                  <div className="dms-section-title">Periodo di inattività</div>
                  <div className="dms-options">
                    {PERIOD_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={`dms-option${periodDays === opt.value ? " dms-option--selected" : ""}`}
                        onClick={() => setPeriodDays(opt.value)}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>

                {/* Periodo di grazia */}
                <div className="dms-section">
                  <div className="dms-section-title">Periodo di grazia (dopo l'avviso)</div>
                  <div className="dms-options">
                    {GRACE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={`dms-option${graceDays === opt.value ? " dms-option--selected" : ""}`}
                        onClick={() => setGraceDays(opt.value)}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>

                {/* Azione */}
                <div className="dms-section">
                  <div className="dms-section-title">Azione dopo il periodo di grazia</div>
                  <div className="dms-action-list">
                    {ACTION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        className={`dms-action-option${action === opt.value ? " dms-action-option--selected" : ""}${opt.value === "lock" ? " dms-action-option--warn" : ""}`}
                        onClick={() => setAction(opt.value as typeof action)}
                      >
                        <div className="dms-action-label">{opt.label}</div>
                        <div className="dms-action-desc">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {error && <div className="dms-error">{error}</div>}
            {success && <div className="dms-success">{success}</div>}

            <button className="dms-save-btn" onClick={save} disabled={saving}>
              {saving ? "Salvataggio…" : "Salva configurazione"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
