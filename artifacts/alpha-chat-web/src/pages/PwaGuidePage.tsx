/**
 * PwaGuidePage — Come installare AlphaChat come app
 * Guida passo-passo per iPhone (Safari) e Android (Chrome)
 * con illustrazioni emoji e istruzioni per abilitare le notifiche.
 */
import { useState } from "react";

interface Props {
  onBack: () => void;
}

export default function PwaGuidePage({ onBack }: Props) {
  const [tab, setTab] = useState<"iphone" | "android">("iphone");

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Installa AlphaChat</h1>
      </header>

      <div className="settings-body">

        {/* Hero */}
        <div className="pwa-hero">
          <div className="pwa-hero-icon">📲</div>
          <div className="pwa-hero-text">
            <div className="pwa-hero-title">Esperienza da app nativa</div>
            <div className="pwa-hero-sub">
              Aggiungi AlphaChat alla schermata Home e ricevi notifiche istantanee — senza passare dall'App Store.
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="pwa-benefits">
          <div className="pwa-benefit"><span>⚡</span><span>Avvio istantaneo</span></div>
          <div className="pwa-benefit"><span>🔔</span><span>Notifiche push</span></div>
          <div className="pwa-benefit"><span>📴</span><span>Funziona offline</span></div>
          <div className="pwa-benefit"><span>🔒</span><span>Nessun tracciamento store</span></div>
        </div>

        {/* Tab switcher */}
        <div className="pwa-tabs">
          <button
            className={`pwa-tab${tab === "iphone" ? " pwa-tab--active" : ""}`}
            onClick={() => setTab("iphone")}
          >
            🍎 iPhone
          </button>
          <button
            className={`pwa-tab${tab === "android" ? " pwa-tab--active" : ""}`}
            onClick={() => setTab("android")}
          >
            🤖 Android
          </button>
        </div>

        {/* ─── iPhone ─────────────────────────────────────────────── */}
        {tab === "iphone" && (
          <div className="pwa-steps">

            <div className="pwa-section-label">📱 Aggiungi alla schermata Home</div>

            <div className="pwa-step">
              <div className="pwa-step-num">1</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">Apri in Safari</div>
                <div className="pwa-step-desc">
                  Assicurati di usare <strong>Safari</strong> — Chrome e altri browser non supportano l'installazione su iPhone.
                </div>
                <div className="pwa-phone-mock">
                  <div className="pwa-mock-bar">
                    <span className="pwa-mock-dot" />
                    <span className="pwa-mock-url">🔒 alphachat.app</span>
                    <span className="pwa-mock-icon">⟳</span>
                  </div>
                  <div className="pwa-mock-tip">← Usa questo browser</div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">2</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">Tocca il pulsante Condividi</div>
                <div className="pwa-step-desc">
                  In basso al centro di Safari trovi il pulsante <strong>Condividi</strong>.
                </div>
                <div className="pwa-phone-mock">
                  <div className="pwa-mock-toolbar">
                    <span className="pwa-mock-tb-btn">←</span>
                    <span className="pwa-mock-tb-btn">→</span>
                    <span className="pwa-mock-tb-btn pwa-mock-tb-share">⬆</span>
                    <span className="pwa-mock-tb-btn">⊡</span>
                    <span className="pwa-mock-tb-btn">≡</span>
                  </div>
                  <div className="pwa-mock-arrow">↑ Tocca qui</div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">3</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">Scorri e tocca "Aggiungi a schermata Home"</div>
                <div className="pwa-step-desc">
                  Nel foglio di condivisione, scorri le opzioni verso il basso e cerca la voce.
                </div>
                <div className="pwa-share-sheet">
                  <div className="pwa-share-row">📬 <span>AirDrop</span></div>
                  <div className="pwa-share-row">✉️ <span>Mail</span></div>
                  <div className="pwa-share-row">💬 <span>Messaggi</span></div>
                  <div className="pwa-share-row pwa-share-row--highlight">
                    <span>⊞</span>
                    <span><strong>Aggiungi a schermata Home</strong></span>
                    <span className="pwa-share-arrow">›</span>
                  </div>
                  <div className="pwa-share-row">📋 <span>Copia link</span></div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">4</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">Tocca "Aggiungi"</div>
                <div className="pwa-step-desc">
                  Puoi modificare il nome oppure toccare direttamente <strong>Aggiungi</strong> in alto a destra.
                </div>
                <div className="pwa-confirm-mock">
                  <div className="pwa-confirm-header">
                    <span className="pwa-confirm-cancel">Annulla</span>
                    <span className="pwa-confirm-title">Aggiungi a schermata Home</span>
                    <span className="pwa-confirm-add">Aggiungi</span>
                  </div>
                  <div className="pwa-confirm-icon">🔒</div>
                  <div className="pwa-confirm-name">AlphaChat</div>
                </div>
              </div>
            </div>

            <div className="pwa-step pwa-step--success">
              <div className="pwa-step-num">✓</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">AlphaChat è sulla tua Home!</div>
                <div className="pwa-step-desc">
                  Troverai l'icona nella schermata Home. Aprila — si avvierà a schermo intero come un'app nativa.
                </div>
              </div>
            </div>

            {/* Notifications iPhone */}
            <div className="pwa-section-label" style={{ marginTop: 24 }}>🔔 Abilita le notifiche (iPhone)</div>

            <div className="pwa-notif-box">
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">1</span>
                <span>Apri AlphaChat <strong>dalla schermata Home</strong> (non da Safari)</span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">2</span>
                <span>Vai su <strong>Impostazioni → Notifiche</strong></span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">3</span>
                <span>Tocca <strong>"Abilita notifiche push"</strong></span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">4</span>
                <span>Tocca <strong>"Consenti"</strong> nel popup di sistema iOS</span>
              </div>
            </div>

            <div className="pwa-note">
              <span>⚠️</span>
              <span>Le notifiche push su iPhone funzionano solo se AlphaChat è installata come app dalla schermata Home. Non funzionano da Safari.</span>
            </div>
          </div>
        )}

        {/* ─── Android ─────────────────────────────────────────────── */}
        {tab === "android" && (
          <div className="pwa-steps">

            <div className="pwa-section-label">📱 Aggiungi alla schermata Home</div>

            <div className="pwa-step">
              <div className="pwa-step-num">1</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">Apri in Chrome</div>
                <div className="pwa-step-desc">
                  Usa <strong>Google Chrome</strong> per la migliore esperienza di installazione su Android.
                </div>
                <div className="pwa-phone-mock">
                  <div className="pwa-mock-bar">
                    <span className="pwa-mock-dot" />
                    <span className="pwa-mock-url">🔒 alphachat.app</span>
                    <span className="pwa-mock-icon">⋮</span>
                  </div>
                  <div className="pwa-mock-tip">← Usa questo browser</div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">2</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">Tocca il menu ⋮</div>
                <div className="pwa-step-desc">
                  Tocca i <strong>tre puntini verticali</strong> in alto a destra di Chrome.
                </div>
                <div className="pwa-phone-mock">
                  <div className="pwa-mock-bar">
                    <span className="pwa-mock-url" style={{ flex: 1 }}>🔒 alphachat.app</span>
                    <span className="pwa-mock-icon pwa-mock-icon--highlight">⋮</span>
                  </div>
                  <div className="pwa-mock-arrow" style={{ textAlign: "right" }}>↑ Tocca qui</div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">3</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">Tocca "Aggiungi a schermata Home"</div>
                <div className="pwa-step-desc">
                  Oppure se vedi il banner <em>"Installa app"</em> in basso, toccalo direttamente.
                </div>
                <div className="pwa-share-sheet">
                  <div className="pwa-share-row">🔖 <span>Aggiungi ai preferiti</span></div>
                  <div className="pwa-share-row pwa-share-row--highlight">
                    <span>⊞</span>
                    <span><strong>Aggiungi a schermata Home</strong></span>
                    <span className="pwa-share-arrow">›</span>
                  </div>
                  <div className="pwa-share-row">🖨️ <span>Stampa</span></div>
                  <div className="pwa-share-row">ℹ️ <span>Info sito</span></div>
                </div>
                <div className="pwa-or-divider">oppure</div>
                <div className="pwa-install-banner">
                  <span>🔒</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Installa AlphaChat</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>alphachat.app</div>
                  </div>
                  <button className="pwa-install-btn">Installa</button>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">4</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">Tocca "Installa"</div>
                <div className="pwa-step-desc">
                  Conferma toccando <strong>Installa</strong> nel popup di sistema Android.
                </div>
                <div className="pwa-confirm-mock">
                  <div className="pwa-confirm-icon">🔒</div>
                  <div className="pwa-confirm-name">AlphaChat</div>
                  <div className="pwa-confirm-domain">alphachat.app</div>
                  <div className="pwa-confirm-actions">
                    <span className="pwa-confirm-cancel-btn">Annulla</span>
                    <span className="pwa-confirm-install-btn">Installa</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pwa-step pwa-step--success">
              <div className="pwa-step-num">✓</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">AlphaChat è installata!</div>
                <div className="pwa-step-desc">
                  Troverai l'icona nel cassetto delle app e nella schermata Home. Si apre come un'app nativa, a schermo intero.
                </div>
              </div>
            </div>

            {/* Notifications Android */}
            <div className="pwa-section-label" style={{ marginTop: 24 }}>🔔 Abilita le notifiche (Android)</div>

            <div className="pwa-notif-box">
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">1</span>
                <span>Apri AlphaChat installata</span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">2</span>
                <span>Vai su <strong>Impostazioni → Notifiche</strong></span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">3</span>
                <span>Tocca <strong>"Abilita notifiche push"</strong></span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">4</span>
                <span>Tocca <strong>"Consenti"</strong> nel popup Android</span>
              </div>
            </div>

            <div className="pwa-note pwa-note--green">
              <span>✅</span>
              <span>Su Android le notifiche funzionano in modo affidabile sia da browser che dall'app installata.</span>
            </div>
          </div>
        )}

        {/* Troubleshooting */}
        <div className="pwa-section-label" style={{ marginTop: 8 }}>🛠️ Problemi comuni</div>
        <div className="pwa-faq">
          <details className="pwa-faq-item">
            <summary>Non vedo "Aggiungi a schermata Home" su iPhone</summary>
            <p>Assicurati di usare Safari (non Chrome o Firefox). L'opzione appare solo in Safari.</p>
          </details>
          <details className="pwa-faq-item">
            <summary>Le notifiche non arrivano su iPhone</summary>
            <p>Apri AlphaChat dalla schermata Home (non da Safari) e vai in Impostazioni → Notifiche. Verifica anche che le notifiche siano abilitate in Impostazioni iOS → AlphaChat.</p>
          </details>
          <details className="pwa-faq-item">
            <summary>Il banner di installazione non appare su Android</summary>
            <p>Prova via menu ⋮ → Aggiungi a schermata Home. Se non compare nemmeno lì, prova a ricaricare la pagina o a svuotare la cache di Chrome.</p>
          </details>
          <details className="pwa-faq-item">
            <summary>Si apre ancora nel browser invece che come app</summary>
            <p>Cerca l'icona AlphaChat nel cassetto delle app, non aprire l'URL dal browser. Una volta installata, usa sempre l'icona dedicata.</p>
          </details>
        </div>

      </div>
    </div>
  );
}
