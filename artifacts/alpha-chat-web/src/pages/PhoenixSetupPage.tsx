/**
 * PhoenixSetupPage — Sprint 18
 * Configurazione Phoenix Code e Recovery Card (autenticato).
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import RecoveryCard from "../components/RecoveryCard";
import {
  apiGetPhoenixRecoveryCard,
  apiSetupPhoenixCode,
  type PhoenixRecoveryData,
} from "../lib/api";

interface Props { onBack: () => void; }

type View = "main" | "setup" | "change" | "card";

export default function PhoenixSetupPage({ onBack }: Props) {
  const { t } = useTranslation("phoenix");
  const [view, setView] = useState<View>("main");
  const [recovery, setRecovery] = useState<PhoenixRecoveryData | null>(null);
  const [phoenixCode, setPhoenixCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    void loadRecovery();
  }, []);

  async function loadRecovery() {
    try {
      const data = await apiGetPhoenixRecoveryCard();
      setRecovery(data);
    } catch { /* non blocca il render */ }
  }

  function showFeedback(type: "ok" | "err", msg: string) {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3000);
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (phoenixCode.length < 20) {
      showFeedback("err", t("errorMinLen"));
      return;
    }
    if (phoenixCode !== confirmCode) {
      showFeedback("err", t("errorMismatch"));
      return;
    }
    setLoading(true);
    try {
      const data = await apiSetupPhoenixCode(phoenixCode);
      showFeedback("ok", `${t("configured")} ${data.emergency_id}`);
      setPhoenixCode(""); setConfirmCode("");
      await loadRecovery();
      setView("card");
    } catch (err) {
      showFeedback("err", err instanceof Error ? err.message : t("errorConnection"));
    } finally {
      setLoading(false);
    }
  }

  // ── Setup form ──────────────────────────────────────────────────────────────
  if (view === "setup" || view === "change") {
    return (
      <div className="settings-root">
        <header className="settings-header">
          <button className="settings-back-btn" onClick={() => setView("main")} aria-label={t("common:back", "Back")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="settings-title">{view === "change" ? t("changeTitle") : t("setupTitle")}</h1>
        </header>
        <div className="settings-body">
          <div className="phoenix-setup-desc">{t("setupDesc")}</div>
          <form onSubmit={handleSetup} className="phoenix-setup-form">
            <label className="phoenix-label">{t("code")}</label>
            <input
              type="password"
              className="phoenix-input"
              value={phoenixCode}
              onChange={(e) => setPhoenixCode(e.target.value)}
              placeholder={t("codePlaceholder")}
              autoComplete="off"
              required
            />
            <div className="phoenix-strength">
              <div className={`phoenix-strength-bar${phoenixCode.length >= 20 ? " ok" : phoenixCode.length >= 10 ? " mid" : ""}`}
                style={{ width: `${Math.min(100, (phoenixCode.length / 20) * 100)}%` }}
              />
            </div>
            <div className="phoenix-strength-label">
              {phoenixCode.length < 10
                ? t("strengthTooShort")
                : phoenixCode.length < 20
                  ? t("strengthMore", { n: 20 - phoenixCode.length })
                  : t("strengthOk")}
            </div>

            <label className="phoenix-label">{t("confirmPlaceholder")}</label>
            <input
              type="password"
              className="phoenix-input"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              placeholder={t("confirmPlaceholder")}
              autoComplete="off"
              required
            />

            {feedback && (
              <div className={`phoenix-feedback ${feedback.type}`}>{feedback.msg}</div>
            )}

            <button
              type="submit"
              className="phoenix-btn-primary"
              disabled={loading || phoenixCode.length < 20}
            >
              {loading ? t("savingBtn") : t("saveBtn")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Recovery Card ────────────────────────────────────────────────────────────
  if (view === "card" && recovery) {
    return (
      <div className="settings-root">
        <header className="settings-header">
          <button className="settings-back-btn" onClick={() => setView("main")} aria-label={t("common:back", "Back")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="settings-title">{t("cardTitle")}</h1>
        </header>
        <div className="settings-body" style={{ padding: "16px" }}>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 16 }}>
            {t("cardSaveHint")}
          </p>
          <RecoveryCard
            username={recovery.username}
            emergencyId={recovery.emergencyId}
            portalUrl={recovery.portalUrl}
          />
          <button
            className="phoenix-btn-secondary"
            style={{ marginTop: 16 }}
            onClick={() => window.print()}
          >
            {t("printBtn")}
          </button>
        </div>
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">{t("title")}</h1>
      </header>

      {feedback && (
        <div className={`phoenix-feedback-banner ${feedback.type}`}>{feedback.msg}</div>
      )}

      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">{t("sectionEmergency")}</div>

          <div className="phoenix-banner">
            <div className="phoenix-banner-icon">🔥</div>
            <div>
              <div className="phoenix-banner-title">{t("title")}</div>
              <div className="phoenix-banner-desc">{t("bannerDesc")}</div>
            </div>
          </div>

          <div
            className="settings-item clickable"
            onClick={() => setView(recovery?.hasPhoenixCode ? "change" : "setup")}
            role="button" tabIndex={0}
          >
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">
                {recovery?.hasPhoenixCode ? t("changeCode") : t("codeSetup")}
              </div>
              <div className="settings-item-value muted">
                {recovery?.hasPhoenixCode ? t("codeActive") : t("codeNotConfigured")}
              </div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron"><polyline points="9 18 15 12 9 6"/></svg>
          </div>

          {recovery?.hasPhoenixCode && (
            <div
              className="settings-item clickable"
              onClick={() => setView("card")}
              role="button" tabIndex={0}
            >
              <div className="settings-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <div className="settings-item-content">
                <div className="settings-item-label">{t("cardTitle")}</div>
                <div className="settings-item-value muted">
                  ID: {recovery.emergencyId}
                </div>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          )}

          <div
            className="settings-item clickable"
            onClick={() => { window.open("/emergency", "_blank"); }}
            role="button" tabIndex={0}
          >
            <div className="settings-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div className="settings-item-content">
              <div className="settings-item-label">{t("portalLabel")}</div>
              <div className="settings-item-value muted">alphachat.sbs/emergency</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      </div>
    </div>
  );
}
