/**
 * LandingPage — Welcome Experience "Bunker Digitale"
 *
 * Una vera conversazione demo. L'utente vede Alpha Chat in azione —
 * stesse bolle, stesso header, stesso sfondo della chat reale.
 * Nessuna landing. Nessun marketing. Solo l'app.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../contexts/AuthContext";
import { unlockNotifAudio, playNotifSound } from "../lib/notifSound";
import RecoveryCardModal, { type RecoveryCardData } from "../components/RecoveryCardModal";
import RecoveryPage from "./RecoveryPage";
import { useTranslation } from "react-i18next";

// ── Script della conversazione ────────────────────────────────────────────────
type Speaker = "user" | "alpha" | "status";
interface Line { speaker: Speaker; text: string }

type TFn = (key: string) => string;

function buildScript(t: TFn): Line[] {
  return [
    { speaker: "user",   text: t("landing.script.q1") },
    { speaker: "alpha",  text: t("landing.script.a1") },
    { speaker: "user",   text: t("landing.script.q2") },
    { speaker: "alpha",  text: t("landing.script.a2") },
    { speaker: "user",   text: t("landing.script.q3") },
    { speaker: "alpha",  text: t("landing.script.a3") },
    { speaker: "user",   text: t("landing.script.q4") },
    { speaker: "alpha",  text: t("landing.script.a4") },
    { speaker: "user",   text: t("landing.script.q5") },
    { speaker: "alpha",  text: t("landing.script.a5") },
    { speaker: "user",   text: t("landing.script.q6") },
    { speaker: "alpha",  text: t("landing.script.a6") },
    { speaker: "user",   text: t("landing.script.q7") },
    { speaker: "alpha",  text: t("landing.script.a7") },
    { speaker: "user",   text: t("landing.script.q8") },
    { speaker: "alpha",  text: t("landing.script.a8") },
    { speaker: "user",   text: t("landing.script.q9") },
    { speaker: "alpha",  text: t("landing.script.a9") },
    { speaker: "user",   text: t("landing.script.q10") },
    { speaker: "alpha",  text: t("landing.script.a10") },
    { speaker: "user",   text: t("landing.script.q11") },
    { speaker: "alpha",  text: t("landing.script.a11") },
    { speaker: "user",   text: t("landing.script.q12") },
    { speaker: "alpha",  text: t("landing.script.a12") },
    { speaker: "user",   text: t("landing.script.q13") },
    { speaker: "alpha",  text: t("landing.script.a13") },
    { speaker: "user",   text: t("landing.script.q14") },
    { speaker: "alpha",  text: t("landing.script.a14") },
    { speaker: "user",   text: t("landing.script.q15") },
    { speaker: "alpha",  text: t("landing.script.a15") },
    { speaker: "status", text: t("landing.script.status1") },
    { speaker: "status", text: t("landing.script.status2") },
    { speaker: "status", text: t("landing.script.status3") },
    { speaker: "status", text: t("landing.script.status4") },
  ];
}

// Durata typing indicator per messaggi Alpha (ms)
const TYPING_MS = 550;
// Pausa dopo ogni messaggio prima del prossimo (ms)  
const GAP_MS    = 320;
// Delay extra per messaggi "user" (nessun typing, ma piccola pausa naturale)
const USER_PAUSE_MS = 420;


function vibrate() {
  try { navigator.vibrate?.(40); } catch { /* ignora */ }
}

// ── Icone occhio password ─────────────────────────────────────────────────────
const EyeOn = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const EyeOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

// ── Componente principale ─────────────────────────────────────────────────────
export default function LandingPage() {
  const { login, register } = useAuth();
  const { t } = useTranslation();

  // Script costruito in base alla lingua corrente
  const script = useMemo(() => buildScript(t), [t]);

  // Demo state
  const [started, setStarted]   = useState(false);  // diventa true al primo gesto
  const [visible, setVisible]   = useState<Line[]>([]);
  const [typing, setTyping]     = useState(false);
  const [done, setDone]         = useState(false);
  const msgsRef   = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);  // ref sincrona per l'handler evento

  // Auth modal
  const [showAuth, setShowAuth] = useState(false);
  const [tab, setTab]           = useState<"login" | "register">("login");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [loginId, setLoginId]   = useState("");
  const [loginPwd, setLoginPwd] = useState("");
  const [showLPwd, setShowLPwd] = useState(false);
  const [regUser, setRegUser]   = useState("");
  const [regName, setRegName]   = useState("");
  const [regPwd, setRegPwd]     = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [showRPwd, setShowRPwd] = useState(false);

  // Al primo gesto: sblocca audio sincrono + avvia sequenza
  useEffect(() => {
    function handleFirstGesture() {
      void unlockNotifAudio(); // unlock HTML5 Audio per tutta la sessione (richiesto da iOS)
    }
    const events = ["click", "touchstart", "mousemove", "keydown"] as const;
    events.forEach((e) => document.addEventListener(e, handleFirstGesture, { passive: true, once: true }));
    return () => events.forEach((e) => document.removeEventListener(e, handleFirstGesture));
  }, []);

  // Scroll to bottom
  const scrollBottom = useCallback(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollBottom();
  }, [visible, typing, scrollBottom]);

  // Sequenziatore — parte solo dopo il primo gesto (started = true)
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function runScript() {
      // Piccolo delay iniziale prima del primo messaggio
      await delay(400);
      for (let i = 0; i < script.length; i++) {
        if (cancelled) return;
        const line = script[i];

        if (line.speaker === "alpha") {
          setTyping(true);
          await delay(TYPING_MS);
          if (cancelled) return;
          setTyping(false);
        } else if (line.speaker === "user") {
          await delay(USER_PAUSE_MS);
          if (cancelled) return;
        } else {
          await delay(400);
          if (cancelled) return;
        }

        setVisible((prev) => [...prev, line]);
        if (line.speaker !== "status") {
          void playNotifSound('received');
          vibrate();
        }

        await delay(GAP_MS);
      }
      if (!cancelled) {
        timer = setTimeout(() => setDone(true), 600);
      }
    }

    void runScript();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [started, script]); // eslint-disable-line react-hooks/exhaustive-deps

  function openAuth(t: "login" | "register") {
    setTab(t); setError(""); setShowAuth(true);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try { await login({ identifier: loginId, password: loginPwd }); }
    catch (err) { setError((err as Error).message ?? t("auth.errors.generic")); }
    finally { setLoading(false); }
  }

  const [recoveryCard, setRecoveryCard] = useState<RecoveryCardData | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const result = await register({ username: regUser, display_name: regName, password: regPwd, ...(regEmail ? { email: regEmail } : {}) });
      // Sprint 22: mostra Recovery Card se presente
      if (result?.recovery_card) {
        const rc = result.recovery_card;
        setRecoveryCard({ username: regUser, emergency_id: rc.emergency_id, recovery_secret: rc.recovery_secret, version: rc.version, generated_at: rc.generated_at, checksum: rc.checksum });
      }
    }
    catch (err) { setError((err as Error).message ?? t("auth.errors.generic")); }
    finally { setLoading(false); }
  }

  // Recovery Page: render diretto, nessun overlay position:fixed
  // (html/body/#root hanno overflow:hidden che su iOS Safari clipa position:fixed)
  if (showRecovery) {
    return (
      <>
        <RecoveryPage onBack={() => setShowRecovery(false)} />
        {recoveryCard && createPortal(
          <RecoveryCardModal card={recoveryCard} onConfirm={() => setRecoveryCard(null)} />,
          document.body
        )}
      </>
    );
  }

  return (
    <>
    <div className="demo-root">

      {/* ── Header identico alla chat reale ──────────────────────────────── */}
      <header className="chat-header">
        <div style={{ width: 36, flexShrink: 0 }} />

        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Alpha Chat" className="demo-alpha-avatar" />

        <div className="chat-header-info">
          <div className="chat-header-name">Alpha Chat</div>
          <div className="chat-header-status online">{t("landing.tagline")}</div>
        </div>

        <div className="chat-header-actions">
          <button className="header-icon-btn" onClick={() => openAuth("login")} aria-label={t("auth.login")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
        </div>
      </header>

      {/* ── Area messaggi ─────────────────────────────────────────────────── */}
      <div className="messages demo-messages" ref={msgsRef}>

        {/* Waiting state — visibile finché l'utente non interagisce */}
        {!started && (
          <div className="demo-waiting" onClick={() => { setStarted(true); startedRef.current = true; void playNotifSound('received'); }}>
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Alpha Chat" className="demo-waiting-logo" />
            <p className="demo-waiting-hint">{t("landing.tapToStart")}</p>
          </div>
        )}

        {visible.map((line, i) => {
          if (line.speaker === "status") {
            return (
              <div key={i} className="demo-status-line demo-msg-enter">
                {line.text}
              </div>
            );
          }
          const isMine = line.speaker === "user";
          return (
            <div key={i} className={`msg-row ${isMine ? "mine" : "theirs"} demo-msg-enter`}>
              {!isMine && <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="α" className="demo-alpha-avatar demo-alpha-avatar--sm" />}
              <div className={`msg-bubble ${isMine ? "mine" : "theirs"}`}>
                <span className="msg-text" style={{ whiteSpace: "pre-line" }}>
                  {line.text}
                </span>
              </div>
            </div>
          );
        })}

        {/* Typing indicator Alpha */}
        {typing && (
          <div className="msg-row theirs demo-msg-enter">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="α" className="demo-alpha-avatar demo-alpha-avatar--sm" />
            <div className="msg-bubble theirs typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom: input disabilitato + CTA ─────────────────────────────── */}
      <div className="demo-input-wrap">
        <form className="chat-input-bar" onSubmit={(e) => e.preventDefault()}>
          <button type="button" className="input-icon-btn" disabled aria-label="Emoji">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 13s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </button>
          <button type="button" className="input-icon-btn" disabled aria-label={t("chat.sendFile")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          <textarea
            className="chat-textarea"
            placeholder={t("landing.signIn") + " · " + t("chat.startChat").toLowerCase()}
            disabled rows={1}
          />
          <button type="button" className="send-btn mic-btn" disabled aria-label={t("chat.voiceMessage")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
        </form>

        {/* CTA — compaiono dopo la fine della conversazione */}
        <div className={`demo-cta-footer ${done ? "demo-cta-visible" : "demo-cta-hidden"}`}>
          <button className="demo-cta-primary" onClick={() => openAuth("register")}>
            {t("landing.createAccount")}
          </button>
          <button className="demo-cta-secondary" onClick={() => openAuth("login")}>
            {t("landing.signIn")}
          </button>
        </div>
      </div>

      {/* ── Auth bottom sheet ─────────────────────────────────────────────── */}
      {showAuth && (
        <div className="auth-modal-overlay" onClick={() => setShowAuth(false)}>
          <div className="auth-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-handle" />

            <button className="auth-modal-close" onClick={() => setShowAuth(false)} aria-label={t("common.close")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            <div className="auth-modal-logo">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="α" width="40" height="40"
                style={{ borderRadius: "50%" }} />
              <span>Alpha Chat</span>
            </div>

            <div className="auth-tabs">
              <button className={`auth-tab ${tab === "login" ? "active" : ""}`}
                onClick={() => { setTab("login"); setError(""); }}>{t("auth.login")}</button>
              <button className={`auth-tab ${tab === "register" ? "active" : ""}`}
                onClick={() => { setTab("register"); setError(""); }}>{t("auth.register")}</button>
            </div>

            {error && <div className="auth-error">{error}</div>}

            {tab === "login" && (
              <form onSubmit={handleLogin} className="auth-form">
                <label className="auth-label">{t("auth.usernameOrEmail")}</label>
                <input className="auth-input" type="text" value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="marco" required autoFocus
                  autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                <label className="auth-label">{t("auth.password")}</label>
                <div className="pwd-wrapper">
                  <input className="auth-input pwd-input"
                    type={showLPwd ? "text" : "password"} value={loginPwd}
                    onChange={(e) => setLoginPwd(e.target.value)}
                    placeholder="••••••••" required autoComplete="current-password" />
                  <button type="button" className="pwd-toggle"
                    onClick={() => setShowLPwd((v) => !v)}
                    aria-label={showLPwd ? t("auth.hidePassword") : t("auth.showPassword")}>
                    {showLPwd ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
                <button className="auth-btn" type="submit" disabled={loading}>
                  {loading ? t("auth.loggingInShort") : t("auth.loginBtn")}
                </button>
              </form>
            )}

            {tab === "register" && (
              <form onSubmit={handleRegister} className="auth-form">
                <label className="auth-label">{t("auth.username")}</label>
                <input className="auth-input" type="text" value={regUser}
                  onChange={(e) => setRegUser(e.target.value.toLowerCase())}
                  placeholder="mario_rossi" pattern="[a-z0-9_.]+"
                  minLength={3} maxLength={32} required autoFocus
                  autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                <label className="auth-label">{t("auth.displayName")}</label>
                <input className="auth-input" type="text" value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Mario Rossi" minLength={1} maxLength={50} required />
                <label className="auth-label">{t("auth.password")}</label>
                <div className="pwd-wrapper">
                  <input className="auth-input pwd-input"
                    type={showRPwd ? "text" : "password"} value={regPwd}
                    onChange={(e) => setRegPwd(e.target.value)}
                    placeholder={t("auth.minCharsPlaceholder")} minLength={8} required
                    autoComplete="new-password" />
                  <button type="button" className="pwd-toggle"
                    onClick={() => setShowRPwd((v) => !v)}
                    aria-label={showRPwd ? t("auth.hidePassword") : t("auth.showPassword")}>
                    {showRPwd ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
                <label className="auth-label">{t("auth.email")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-3)", fontSize: "11px" }}>({t("auth.emailOptional")})</span></label>
                <input className="auth-input" type="email" value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder={t("auth.emailPlaceholder")}
                  autoComplete="email" autoCapitalize="none" />
                <button className="auth-btn" type="submit" disabled={loading}>
                  {loading ? t("auth.registering") : t("auth.registerTitle")}
                </button>
              </form>
            )}

            <p className="auth-hint">
              {tab === "login" ? t("auth.noAccount") + " " : t("auth.hasAccount") + " "}
              <button className="auth-link"
                onClick={() => { setTab(tab === "login" ? "register" : "login"); setError(""); }}>
                {tab === "login" ? t("auth.register") : t("auth.login")}
              </button>
            </p>
            {tab === "login" && (
              <p className="auth-hint" style={{ marginTop: 4 }}>
                <button className="auth-link" onClick={() => { setShowAuth(false); setShowRecovery(true); }}>
                  🔑 {t("auth.forgotPassword")}
                </button>
              </p>
            )}
          </div>
        </div>
      )}

    </div>

    {/* Recovery Card Modal — portal su document.body per bypassare overflow:hidden iOS */}
    {recoveryCard && createPortal(
      <RecoveryCardModal card={recoveryCard} onConfirm={() => setRecoveryCard(null)} />,
      document.body
    )}
    </>
  );
}

// Helper
function delay(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}
