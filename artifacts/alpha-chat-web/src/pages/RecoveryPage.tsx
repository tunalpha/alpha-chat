/**
 * RecoveryPage — Sprint 22
 * Dashboard completa del recovery (card, contatti, sessioni, riattivazione account).
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type AppView } from "../App";
import { apiGetRecoveryStatus, type RecoveryStatus } from "../lib/api";

interface Props {
  onBack: () => void;
  onNavigate?: (view: AppView) => void;
}

export default function RecoveryPage({ onBack, onNavigate }: Props) {
  const { t } = useTranslation("recoveryPage");
  const [status, setStatus]     = useState<RecoveryStatus | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    void apiGetRecoveryStatus()
      .then(s => setStatus(s))
      .finally(() => setLoading(false));
  }, []);

  const score =
    (status?.has_recovery_card   ? 40 : 0) +
    (status?.has_recovery_email  ? 25 : 0) +
    (status?.has_phoenix_code    ? 35 : 0);

  const scoreColor = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div className="rp-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="settings-title">{t("title")}</h1>
      </header>

      <div className="rp-body">
        {loading ? (
          <div className="rp-loading">{t("loading")}</div>
        ) : (
          <>
            {/* Score card */}
            <div className="rp-score-card" style={{ "--score-color": scoreColor } as React.CSSProperties}>
              <div className="rp-score-circle" style={{ borderColor: scoreColor }}>
                <span className="rp-score-number" style={{ color: scoreColor }}>{score}</span>
                <span className="rp-score-unit">/100</span>
              </div>
              <div className="rp-score-info">
                <div className="rp-score-label" style={{ color: scoreColor }}>
                  {score >= 80 ? t("levelHigh") : score >= 50 ? t("levelMedium") : t("levelLow")}
                </div>
                <div className="rp-score-desc">
                  {score < 100
                    ? t("scoreIncompleteHint")
                    : t("scoreMaxProtection")}
                </div>
              </div>
            </div>

            {/* Sezione card */}
            <div className="rp-section">
              <div className="rp-section-title">{t("recoveryMethods")}</div>

              <button className="rp-item" onClick={() => onNavigate?.("recovery-settings")}>
                <div className="rp-item-left">
                  <div className="rp-item-icon">{status?.has_recovery_card ? "✅" : "❌"}</div>
                  <div className="rp-item-body">
                    <div className="rp-item-label">{t("recoveryCard")}</div>
                    <div className="rp-item-sub">
                      {status?.has_recovery_card
                        ? `v${status.card_version ?? "?"} · ${new Date(status.card_generated_at!).toLocaleDateString()}`
                        : t("notConfigured")}
                    </div>
                  </div>
                </div>
                <span className="rp-chevron">›</span>
              </button>

              <button className="rp-item" onClick={() => onNavigate?.("recovery-settings")}>
                <div className="rp-item-left">
                  <div className="rp-item-icon">{status?.has_recovery_email ? "✅" : "⚠️"}</div>
                  <div className="rp-item-body">
                    <div className="rp-item-label">{t("recoveryEmail")}</div>
                    <div className="rp-item-sub">
                      {status?.has_recovery_email
                        ? status.recovery_email_masked ?? t("configured")
                        : t("notConfigured")}
                    </div>
                  </div>
                </div>
                <span className="rp-chevron">›</span>
              </button>

              <button className="rp-item" onClick={() => onNavigate?.("phoenix")}>
                <div className="rp-item-left">
                  <div className="rp-item-icon">{status?.has_phoenix_code ? "✅" : "⚪"}</div>
                  <div className="rp-item-body">
                    <div className="rp-item-label">{t("phoenixCode")}</div>
                    <div className="rp-item-sub">
                      {status?.has_phoenix_code ? t("configured") : t("notConfigured")}
                    </div>
                  </div>
                </div>
                <span className="rp-chevron">›</span>
              </button>

              <button className="rp-item" onClick={() => onNavigate?.("recovery-contacts")}>
                <div className="rp-item-left">
                  <div className="rp-item-icon">⚪</div>
                  <div className="rp-item-body">
                    <div className="rp-item-label">{t("recoveryContacts")}</div>
                    <div className="rp-item-sub">{t("notConfigured")}</div>
                  </div>
                </div>
                <span className="rp-chevron">›</span>
              </button>
            </div>

            {/* Attività recente */}
            {(status?.last_recovery_at) && (
              <div className="rp-section">
                <div className="rp-section-title">{t("recentActivity")}</div>
                <div className="rp-activity-item">
                  <div className="rp-activity-icon">🛡️</div>
                  <div>
                    <div className="rp-activity-label">{t("lastRecovery")}</div>
                    <div className="rp-activity-date">{new Date(status.last_recovery_at).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Azioni rapide */}
            <div className="rp-section">
              <div className="rp-section-title">{t("quickActions")}</div>
              <button className="rp-action-btn" onClick={() => onNavigate?.("recovery-settings")}>
                🔄 {t("regenerateCard")}
              </button>
              <button className="rp-action-btn rp-action-btn--secondary" onClick={() => window.open("/emergency", "_blank")}>
                🔑 {t("openPortal")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
