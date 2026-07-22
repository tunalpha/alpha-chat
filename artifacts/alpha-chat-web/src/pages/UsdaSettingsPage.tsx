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

import { useState, useCallback } from "react";
import {
  useActiveAccount,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
  ConnectButton,
} from "thirdweb/react";
import { createWallet, walletConnect } from "thirdweb/wallets";
import {
  thirdwebClient,
  polygonMainnet,
  WC_PROJECT_ID,
  WC_WALLET_CONNECT_CONFIG,
  APP_METADATA,
  USDA_CONTRACT_ADDRESS,
  USDA_CHAIN_ID,
  THIRDWEB_READY,
} from "../lib/thirdweb-client";
import WcDebugPanel from "../components/usda/WcDebugPanel";

// ── Costanti ─────────────────────────────────────────────────────────────────

const USDA_SYMBOL   = "USDA";
const USDA_DECIMALS = 18;
const USDA_NETWORK  = "Polygon Mainnet";
const USDA_SITE     = "https://getusda.xyz";
const USDA_LOGO     = "https://getusda.xyz/favicon.ico";

const SUPPORTED_WALLETS = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  walletConnect(),
  createWallet("me.rainbow"),
  createWallet("com.trustwallet.app"),
];

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

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function UsdaSettingsPage({ onBack }: Props) {
  const account     = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();

  const isConnected      = !!account;
  const isCorrectNetwork = activeChain?.id === USDA_CHAIN_ID;

  const [copied,       setCopied]       = useState<string | null>(null);
  const [watchStatus,  setWatchStatus]  = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [switchError,  setSwitchError]  = useState<string | null>(null);

  // ── Copy helpers ──────────────────────────────────────────────────────────
  const copy = useCallback((key: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    });
  }, []);

  // ── Switch rete ───────────────────────────────────────────────────────────
  async function handleSwitchNetwork() {
    setSwitchError(null);
    try {
      await switchChain(polygonMainnet);
    } catch {
      setSwitchError("Impossibile cambiare rete automaticamente. Passa a Polygon Mainnet nel wallet.");
    }
  }

  // ── wallet_watchAsset ─────────────────────────────────────────────────────
  async function handleAddToken() {
    setWatchStatus("loading");
    try {
      const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown }) => Promise<unknown> } }).ethereum;
      if (!eth) throw new Error("no provider");
      await eth.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address:  USDA_CONTRACT_ADDRESS,
            symbol:   USDA_SYMBOL,
            decimals: USDA_DECIMALS,
            image:    USDA_LOGO,
          },
        },
      });
      setWatchStatus("ok");
      setTimeout(() => setWatchStatus("idle"), 3000);
    } catch {
      setWatchStatus("err");
      setTimeout(() => setWatchStatus("idle"), 3000);
    }
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

          {/* Wallet NON configurato */}
          {!THIRDWEB_READY && (
            <div className="ups-card ups-card--neutral">
              <div className="ups-status-badge ups-status-badge--warn">⚙️ Configurazione richiesta</div>
              <p className="ups-card-body">
                Imposta <code>VITE_THIRDWEB_CLIENT_ID</code> per abilitare il wallet.
              </p>
            </div>
          )}

          {THIRDWEB_READY && !isConnected && (
            <div className="ups-card ups-card--cta" aria-label="Collega wallet">
              <div className="ups-status-badge ups-status-badge--warn">🟡 Wallet non configurato</div>
              <p className="ups-card-headline">🚀 Attiva il tuo wallet in meno di un minuto</p>
              <p className="ups-card-body">
                Per inviare e ricevere USDA devi collegare un wallet compatibile con Polygon.
                Il tuo indirizzo viene letto automaticamente — non devi inserirlo.
              </p>

              {/* Wallet chips */}
              <div className="usda-wallet-chips" aria-label="Wallet supportati" role="list">
                {WALLET_CHIPS.map((w) => (
                  <div key={w.name} className="usda-wallet-chip" role="listitem" aria-label={w.name}>
                    <span aria-hidden="true">{w.icon}</span>
                    <span>{w.name}</span>
                  </div>
                ))}
              </div>

              <div className="ups-connect-wrap">
                <ConnectButton
                  client={thirdwebClient}
                  chain={polygonMainnet}
                  wallets={SUPPORTED_WALLETS}
                  appMetadata={APP_METADATA}
                  walletConnect={WC_WALLET_CONNECT_CONFIG}
                  connectModal={{
                    title: "Connetti Wallet",
                    size: "compact",
                    welcomeScreen: {
                      title: "💸 Pagamenti USDA",
                      subtitle: "Connetti il wallet per inviare e ricevere USDA in chat",
                    },
                  }}
                  connectButton={{ label: "🔗 Collega Wallet" }}
                />
              </div>
            </div>
          )}

          {THIRDWEB_READY && isConnected && !isCorrectNetwork && (
            <div className="ups-card ups-card--warn" aria-label="Rete errata">
              <div className="ups-status-badge ups-status-badge--warn">⚠️ Rete non corretta</div>
              <p className="ups-card-body">
                Sei connesso su {activeChain?.name ?? `chain ${activeChain?.id}`}.
                I pagamenti USDA richiedono <strong>Polygon Mainnet</strong>.
              </p>
              {switchError && <p className="ups-inline-error">{switchError}</p>}
              <button type="button" className="ups-btn-primary" onClick={handleSwitchNetwork}>
                🌐 Passa a Polygon Mainnet
              </button>
              <div className="ups-connect-wrap" style={{ marginTop: 8 }}>
                <ConnectButton
                  client={thirdwebClient}
                  chain={polygonMainnet}
                  wallets={SUPPORTED_WALLETS}
                  appMetadata={APP_METADATA}
                  walletConnect={WC_WALLET_CONNECT_CONFIG}
                  detailsButton={{ style: { fontSize: "0.82rem", padding: "6px 14px" } }}
                />
              </div>
            </div>
          )}

          {THIRDWEB_READY && isConnected && isCorrectNetwork && (
            <div className="ups-card ups-card--success" aria-label="Wallet attivo">
              <div className="ups-status-badge ups-status-badge--ok">✅ Wallet attivo</div>
              <p className="ups-card-headline">🎉 Sei pronto per inviare e ricevere USDA!</p>

              <div className="ups-addr-block">
                <div className="ups-addr-label">Indirizzo Polygon</div>
                <button
                  type="button"
                  className="ups-addr-value"
                  aria-label={`Copia indirizzo ${account.address}`}
                  onClick={() => copy("addr", account.address)}
                >
                  <span className="ups-addr-text">{abbrev(account.address)}</span>
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
                  <ConnectButton
                    client={thirdwebClient}
                    chain={polygonMainnet}
                    wallets={SUPPORTED_WALLETS}
                    appMetadata={APP_METADATA}
                    walletConnect={WC_WALLET_CONNECT_CONFIG}
                    detailsButton={{ style: { fontSize: "0.82rem", padding: "6px 14px" } }}
                  />
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
            <a
              href="https://getusda.xyz"
              target="_blank" rel="noopener noreferrer"
              className="ups-btn-secondary"
              aria-label="Scopri come funziona USDA sul sito ufficiale"
            >
              📚 Scopri come funziona
            </a>
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
              disabled={watchStatus === "loading" || !isConnected}
              onClick={handleAddToken}
              aria-busy={watchStatus === "loading"}
              title={!isConnected ? "Connetti il wallet prima" : undefined}
            >
              {watchStatus === "loading" && <><span className="usda-btn-spinner" aria-hidden="true" /> Aggiunta…</>}
              {watchStatus === "ok"      && "✅ Token aggiunto con successo!"}
              {watchStatus === "err"     && "⚠️ Riprova — apri il wallet e accetta"}
              {watchStatus === "idle"    && "➕ Aggiungi USDA al Wallet"}
            </button>
            {!isConnected && watchStatus === "idle" && (
              <p className="ups-inline-hint">Connetti il wallet per aggiungere il token automaticamente.</p>
            )}
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
          <WcDebugPanel />
        </div>
      </div>
    </div>
  );
}
