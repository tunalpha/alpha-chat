import { useEffect, useRef, useState } from "react";

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
  const [isSwapGuideOpen, setIsSwapGuideOpen] = useState(false);

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

  useEffect(() => {
    if (!isSwapGuideOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSwapGuideOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isSwapGuideOpen]);

  return (
    <div className="settings-root hiw-root hiw2-root">
      <style>{`
         /*
          * Il page shell può essere compresso dal contenitore della view
          * mobile mentre l'header resta viewport-wide. In quel caso le card
          * risultano centrate su una colonna più stretta e appaiono spostate
          * a sinistra. Questa pagina deve occupare esattamente il viewport.
          */
         .settings-root.hiw2-root {
           width: 100vw;
           min-width: 100vw;
           max-width: 100vw;
           align-self: flex-start;
           box-sizing: border-box;
         }
        .settings-body.hiw2-body {
          display: block !important;
          align-self: stretch;
          flex: 1 1 auto;
          min-height: 0;
           width: 100vw;
           max-width: 100vw;
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
                <div className="hiw2-wallet-label">
                  <small>ALPHA WALLET</small>
                  <span className="hiw2-recommended-badge"><CheckIcon /> RACCOMANDATO</span>
                </div>
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
          <button
            type="button"
            className="hiw2-swap-card"
            onClick={() => setIsSwapGuideOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isSwapGuideOpen}
          >
            <div className="hiw2-swap-icon" aria-hidden="true"><ArrowIcon /></div>
            <div>
              <span>SCAMBIA CON CONSAPEVOLEZZA</span>
              <h3>Come funziona lo swap</h3>
              <p>Selezioni cosa inviare e ricevere, rivedi i dettagli e firmi dal tuo wallet. Lo stato dello swap resta sempre consultabile in-app.</p>
            </div>
            <span className="hiw2-swap-card-hint" aria-hidden="true">Apri guida</span>
          </button>
        </section>

        <footer className="hiw2-footer hiw-anim">
          <div className="hiw2-footer-glow" />
          <span>IL TUO WALLET, NELLA TUA CHAT</span>
          <h3>Pronto a iniziare?</h3>
          <p>Attiva Alpha Wallet per avere un percorso più diretto, leggibile e tuo.</p>
          <button className="hiw-cta-btn hiw2-cta-btn" onClick={onOpenWallet}>Apri Alpha Wallet <ArrowIcon /></button>
        </footer>
      </main>

      {isSwapGuideOpen && (
        <div
          className="hiw2-swap-modal-backdrop"
          onClick={() => setIsSwapGuideOpen(false)}
        >
          <div
            className="hiw2-swap-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hiw2-swap-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="hiw2-swap-modal-header">
              <div>
                <span>SWAP · GUIDA RAPIDA</span>
                <h2 id="hiw2-swap-modal-title">Scambia con chiarezza</h2>
              </div>
              <button
                type="button"
                className="hiw2-swap-modal-close"
                onClick={() => setIsSwapGuideOpen(false)}
                aria-label="Chiudi guida swap"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="hiw2-swap-modal-scroll">
            <p className="hiw2-swap-modal-intro">
              Scegli cosa inviare e cosa ricevere, controlla il riepilogo e firma solo quando tutto ti è chiaro.
            </p>

            {/* ── Schermata 1: Quotazione ─────────────────────────────────── */}
            <p className="hiw2-guide-section-label">① Quotazione</p>
            <div className="hiw2-swap-preview" aria-label="Anteprima schermata quotazione swap">
              <div className="hiw2-swap-preview-top">
                <span>Alpha Swap · EVM</span>
                <span className="hiw2-swap-preview-status">ESEMPIO</span>
              </div>

              {/* coppia token con loghi reali */}
              <div className="hiw2-swap-route">
                <div className="hiw2-swap-token">
                  <div className="hiw2-swap-token-head">
                    <img src="/coin-icons/pol.png" alt="" className="hiw2-token-logo" />
                    <strong>POL</strong>
                  </div>
                  <small>• Polygon</small>
                </div>
                <div className="hiw2-swap-route-arrow" aria-hidden="true">⇅</div>
                <div className="hiw2-swap-token hiw2-swap-token--receive">
                  <div className="hiw2-swap-token-head">
                    <img src="/coin-icons/usdc.png" alt="" className="hiw2-token-logo" />
                    <strong>USDC</strong>
                  </div>
                  <small>• Polygon</small>
                </div>
              </div>

              {/* importo stimato */}
              <div className="hiw2-swap-preview-estimated">
                <span>Riceverai circa</span>
                <strong>≈ 10.696922</strong>
              </div>

              {/* dettagli quotazione come nel vero swap */}
              <div className="hiw2-swap-quote-details">
                <div><span>Invii</span><b>134.318 POL</b></div>
                <div><span>Riceverai circa</span><b>10.696922 USDC</b></div>
                <div><span>Tasso</span><b>1 POL ≈ 0.079638 USDC</b></div>
                <div><span>Minimo da inviare</span><b>84.58 POL</b></div>
                <div className="hiw2-quote-fee-row"><span>Commissione Alpha</span><b className="hiw2-fee-none">Nessuna</b></div>
              </div>
            </div>

            {/* ── Schermata 2: Progress TX ─────────────────────────────────── */}
            <p className="hiw2-guide-section-label">② Stato in tempo reale</p>
            <div className="hiw2-swap-progress" aria-label="Anteprima schermata stato swap">
              <ol className="hiw2-progress-steps">
                <li className="hiw2-ps-done">
                  <span className="hiw2-ps-num"><CheckIcon /></span>
                  <div><strong>Deposito in attesa</strong></div>
                </li>
                <li className="hiw2-ps-active">
                  <span className="hiw2-ps-num"><span className="hiw2-ps-spin" aria-hidden="true" /></span>
                  <div>
                    <strong>Deposito rilevato</strong>
                    <p>ChangeNOW ha ricevuto i fondi</p>
                  </div>
                </li>
                <li><span className="hiw2-ps-num">3</span><div><strong>Conversione in corso</strong></div></li>
                <li><span className="hiw2-ps-num">4</span><div><strong>Invio token</strong></div></li>
                <li><span className="hiw2-ps-num">5</span><div><strong>Completato</strong></div></li>
              </ol>
              <div className="hiw2-progress-details">
                <div><span>Inviato</span><b>100 POL</b></div>
                <div><span>Stimato ricevuto</span><b>7.925 USDC</b></div>
                <div><span>Exchange ID</span><b className="hiw2-mono">0039a7aaa4c720</b></div>
                <div><span>TX deposito</span><b className="hiw2-mono">0x73b90fd29…</b></div>
              </div>
              <p className="hiw2-progress-note">Aggiornamento automatico ogni 15 secondi</p>
            </div>

            <ol className="hiw2-swap-modal-steps">
              <li>
                <span>1</span>
                <div><strong>Seleziona la coppia</strong><p>Indica il token e la rete da cui parti e quello che vuoi ricevere.</p></div>
              </li>
              <li>
                <span>2</span>
                <div><strong>Controlla il riepilogo</strong><p>Verifica importo, percorso, commissioni e indirizzo di destinazione.</p></div>
              </li>
              <li>
                <span>3</span>
                <div><strong>Firma dal tuo wallet</strong><p>Confermi tu l'operazione. Lo stato resta visibile nella cronologia.</p></div>
              </li>
            </ol>

            <button
              type="button"
              className="hiw2-swap-modal-done"
              onClick={() => setIsSwapGuideOpen(false)}
            >
              Ho capito
            </button>
            </div>{/* /hiw2-swap-modal-scroll */}
          </div>
        </div>
      )}
    </div>
  );
}