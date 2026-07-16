/**
 * TrustCenterPage — Sprint 20
 * Security Dashboard: score, badge, audit, architettura, PDF.
 */
import { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLock } from "../contexts/LockContext";
import { type AppView } from "../App";

interface Props { onBack: () => void; onNavigate: (v: AppView) => void }

interface SecurityCheck {
  id: string;
  label: string;
  description: string;
  status: "ok" | "warn" | "fail" | "na";
  value: string | null;
  points: number;
  max_points: number;
  category: "encryption" | "identity" | "device" | "recovery" | "privacy";
}

interface TrustStatus {
  checks: SecurityCheck[];
  score: number;
  max_score: number;
  level: string;
  level_color: "green" | "blue" | "yellow" | "red";
  missing: string[];
  last_audit_at: string | null;
  audited_at?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  encryption: "🔐 Crittografia",
  identity:   "🪪 Identità",
  device:     "📱 Dispositivo",
  recovery:   "🛡️ Recovery",
  privacy:    "👻 Privacy",
};

const STATUS_ICON: Record<string, string> = { ok: "🟢", warn: "🟡", fail: "🔴", na: "⚫" };
const LEVEL_COLOR_MAP: Record<string, string> = {
  green:  "#22c55e",
  blue:   "#6366f1",
  yellow: "#f59e0b",
  red:    "#ef4444",
};

const ARCHITECTURE = [
  { name: "Signal Protocol", desc: "Framework crittografico end-to-end. Combina X3DH e Double Ratchet per garantire forward secrecy e break-in recovery." },
  { name: "X3DH", desc: "Extended Triple Diffie-Hellman. Negozia chiavi di sessione senza che le parti siano online simultaneamente." },
  { name: "Double Ratchet", desc: "Algoritmo a doppio cricchetto. Ogni messaggio ha una chiave derivata diversa: compromettere una chiave non rivela le altre." },
  { name: "AES-256-GCM", desc: "Cifratura simmetrica autenticata con 256 bit di chiave. Usata per media e blob cifrati end-to-end." },
  { name: "Argon2id", desc: "Funzione di hashing delle password vincitrice della Password Hashing Competition 2015. Resistente ad attacchi GPU e time-memory." },
  { name: "Zero Knowledge", desc: "Il server non può mai leggere i messaggi. Non ha accesso alle chiavi private, che rimangono solo sul dispositivo." },
  { name: "WebAuthn", desc: "Standard W3C per autenticazione biometrica (Face ID, Touch ID). Le credenziali non lasciano mai il dispositivo." },
  { name: "Safety Number", desc: "Impronta crittografica dell'identità. Verifica manuale che il canale non sia intercettato (TOFU + verifica attiva)." },
  { name: "Phoenix Protocol", desc: "Protocollo di emergenza: Emergency Lock reversibile + distruzione sicura con tripla autenticazione anti-coercizione." },
];

export default function TrustCenterPage({ onBack, onNavigate }: Props) {
  const { auth } = useAuth();
  const { hasPINSet, hasBiometricSet, settings } = useLock();

  const [status, setStatus]     = useState<TrustStatus | null>(null);
  const [loading, setLoading]   = useState(true);
  const [auditing, setAuditing] = useState(false);
  const [error, setError]       = useState("");
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [expandedArch, setExpandedArch] = useState<string | null>(null);
  const scoreRef = useRef<NodeJS.Timeout | null>(null);

  const pinOk     = hasPINSet;
  const bioOk     = hasBiometricSet;
  const timeoutOk = !!settings?.autoLockMs && settings.autoLockMs > 0;

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!status) return;
    // Animazione contatore score
    const target = status.score;
    let current = 0;
    const step = Math.ceil(target / 40);
    const interval = setInterval(() => {
      current = Math.min(current + step, target);
      setScoreDisplay(current);
      if (current >= target) clearInterval(interval);
    }, 25);
    scoreRef.current = interval;
    return () => clearInterval(interval);
  }, [status?.score]);

  async function load() {
    setLoading(true);
    try {
      const url = `/api/v1/trust-center?pin=${pinOk}&biometric=${bioOk}&timeout=${timeoutOk}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${auth?.accessToken}` } });
      setStatus(await res.json() as TrustStatus);
    } catch { setError("Errore di caricamento."); }
    finally { setLoading(false); }
  }

  async function runAudit() {
    setAuditing(true); setError("");
    try {
      const res = await fetch("/api/v1/trust-center/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth?.accessToken}` },
        body: JSON.stringify({ pin_configured: pinOk, biometric_configured: bioOk, timeout_configured: timeoutOk }),
      });
      setStatus(await res.json() as TrustStatus);
    } catch { setError("Errore durante l'audit."); }
    finally { setAuditing(false); }
  }

  function handlePrint() {
    window.print();
  }

  // Group checks by category
  const categories = Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[];
  const grouped = categories.map(cat => ({
    key: cat,
    label: CATEGORY_LABELS[cat],
    checks: status?.checks.filter(c => c.category === cat) ?? [],
  }));

  const levelColor = status ? LEVEL_COLOR_MAP[status.level_color] ?? "#6366f1" : "#6366f1";

  return (
    <div className="tc-root" id="trust-center-page">
      {/* Header — nascosto in stampa */}
      <header className="settings-header no-print">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 className="settings-title">Trust Center</h1>
        <button className="tc-print-btn no-print" onClick={handlePrint} aria-label="Esporta PDF">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        </button>
      </header>

      <div className="tc-body">
        {/* Print header */}
        <div className="print-only tc-print-header">
          <div className="tc-print-title">🛡️ Alpha Chat — Security Report</div>
          <div className="tc-print-date">Generato il {new Date().toLocaleString("it-IT")}</div>
          <div className="tc-print-user">Utente: @{auth?.username ?? "—"}</div>
        </div>

        {loading && <div className="tc-loading">Caricamento…</div>}
        {error && <div className="tc-error">{error}</div>}

        {status && (
          <>
            {/* ── Security Score ── */}
            <div className="tc-score-card" style={{ "--level-color": levelColor } as React.CSSProperties}>
              <div className="tc-score-ring">
                <svg viewBox="0 0 120 120" className="tc-score-svg">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10"/>
                  <circle
                    cx="60" cy="60" r="50"
                    fill="none"
                    stroke={levelColor}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 50}`}
                    strokeDashoffset={`${2 * Math.PI * 50 * (1 - scoreDisplay / 100)}`}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "60px 60px", transition: "stroke-dashoffset 0.05s linear" }}
                  />
                </svg>
                <div className="tc-score-inner">
                  <div className="tc-score-number" style={{ color: levelColor }}>{scoreDisplay}</div>
                  <div className="tc-score-max">/100</div>
                </div>
              </div>
              <div className="tc-score-info">
                <div className="tc-score-level" style={{ color: levelColor }}>{status.level}</div>
                <div className="tc-score-desc">
                  {status.missing.length === 0
                    ? "Protezione massima attiva. Ottimo lavoro."
                    : `${status.missing.length} element${status.missing.length === 1 ? "o" : "i"} da configurare per il massimo.`}
                </div>
                {status.last_audit_at && (
                  <div className="tc-score-audit-time">
                    Ultimo audit: {new Date(status.last_audit_at).toLocaleString("it-IT")}
                  </div>
                )}
              </div>
            </div>

            {/* ── Audit button ── */}
            <button className="tc-audit-btn no-print" onClick={runAudit} disabled={auditing}>
              <span className="tc-audit-icon">{auditing ? "⏳" : "🔍"}</span>
              {auditing ? "Audit in corso…" : "Esegui audit sicurezza"}
            </button>

            {/* ── Cosa manca ── */}
            {status.missing.length > 0 && (
              <div className="tc-missing">
                <div className="tc-missing-title">📋 Per raggiungere il 100%</div>
                <div className="tc-missing-list">
                  {status.missing.map(m => (
                    <div key={m} className="tc-missing-item">
                      <span className="tc-missing-dot">·</span> {m}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Badge per categoria ── */}
            {grouped.map(group => (
              <div key={group.key} className="tc-category">
                <div className="tc-category-label">{group.label}</div>
                <div className="tc-check-list">
                  {group.checks.map(check => (
                    <div key={check.id} className={`tc-check tc-check--${check.status}`}>
                      <div className="tc-check-left">
                        <span className="tc-check-icon">{STATUS_ICON[check.status]}</span>
                        <div className="tc-check-info">
                          <div className="tc-check-label">{check.label}</div>
                          <div className="tc-check-desc">{check.description}</div>
                        </div>
                      </div>
                      <div className="tc-check-value">{check.value ?? "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* ── Quick actions ── */}
            <div className="tc-actions no-print">
              <div className="tc-actions-title">Azioni rapide</div>
              <div className="tc-action-grid">
                {!status.checks.find(c => c.id === "phoenix_protocol")?.points && (
                  <button className="tc-action-card tc-action-card--urgent" onClick={() => onNavigate("phoenix")}>
                    <span>🔑</span><span>Configura Phoenix</span>
                  </button>
                )}
                <button className="tc-action-card" onClick={() => onNavigate("security-timeline")}>
                  <span>📋</span><span>Timeline sicurezza</span>
                </button>
                <button className="tc-action-card" onClick={() => onNavigate("dead-man-switch")}>
                  <span>⏱️</span><span>Dead Man Switch</span>
                </button>
                <button className="tc-action-card" onClick={() => onNavigate("recovery-dashboard")}>
                  <span>🗂️</span><span>Recovery Center</span>
                </button>
                <button className="tc-action-card" onClick={() => onNavigate("devices")}>
                  <span>📱</span><span>Dispositivi</span>
                </button>
                <button className="tc-action-card" onClick={() => onNavigate("security")}>
                  <span>🔒</span><span>PIN & Biometria</span>
                </button>
              </div>
            </div>

            {/* ── Architettura ── */}
            <div className="tc-arch">
              <div className="tc-arch-title">🏗️ Architettura di Sicurezza</div>
              <div className="tc-arch-list">
                {ARCHITECTURE.map(item => (
                  <div
                    key={item.name}
                    className={`tc-arch-item${expandedArch === item.name ? " tc-arch-item--open" : ""}`}
                    onClick={() => setExpandedArch(prev => prev === item.name ? null : item.name)}
                  >
                    <div className="tc-arch-header">
                      <span className="tc-arch-name">{item.name}</span>
                      <span className="tc-arch-chevron">{expandedArch === item.name ? "▲" : "▼"}</span>
                    </div>
                    {expandedArch === item.name && (
                      <div className="tc-arch-desc">{item.desc}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Security Version Card ── */}
            <div className="tc-version-card">
              <div className="tc-version-header">
                <div className="tc-version-brand">
                  <div className="tc-version-logo">α</div>
                  <div>
                    <div className="tc-version-name">Alpha Chat Security</div>
                    <div className="tc-version-subtitle">Informazioni build & protocollo</div>
                  </div>
                </div>
                <div className="tc-version-badge">ATTIVO</div>
              </div>

              <div className="tc-version-rows">
                <div className="tc-version-row">
                  <span className="tc-version-key">Versione</span>
                  <span className="tc-version-val">{__APP_VERSION__}</span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">Build</span>
                  <span className="tc-version-val tc-version-val--mono">{__BUILD_DATE__}</span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">Commit</span>
                  <span className="tc-version-val tc-version-val--mono">{__BUILD_COMMIT__}</span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">Signal Protocol</span>
                  <span className="tc-version-val tc-version-val--ok">✓ Attivo</span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">Ultimo audit</span>
                  <span className="tc-version-val tc-version-val--mono">
                    {status.last_audit_at
                      ? new Date(status.last_audit_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "Mai eseguito"}
                  </span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">Test interni</span>
                  <span className="tc-version-val tc-version-val--ok">✓ {__BUILD_TESTS__} superati</span>
                </div>
              </div>

              <p className="tc-version-disclaimer">
                I test interni verificano il corretto funzionamento delle componenti di sicurezza al momento del rilascio. Non costituiscono una certificazione esterna o un audit indipendente.
              </p>
            </div>

            {/* ── PDF footer ── */}
            <div className="print-only tc-print-footer">
              <div>Alpha Chat Security Report — Solo dati tecnici, mai contenuti delle conversazioni.</div>
              <div>alphachat.sbs · {new Date().getFullYear()}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
