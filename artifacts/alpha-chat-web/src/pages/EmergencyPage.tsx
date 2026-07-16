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
  const [step, setStep] = useState<Step>("form");
  const [username, setUsername] = useState("");
  const [phoenixCode, setPhoenixCode] = useState("");
  const [action, setAction] = useState<"lock" | "destroy">("lock");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmInfo, setConfirmInfo] = useState<ConfirmInfo | null>(null);
  const [countdown, setCountdown] = useState(10);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        setErrorMsg(data.error?.message ?? "Link non valido o scaduto.");
        setStep("error");
        return;
      }
      setConfirmInfo({ username: data.username, action: urlAction, token });
      setStep("confirm");
    } catch {
      setErrorMsg("Errore di connessione. Riprova.");
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
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error?.message ?? "Errore. Riprova.");
        return;
      }
      setStep("email-sent");
    } catch {
      setErrorMsg("Errore di connessione. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  function startCountdown() {
    setStep("countdown");
    setCountdown(10);
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
    setCountdown(10);
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
        setErrorMsg(data.error?.message ?? "Errore durante l'esecuzione.");
        setStep("error");
        return;
      }
      setStep("done");
    } catch {
      setErrorMsg("Errore di connessione.");
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
          <div className="emergency-logo">α</div>
          <div className="emergency-brand">Alpha Chat</div>
          <div className="emergency-tagline">PORTALE DI EMERGENZA</div>
        </div>

        {step === "form" && (
          <form onSubmit={handleSubmit} className="emergency-form">
            <p className="emergency-desc">
              Usa questo portale se hai perso accesso al tuo dispositivo o sospetti
              che il tuo account sia compromesso.
            </p>

            <label className="emergency-label">Username</label>
            <input
              className="emergency-input"
              type="text"
              placeholder="@username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
            />

            <label className="emergency-label">Phoenix Code</label>
            <input
              className="emergency-input"
              type="password"
              placeholder="La tua passphrase di emergenza"
              value={phoenixCode}
              onChange={(e) => setPhoenixCode(e.target.value)}
              required
              autoComplete="off"
            />

            <label className="emergency-label">Azione</label>
            <div className="emergency-actions">
              <button
                type="button"
                className={`emergency-action-btn${action === "lock" ? " selected" : ""}`}
                onClick={() => setAction("lock")}
              >
                <span className="emergency-action-icon">🔒</span>
                <span className="emergency-action-title">Emergency Lock</span>
                <span className="emergency-action-desc">Disconnetti tutti i dispositivi. Account recuperabile.</span>
              </button>
              <button
                type="button"
                className={`emergency-action-btn destroy${action === "destroy" ? " selected" : ""}`}
                onClick={() => setAction("destroy")}
              >
                <span className="emergency-action-icon">🔥</span>
                <span className="emergency-action-title">Phoenix Protocol</span>
                <span className="emergency-action-desc">Distruggi account, messaggi e chiavi. IRREVERSIBILE.</span>
              </button>
            </div>

            {errorMsg && <div className="emergency-error">{errorMsg}</div>}

            <button
              type="submit"
              className={`emergency-submit${action === "destroy" ? " danger" : ""}`}
              disabled={loading}
            >
              {loading ? "Verifica in corso…" : "Avvia procedura"}
            </button>
          </form>
        )}

        {step === "email-sent" && (
          <div className="emergency-state">
            <div className="emergency-state-icon">✉️</div>
            <h2>Email inviata</h2>
            <p>
              Se l'username e il Phoenix Code sono corretti, riceverai a breve
              un'email con il link di conferma.
            </p>
            <p className="emergency-hint">Il link scade in 15 minuti.</p>
          </div>
        )}

        {step === "confirm" && confirmInfo && (
          <div className="emergency-state">
            <div className="emergency-state-icon">
              {confirmInfo.action === "lock" ? "🔒" : "⚠️"}
            </div>
            <h2>
              {confirmInfo.action === "lock" ? "Emergency Lock" : "Phoenix Protocol"}
            </h2>
            <p>
              Stai per {confirmInfo.action === "lock"
                ? "disconnettere tutti i dispositivi"
                : "distruggere definitivamente l'account"}{" "}
              di <strong>@{confirmInfo.username}</strong>.
            </p>
            {confirmInfo.action === "destroy" && (
              <div className="emergency-warning">
                ⚠️ Questa azione è <strong>irreversibile</strong>. Account, messaggi,
                media e chiavi crittografiche saranno eliminati permanentemente.
              </div>
            )}
            <div className="emergency-confirm-buttons">
              <button
                className={`emergency-submit${confirmInfo.action === "destroy" ? " danger" : ""}`}
                onClick={startCountdown}
                disabled={loading}
              >
                Conferma
              </button>
              <button
                className="emergency-cancel"
                onClick={() => setStep("form")}
              >
                Annulla
              </button>
            </div>
          </div>
        )}

        {step === "countdown" && confirmInfo && (
          <div className="emergency-state">
            <div className={`emergency-countdown${confirmInfo.action === "destroy" ? " danger" : ""}`}>
              {countdown}
            </div>
            <p>La procedura si avvierà automaticamente tra {countdown} secondi.</p>
            <button className="emergency-cancel" onClick={cancelCountdown}>
              ✕ Annulla
            </button>
          </div>
        )}

        {step === "done" && confirmInfo && (
          <div className="emergency-state">
            <div className="emergency-state-icon">
              {confirmInfo.action === "lock" ? "✓" : "💀"}
            </div>
            <h2>
              {confirmInfo.action === "lock" ? "Dispositivi disconnessi" : "Account distrutto"}
            </h2>
            <p>
              {confirmInfo.action === "lock"
                ? "Tutte le sessioni sono state revocate. L'account è intatto e recuperabile."
                : "Il Phoenix Protocol è stato eseguito. L'account e tutti i dati associati sono stati eliminati definitivamente."}
            </p>
            {confirmInfo.action === "lock" && (
              <a href="/" className="emergency-submit" style={{ textDecoration: "none", textAlign: "center" }}>
                Torna al login
              </a>
            )}
          </div>
        )}

        {step === "error" && (
          <div className="emergency-state">
            <div className="emergency-state-icon">✗</div>
            <h2>Errore</h2>
            <p>{errorMsg || "Si è verificato un errore."}</p>
            <button className="emergency-submit" onClick={() => setStep("form")}>
              Riprova
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
