/**
 * UsdaSettingsPage — sezione "💸 Pagamenti USDA" nell'account utente.
 *
 * Stile fintech premium (Revolut · PayPal · Cash App · Wise):
 *   card moderne, emoji eleganti, UX rassicurante, zero linguaggio tecnico.
 *
 * Sezioni:
 *   1. Stato Wallet   — ThirdWeb ConnectButton, indirizzo auto, switch rete
 *   2. Guida USDA     — how-to in 4 passi
 *   3. Token USDA     — info copiabili + wallet_watchAsset
 *   4. Risorse        — link al sito ufficiale
 *   5. Sicurezza      — card rassicurante custody
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useActiveAccount, ConnectButton } from "thirdweb/react";

// ── HowItWorksDialog ─────────────────────────────────────────────────────────

const HOW_SLIDES = [
  {
    emoji: "💬",
    accent: "#6366f1",
    title: "Pagamenti nati per la chat",
    body: "Invia e ricevi USDA direttamente in una conversazione, come un messaggio — senza app esterne, senza commissioni nascoste.",
    visual: (
      <div className="hiw-chat-preview" aria-hidden="true">
        <div className="hiw-bubble hiw-bubble--out">
          <span className="hiw-bubble-pill">💸 HAI INVIATO</span>
          <strong>5 USDA</strong>
          <span className="hiw-bubble-sub">a Marco</span>
        </div>
        <div className="hiw-bubble hiw-bubble--in">
          <span className="hiw-bubble-pill">🎉 RICEVUTO</span>
          <strong>5 USDA</strong>
          <span className="hiw-bubble-sub">da Giulia</span>
        </div>
      </div>
    ),
  },
  {
    emoji: "🔐",
    accent: "#10b981",
    title: "Sicuro per design",
    body: "I tuoi fondi passano per un escrow on-chain su Polygon. AlphaChat non può toccarli — vengono rilasciati solo dopo la conferma blockchain.",
    visual: (
      <div className="hiw-flow" aria-hidden="true">
        <div className="hiw-flow-node hiw-flow-node--you">Tu</div>
        <div className="hiw-flow-arrow">
          <span className="hiw-flow-label">escrow</span>
          <span className="hiw-flow-line" />
          <span className="hiw-flow-label">⛓️</span>
        </div>
        <div className="hiw-flow-node hiw-flow-node--dest">Destinatario</div>
      </div>
    ),
  },
  {
    emoji: "⚡",
    accent: "#f59e0b",
    title: "In pochi secondi",
    body: "Firma con il tuo wallet, AlphaChat rileva il deposito on-chain e notifica il destinatario — tutto automatico, in tempo reale.",
    visual: (
      <div className="hiw-steps-vis" aria-hidden="true">
        {[
          { icon: "✍️", label: "Firma" },
          { icon: "⛓️", label: "Blockchain" },
          { icon: "🔔", label: "Notifica" },
          { icon: "✅", label: "Ricevuto" },
        ].map((s, i) => (
          <div key={i} className="hiw-step-vis">
            <div className="hiw-step-vis-dot">{s.icon}</div>
            <div className="hiw-step-vis-label">{s.label}</div>
            {i < 3 && <div className="hiw-step-vis-line" aria-hidden="true" />}
          </div>
        ))}
      </div>
    ),
  },
  {
    emoji: "📩",
    accent: "#8b5cf6",
    title: "Richiedi USDA ai tuoi contatti",
    body: "Usa il tasto 💸 in chat e scegli «Richiedi». Il pagamento arriva direttamente nel tuo wallet non appena l'altro firma.",
    visual: (
      <div className="hiw-chat-preview" aria-hidden="true">
        <div className="hiw-bubble hiw-bubble--req">
          <span className="hiw-bubble-pill">📩 RICHIESTA</span>
          <strong>10 USDA</strong>
          <div className="hiw-bubble-btn">Paga ora →</div>
        </div>
        <div className="hiw-bubble hiw-bubble--in hiw-bubble--small">
          <span className="hiw-bubble-pill">✅ PAGATA</span>
          <strong>Richiesta pagata!</strong>
        </div>
      </div>
    ),
  },
];

function HowItWorksDialog({ onClose }: { onClose: () => void }) {
  const [slide, setSlide] = useState(0);
  const total = HOW_SLIDES.length;
  const s = HOW_SLIDES[slide];
  const isLast = slide === total - 1;

  // Dismiss on backdrop click
  function onBackdrop(e: React.MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("hiw-backdrop")) onClose();
  }

  return (
    <div className="hiw-backdrop" role="dialog" aria-modal="true" aria-label="Come funzionano i pagamenti" onClick={onBackdrop}>
      <div className="hiw-sheet" style={{ "--hiw-accent": s.accent } as React.CSSProperties}>

        {/* Close */}
        <button type="button" className="hiw-close" aria-label="Chiudi" onClick={onClose}>✕</button>

        {/* Emoji accent */}
        <div className="hiw-emoji" aria-hidden="true">{s.emoji}</div>

        {/* Visual scene */}
        <div className="hiw-visual">{s.visual}</div>

        {/* Text */}
        <h2 className="hiw-title">{s.title}</h2>
        <p className="hiw-body">{s.body}</p>

        {/* Dots */}
        <div className="hiw-dots" role="tablist" aria-label="Slide">
          {HOW_SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === slide}
              aria-label={`Slide ${i + 1}`}
              className={`hiw-dot ${i === slide ? "hiw-dot--active" : ""}`}
              onClick={() => setSlide(i)}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="hiw-nav">
          {slide > 0 ? (
            <button type="button" className="hiw-btn-ghost" onClick={() => setSlide(slide - 1)}>← Indietro</button>
          ) : (
            <button type="button" className="hiw-btn-ghost" onClick={onClose}>Salta</button>
          )}
          {isLast ? (
            <button type="button" className="hiw-btn-primary" onClick={onClose}>🚀 Inizia ora</button>
          ) : (
            <button type="button" className="hiw-btn-primary" onClick={() => setSlide(slide + 1)}>Avanti →</button>
          )}
        </div>
      </div>
    </div>
  );
}
import {
  client,
  polygon,
  wallets,
  USDA_CONTRACT_ADDRESS,
  USDA_CHAIN_ID,
} from "../lib/thirdweb";
import { apiUsdaSetWalletAddress } from "../lib/usda-api";

// ── Costanti ─────────────────────────────────────────────────────────────────

const USDA_SYMBOL   = "USDA";
const USDA_DECIMALS = 18;
const USDA_NETWORK  = "Polygon Mainnet";
const USDA_SITE     = "https://getusda.xyz";
const USDA_LOGO     = "https://getusda.xyz/favicon.ico";

const WALLET_CHIPS = [
  { icon: "🦊", name: "MetaMask"     },
  { icon: "🐦", name: "Trust"        },
  { icon: "🔐", name: "WalletConnect"},
  { icon: "🪙", name: "Coinbase"     },
  { icon: "🌈", name: "Rainbow"      },
];

const GUIDE_STEPS = [
  { icon: "🔗", title: "Collega il wallet",         desc: "Connetti MetaMask, Trust Wallet, WalletConnect o qualsiasi wallet compatibile." },
  { icon: "🌐", title: "Rete Polygon automatica",   desc: "AlphaChat passa automaticamente a Polygon Mainnet — non devi fare nulla." },
  { icon: "🪙", title: "Aggiungi USDA al wallet",   desc: "Tocca «Aggiungi USDA» qui sotto per aggiungere il token in un clic." },
  { icon: "💸", title: "Invia e ricevi in chat",    desc: "Usa il tasto 💸 in qualsiasi conversazione per inviare o richiedere USDA." },
];

// ── ManualAddDialog ───────────────────────────────────────────────────────────

function ManualAddDialog({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copyAddr() {
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }
  function onBackdrop(e: React.MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("mad-backdrop")) onClose();
  }
  const shortAddr = `${address.slice(0, 8)}…${address.slice(-6)}`;

  return (
    <div className="mad-backdrop" role="dialog" aria-modal="true" aria-label="Come aggiungere USDA" onClick={onBackdrop}>
      <div className="mad-sheet">
        <button type="button" className="mad-close" aria-label="Chiudi" onClick={onClose}>✕</button>

        <div className="mad-emoji" aria-hidden="true">🪙</div>
        <h2 className="mad-title">Aggiungi USDA al wallet</h2>
        <p className="mad-subtitle">Segui questi passi nel tuo wallet preferito:</p>

        <ol className="mad-steps">
          <li><strong>Apri Trust Wallet</strong> (o MetaMask) e vai alla sezione <em>Token</em></li>
          <li>Tocca <strong>Aggiungi token personalizzato</strong></li>
          <li>Seleziona la rete <strong>Polygon</strong></li>
          <li>Incolla l'indirizzo del contratto qui sotto</li>
          <li>Symbol e decimali si compilano automaticamente → conferma</li>
        </ol>

        <div className="mad-addr-row">
          <span className="mad-addr-label">Contract Address</span>
          <button type="button" className="mad-addr-copy" onClick={copyAddr} aria-label="Copia indirizzo contratto">
            <span className="mad-addr-value">{shortAddr}</span>
            <span className="mad-addr-icon">{copied ? "✓" : "⎘"}</span>
          </button>
        </div>
        {copied && <p className="mad-copied" aria-live="polite">✓ Indirizzo copiato!</p>}

        <div className="mad-meta">
          <span>Symbol: <strong>USDA</strong></span>
          <span>Decimals: <strong>18</strong></span>
          <span>Rete: <strong>Polygon</strong></span>
        </div>

        <a
          href={`https://polygonscan.com/token/${address}`}
          target="_blank" rel="noopener noreferrer"
          className="mad-link"
        >
          🔗 Contratto su PolygonScan
        </a>

        <button type="button" className="mad-btn-ok" onClick={onClose}>Fatto ✓</button>
      </div>
    </div>
  );
}

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function UsdaSettingsPage({ onBack }: Props) {
  const account          = useActiveAccount();
  const address          = account?.address;
  const isConnected      = !!account;
  const isCorrectNetwork = !!account;

  // Traccia l'ultimo indirizzo già persistito per evitare scritture duplicate
  const lastPersistedRef = useRef<string | null>(null);

  // Persiste il wallet address in MongoDB quando il wallet si connette.
  // Senza questo step, preparePayment non trova il destinatario e restituisce
  // RECIPIENT_NO_WALLET anche se il Wallet Center mostra "✅ Wallet attivo".
  // Confronto case-insensitive (standard EVM) — skip se già salvato in questa sessione.
  useEffect(() => {
    console.log("[USDA][Settings] address:", address);
    if (!address) return;
    if (lastPersistedRef.current?.toLowerCase() === address.toLowerCase()) return;
    lastPersistedRef.current = address;
    console.log("[USDA][Settings] useEffect persist triggered");
    void (async () => {
      try {
        console.log("[USDA][Settings] calling apiUsdaSetWalletAddress", address);
        await apiUsdaSetWalletAddress(address);
        console.log("[USDA][Settings] apiUsdaSetWalletAddress SUCCESS");
      } catch (e) {
        console.error("[USDA][Settings] apiUsdaSetWalletAddress FAILED", e);
        lastPersistedRef.current = null;
      }
    })();
  }, [address]);

  const [copied,         setCopied]         = useState<string | null>(null);
  const [watchStatus,    setWatchStatus]    = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showManualAdd,  setShowManualAdd]  = useState(false);

  // ── Copy helpers ──────────────────────────────────────────────────────────
  const copy = useCallback((key: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    });
  }, []);


  // ── wallet_watchAsset ─────────────────────────────────────────────────────
  // Strategia a 3 livelli:
  //  1. account.watchAsset() — API nativa ThirdWeb v5, passa per WalletConnect
  //     → Trust Wallet su iOS riceve il popup nativo nell'app
  //  2. window.ethereum.request() — MetaMask extension / browser Trust/MM mobile
  //  3. Fallback manuale → dialog con istruzioni passo-passo + indirizzo copiabile
  async function handleAddToken() {
    // Se non connesso → mostra subito le istruzioni manuali, non caricare
    if (!isConnected) {
      setShowManualAdd(true);
      return;
    }

    setWatchStatus("loading");

    const watchAssetArg = {
      type:    "ERC20" as const,
      options: {
        address:  USDA_CONTRACT_ADDRESS as `0x${string}`,
        symbol:   USDA_SYMBOL,
        decimals: USDA_DECIMALS,
        image:    USDA_LOGO,
      },
    };

    // Livello 1 — ThirdWeb v5 account.watchAsset (→ WC → Trust Wallet iOS popup nativo)
    if (account?.watchAsset) {
      try {
        await account.watchAsset(watchAssetArg);
        setWatchStatus("ok");
        setTimeout(() => setWatchStatus("idle"), 3000);
        return;
      } catch {
        // Utente ha rifiutato → errore, senza ulteriori fallback
        setWatchStatus("err");
        setTimeout(() => setWatchStatus("idle"), 3000);
        return;
      }
    }

    // Livello 2 — window.ethereum (MetaMask extension / browser interno Trust/MM)
    try {
      const eth = (window as unknown as {
        ethereum?: { request: (args: { method: string; params?: unknown }) => Promise<unknown> };
      }).ethereum;
      if (eth?.request) {
        await eth.request({
          method: "wallet_watchAsset",
          params: { type: "ERC20", options: watchAssetArg.options },
        });
        setWatchStatus("ok");
        setTimeout(() => setWatchStatus("idle"), 3000);
        return;
      }
    } catch {
      setWatchStatus("err");
      setTimeout(() => setWatchStatus("idle"), 3000);
      return;
    }

    // Livello 3 — nessun provider disponibile → istruzioni manuali
    setWatchStatus("idle");
    setShowManualAdd(true);
  }

  // ── Abbrev indirizzo ──────────────────────────────────────────────────────
  function abbrev(addr: string) {
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
  }

  return (
    <div className="ups-root">

      <div className="ups-body">
        {/* ── Titolo + chiudi (nella zona scrollabile) ─────────────────────── */}
        <div className="ups-topbar">
          <div className="ups-header-inner">
            <span className="ups-header-icon" aria-hidden="true">💸</span>
            <h1 className="ups-header-title">Pagamenti USDA</h1>
          </div>
          <button
            type="button" className="ups-close" aria-label="Chiudi"
            onClick={onBack}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            1. STATO WALLET
        ══════════════════════════════════════════════════════════════════ */}
        <section className="ups-section" aria-label="Stato wallet">

          {/* Wallet non connesso */}
          {!isConnected && (
            <div className="ups-card ups-card--cta" aria-label="Collega wallet">
              <div className="ups-status-badge ups-status-badge--warn">🟡 Wallet non configurato</div>
              <p className="ups-card-headline">🚀 Attiva il tuo wallet in meno di un minuto</p>
              <p className="ups-card-body">
                Per inviare e ricevere USDA devi collegare un wallet compatibile con Polygon.
                Il tuo indirizzo viene letto automaticamente — non devi inserirlo.
              </p>
              <div className="usda-wallet-chips" aria-label="Wallet supportati" role="list">
                {WALLET_CHIPS.map((w) => (
                  <div key={w.name} className="usda-wallet-chip" role="listitem" aria-label={w.name}>
                    <span aria-hidden="true">{w.icon}</span>
                    <span>{w.name}</span>
                  </div>
                ))}
              </div>
              <div className="ups-connect-wrap">
                <ConnectButton client={client} chain={polygon} wallets={wallets} />
              </div>
            </div>
          )}

          {isConnected && !isCorrectNetwork && (
            <div className="ups-card ups-card--warn" aria-label="Rete errata">
              <div className="ups-status-badge ups-status-badge--warn">⚠️ Rete non corretta</div>
              <p className="ups-card-body">
                I pagamenti USDA richiedono <strong>Polygon Mainnet</strong>.
              </p>
              <div className="ups-connect-wrap" style={{ marginTop: 8 }}>
                <ConnectButton client={client} chain={polygon} wallets={wallets} />
              </div>
            </div>
          )}

          {isConnected && isCorrectNetwork && address && (
            <div className="ups-card ups-card--success" aria-label="Wallet attivo">
              <div className="ups-status-badge ups-status-badge--ok">✅ Wallet attivo</div>
              <p className="ups-card-headline">🎉 Sei pronto per inviare e ricevere USDA!</p>
              <div className="ups-addr-block">
                <div className="ups-addr-label">Indirizzo Polygon</div>
                <button
                  type="button"
                  className="ups-addr-value"
                  aria-label={`Copia indirizzo ${address}`}
                  onClick={() => copy("addr", address)}
                >
                  <span className="ups-addr-text">{abbrev(address)}</span>
                  <span className="ups-copy-icon" aria-hidden="true">
                    {copied === "addr" ? "✓" : "⎘"}
                  </span>
                </button>
                {copied === "addr" && (
                  <span className="ups-copied-hint" aria-live="polite">Copiato!</span>
                )}
              </div>
              <div className="ups-wallet-actions">
                <div className="ups-connect-wrap">
                  <ConnectButton client={client} chain={polygon} wallets={wallets} />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            2. GUIDA USDA
        ══════════════════════════════════════════════════════════════════ */}
        <section className="ups-section" aria-label="Guida USDA">
          <div className="ups-section-title">📖 Come iniziare</div>
          <div className="ups-card ups-card--guide">
            <div className="ups-guide-steps" role="list">
              {GUIDE_STEPS.map((step, i) => (
                <div key={i} className="ups-guide-step" role="listitem">
                  <div className="ups-guide-step-icon" aria-hidden="true">{step.icon}</div>
                  <div className="ups-guide-step-body">
                    <div className="ups-guide-step-title">
                      <span className="ups-guide-step-num" aria-hidden="true">{i + 1}</span>
                      {step.title}
                    </div>
                    <div className="ups-guide-step-desc">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="ups-btn-secondary"
              onClick={() => setShowHowItWorks(true)}
            >
              📚 Scopri come funziona
            </button>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            3. AGGIUNGI USDA AL WALLET
        ══════════════════════════════════════════════════════════════════ */}
        <section className="ups-section" aria-label="Token USDA">
          <div className="ups-section-title">🪙 Token USDA</div>
          <div className="ups-card ups-card--token">
            <div className="ups-token-rows" role="list">
              {[
                { label: "Contract Address", key: "contract", value: USDA_CONTRACT_ADDRESS, mono: true },
                { label: "Symbol",           key: "symbol",   value: USDA_SYMBOL,           mono: false },
                { label: "Decimals",         key: "dec",      value: String(USDA_DECIMALS),  mono: false },
                { label: "Network",          key: "network",  value: USDA_NETWORK,           mono: false },
              ].map((row) => (
                <button
                  key={row.key}
                  type="button"
                  role="listitem"
                  className="ups-token-row"
                  aria-label={`Copia ${row.label}: ${row.value}`}
                  onClick={() => copy(row.key, row.value)}
                >
                  <span className="ups-token-label">{row.label}</span>
                  <span className={`ups-token-value ${row.mono ? "mono" : ""}`}>
                    {row.mono ? abbrev(row.value) : row.value}
                  </span>
                  <span className="ups-copy-icon" aria-hidden="true">
                    {copied === row.key ? "✓" : "⎘"}
                  </span>
                </button>
              ))}
            </div>
            {copied && (
              <p className="ups-copied-hint ups-copied-hint--center" aria-live="polite">✓ Copiato negli appunti</p>
            )}

            <button
              type="button"
              className="ups-btn-primary"
              disabled={watchStatus === "loading"}
              onClick={handleAddToken}
              aria-busy={watchStatus === "loading"}
            >
              {watchStatus === "loading" && <><span className="usda-btn-spinner" aria-hidden="true" /> Aggiunta…</>}
              {watchStatus === "ok"      && "✅ Token aggiunto con successo!"}
              {watchStatus === "err"     && "⚠️ Riprova — apri il wallet e accetta"}
              {watchStatus === "idle"    && (isConnected ? "➕ Aggiungi USDA al Wallet" : "📋 Come aggiungere USDA al wallet")}
            </button>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            4. RISORSE UFFICIALI
        ══════════════════════════════════════════════════════════════════ */}
        <section className="ups-section" aria-label="Risorse ufficiali">
          <div className="ups-section-title">🌐 Risorse ufficiali</div>
          <div className="ups-card ups-card--resources">
            <p className="ups-card-body">
              Scopri di più su USDA: token, ecosistema e casi d'uso sulla rete Polygon.
            </p>
            <a
              href={USDA_SITE}
              target="_blank" rel="noopener noreferrer"
              className="ups-btn-primary ups-btn-link"
              aria-label="Visita il sito ufficiale USDA"
            >
              🌍 Visita il sito ufficiale USDA
            </a>
            <a
              href={`https://polygonscan.com/token/${USDA_CONTRACT_ADDRESS}`}
              target="_blank" rel="noopener noreferrer"
              className="ups-btn-secondary ups-btn-link"
              aria-label="Visualizza il contratto USDA su PolygonScan"
            >
              🔗 Contratto su PolygonScan
            </a>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            5. SICUREZZA
        ══════════════════════════════════════════════════════════════════ */}
        <section className="ups-section" aria-label="Sicurezza">
          <div className="ups-section-title">🔒 La tua sicurezza prima di tutto</div>
          <div className="ups-card ups-card--security">
            <div className="ups-security-icon" aria-hidden="true">🛡️</div>
            <div className="ups-security-body">
              <p className="ups-security-title">AlphaChat non custodisce i tuoi fondi.</p>
              <p className="ups-security-desc">
                Le transazioni vengono firmate direttamente dal tuo wallet e restano sempre
                sotto il tuo controllo esclusivo.
              </p>
              <ul className="ups-security-points">
                <li>🔐 Chiavi private sempre nel tuo dispositivo</li>
                <li>⛓️ Ogni transazione verificata on-chain su Polygon</li>
                <li>👁️ Zero accesso ai tuoi fondi da parte di AlphaChat</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Padding bottom */}
        <div style={{ height: 32 }} aria-hidden="true" />
        {/* Debug WalletConnect — tocca 5 volte "Debug" per aprire */}
        <div className="ups-section" style={{ paddingBottom: 8 }}>
        </div>
      </div>

      {/* ── How It Works Dialog ─────────────────────────────────────────── */}
      {showHowItWorks && <HowItWorksDialog onClose={() => setShowHowItWorks(false)} />}

      {/* ── Manual Add Token Dialog ──────────────────────────────────────── */}
      {showManualAdd && (
        <ManualAddDialog
          address={USDA_CONTRACT_ADDRESS}
          onClose={() => setShowManualAdd(false)}
        />
      )}
    </div>
  );
}
