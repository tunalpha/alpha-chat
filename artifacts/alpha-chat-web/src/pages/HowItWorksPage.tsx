import { useEffect, useRef } from "react";

interface Props {
  onBack: () => void;
  onOpenWallet: () => void;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4.2 4.2L19 6.5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h13" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}

export default function HowItWorksPage({ onBack, onOpenWallet }: Props) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const isReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (isReduced || typeof IntersectionObserver === "undefined") {
      document.querySelectorAll(".hiw-anim").forEach((el) => el.classList.add("hiw-animate-in"));
      return;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("hiw-animate-in");
          observerRef.current?.unobserve(entry.target);
        }
      }),
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" },
    );

    document.querySelectorAll(".hiw-anim").forEach((el) => observerRef.current?.observe(el));
    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div className="settings-root hiw-root hiw2-root">
      <style>{`
        .settings-root.hiw2-root { width: 100%; min-width: 0; }
        .settings-body.hiw2-body {
          display: block !important;
          align-self: stretch;
          flex: 1 1 auto;
          min-height: 0;
          width: 100%;
          box-sizing: border-box;
          padding-bottom: calc(36px + var(--sab)) !important;
          overflow-x: hidden;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-y: contain;
          touch-action: pan-y;
        }
        .hiw2-body > .hiw2-hero,
        .hiw2-body > .hiw2-section,
        .hiw2-body > .hiw2-footer {
          width: 100%;
          margin-left: auto;
          margin-right: auto;
        }
      `}</style>
      <header className="settings-header hiw2-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Come funziona</h1>
      </header>

      <main className="settings-body hiw-body hiw2-body">
        <section className="hiw2-hero hiw-anim">
          <div className="hiw2-orb hiw2-orb--purple" />
          <div className="hiw2-orb hiw2-orb--green" />
          <div className="hiw2-hero-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2" />
              <path d="M16 12h5" />
              <path d="m18.5 9.5 2.5 2.5-2.5 2.5" />
              <path d="M3 7h17" />
            </svg>
          </div>
          <span className="hiw2-eyebrow">ALPHA CHAT · WALLET · MOVIMENTI</span>
          <h2>L'ecosistema Alpha</h2>
          <p>Parli, invii e tieni tutto sotto controllo nello stesso spazio. Con un percorso sempre chiaro, prima e dopo ogni operazione.</p>
        </section>

        <section className="hiw2-section hiw-anim">
          <div className="hiw2-section-head">
            <span>01</span>
            <div>
              <p>Due modi per partire</p>
              <h3>Scegli il tuo wallet</h3>
            </div>
          </div>
          <div className="hiw2-wallet-choices">
            <article className="hiw2-wallet-choice hiw2-wallet-choice--alpha">
              <span className="hiw2-choice-icon">A</span>
              <div>
                <small>ALPHA WALLET</small>
                <strong>Il wallet nativo</strong>
                <p>Creato e gestito direttamente in Alpha Chat.</p>
              </div>
              <span className="hiw2-choice-status"><CheckIcon /></span>
            </article>
            <div className="hiw2-choice-divider"><span>oppure</span></div>
            <article className="hiw2-wallet-choice">
              <span className="hiw2-choice-icon hiw2-choice-icon--outline">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" /><path d="M15 12h3" /><circle cx="15" cy="12" r=".5" fill="currentColor" /></svg>
              </span>
              <div>
                <small>WALLET ESTERNO</small>
                <strong>Il tuo wallet di terze parti</strong>
                <p>Collegalo quando preferisci usare un indirizzo già esistente.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="hiw2-section hiw-anim">
          <div className="hiw2-section-head">
            <span>02</span>
            <div>
              <p>Come inviare</p>
              <h3>Tre passi, una sola chat</h3>
            </div>
          </div>

          <div className="hiw2-phone-shot" aria-label="Esempio di schermata invio in chat">
            <div className="hiw2-phone-top">
              <span className="hiw2-avatar">M</span>
              <div><strong>Marco</strong><small>online ora</small></div>
              <i />
            </div>
            <div className="hiw2-chat-space">
              <div className="hiw2-message hiw2-message--friend">Ci sentiamo dopo?</div>
              <div className="hiw2-message hiw2-message--mine">Certo, ti invio ora la quota.</div>
              <div className="hiw2-pay-preview">
                <div><span className="hiw2-pay-spark">↗</span><small>INVIO SICURO</small></div>
                <strong>25,00 USDT</strong>
                <p>Marco · Polygon</p>
              </div>
            </div>
            <div className="hiw2-phone-action"><span>Scrivi un messaggio…</span><b>+</b></div>
          </div>

          <ol className="hiw2-steps">
            <li>
              <span className="hiw2-step-number">1</span>
              <div><strong>Apri una chat</strong><p>Scegli la persona a cui vuoi inviare.</p></div>
            </li>
            <li>
              <span className="hiw2-step-number">2</span>
              <div><strong>Scegli importo e rete</strong><p>Vedi sempre il riepilogo prima della firma.</p></div>
            </li>
            <li>
              <span className="hiw2-step-number">3</span>
              <div><strong>Conferma con calma</strong><p>Lo stato resta visibile direttamente nella chat.</p></div>
            </li>
          </ol>
        </section>

        <section className="hiw2-section hiw-anim">
          <div className="hiw2-section-head">
            <span>03</span>
            <div>
              <p>Il percorso cambia con il wallet</p>
              <h3>Tu vedi sempre dove sono i fondi</h3>
            </div>
          </div>

          <article className="hiw2-flow-card hiw2-flow-card--direct">
            <div className="hiw2-flow-copy">
              <div className="hiw2-flow-badge"><span className="hiw2-live-dot" /> PIÙ VELOCE</div>
              <h3>P2P Diretto (Alpha Wallet)</h3>
              <p>Quando entrambi usate Alpha Wallet, l’importo passa da wallet a wallet in un trasferimento diretto on-chain.</p>
            </div>
            <div className="hiw2-mini-shot hiw2-mini-shot--success" aria-label="Esempio di trasferimento completato">
              <span className="hiw2-success-ring"><CheckIcon /></span>
              <small>TRASFERIMENTO COMPLETATO</small>
              <strong>25,00 USDT</strong>
              <p>Inviati a Marco</p>
              <div><span>Rete</span><b>Polygon</b></div>
            </div>
          </article>

          <article className="hiw2-flow-card hiw2-flow-card--escrow">
            <div className="hiw2-flow-copy">
              <div className="hiw2-flow-badge hiw2-flow-badge--amber">PROTETTO</div>
              <h3>Sistema Escrow (Wallet Esterni)</h3>
              <p>Con un wallet esterno, Alpha Chat prepara un wallet escrow dedicato: deposito, verifica e rilascio oppure rimborso.</p>
            </div>
            <div className="hiw2-mini-shot hiw2-mini-shot--escrow" aria-label="Esempio di trasferimento protetto">
              <div className="hiw2-escrow-title"><span>⌁</span><strong>Protezione attiva</strong></div>
              <div className="hiw2-escrow-rail"><i className="is-done" /><i className="is-active" /><i /></div>
              <div className="hiw2-escrow-labels"><span>Deposito</span><span>Verifica</span><span>Rilascio</span></div>
              <p>Fondi verificati, pronti al rilascio.</p>
            </div>
          </article>
        </section>

        <section className="hiw2-section hiw-anim">
          <div className="hiw2-swap-card">
            <div className="hiw2-swap-icon" aria-hidden="true"><ArrowIcon /></div>
            <div>
              <span>SCAMBIA CON CONSAPEVOLEZZA</span>
              <h3>Come funziona lo swap</h3>
              <p>Selezioni cosa inviare e ricevere, rivedi i dettagli e firmi dal tuo wallet. Lo stato dello swap resta sempre consultabile in-app.</p>
            </div>
          </div>
        </section>

        <footer className="hiw2-footer hiw-anim">
          <div className="hiw2-footer-glow" />
          <span>IL TUO WALLET, NELLA TUA CHAT</span>
          <h3>Pronto a iniziare?</h3>
          <p>Attiva Alpha Wallet per avere un percorso più diretto, leggibile e tuo.</p>
          <button className="hiw-cta-btn hiw2-cta-btn" onClick={onOpenWallet}>Apri Alpha Wallet <ArrowIcon /></button>
        </footer>
      </main>
    </div>
  );
}