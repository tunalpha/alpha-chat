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
import { useTranslation } from "react-i18next";
import {
  useActiveAccount,
  useActiveWallet,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
  useDisconnect,
  ConnectButton,
} from "thirdweb/react";

// ── HowItWorksDialog ─────────────────────────────────────────────────────────

function HowItWorksDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("usdaSettings");
  const HOW_SLIDES = [
    {
      emoji: "💬",
      accent: "#6366f1",
      title: t("hiwSlide1Title"),
      body: t("hiwSlide1Body"),
      visual: (
        <div className="hiw-chat-preview" aria-hidden="true">
          <div className="hiw-bubble hiw-bubble--out">
            <span className="hiw-bubble-pill">{t("hiwSent")}</span>
            <strong>5 USDA</strong>
            <span className="hiw-bubble-sub">{t("hiwToMarco")}</span>
          </div>
          <div className="hiw-bubble hiw-bubble--in">
            <span className="hiw-bubble-pill">{t("hiwReceived")}</span>
            <strong>5 USDA</strong>
            <span className="hiw-bubble-sub">{t("hiwFromGiulia")}</span>
          </div>
        </div>
      ),
    },
    {
      emoji: "🔐",
      accent: "#10b981",
      title: t("hiwSlide2Title"),
      body: t("hiwSlide2Body"),
      visual: (
        <div className="hiw-flow" aria-hidden="true">
          <div className="hiw-flow-node hiw-flow-node--you">{t("hiwYou")}</div>
          <div className="hiw-flow-arrow">
            <span className="hiw-flow-label">{t("hiwEscrow")}</span>
            <span className="hiw-flow-line" />
            <span className="hiw-flow-label">⛓️</span>
          </div>
          <div className="hiw-flow-node hiw-flow-node--dest">{t("hiwRecipient")}</div>
        </div>
      ),
    },
    {
      emoji: "⚡",
      accent: "#f59e0b",
      title: t("hiwSlide3Title"),
      body: t("hiwSlide3Body"),
      visual: (
        <div className="hiw-steps-vis" aria-hidden="true">
          {[
            { icon: "✍️", label: t("hiwVisSign") },
            { icon: "⛓️", label: t("hiwVisBlockchain") },
            { icon: "🔔", label: t("hiwVisNotify") },
            { icon: "✅", label: t("hiwVisReceived") },
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
      title: t("hiwSlide4Title"),
      body: t("hiwSlide4Body"),
      visual: (
        <div className="hiw-chat-preview" aria-hidden="true">
          <div className="hiw-bubble hiw-bubble--req">
            <span className="hiw-bubble-pill">{t("hiwRequest")}</span>
            <strong>10 USDA</strong>
            <div className="hiw-bubble-btn">{t("hiwPayNow")}</div>
          </div>
          <div className="hiw-bubble hiw-bubble--in hiw-bubble--small">
            <span className="hiw-bubble-pill">{t("hiwPaid")}</span>
            <strong>{t("hiwRequestPaid")}</strong>
          </div>
        </div>
      ),
    },
  ];

  const [slide, setSlide] = useState(0);
  const total = HOW_SLIDES.length;
  const s = HOW_SLIDES[slide];
  const isLast = slide === total - 1;

  // Dismiss on backdrop click
  function onBackdrop(e: React.MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("hiw-backdrop")) onClose();
  }

  return (
    <div className="hiw-backdrop" role="dialog" aria-modal="true" aria-label={t("hiwDialogAriaLabel")} onClick={onBackdrop}>
      <div className="hiw-sheet" style={{ "--hiw-accent": s.accent } as React.CSSProperties}>

        {/* Close */}
        <button type="button" className="hiw-close" aria-label={t("closeAriaLabel")} onClick={onClose}>✕</button>

        {/* Emoji accent */}
        <div className="hiw-emoji" aria-hidden="true">{s.emoji}</div>

        {/* Visual scene */}
        <div className="hiw-visual">{s.visual}</div>

        {/* Text */}
        <h2 className="hiw-title">{s.title}</h2>
        <p className="hiw-body">{s.body}</p>

        {/* Dots */}
        <div className="hiw-dots" role="tablist" aria-label={t("hiwSlideAriaLabel")}>
          {HOW_SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === slide}
              aria-label={t("hiwSlideNumAriaLabel", { num: i + 1 })}
              className={`hiw-dot ${i === slide ? "hiw-dot--active" : ""}`}
              onClick={() => setSlide(i)}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="hiw-nav">
          {slide > 0 ? (
            <button type="button" className="hiw-btn-ghost" onClick={() => setSlide(slide - 1)}>{t("hiwBack")}</button>
          ) : (
            <button type="button" className="hiw-btn-ghost" onClick={onClose}>{t("hiwSkip")}</button>
          )}
          {isLast ? (
            <button type="button" className="hiw-btn-primary" onClick={onClose}>{t("hiwStartNow")}</button>
          ) : (
            <button type="button" className="hiw-btn-primary" onClick={() => setSlide(slide + 1)}>{t("hiwNext")}</button>
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

// ── ManualAddDialog ───────────────────────────────────────────────────────────

function ManualAddDialog({ address, onClose }: { address: string; onClose: () => void }) {
  const { t } = useTranslation("usdaSettings");
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
    <div className="mad-backdrop" role="dialog" aria-modal="true" aria-label={t("madDialogAriaLabel")} onClick={onBackdrop}>
      <div className="mad-sheet">
        <button type="button" className="mad-close" aria-label={t("closeAriaLabel")} onClick={onClose}>✕</button>

        <div className="mad-emoji" aria-hidden="true">🪙</div>
        <h2 className="mad-title">{t("madTitle")}</h2>
        <p className="mad-subtitle">{t("madSubtitle")}</p>

        <ol className="mad-steps">
          <li><strong>{t("madStep1Strong")}</strong>{t("madStep1A")}<em>{t("madStep1Em")}</em></li>
          <li>{t("madStep2A")}<strong>{t("madStep2Strong")}</strong></li>
          <li>{t("madStep3A")}<strong>{t("madStep3Strong")}</strong></li>
          <li>{t("madStep4")}</li>
          <li>{t("madStep5")}</li>
        </ol>

        {/* Indirizzo contratto + copia inline */}
        <div className="mad-addr-row">
          <div className="mad-addr-text">
            <span className="mad-addr-label">Contract Address</span>
            <span className="mad-addr-value">{shortAddr}</span>
          </div>
          <button
            type="button"
            className={`mad-copy-inline${copied ? " mad-copy-inline--done" : ""}`}
            onClick={copyAddr}
            aria-label={t("madCopyAriaLabel")}
          >
            {copied ? "✅" : "📋"}
          </button>
        </div>
        {copied && (
          <p className="mad-copied-hint" aria-live="polite">{t("madCopiedHint")}</p>
        )}

        {/* Dettagli token — tutte le info in un'unica schermata */}
        <div className="mad-meta">
          <span>{t("madMetaName")} <strong>USDA</strong></span>
          <span>{t("madMetaSymbol")} <strong>USDA</strong></span>
          <span>{t("madMetaDecimals")} <strong>18</strong></span>
          <span>{t("madMetaNetwork")} <strong>Polygon</strong></span>
        </div>

        <a
          href={`https://polygonscan.com/token/${address}`}
          target="_blank" rel="noopener noreferrer"
          className="mad-link"
        >
          {t("madPolygonScan")}
        </a>

        <button type="button" className="mad-btn-ok" onClick={onClose}>{t("madDone")}</button>
      </div>
    </div>
  );
}

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onOpenAlphaWallet?: () => void;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function UsdaSettingsPage({ onBack, onOpenAlphaWallet }: Props) {
  const { t } = useTranslation("usdaSettings");

  const WALLET_CHIPS = [
    { icon: "🦊", name: "MetaMask"     },
    { icon: "🐦", name: "Trust"        },
    { icon: "🔐", name: "WalletConnect"},
    { icon: "🪙", name: "Coinbase"     },
    { icon: "🌈", name: "Rainbow"      },
  ];

  const GUIDE_STEPS = [
    { icon: "🔗", title: t("guideStep1Title"), desc: t("guideStep1Desc") },
    { icon: "🌐", title: t("guideStep2Title"), desc: t("guideStep2Desc") },
    { icon: "🪙", title: t("guideStep3Title"), desc: t("guideStep3Desc") },
    { icon: "💸", title: t("guideStep4Title"), desc: t("guideStep4Desc") },
  ];

  const account          = useActiveAccount();
  const address          = account?.address;
  const activeWallet     = useActiveWallet();
  const activeChain      = useActiveWalletChain();
  const switchChain      = useSwitchActiveWalletChain();
  const { disconnect }   = useDisconnect();
  const isConnected      = !!account;
  // Vera verifica rete: il wallet deve essere su Polygon (chainId 137)
  const isCorrectNetwork = !!account && activeChain?.id === USDA_CHAIN_ID;

  // Stato per il pulsante Switch Network manuale con timeout e gestione errori
  const [isSwitching,  setIsSwitching]  = useState(false);
  const [switchError,  setSwitchError]  = useState<string | null>(null);

  async function handleSwitchNetwork() {
    setSwitchError(null);
    setIsSwitching(true);
    // Timeout di 15s per evitare spinner infinito su iOS/WalletConnect
    const timer = setTimeout(() => {
      setIsSwitching(false);
      setSwitchError("Timeout: apri il wallet e accetta il cambio rete, poi riprova.");
    }, 15_000);
    try {
      await switchChain(polygon);
      setSwitchError(null);
    } catch {
      setSwitchError("Cambio rete non riuscito. Prova manualmente da Trust Wallet o MetaMask.");
    } finally {
      clearTimeout(timer);
      setIsSwitching(false);
    }
  }

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
            <h1 className="ups-header-title">{t("headerTitle")}</h1>
          </div>
          <button
            type="button" className="ups-close" aria-label={t("closeAriaLabel")}
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
        <section className="ups-section" aria-label={t("walletStatusAriaLabel")}>

          {/* Wallet non connesso */}
          {!isConnected && (
            <div className="ups-card ups-card--cta" aria-label={t("connectWalletAriaLabel")}>
              <div className="ups-status-badge ups-status-badge--warn">{t("walletNotConfigured")}</div>
              <p className="ups-card-headline">{t("ctaHeadline")}</p>
              <p className="ups-card-body">
                {t("ctaDesc")}
              </p>
              <div className="usda-wallet-chips" aria-label={t("supportedWallets")} role="list">
                {WALLET_CHIPS.map((w) => (
                  <div key={w.name} className="usda-wallet-chip" role="listitem" aria-label={w.name}>
                    <span aria-hidden="true">{w.icon}</span>
                    <span>{w.name}</span>
                  </div>
                ))}
              </div>

              {/* Alpha Wallet — opzione nativa */}
              {onOpenAlphaWallet && (
                <div className="ups-alpha-wallet-option">
                  <div className="ups-alpha-wallet-divider">
                    <span>oppure</span>
                  </div>
                  <button
                    type="button"
                    className="ups-alpha-wallet-btn"
                    onClick={onOpenAlphaWallet}
                  >
                    <span className="ups-alpha-wallet-btn-icon">🔐</span>
                    <div className="ups-alpha-wallet-btn-text">
                      <span className="ups-alpha-wallet-btn-title">Alpha Wallet</span>
                      <span className="ups-alpha-wallet-btn-sub">Wallet nativo integrato — nessuna app esterna</span>
                    </div>
                    <span className="ups-alpha-wallet-btn-arrow">›</span>
                  </button>
                </div>
              )}

              <div className="ups-connect-wrap">
                <ConnectButton client={client} chain={polygon} wallets={wallets} />
              </div>
            </div>
          )}

          {isConnected && !isCorrectNetwork && (
            <div className="ups-card ups-card--warn" aria-label={t("wrongNetworkAriaLabel")}>
              <div className="ups-status-badge ups-status-badge--warn">{t("wrongNetwork")}</div>
              <p className="ups-card-body">
                {t("wrongNetworkDescA")}<strong>Polygon Mainnet</strong>{t("wrongNetworkDescB")}
              </p>

              {/* 1 — Switch Network automatico con timeout 15s */}
              <button
                type="button"
                className="ups-switch-network-btn"
                style={{
                  marginTop: 12, width: "100%", padding: "12px 0",
                  borderRadius: 10, fontWeight: 600, fontSize: 15,
                  cursor: isSwitching ? "not-allowed" : "pointer",
                  opacity: isSwitching ? 0.7 : 1,
                }}
                onClick={handleSwitchNetwork}
                disabled={isSwitching}
              >
                {isSwitching ? "⏳ Cambio rete in corso…" : "🔄 Switch Network"}
              </button>
              {switchError && (
                <p style={{ color: "#f87171", fontSize: 13, marginTop: 8, textAlign: "center" }}>
                  {switchError}
                </p>
              )}

              {/* Divider */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0" }}>
                <hr style={{ flex: 1, border: "none", borderTop: "1px solid rgba(255,255,255,0.12)" }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>oppure</span>
                <hr style={{ flex: 1, border: "none", borderTop: "1px solid rgba(255,255,255,0.12)" }} />
              </div>

              {/* 2 — Disconnetti wallet (utile se Switch Network non funziona su iOS) */}
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center", marginBottom: 10 }}>
                Disconnetti il wallet e riconnettiti già su Polygon Mainnet.
              </p>
              <button
                type="button"
                style={{
                  width: "100%", padding: "11px 0", borderRadius: 10,
                  fontWeight: 600, fontSize: 14, background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.15)", color: "#f87171",
                  cursor: "pointer",
                }}
                onClick={() => { if (activeWallet) disconnect(activeWallet); }}
              >
                🔌 Disconnetti wallet
              </button>
            </div>
          )}

          {isConnected && isCorrectNetwork && address && (
            <div className="ups-card ups-card--success" aria-label={t("walletActiveAriaLabel")}>
              <div className="ups-status-badge ups-status-badge--ok">{t("walletActive")}</div>
              <p className="ups-card-headline">{t("walletReady")}</p>
              <div className="ups-addr-block">
                <div className="ups-addr-label">{t("polygonAddress")}</div>
                <button
                  type="button"
                  className="ups-addr-value"
                  aria-label={t("copyAddressAriaLabel", { address })}
                  onClick={() => copy("addr", address)}
                >
                  <span className="ups-addr-text">{abbrev(address)}</span>
                  <span className="ups-copy-icon" aria-hidden="true">
                    {copied === "addr" ? "✓" : "⎘"}
                  </span>
                </button>
                {copied === "addr" && (
                  <span className="ups-copied-hint" aria-live="polite">{t("copied")}</span>
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
        <section className="ups-section" aria-label={t("guideAriaLabel")}>
          <div className="ups-section-title">{t("sectionGetStarted")}</div>
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
              {t("discoverHow")}
            </button>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            3. AGGIUNGI USDA AL WALLET
        ══════════════════════════════════════════════════════════════════ */}
        <section className="ups-section" aria-label={t("tokenAriaLabel")}>
          <div className="ups-section-title">{t("sectionToken")}</div>
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
                  aria-label={t("copyTokenAriaLabel", { label: row.label, value: row.value })}
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
              <p className="ups-copied-hint ups-copied-hint--center" aria-live="polite">{t("copiedClipboard")}</p>
            )}

            <button
              type="button"
              className="ups-btn-primary"
              disabled={watchStatus === "loading"}
              onClick={handleAddToken}
              aria-busy={watchStatus === "loading"}
            >
              {watchStatus === "loading" && <><span className="usda-btn-spinner" aria-hidden="true" /> {t("addTokenLoading")}</>}
              {watchStatus === "ok"      && t("addTokenOk")}
              {watchStatus === "err"     && t("addTokenErr")}
              {watchStatus === "idle"    && (isConnected ? t("addTokenConnected") : t("addTokenNotConnected"))}
            </button>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            4. RISORSE UFFICIALI
        ══════════════════════════════════════════════════════════════════ */}
        <section className="ups-section" aria-label={t("resourcesAriaLabel")}>
          <div className="ups-section-title">{t("sectionResources")}</div>
          <div className="ups-card ups-card--resources">
            <p className="ups-card-body">
              {t("resourcesDesc")}
            </p>
            <a
              href={USDA_SITE}
              target="_blank" rel="noopener noreferrer"
              className="ups-btn-primary ups-btn-link"
              aria-label={t("visitSiteAriaLabel")}
            >
              {t("visitSite")}
            </a>
            <a
              href={`https://polygonscan.com/token/${USDA_CONTRACT_ADDRESS}`}
              target="_blank" rel="noopener noreferrer"
              className="ups-btn-secondary ups-btn-link"
              aria-label={t("viewContractAriaLabel")}
            >
              {t("madPolygonScan")}
            </a>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            5. SICUREZZA
        ══════════════════════════════════════════════════════════════════ */}
        <section className="ups-section" aria-label={t("securityAriaLabel")}>
          <div className="ups-section-title">{t("sectionSecurity")}</div>
          <div className="ups-card ups-card--security">
            <div className="ups-security-icon" aria-hidden="true">🛡️</div>
            <div className="ups-security-body">
              <p className="ups-security-title">{t("securityTitle")}</p>
              <p className="ups-security-desc">
                {t("securityDesc")}
              </p>
              <ul className="ups-security-points">
                <li>{t("securityPoint1")}</li>
                <li>{t("securityPoint2")}</li>
                <li>{t("securityPoint3")}</li>
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
