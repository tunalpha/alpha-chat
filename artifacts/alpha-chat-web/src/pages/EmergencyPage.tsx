/**
 * EmergencyPage — Sprint 18 — Phoenix Protocol
 *
 * Accessibile SENZA autenticazione da qualsiasi browser.
 * URL: alphachat.sbs/emergency  (o emergency.alphachat.sbs in futuro)
 *
 * Flusso:
 *   1. Username + Phoenix Code + scelta azione → Avvia procedura
 *   2. Server invia email con link monouso
 *   3. Utente torna su questa pagina con ?token=... → countdown + conferma
 */

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

type Step = "form" | "email-sent" | "confirm" | "countdown" | "done" | "error";

interface ConfirmInfo {
  username: string;
  action: "lock" | "destroy";
  token: string;
}

const BASE = "/api/v1/phoenix";

async function apiPost(path: string, body: object): Promise<Response> {
  return fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export default function EmergencyPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("form");
  const [username, setUsername] = useState("");
  const [phoenixCode, setPhoenixCode] = useState("");
  const [emergencyId, setEmergencyId] = useState("");
  const [action, setAction] = useState<"lock" | "destroy">("lock");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmInfo, setConfirmInfo] = useState<ConfirmInfo | null>(null);
  const [countdown, setCountdown] = useState(10);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Override dell'overflow globale (html/body/#root hanno overflow:hidden via CSS).
  // Usiamo una classe CSS con !important invece di inline styles,
  // perché su iOS Safari gli inline styles senza !important vengono ignorati
  // quando il foglio di stile ha selettori ad alta specificità.
  useEffect(() => {
    document.documentElement.classList.add("emergency-open");
    return () => {
      document.documentElement.classList.remove("emergency-open");
    };
  }, []);

  // Rileva token nell'URL (link da email)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const urlAction = params.get("action") as "lock" | "destroy" | null;
    if (token && urlAction) {
      void validateToken(token, urlAction);
    }
  }, []);

  async function validateToken(token: string, urlAction: "lock" | "destroy") {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/confirm?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setErrorMsg(data.error?.message ?? t("emergency.invalidLink"));
        setStep("error");
        return;
      }
      setConfirmInfo({ username: data.username, action: urlAction, token });
      setStep("confirm");
    } catch {
      setErrorMsg(t("emergency.connectionError"));
      setStep("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await apiPost("/initiate", {
        username: username.trim(),
        phoenix_code: phoenixCode,
        action,
        ...(action === "destroy" ? { emergency_id: emergencyId.trim() } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error?.message ?? t("common.error"));
        return;
      }
      setStep("email-sent");
    } catch {
      setErrorMsg(t("emergency.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  // 30s per destroy (irreversibile), 10s per lock
  const COUNTDOWN_SECS = confirmInfo?.action === "destroy" ? 30 : 10;

  function startCountdown() {
    const secs = confirmInfo?.action === "destroy" ? 30 : 10;
    setStep("countdown");
    setCountdown(secs);
    countdownRef.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(countdownRef.current!);
          void executeAction();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  }

  function cancelCountdown() {
    clearInterval(countdownRef.current!);
    setStep("confirm");
    setCountdown(COUNTDOWN_SECS);
  }

  async function executeAction() {
    if (!confirmInfo) return;
    setLoading(true);
    try {
      const res = await apiPost("/execute", {
        token: confirmInfo.token,
        action: confirmInfo.action,
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error?.message ?? t("emergency.executionError"));
        setStep("error");
        return;
      }
      setStep("done");
    } catch {
      setErrorMsg(t("emergency.connectionError"));
      setStep("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="emergency-root">
      <div className="emergency-card">
        {/* Header */}
        <div className="emergency-header">
          <button
            className="emergency-close-btn"
            onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = "/")}
            aria-label={t("common.close")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <div className="emergency-logo">α</div>
          <div className="emergency-brand">Alpha Chat</div>
          <div className="emergency-tagline">{t("emergency.tagline")}</div>
        </div>

        {step === "form" && (
          <form onSubmit={handleSubmit} className="emergency-form">
            <p className="emergency-desc">
              {t("emergency.desc")}
            </p>

            <label className="emergency-label">{t("emergency.usernameLabel")}</label>
            <input
              className="emergency-input"
              type="text"
              placeholder={t("emergency.usernamePlaceholder")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
            />

            <label className="emergency-label">{t("emergency.phoenixCodeLabel")}</label>
            <input
              className="emergency-input"
              type="password"
              placeholder={t("emergency.phoenixCodePlaceholder")}
              value={phoenixCode}
              onChange={(e) => setPhoenixCode(e.target.value)}
              required
              autoComplete="off"
            />

            <label className="emergency-label">{t("emergency.actionLabel")}</label>
            <div className="emergency-actions">
              <button
                type="button"
                className={`emergency-action-btn${action === "lock" ? " selected" : ""}`}
                onClick={() => setAction("lock")}
              >
                <span className="emergency-action-icon">🔒</span>
                <span className="emergency-action-title">{t("emergency.lockTitle")}</span>
                <span className="emergency-action-desc">{t("emergency.lockDesc")}</span>
              </button>
              <button
                type="button"
                className={`emergency-action-btn destroy${action === "destroy" ? " selected" : ""}`}
                onClick={() => setAction("destroy")}
              >
                <span className="emergency-action-icon">🔥</span>
                <span className="emergency-action-title">{t("emergency.phoenixTitle")}</span>
                <span className="emergency-action-desc">{t("emergency.phoenixDesc")}</span>
              </button>
            </div>

            {action === "destroy" && (
              <>
                <label className="emergency-label">
                  {t("emergency.emergencyIdLabel")}
                  <span className="emergency-label-hint">{t("emergency.emergencyIdHint")}</span>
                </label>
                <input
                  className="emergency-input emergency-input--mono"
                  type="text"
                  placeholder={t("emergency.emergencyIdPlaceholder")}
                  value={emergencyId}
                  onChange={(e) => setEmergencyId(e.target.value.toUpperCase())}
                  required={action === "destroy"}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={9}
                />
              </>
            )}

            {errorMsg && <div className="emergency-error">{errorMsg}</div>}

            <button
              type="submit"
              className={`emergency-submit${action === "destroy" ? " danger" : ""}`}
              disabled={loading}
            >
              {loading ? t("emergency.verifying") : t("emergency.submit")}
            </button>
          </form>
        )}

        {step === "email-sent" && (
          <div className="emergency-state">
            <div className="emergency-state-icon">✉️</div>
            <h2>{t("emergency.emailSentTitle")}</h2>
            <p>{t("emergency.emailSentDesc")}</p>
            <p className="emergency-hint">{t("emergency.emailSentHint")}</p>
          </div>
        )}

        {step === "confirm" && confirmInfo && (
          <div className="emergency-state">
            <div className="emergency-state-icon">
              {confirmInfo.action === "lock" ? "🔒" : "⚠️"}
            </div>
            <h2>
              {confirmInfo.action === "lock" ? t("emergency.lockTitle") : t("emergency.phoenixTitle")}
            </h2>
            <p>
              {confirmInfo.action === "lock"
                ? t("emergency.confirmDescLock")
                : t("emergency.confirmDescPhoenix")}{" "}
              <strong>@{confirmInfo.username}</strong>.
            </p>
            {confirmInfo.action === "destroy" && (
              <div className="emergency-warning">
                {t("emergency.confirmWarning")}
              </div>
            )}
            <div className="emergency-confirm-buttons">
              <button
                className={`emergency-submit${confirmInfo.action === "destroy" ? " danger" : ""}`}
                onClick={startCountdown}
                disabled={loading}
              >
                {t("emergency.confirm")}
              </button>
              <button
                className="emergency-cancel"
                onClick={() => setStep("form")}
              >
                {t("emergency.cancel")}
              </button>
            </div>
          </div>
        )}

        {step === "countdown" && confirmInfo && (
          <div className="emergency-state">
            <div className={`emergency-countdown${confirmInfo.action === "destroy" ? " danger" : ""}`}>
              {countdown}
            </div>
            <p>{t("emergency.countdownText", { secs: countdown })}</p>
            <button className="emergency-cancel" onClick={cancelCountdown}>
              {t("emergency.cancelCountdown")}
            </button>
          </div>
        )}

        {step === "done" && confirmInfo && (
          <div className="emergency-state">
            <div className="emergency-state-icon">
              {confirmInfo.action === "lock" ? "✓" : "💀"}
            </div>
            <h2>
              {confirmInfo.action === "lock" ? t("emergency.doneLockTitle") : t("emergency.donePhoenixTitle")}
            </h2>
            <p>
              {confirmInfo.action === "lock"
                ? t("emergency.doneLockDesc")
                : t("emergency.donePhoenixDesc")}
            </p>
            {confirmInfo.action === "lock" && (
              <a href="/" className="emergency-submit" style={{ textDecoration: "none", textAlign: "center" }}>
                {t("emergency.backToLogin")}
              </a>
            )}
          </div>
        )}

        {step === "error" && (
          <div className="emergency-state">
            <div className="emergency-state-icon">✗</div>
            <h2>{t("emergency.errorTitle")}</h2>
            <p>{errorMsg || t("emergency.defaultError")}</p>
            <button className="emergency-submit" onClick={() => setStep("form")}>
              {t("emergency.retry")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
