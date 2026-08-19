import { useEffect, useRef } from "react";

interface Props {
  onBack: () => void;
  onOpenWallet: () => void;
}

export default function HowItWorksPage({ onBack, onOpenWallet }: Props) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const isReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (isReduced || typeof IntersectionObserver === "undefined") {
      document.querySelectorAll(".hiw-anim").forEach((el) => {
        el.classList.add("hiw-animate-in");
      });
      return;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("hiw-animate-in");
            observerRef.current?.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );

    const els = document.querySelectorAll(".hiw-anim");
    els.forEach((el) => observerRef.current?.observe(el));

    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div className="settings-root hiw-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Come funziona</h1>
      </header>

      <div className="settings-body hiw-body">
        {/* Hero */}
        <div className="hiw-hero hiw-anim">
          <div className="hiw-hero-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </div>
          <h2 className="hiw-hero-title">L'ecosistema Alpha</h2>
          <p className="hiw-hero-subtitle">
            I tuoi messaggi, il tuo wallet e le tue operazioni: un'esperienza più semplice, senza rinunciare al controllo.
          </p>
        </div>

        <div className="hiw-section hiw-anim" style={{ transitionDelay: "100ms" }}>
          <div className="hiw-section-label">Due modi per partire</div>
          <div className="hiw-compare">
            <div className="hiw-compare-side hiw-compare-side--native">
              <div className="hiw-compare-kicker">Alpha Wallet</div>
              <strong>Il wallet nativo</strong>
              <span>Creato e gestito direttamente in Alpha Chat.</span>
            </div>
            <div className="hiw-compare-divider">oppure</div>
            <div className="hiw-compare-side">
              <div className="hiw-compare-kicker">Wallet esterno</div>
              <strong>Il tuo wallet di terze parti</strong>
              <span>Collegalo quando preferisci usare un indirizzo già esistente.</span>
            </div>
          </div>
        </div>

        <div className="hiw-section hiw-anim" style={{ transitionDelay: "130ms" }}>
          <div className="hiw-section-label">L'esperienza nativa</div>
          <div className="hiw-card">
            <div className="hiw-card-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M8 10h.01" />
                <path d="M12 10h.01" />
                <path d="M16 10h.01" />
              </svg>
            </div>
            <h3 className="hiw-card-title">Tutto all'interno della chat</h3>
            <p className="hiw-card-desc">
              Con <strong>Alpha Wallet</strong> non devi interrompere la conversazione per aprire un'altra app, copiare un indirizzo o riconnettere un wallet. Invia, ricevi e gestisci i fondi nello stesso spazio in cui parli con le persone.
            </p>
          </div>
        </div>

        <div className="hiw-section hiw-anim" style={{ transitionDelay: "150ms" }}>
          <div className="hiw-section-label">Come inviare</div>
          <div className="hiw-flow hiw-card">
            <div className="hiw-flow-step">
              <span>1</span>
              <p><strong>Apri una chat</strong><small>Scegli la persona a cui vuoi inviare.</small></p>
            </div>
            <div className="hiw-flow-line" aria-hidden="true" />
            <div className="hiw-flow-step">
              <span>2</span>
              <p><strong>Scegli importo e rete</strong><small>Vedrai sempre il riepilogo prima della firma.</small></p>
            </div>
            <div className="hiw-flow-line" aria-hidden="true" />
            <div className="hiw-flow-step">
              <span>3</span>
              <p><strong>Conferma e monitora</strong><small>Lo stato rimane visibile nella conversazione.</small></p>
            </div>
          </div>
        </div>

        <div className="hiw-section hiw-anim" style={{ transitionDelay: "180ms" }}>
          <div className="hiw-section-label">Il percorso cambia con il wallet</div>
          <div className="hiw-card hiw-card--direct">
            <div className="hiw-card-icon hiw-icon-green">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <h3 className="hiw-card-title">P2P Diretto (Alpha Wallet)</h3>
            <p className="hiw-card-desc">
              Quando sia tu sia il tuo contatto avete configurato Alpha Wallet, l'importo viaggia in <strong>un trasferimento diretto on-chain</strong>, da wallet a wallet. Meno passaggi, meno attese, tutto senza uscire dalla chat.
            </p>
          </div>

          <div className="hiw-card hiw-card--escrow">
            <div className="hiw-card-icon hiw-icon-amber">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3 className="hiw-card-title">Sistema Escrow (Wallet Esterni)</h3>
            <p className="hiw-card-desc">
              Se usi un wallet di terze parti, Alpha Chat prepara un <strong>wallet escrow dedicato</strong>. Depositi lì l'importo, il sistema ne verifica l'arrivo e poi lo rilascia al destinatario. Se l'operazione non può proseguire, il flusso prevede il rimborso.
            </p>
            <div className="hiw-escrow-path" aria-label="Deposito, verifica e rilascio">
              <span>Deposito</span><i>→</i><span>Verifica</span><i>→</i><span>Rilascio</span>
            </div>
          </div>
        </div>

        <div className="hiw-section hiw-anim" style={{ transitionDelay: "210ms" }}>
          <div className="hiw-section-label">Come funziona lo swap</div>
          <div className="hiw-card">
            <div className="hiw-card-icon hiw-icon-purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 16 4 4 4-4" />
                <path d="M7 20V4" />
                <path d="m21 8-4-4-4 4" />
                <path d="M17 4v16" />
              </svg>
            </div>
            <h3 className="hiw-card-title">Swap Istantanei</h3>
            <p className="hiw-card-desc">
              Selezioni ciò che vuoi inviare e ciò che vuoi ricevere. Prima di firmare, Alpha Chat mostra il riepilogo dell'operazione; poi la firma resta nel tuo wallet e lo stato dello swap rimane sempre consultabile in-app.
            </p>
          </div>
        </div>

        <div className="hiw-footer hiw-anim" style={{ transitionDelay: "240ms" }}>
          <h3 className="hiw-footer-title">Pronto per iniziare?</h3>
          <p className="hiw-footer-desc">Attiva Alpha Wallet per un'esperienza finanziaria fluida e perfettamente integrata nella chat.</p>
          <button className="hiw-cta-btn" onClick={onOpenWallet}>
            Apri Alpha Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
