/**
 * LandingPage — Welcome Experience
 *
 * L'utente vede subito una chat demo che trasmette l'identità di Alpha Chat.
 * Stesse classi CSS della chat reale — stesso sfondo, stesse bolle, stesso header.
 * Nessuna modifica al backend o al resto dell'app.
 */

import { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";

// ── Messaggi demo ────────────────────────────────────────────────────────────
const DEMO_MESSAGES = [
  "Benvenuto.",
  "Qui la tua privacy non è una funzione.",
  "È il punto di partenza.",
  "Il tuo bunker digitale.",
  "Solo chi inviti può trovarti.",
  "Nessuna ricerca pubblica.",
  "Nessun numero di telefono.",
  "Codici invito usa e getta.",
  "Messaggi protetti. Zero tracking.",
  "La privacy è la tua prima linea di difesa.",
  "Benvenuto in Alpha Chat.",
];

const TYPING_MS  = 650;   // durata indicatore "sta scrivendo"
const GAP_MS     = 350;   // pausa dopo ogni messaggio prima del prossimo

// Occhio per password
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

export default function LandingPage() {
  const { login, register } = useAuth();

  // ── Demo chat state ────────────────────────────────────────────────────────
  const [visibleMsgs, setVisibleMsgs] = useState<string[]>([]);
  const [isTyping, setIsTyping]       = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;

    function showNext() {
      if (idx >= DEMO_MESSAGES.length) return;

      // 1. Mostra typing
      setIsTyping(true);

      timer = setTimeout(() => {
        // 2. Aggiungi messaggio
        const msg = DEMO_MESSAGES[idx++];
        setIsTyping(false);
        setVisibleMsgs((prev) => [...prev, msg]);

        // 3. Pausa, poi il prossimo
        timer = setTimeout(showNext, GAP_MS);
      }, TYPING_MS);
    }

    // Primo messaggio dopo 800ms
    timer = setTimeout(showNext, 800);
    return () => clearTimeout(timer);
  }, []);

  // Scroll to bottom quando arrivano messaggi
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMsgs, isTyping]);

  // ── Auth modal state ───────────────────────────────────────────────────────
  const [showAuth, setShowAuth]   = useState(false);
  const [tab, setTab]             = useState<"login" | "register">("login");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);

  const [loginId, setLoginId]     = useState("");
  const [loginPwd, setLoginPwd]   = useState("");
  const [showLoginPwd, setShowLoginPwd] = useState(false);

  const [regUser, setRegUser]     = useState("");
  const [regName, setRegName]     = useState("");
  const [regPwd, setRegPwd]       = useState("");
  const [showRegPwd, setShowRegPwd]   = useState(false);

  function openAuth(t: "login" | "register") {
    setTab(t); setError(""); setShowAuth(true);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try { await login({ identifier: loginId, password: loginPwd }); }
    catch (err) { setError((err as Error).message ?? "Errore di accesso"); }
    finally { setLoading(false); }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    try { await register({ username: regUser, display_name: regName, password: regPwd }); }
    catch (err) { setError((err as Error).message ?? "Errore di registrazione"); }
    finally { setLoading(false); }
  }

  return (
    <div className="demo-root">

      {/* ── Header — identico al reale ─────────────────────────────────────── */}
      <header className="chat-header">
        {/* back placeholder (stessa struttura dell'header reale) */}
        <div style={{ width: 36 }} />

        {/* Avatar + nome */}
        <div className="chat-header-avatar" style={{ background: "linear-gradient(135deg,#6D28D9,#C026D3)", borderRadius: "50%", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
          α
        </div>
        <div className="chat-header-info">
          <div className="chat-header-name">Alpha Chat</div>
          <div className="chat-header-status online">sicuro e privato</div>
        </div>

        {/* Azioni header (icona profilo) */}
        <div className="chat-header-actions">
          <button
            className="header-icon-btn"
            onClick={() => openAuth("login")}
            aria-label="Accedi"
            title="Accedi"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
        </div>
      </header>

      {/* ── Area messaggi demo ────────────────────────────────────────────── */}
      <div className="messages demo-messages" ref={messagesRef}>
        {visibleMsgs.map((text, i) => (
          <div key={i} className="msg-row theirs demo-msg-enter">
            <div className="msg-bubble theirs">
              <span className="msg-text">{text}</span>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="msg-row theirs">
            <div className="msg-bubble theirs typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
      </div>

      {/* ── Input disabilitato ────────────────────────────────────────────── */}
      <div className="demo-input-wrap">
        <form className="chat-input-bar" onSubmit={(e) => e.preventDefault()}>
          <button type="button" className="input-icon-btn" disabled aria-label="Emoji">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </button>
          <button type="button" className="input-icon-btn" disabled aria-label="Allega">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          <textarea
            className="chat-textarea"
            placeholder="Accedi per iniziare una conversazione"
            disabled
            rows={1}
          />
          <button type="button" className="send-btn mic-btn" disabled aria-label="Microfono">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
        </form>

        {/* CTA fissi */}
        <div className="demo-cta-footer">
          <button className="demo-cta-primary" onClick={() => openAuth("register")}>
            Crea account
          </button>
          <button className="demo-cta-secondary" onClick={() => openAuth("login")}>
            Accedi
          </button>
        </div>
      </div>

      {/* ── Auth bottom sheet ─────────────────────────────────────────────── */}
      {showAuth && (
        <div className="auth-modal-overlay" onClick={() => setShowAuth(false)}>
          <div className="auth-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-handle" />
            <button className="auth-modal-close" onClick={() => setShowAuth(false)} aria-label="Chiudi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            <div className="auth-modal-logo">
              <img src={`${import.meta.env.BASE_URL}logo.png`} alt="α" width="40" height="40" style={{ borderRadius: "50%" }} />
              <span>Alpha Chat</span>
            </div>

            <div className="auth-tabs">
              <button className={`auth-tab ${tab === "login" ? "active" : ""}`}
                onClick={() => { setTab("login"); setError(""); }}>Accedi</button>
              <button className={`auth-tab ${tab === "register" ? "active" : ""}`}
                onClick={() => { setTab("register"); setError(""); }}>Registrati</button>
            </div>

            {error && <div className="auth-error">{error}</div>}

            {tab === "login" && (
              <form onSubmit={handleLogin} className="auth-form">
                <label className="auth-label">Username o Email</label>
                <input className="auth-input" type="text" value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="marco" required autoFocus
                  autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                <label className="auth-label">Password</label>
                <div className="pwd-wrapper">
                  <input className="auth-input pwd-input"
                    type={showLoginPwd ? "text" : "password"} value={loginPwd}
                    onChange={(e) => setLoginPwd(e.target.value)}
                    placeholder="••••••••" required autoComplete="current-password" />
                  <button type="button" className="pwd-toggle"
                    onClick={() => setShowLoginPwd((v) => !v)}
                    aria-label={showLoginPwd ? "Nascondi" : "Mostra"}>
                    {showLoginPwd ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
                <button className="auth-btn" type="submit" disabled={loading}>
                  {loading ? "Accesso…" : "Accedi"}
                </button>
              </form>
            )}

            {tab === "register" && (
              <form onSubmit={handleRegister} className="auth-form">
                <label className="auth-label">Username</label>
                <input className="auth-input" type="text" value={regUser}
                  onChange={(e) => setRegUser(e.target.value.toLowerCase())}
                  placeholder="mario_rossi" pattern="[a-z0-9_.]+"
                  minLength={3} maxLength={32} required autoFocus
                  autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                <label className="auth-label">Nome visualizzato</label>
                <input className="auth-input" type="text" value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Mario Rossi" minLength={1} maxLength={50} required />
                <label className="auth-label">Password</label>
                <div className="pwd-wrapper">
                  <input className="auth-input pwd-input"
                    type={showRegPwd ? "text" : "password"} value={regPwd}
                    onChange={(e) => setRegPwd(e.target.value)}
                    placeholder="Min. 8 caratteri" minLength={8} required
                    autoComplete="new-password" />
                  <button type="button" className="pwd-toggle"
                    onClick={() => setShowRegPwd((v) => !v)}
                    aria-label={showRegPwd ? "Nascondi" : "Mostra"}>
                    {showRegPwd ? <EyeOff /> : <EyeOn />}
                  </button>
                </div>
                <button className="auth-btn" type="submit" disabled={loading}>
                  {loading ? "Registrazione…" : "Crea account"}
                </button>
              </form>
            )}

            <p className="auth-hint">
              {tab === "login" ? "Non hai un account? " : "Hai già un account? "}
              <button className="auth-link"
                onClick={() => { setTab(tab === "login" ? "register" : "login"); setError(""); }}>
                {tab === "login" ? "Registrati" : "Accedi"}
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
