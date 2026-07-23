/**
 * TrustCenterPage — Sprint 20
 * Security Dashboard: score, badge, audit, architettura, PDF.
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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

/** Mappa check.id → AppView di destinazione per le righe cliccabili */
const CHECK_NAV: Record<string, string> = {
  safety_number:        "security-center",
  two_fa:               "security",
  email_verified:       "recovery-settings",
  device_security:      "devices",
  pin:                  "security",
  biometric:            "security",
  timeout:              "security",
  ghost_mode:           "privacy",
  phoenix_protocol:     "phoenix",
  emergency_lock:       "phoenix",
  secure_destroy:       "nuclear-destroy",
  recovery_card:        "recovery-dashboard",
  dead_man_switch:      "dead-man-switch",
  recovery_contacts:    "recovery-contacts",
};

const STATUS_ICON: Record<string, string> = { ok: "🟢", warn: "🟡", fail: "🔴", na: "⚫" };
const LEVEL_COLOR_MAP: Record<string, string> = {
  green:  "#22c55e",
  blue:   "#6366f1",
  yellow: "#f59e0b",
  red:    "#ef4444",
};

export default function TrustCenterPage({ onBack, onNavigate }: Props) {
  const { t } = useTranslation("trust");
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

  // Category labels and architecture inside component so t() works
  const CATEGORY_LABELS: Record<string, string> = {
    encryption: t("catEncryption"),
    identity:   t("catIdentity"),
    device:     t("catDevice"),
    recovery:   t("catRecovery"),
    privacy:    t("catPrivacy"),
  };

  const ARCHITECTURE = [
    { name: "Signal Protocol", desc: t("archSignal") },
    { name: "X3DH",            desc: t("archX3dh") },
    { name: "Double Ratchet",  desc: t("archDoubleRatchet") },
    { name: "AES-256-GCM",     desc: t("archAes") },
    { name: "Argon2id",        desc: t("archArgon2") },
    { name: "Zero Knowledge",  desc: t("archZeroKnowledge") },
    { name: "WebAuthn",        desc: t("archWebauthn") },
    { name: "Safety Number",   desc: t("archSafetyNumber") },
    { name: "Phoenix Protocol",desc: t("archPhoenix") },
  ];

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!status) return;
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
    } catch { setError(t("loadError")); }
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
    } catch { setError(t("auditError")); }
    finally { setAuditing(false); }
  }

  function handlePrint() {
    window.print();
  }

  const categories = Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[];
  const grouped = categories.map(cat => ({
    key: cat,
    label: CATEGORY_LABELS[cat],
    checks: status?.checks.filter(c => c.category === cat) ?? [],
  }));

  const levelColor = status ? LEVEL_COLOR_MAP[status.level_color] ?? "#6366f1" : "#6366f1";

  return (
    <div className="tc-root" id="trust-center-page">
      <header className="settings-header no-print">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 className="settings-title">{t("title")}</h1>
        <button className="tc-print-btn no-print" onClick={handlePrint} aria-label={t("exportPdf")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        </button>
      </header>

      <div className="tc-body">
        <div className="print-only tc-print-header">
          <div className="tc-print-title">🛡️ Alpha Chat — Security Report</div>
          <div className="tc-print-date">{t("generatedOn")} {new Date().toLocaleString()}</div>
          <div className="tc-print-user">{t("user")}: @{auth?.username ?? "—"}</div>
        </div>

        {loading && <div className="tc-loading">{t("loading")}</div>}
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
                    ? t("maxProtection")
                    : t("missingItems", { count: status.missing.length })}
                </div>
                {status.last_audit_at && (
                  <div className="tc-score-audit-time">
                    {t("lastAudit")}: {new Date(status.last_audit_at).toLocaleString()}
                  </div>
                )}
              </div>
            </div>

            {/* ── Audit button ── */}
            <button className="tc-audit-btn no-print" onClick={runAudit} disabled={auditing}>
              <span className="tc-audit-icon">{auditing ? "⏳" : "🔍"}</span>
              {auditing ? t("auditRunning") : t("auditBtn")}
            </button>

            {/* ── Cosa manca ── */}
            {status.missing.length > 0 && (
              <div className="tc-missing">
                <div className="tc-missing-title">📋 {t("toReach100")}</div>
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
                  {group.checks.map(check => {
                    const dest = CHECK_NAV[check.id] as Parameters<typeof onNavigate>[0] | undefined;
                    const inner = (
                      <>
                        <div className="tc-check-left">
                          <span className="tc-check-icon">{STATUS_ICON[check.status]}</span>
                          <div className="tc-check-info">
                            <div className="tc-check-label">{check.label}</div>
                            <div className="tc-check-desc">{check.description}</div>
                          </div>
                        </div>
                        <div className="tc-check-right">
                          <span className="tc-check-value">{check.value ?? "—"}</span>
                          {dest && <span className="tc-check-chevron">›</span>}
                        </div>
                      </>
                    );
                    return dest ? (
                      <button
                        key={check.id}
                        className={`tc-check tc-check--${check.status} tc-check--nav`}
                        onClick={() => onNavigate(dest)}
                      >
                        {inner}
                      </button>
                    ) : (
                      <div key={check.id} className={`tc-check tc-check--${check.status}`}>
                        {inner}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* ── Quick actions ── */}
            <div className="tc-actions no-print">
              <div className="tc-actions-title">{t("quickActions")}</div>
              <div className="tc-action-grid">
                {!status.checks.find(c => c.id === "phoenix_protocol")?.points && (
                  <button className="tc-action-card tc-action-card--urgent" onClick={() => onNavigate("phoenix")}>
                    <span>🔑</span><span>{t("configurePhoenix")}</span>
                  </button>
                )}
                <button className="tc-action-card" onClick={() => onNavigate("security-timeline")}>
                  <span>📋</span><span>{t("securityTimeline")}</span>
                </button>
                <button className="tc-action-card" onClick={() => onNavigate("dead-man-switch")}>
                  <span>⏱️</span><span>{t("deadManSwitch")}</span>
                </button>
                <button className="tc-action-card" onClick={() => onNavigate("recovery-dashboard")}>
                  <span>🗂️</span><span>{t("recoveryCenter")}</span>
                </button>
                <button className="tc-action-card" onClick={() => onNavigate("devices")}>
                  <span>📱</span><span>{t("devices")}</span>
                </button>
                <button className="tc-action-card" onClick={() => onNavigate("security")}>
                  <span>🔒</span><span>{t("pinBiometrics")}</span>
                </button>
              </div>
            </div>

            {/* ── Architettura ── */}
            <div className="tc-arch">
              <div className="tc-arch-title">🏗️ {t("architectureTitle")}</div>
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
                    <div className="tc-version-subtitle">{t("versionSubtitle")}</div>
                  </div>
                </div>
                <div className="tc-version-badge">{t("active")}</div>
              </div>

              <div className="tc-version-rows">
                <div className="tc-version-row">
                  <span className="tc-version-key">{t("version")}</span>
                  <span className="tc-version-val">{__APP_VERSION__}</span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">{t("build")}</span>
                  <span className="tc-version-val tc-version-val--mono">{__BUILD_DATE__}</span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">{t("commit")}</span>
                  <span className="tc-version-val tc-version-val--mono">{__BUILD_COMMIT__}</span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">Signal Protocol</span>
                  <span className="tc-version-val tc-version-val--ok">✓ {t("active")}</span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">{t("lastAudit")}</span>
                  <span className="tc-version-val tc-version-val--mono">
                    {status.last_audit_at
                      ? new Date(status.last_audit_at).toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                      : t("neverAudited")}
                  </span>
                </div>
                <div className="tc-version-row">
                  <span className="tc-version-key">{t("internalTests")}</span>
                  <span className="tc-version-val tc-version-val--ok">✓ {__BUILD_TESTS__} {t("passed")}</span>
                </div>
              </div>

              <p className="tc-version-disclaimer">
                {t("disclaimer")}
              </p>
            </div>

            {/* ── PDF footer ── */}
            <div className="print-only tc-print-footer">
              <div>{t("printFooter")}</div>
              <div>alphachat.sbs · {new Date().getFullYear()}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
