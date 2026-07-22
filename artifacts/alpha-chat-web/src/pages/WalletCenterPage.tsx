/**
 * WalletCenterPage — hub completo per i pagamenti USDA.
 *
 * Tab 1 — Saldo:        balance, wallet ThirdWeb connesso, rete, contatti recenti
 * Tab 2 — Storico:      filtri + lista pagamenti
 * Tab 3 — Impostazioni: ThirdWeb wallet connect, info backend
 *
 * Il wallet viene collegato automaticamente tramite ThirdWeb Connect.
 * L'utente non inserisce mai indirizzi 0x né sceglie la blockchain manualmente.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useActiveAccount,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
  useConnect,
  ConnectButton,
} from "thirdweb/react";
import { createWallet, walletConnect } from "thirdweb/wallets";
import {
  thirdwebClient,
  polygonMainnet,
  THIRDWEB_READY,
  USDA_CHAIN_ID,
  WC_PROJECT_ID,
  WC_WALLET_CONNECT_CONFIG,
  APP_METADATA,
} from "../lib/thirdweb-client";
import {
  apiUsdaGetWallet,
  apiUsdaGetHistory,
  apiUsdaGetCapabilities,
  apiUsdaGetInfo,
  apiUsdaCheckByClientId,
} from "../lib/usda-api";
import type { WalletInfo, UsdaPaymentData, UsdaBackendInfo, UsdaCapabilities } from "../lib/usda-types";
import { USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../lib/usda-types";
import { UsdaPaymentDetail } from "../components/usda/UsdaPaymentDetail";
import WcDebugPanel from "../components/usda/WcDebugPanel";

type Tab = "saldo" | "storico" | "impostazioni";
type HistoryFilter = "tutti" | "sent" | "received" | "pending" | "claimed" | "refunded";

const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "tutti",    label: "Tutti"      },
  { key: "sent",     label: "Inviati"    },
  { key: "received", label: "Ricevuti"   },
  { key: "pending",  label: "Pending"    },
  { key: "claimed",  label: "Riscossi"   },
  { key: "refunded", label: "Rimborsati" },
];

const TAB_META: { id: Tab; icon: string; label: string }[] = [
  { id: "saldo",        icon: "💳", label: "Saldo"        },
  { id: "storico",      icon: "📋", label: "Storico"      },
  { id: "impostazioni", icon: "⚙️", label: "Impostazioni" },
];

const SUPPORTED_WALLETS = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  walletConnect(),
  createWallet("me.rainbow"),
  createWallet("com.trustwallet.app"),
];

interface Props {
  onBack: () => void;
}

export default function WalletCenterPage({ onBack }: Props) {
  const [tab,          setTab]          = useState<Tab>("saldo");
  const [wallet,       setWallet]       = useState<WalletInfo | null>(null);
  const [backendInfo,  setBackendInfo]  = useState<UsdaBackendInfo | null>(null);
  const [capabilities, setCapabilities] = useState<UsdaCapabilities | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);

  const [histFilter,  setHistFilter]  = useState<HistoryFilter>("tutti");
  const [payments,    setPayments]    = useState<UsdaPaymentData[]>([]);
  const [histTotal,   setHistTotal]   = useState(0);
  const [histLoading, setHistLoading] = useState(false);
  const [histError,   setHistError]   = useState<string | null>(null);

  const [recentContacts, setRecentContacts] = useState<{ id: string; name: string; icon: string }[]>([]);
  const [detailId,       setDetailId]       = useState<string | null>(null);

  const abortMount   = useRef<AbortController | null>(null);
  const abortHistory = useRef<AbortController | null>(null);

  // ── ThirdWeb — wallet connesso automaticamente dal provider ─────────────────
  const account     = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const { isConnecting } = useConnect();

  const isWalletConnected = !!account;
  const isCorrectNetwork  = activeChain?.id === USDA_CHAIN_ID;

  // ── Recovery crash al mount ─────────────────────────────────────────────────
  const [recoveryBanner, setRecoveryBanner] = useState<"found" | "not_found" | null>(null);

  useEffect(() => {
    const inflightCpi = sessionStorage.getItem("usda_inflight_cpi");
    if (!inflightCpi) return;
    sessionStorage.removeItem("usda_inflight_cpi");

    apiUsdaCheckByClientId(inflightCpi).then((payment) => {
      setRecoveryBanner(payment ? "found" : "not_found");
    }).catch(() => {});
  }, []);

  // ── Dati al mount ───────────────────────────────────────────────────────────
  useEffect(() => {
    abortMount.current = new AbortController();
    Promise.all([
      // FIX 2: passa l'indirizzo ThirdWeb live (se già disponibile al mount)
      // per ottenere il saldo del wallet connesso, non di quello in MongoDB
      apiUsdaGetWallet(account?.address).then(setWallet).catch(() => {}),
      apiUsdaGetInfo().then(setBackendInfo).catch(() => {}),
      apiUsdaGetCapabilities().then(setCapabilities).catch(() => {}),
      apiUsdaGetHistory({ limit: 10 }).then((r) => {
        const seen = new Set<string>();
        const contacts: { id: string; name: string; icon: string }[] = [];
        for (const p of r.payments) {
          const id   = p.kind === "send" ? p.recipient_id : p.sender_id;
          const name = (p.kind === "send" ? p.recipient_name : p.sender_name) ?? id.slice(0, 8);
          if (!seen.has(id)) { seen.add(id); contacts.push({ id, name, icon: p.kind === "send" ? "📤" : "📥" }); }
          if (contacts.length >= 5) break;
        }
        setRecentContacts(contacts);
      }).catch(() => {}),
    ]).finally(() => setWalletLoading(false));

    return () => { abortMount.current?.abort(); };
  }, []);

  // ── FIX 2: Re-fetch saldo quando il wallet ThirdWeb cambia ────────────────────
  // Al mount il wallet potrebbe non essere ancora connesso (ThirdWeb riconnette
  // in modo asincrono). Questo effect scatta appena account.address diventa
  // disponibile o cambia, garantendo che il saldo mostrato sia sempre quello
  // del wallet effettivamente connesso.
  useEffect(() => {
    if (!account?.address) return;
    apiUsdaGetWallet(account.address).then(setWallet).catch(() => {});
  }, [account?.address]);

  // ── Storico ─────────────────────────────────────────────────────────────────
  const loadHistory = useCallback(() => {
    abortHistory.current?.abort();
    abortHistory.current = new AbortController();
    setHistLoading(true);
    setHistError(null);
    apiUsdaGetHistory({ type: histFilter === "tutti" ? undefined : histFilter, limit: 30 })
      .then((r) => { setPayments(r.payments); setHistTotal(r.total); })
      .catch((err: Error) => { if (err.name !== "AbortError") setHistError(err.message); })
      .finally(() => setHistLoading(false));
  }, [histFilter]);

  useEffect(() => {
    if (tab !== "storico") return;
    loadHistory();
    return () => { abortHistory.current?.abort(); };
  }, [tab, loadHistory]);

  const balance = wallet?.balance_usda ?? "—";

  // ── Switch rete automatico ───────────────────────────────────────────────────
  async function handleSwitchNetwork() {
    try {
      await switchChain(polygonMainnet);
    } catch {
      // Ignora — l'utente può cambiare manualmente nel wallet
    }
  }

  return (
    <div className="wc-root">

      {/* ── Recovery banner ───────────────────────────────────────────────── */}
      {recoveryBanner === "found" && (
        <div className="wc-recovery-banner wc-recovery-found" role="alert">
          <span>⚠️</span>
          <span>Un pagamento precedente è stato registrato correttamente prima della chiusura dell'app. Controlla lo storico.</span>
          <button type="button" aria-label="Chiudi avviso" onClick={() => setRecoveryBanner(null)}>✕</button>
        </div>
      )}
      {recoveryBanner === "not_found" && (
        <div className="wc-recovery-banner wc-recovery-not-found" role="status">
          <span>ℹ️</span>
          <span>L'ultimo pagamento non era stato completato. Puoi riprovare normalmente.</span>
          <button type="button" aria-label="Chiudi avviso" onClick={() => setRecoveryBanner(null)}>✕</button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="wc-header">
        <div className="wc-header-title">
          <span className="wc-header-icon" aria-hidden="true">💰</span>
          <span>Wallet Center</span>
        </div>
        {backendInfo && (
          <span className="wc-version" aria-label={`Backend: ${backendInfo.network} v${backendInfo.version}`}>
            {backendInfo.network.split(" ").slice(-1)[0]} · v{backendInfo.version}
          </span>
        )}
        <button type="button" className="wc-close-btn" aria-label="Chiudi Wallet Center" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </header>

      {/* ── Tab Bar ─────────────────────────────────────────────────────────── */}
      <div className="wc-tabs" role="tablist" aria-label="Sezioni Wallet Center">
        {TAB_META.map((t) => (
          <button
            key={t.id} type="button" role="tab"
            aria-selected={tab === t.id}
            aria-controls={`wc-panel-${t.id}`}
            id={`wc-tab-${t.id}`}
            className={`wc-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Saldo ──────────────────────────────────────────────────────── */}
      {tab === "saldo" && (
        <div id="wc-panel-saldo" role="tabpanel" aria-labelledby="wc-tab-saldo" className="wc-content">
          {walletLoading ? (
            <div className="wc-loading" role="status" aria-label="Caricamento saldo">
              <span className="usda-loading-dots" aria-hidden="true" /> Caricamento…
            </div>
          ) : (
            <>
              {/* Balance */}
              <div className="wc-balance-card" aria-label={`Saldo: ${balance} USDA`}>
                <div className="wc-balance-label">Saldo disponibile</div>
                <div className="wc-balance-amount">
                  {balance} <span className="wc-balance-currency">USDA</span>
                </div>
              </div>

              {/* Quick actions */}
              <div className="wc-stats-grid" role="list" aria-label="Accesso rapido">
                {[
                  { icon: "📤", label: "Inviati",   filter: "sent"     as HistoryFilter },
                  { icon: "📥", label: "Ricevuti",  filter: "received" as HistoryFilter },
                  { icon: "⏳", label: "Pending",   filter: "pending"  as HistoryFilter },
                  { icon: "✅", label: "Riscossi",  filter: "claimed"  as HistoryFilter },
                  { icon: "↩️", label: "Rimborsi",  filter: "refunded" as HistoryFilter },
                  { icon: "📋", label: "Tutti",     filter: "tutti"    as HistoryFilter },
                ].map((item) => (
                  <button
                    key={item.filter} type="button" role="listitem"
                    className="wc-stat"
                    aria-label={`Mostra ${item.label}`}
                    onClick={() => { setHistFilter(item.filter); setTab("storico"); }}
                  >
                    <div className="wc-stat-icon" aria-hidden="true">{item.icon}</div>
                    <div className="wc-stat-label">{item.label}</div>
                  </button>
                ))}
              </div>

              {/* Contatti recenti */}
              {recentContacts.length > 0 && (
                <>
                  <div className="wc-section-title">Contatti recenti</div>
                  <div className="wc-recent-contacts" role="list">
                    {recentContacts.map((c) => (
                      <div key={c.id} className="wc-recent-contact" role="listitem">
                        <div className="wc-recent-icon" aria-hidden="true">{c.icon}</div>
                        <div className="wc-recent-name">{c.name}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Wallet ThirdWeb — connesso automaticamente, indirizzo letto dal provider */}
              <div className="wc-section-title">Wallet</div>
              <div className="wc-tw-section">
                {!THIRDWEB_READY ? (
                  <div className="wc-tw-card wc-tw-card--empty">
                    <p>⚙️ Configura <code>VITE_THIRDWEB_CLIENT_ID</code> per abilitare i pagamenti USDA.</p>
                  </div>
                ) : isWalletConnected ? (
                  <div className="wc-tw-card">
                    <div className="wc-tw-chain-row">
                      <span aria-hidden="true">🟣</span>
                      <span>Polygon Mainnet</span>
                      {isCorrectNetwork ? (
                        <span className="wc-tw-badge wc-tw-badge--ok">Chain 137 ✓</span>
                      ) : (
                        <button type="button" className="wc-tw-badge wc-tw-badge--warn" onClick={handleSwitchNetwork}>
                          Rete errata — Passa a Polygon
                        </button>
                      )}
                    </div>
                    <div className="wc-tw-addr-row">
                      <span className="wc-tw-addr-label">Indirizzo</span>
                      <span className="wc-tw-addr">{account.address}</span>
                    </div>
                    <div className="wc-tw-connect-btn">
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
                ) : (
                  <div className="wc-tw-card wc-tw-card--empty">
                    <p>Connetti il tuo wallet per inviare e ricevere USDA su Polygon Mainnet.</p>
                    <p className="wc-tw-hint">
                      Supporta MetaMask, WalletConnect, Coinbase, Rainbow, Trust Wallet e qualsiasi wallet compatibile.
                      Il tuo indirizzo 0x verrà letto automaticamente.
                    </p>
                    <div className="wc-tw-connect-btn">
                      <ConnectButton
                        client={thirdwebClient}
                        chain={polygonMainnet}
                        wallets={SUPPORTED_WALLETS}
                        appMetadata={APP_METADATA}
                        walletConnect={WC_WALLET_CONNECT_CONFIG}
                        connectModal={{
                          title: "Connetti Wallet",
                          size: "compact",
                          welcomeScreen: { title: "USDA Payments", subtitle: "Connetti il wallet per iniziare" },
                        }}
                        connectButton={{ label: "Connetti Wallet" }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Network info */}
              {backendInfo && (
                <>
                  <div className="wc-section-title">Rete</div>
                  <div className="wc-backend-info">
                    <div className="wc-backend-row"><span>Network</span><span className="wc-backend-val">{backendInfo.network}</span></div>
                    <div className="wc-backend-row"><span>Chain ID</span><span className="wc-backend-val">{backendInfo.chainId}</span></div>
                    <div className="wc-backend-row">
                      <span>Ambiente</span>
                      <span className={`wc-backend-val ${backendInfo.environment === "production" ? "ok" : ""}`}>
                        {backendInfo.environment}
                      </span>
                    </div>
                    <div className="wc-backend-row">
                      <span>Explorer</span>
                      <a href={backendInfo.explorer} target="_blank" rel="noopener noreferrer" className="wc-backend-link">
                        {backendInfo.explorer.replace("https://", "")}
                      </a>
                    </div>
                  </div>
                </>
              )}

              {/* Capabilities */}
              {capabilities && (
                <>
                  <div className="wc-section-title">Funzionalità</div>
                  <div className="wc-caps-grid" role="list">
                    {(Object.entries(capabilities.supports) as [string, boolean][]).map(([k, v]) => (
                      <div key={k} role="listitem" className={`wc-cap ${v ? "ok" : "off"}`}>
                        <span aria-hidden="true">{v ? "✓" : "✗"}</span>
                        <span>{k}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Storico ────────────────────────────────────────────────────── */}
      {tab === "storico" && (
        <div id="wc-panel-storico" role="tabpanel" aria-labelledby="wc-tab-storico" className="wc-content wc-content--history">
          <div className="wc-hist-filters" role="tablist" aria-label="Filtra transazioni">
            {HISTORY_FILTERS.map((f) => (
              <button
                key={f.key} type="button" role="tab"
                aria-selected={histFilter === f.key}
                className={`usda-filter-btn ${histFilter === f.key ? "active" : ""}`}
                onClick={() => setHistFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {histLoading && (
            <div className="wc-loading" role="status"><span className="usda-loading-dots" aria-hidden="true" /> Caricamento…</div>
          )}
          {histError && (
            <div className="usda-error" style={{ margin: "12px 16px" }} role="alert">{histError}</div>
          )}
          {!histLoading && !histError && payments.length === 0 && (
            <div className="wc-empty">Nessuna transazione</div>
          )}

          <div className="wc-hist-list" role="list">
            {payments.map((p) => (
              <button
                key={p.payment_id} type="button" role="listitem"
                className="usda-history-item"
                aria-label={`${p.kind === "request" ? "Richiesta" : "Pagamento"} di ${p.amount} USDA — ${USDA_STATUS_LABELS[p.status]}`}
                onClick={() => setDetailId(p.payment_id)}
              >
                <div className="usda-history-icon" aria-hidden="true">{p.kind === "request" ? "💸" : "💰"}</div>
                <div className="usda-history-info">
                  <div className="usda-history-amount">{p.amount} USDA</div>
                  <div className="usda-history-name">
                    {p.sender_name ?? p.sender_id.slice(0, 8)} → {p.recipient_name ?? p.recipient_id.slice(0, 8)}
                  </div>
                  {p.note && <div className="usda-history-note">"{p.note}"</div>}
                </div>
                <div className="usda-history-status" aria-hidden="true">
                  <span>{USDA_STATUS_ICONS[p.status]}</span>
                  <span className="usda-history-status-label">{USDA_STATUS_LABELS[p.status]}</span>
                </div>
              </button>
            ))}
          </div>

          {histTotal > payments.length && (
            <div className="usda-history-more" aria-live="polite">
              {histTotal - payments.length} altre transazioni
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Impostazioni ───────────────────────────────────────────────── */}
      {tab === "impostazioni" && (
        <div id="wc-panel-impostazioni" role="tabpanel" aria-labelledby="wc-tab-impostazioni" className="wc-content">

          {/* ThirdWeb Wallet Connect */}
          <div className="wc-section-title">Wallet collegato</div>
          <div className="wc-tw-section">
            {!THIRDWEB_READY ? (
              <div className="wc-tw-card wc-tw-card--empty">
                <p>⚙️ <code>VITE_THIRDWEB_CLIENT_ID</code> non configurato.</p>
              </div>
            ) : isWalletConnected ? (
              <div className="wc-tw-card">
                <div className="wc-tw-chain-row">
                  <span aria-hidden="true">🟣</span>
                  <span>Polygon Mainnet</span>
                  {isCorrectNetwork ? (
                    <span className="wc-tw-badge wc-tw-badge--ok">Chain 137 ✓</span>
                  ) : (
                    <button type="button" className="wc-tw-badge wc-tw-badge--warn" onClick={handleSwitchNetwork}>
                      Rete errata — Passa a Polygon
                    </button>
                  )}
                </div>
                <div className="wc-tw-addr-row">
                  <span className="wc-tw-addr-label">Indirizzo (letto dal wallet)</span>
                  <span className="wc-tw-addr">{account.address}</span>
                </div>
                <div className="wc-tw-connect-btn">
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
            ) : (
              <div className="wc-tw-card wc-tw-card--empty">
                <p>Nessun wallet connesso.</p>
                <p className="wc-tw-hint">
                  Connetti MetaMask, WalletConnect, Coinbase Wallet, Rainbow o Trust Wallet.
                  Il tuo indirizzo Polygon viene letto automaticamente — non devi inserirlo.
                </p>
                <div className="wc-tw-connect-btn">
                  <ConnectButton
                    client={thirdwebClient}
                    chain={polygonMainnet}
                    wallets={SUPPORTED_WALLETS}
                    appMetadata={APP_METADATA}
                    walletConnect={WC_WALLET_CONNECT_CONFIG}
                    connectModal={{
                      title: "Connetti Wallet",
                      size: "compact",
                      welcomeScreen: { title: "USDA Payments", subtitle: "Connetti il wallet per continuare" },
                    }}
                    connectButton={{ label: "Connetti Wallet" }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Backend USDA */}
          {(backendInfo || capabilities) && (
            <>
              <div className="wc-section-title" style={{ marginTop: 24 }}>Backend USDA</div>
              <div className="wc-backend-info">
                {backendInfo && (
                  <>
                    <div className="wc-backend-row"><span>Nome</span><span className="wc-backend-val">{backendInfo.name}</span></div>
                    <div className="wc-backend-row"><span>Versione</span><span className="wc-backend-val">{backendInfo.version}</span></div>
                    <div className="wc-backend-row"><span>API</span><span className="wc-backend-val">{backendInfo.apiVersion}</span></div>
                    <div className="wc-backend-row">
                      <span>Ambiente</span>
                      <span className={`wc-backend-val ${backendInfo.environment === "production" ? "ok" : ""}`}>
                        {backendInfo.environment}
                      </span>
                    </div>
                    <div className="wc-backend-row"><span>Network</span><span className="wc-backend-val">{backendInfo.network}</span></div>
                    <div className="wc-backend-row"><span>Chain ID</span><span className="wc-backend-val">{backendInfo.chainId}</span></div>
                    <div className="wc-backend-row">
                      <span>Explorer</span>
                      <a href={backendInfo.explorer} target="_blank" rel="noopener noreferrer" className="wc-backend-link">
                        {backendInfo.explorer.replace("https://", "")}
                      </a>
                    </div>
                  </>
                )}
                {capabilities && (Object.entries(capabilities.supports) as [string, boolean][]).map(([k, v]) => (
                  <div key={k} className="wc-backend-row">
                    <span>{k}</span>
                    <span className={`wc-backend-val ${v ? "ok" : "off"}`}>{v ? "✓" : "✗"}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {detailId && (
        <UsdaPaymentDetail
          paymentId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      {/* Debug WalletConnect — tocca 5 volte "Debug" per aprire */}
      <WcDebugPanel />

      {/* ── iOS: pannello floating "Apri wallet" quando ThirdWeb è in attesa ── */}
      {/iPhone|iPad|iPod/.test(navigator.userAgent) && isConnecting && (
        <div style={{
          position: "fixed", bottom: 100, left: 16, right: 16,
          zIndex: 2147483647,
          background: "rgba(13,13,26,0.97)",
          border: "1px solid rgba(155,64,248,0.45)",
          borderRadius: 20,
          padding: "16px 16px 12px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <p style={{ margin: 0, color: "rgba(255,255,255,0.65)", fontSize: "0.78rem", textAlign: "center" }}>
            📱 Il wallet non si è aperto automaticamente?
          </p>
          <button
            type="button"
            onClick={() => { window.location.href = "trust://"; }}
            style={{
              background: "linear-gradient(135deg,#1b6ff8,#0047c8)",
              border: "none", borderRadius: 13, color: "#fff",
              fontSize: "0.95rem", fontWeight: 700,
              padding: "13px 20px", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
            }}
          >
            🐦 Apri Trust Wallet →
          </button>
          <button
            type="button"
            onClick={() => { window.location.href = "metamask://"; }}
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 13, color: "rgba(255,255,255,0.65)",
              fontSize: "0.85rem", fontWeight: 600,
              padding: "10px 20px", cursor: "pointer",
              touchAction: "manipulation", WebkitTapHighlightColor: "transparent",
            }}
          >
            🦊 Apri MetaMask
          </button>
        </div>
      )}
    </div>
  );
}
