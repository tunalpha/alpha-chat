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
import { useTranslation } from "react-i18next";
import { useActiveAccount, useActiveWalletChain, ConnectButton } from "thirdweb/react";
import {
  client,
  polygon,
  wallets,
  USDA_CHAIN_ID,
  appMetadata,
} from "../lib/thirdweb";
import { useWallet } from "../wallet/context/WalletContext";
import {
  apiUsdaGetWallet,
  apiUsdaSetWalletAddress,
  apiUsdaGetHistory,
  apiUsdaGetCapabilities,
  apiUsdaGetInfo,
  apiUsdaCheckByClientId,
} from "../lib/usda-api";
import type { WalletInfo, UsdaPaymentData, UsdaBackendInfo, UsdaCapabilities } from "../lib/usda-types";
import { USDA_STATUS_LABELS, USDA_STATUS_ICONS } from "../lib/usda-types";
import { UsdaPaymentDetail } from "../components/usda/UsdaPaymentDetail";

type Tab = "saldo" | "storico" | "impostazioni";
type HistoryFilter = "tutti" | "sent" | "received" | "pending" | "claimed" | "refunded";

interface Props {
  onBack: () => void;
  onOpenAlphaWallet?: () => void;
}

export default function WalletCenterPage({ onBack, onOpenAlphaWallet }: Props) {
  const { t } = useTranslation("walletCenter");

  const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
    { key: "tutti",    label: t("filterAllLabel")      },
    { key: "sent",     label: t("filterSentLabel")     },
    { key: "received", label: t("filterReceivedLabel") },
    { key: "pending",  label: t("filterPendingLabel")  },
    { key: "claimed",  label: t("filterClaimedLabel")  },
    { key: "refunded", label: t("filterRefundedLabel") },
  ];

  const TAB_META: { id: Tab; icon: string; label: string }[] = [
    { id: "saldo",        icon: "💳", label: t("tabBalance")  },
    { id: "storico",      icon: "📋", label: t("tabHistory")  },
    { id: "impostazioni", icon: "⚙️", label: t("tabSettings") },
  ];

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
  // Traccia l'ultimo indirizzo già persistito per evitare scritture duplicate
  // nella stessa sessione — stesso pattern di UsdaSettingsPage.
  const lastPersistedRef = useRef<string | null>(null);

  const account           = useActiveAccount();
  const address           = account?.address;
  const activeChain       = useActiveWalletChain();
  const isWalletConnected = !!account;
  // Vera verifica rete: il wallet deve essere su Polygon (chainId 137)
  const isCorrectNetwork  = !!account && activeChain?.id === USDA_CHAIN_ID;

  const { phase: awPhase, meta: awMeta } = useWallet();
  const hasAlphaWallet = awPhase === "unlocked" || awPhase === "locked";

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
      apiUsdaGetWallet(address).then(setWallet).catch(() => {}),
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

  // Re-fetch saldo quando cambia l'indirizzo del wallet connesso.
  useEffect(() => {
    if (!address) return;
    apiUsdaGetWallet(address).then(setWallet).catch(() => {});
  }, [address]);

  // Persiste l'indirizzo in MongoDB (fonte di verità per preparePayment).
  // Non interroga getWallet() per decidere: getWallet() restituisce sempre
  // l'indirizzo live passato come query param, rendendo qualsiasi confronto
  // tautologicamente falso. Si usa un ref per evitare scritture duplicate
  // nella stessa sessione — identico al pattern di UsdaSettingsPage.
  useEffect(() => {
    console.log("[USDA][WalletCenter] address:", address);
    if (!address) return;
    if (lastPersistedRef.current?.toLowerCase() === address.toLowerCase()) return;
    lastPersistedRef.current = address;
    console.log("[USDA][WalletCenter] useEffect persist triggered");
    void (async () => {
      try {
        console.log("[USDA][WalletCenter] calling apiUsdaSetWalletAddress", address);
        await apiUsdaSetWalletAddress(address);
        console.log("[USDA][WalletCenter] apiUsdaSetWalletAddress SUCCESS");
      } catch (e) {
        console.error("[USDA][WalletCenter] apiUsdaSetWalletAddress FAILED", e);
        lastPersistedRef.current = null;
      }
    })();
  }, [address]);

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


  return (
    <div className="wc-root">

      {/* ── Recovery banner ───────────────────────────────────────────────── */}
      {recoveryBanner === "found" && (
        <div className="wc-recovery-banner wc-recovery-found" role="alert">
          <span>⚠️</span>
          <span>{t("recoveryFound")}</span>
          <button type="button" aria-label={t("closeAlertAriaLabel")} onClick={() => setRecoveryBanner(null)}>✕</button>
        </div>
      )}
      {recoveryBanner === "not_found" && (
        <div className="wc-recovery-banner wc-recovery-not-found" role="status">
          <span>ℹ️</span>
          <span>{t("recoveryNotFound")}</span>
          <button type="button" aria-label={t("closeAlertAriaLabel")} onClick={() => setRecoveryBanner(null)}>✕</button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="wc-header">
        <div className="wc-header-title">
          <span className="wc-header-icon" aria-hidden="true">💰</span>
          <span>{t("title")}</span>
        </div>
        {backendInfo && (
          <span className="wc-version" aria-label={t("backendAriaLabel", { network: backendInfo.network, version: backendInfo.version })}>
            {backendInfo.network.split(" ").slice(-1)[0]} · v{backendInfo.version}
          </span>
        )}
        <button type="button" className="wc-close-btn" aria-label={t("closeAriaLabel")} onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </header>

      {/* ── Tab Bar ─────────────────────────────────────────────────────────── */}
      <div className="wc-tabs" role="tablist" aria-label={t("tabsAriaLabel")}>
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
            <div className="wc-loading" role="status" aria-label={t("loadingBalance")}>
              <span className="usda-loading-dots" aria-hidden="true" /> {t("loadingDots")}
            </div>
          ) : (
            <>
              {/* Balance */}
              <div className="wc-balance-card" aria-label={t("balanceAriaLabel", { balance })}>
                <div className="wc-balance-label">{t("availableBalance")}</div>
                <div className="wc-balance-amount">
                  {balance} <span className="wc-balance-currency">USDA</span>
                </div>
              </div>

              {/* Quick actions */}
              <div className="wc-stats-grid" role="list" aria-label={t("quickAccessAriaLabel")}>
                {[
                  { icon: "📤", label: t("statSent"),     filter: "sent"     as HistoryFilter },
                  { icon: "📥", label: t("statReceived"), filter: "received" as HistoryFilter },
                  { icon: "⏳", label: t("statPending"),  filter: "pending"  as HistoryFilter },
                  { icon: "✅", label: t("statClaimed"),  filter: "claimed"  as HistoryFilter },
                  { icon: "↩️", label: t("statRefunds"),  filter: "refunded" as HistoryFilter },
                  { icon: "📋", label: t("statAll"),      filter: "tutti"    as HistoryFilter },
                ].map((item) => (
                  <button
                    key={item.filter} type="button" role="listitem"
                    className="wc-stat"
                    aria-label={t("showLabel", { label: item.label })}
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
                  <div className="wc-section-title">{t("recentContacts")}</div>
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

              {/* Alpha Wallet — wallet nativo */}
              {awPhase !== "initializing" && (
                <>
                  <div className="wc-section-title">🔐 Alpha Wallet</div>
                  {hasAlphaWallet ? (
                    <div className="wc-aw-card wc-aw-card--active">
                      <div className="wc-aw-header">
                        <span className="wc-aw-icon" aria-hidden="true">🔐</span>
                        <div className="wc-aw-title-group">
                          <span className="wc-aw-title">Alpha Wallet</span>
                          <span className="wc-aw-badge">✓ Attivo</span>
                        </div>
                        {awPhase === "locked" && (
                          <span className="wc-aw-locked-badge" title="Wallet bloccato — sblocca in Alpha Wallet">🔒</span>
                        )}
                      </div>
                      {awMeta && (
                        <div className="wc-aw-addr-row">
                          <span className="wc-aw-addr-label">EVM</span>
                          <span className="wc-aw-addr">{awMeta.evmAddress.slice(0, 6)}…{awMeta.evmAddress.slice(-4)}</span>
                        </div>
                      )}
                      {awMeta && (
                        <div className="wc-aw-addr-row">
                          <span className="wc-aw-addr-label">BTC</span>
                          <span className="wc-aw-addr">{awMeta.btcAddress.slice(0, 8)}…{awMeta.btcAddress.slice(-6)}</span>
                        </div>
                      )}
                      <p className="wc-aw-hint">Usa <strong>Paga con Alpha Wallet</strong> in chat per pagamenti diretti P2P senza wallet esterni.</p>
                    </div>
                  ) : (
                    <div className="wc-aw-card wc-aw-card--empty">
                      <div className="wc-aw-header">
                        <span className="wc-aw-icon" aria-hidden="true">🔐</span>
                        <span className="wc-aw-title">Alpha Wallet — Wallet nativo</span>
                      </div>
                      <p className="wc-aw-desc">Wallet self-custodial integrato in Alpha Chat. Nessun MetaMask o Trust Wallet richiesto per i pagamenti diretti in chat.</p>
                      {onOpenAlphaWallet && (
                        <button type="button" className="wc-aw-setup-btn" onClick={onOpenAlphaWallet}>
                          Configura Alpha Wallet →
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Wallet — Reown AppKit */}
              <div className="wc-section-title">{t("walletSection")}</div>
              <div className="wc-tw-section">
                {isWalletConnected && address ? (
                  <div className="wc-tw-card">
                    <div className="wc-tw-chain-row">
                      <span aria-hidden="true">🟣</span>
                      <span>Polygon Mainnet</span>
                      <span className="wc-tw-badge wc-tw-badge--ok">Chain 137 ✓</span>
                    </div>
                    <div className="wc-tw-addr-row">
                      <span className="wc-tw-addr-label">{t("addressLabel")}</span>
                      <span className="wc-tw-addr">{address}</span>
                    </div>
                    <div className="wc-tw-connect-btn">
                      <ConnectButton client={client} chain={polygon} wallets={wallets} appMetadata={appMetadata} />
                    </div>
                  </div>
                ) : (
                  <div className="wc-tw-card wc-tw-card--empty">
                    <p>{t("connectWalletDesc")}</p>
                    <p className="wc-tw-hint">
                      {t("connectWalletHint")}
                    </p>
                    <div className="wc-tw-connect-btn">
                      <ConnectButton client={client} chain={polygon} wallets={wallets} appMetadata={appMetadata} />
                    </div>
                  </div>
                )}
              </div>

              {/* Network info */}
              {backendInfo && (
                <>
                  <div className="wc-section-title">{t("networkSection")}</div>
                  <div className="wc-backend-info">
                    <div className="wc-backend-row"><span>Network</span><span className="wc-backend-val">{backendInfo.network}</span></div>
                    <div className="wc-backend-row"><span>Chain ID</span><span className="wc-backend-val">{backendInfo.chainId}</span></div>
                    <div className="wc-backend-row">
                      <span>{t("environment")}</span>
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
                  <div className="wc-section-title">{t("features")}</div>
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
          <div className="wc-hist-filters" role="tablist" aria-label={t("filterAriaLabel")}>
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
            <div className="wc-loading" role="status"><span className="usda-loading-dots" aria-hidden="true" /> {t("loadingDots")}</div>
          )}
          {histError && (
            <div className="usda-error" style={{ margin: "12px 16px" }} role="alert">{histError}</div>
          )}
          {!histLoading && !histError && payments.length === 0 && (
            <div className="wc-empty">{t("noTransactions")}</div>
          )}

          <div className="wc-hist-list" role="list">
            {payments.map((p) => (
              <button
                key={p.payment_id} type="button" role="listitem"
                className="usda-history-item"
                aria-label={t("historyItemAriaLabel", { kind: p.kind === "request" ? t("kindRequest") : t("kindPayment"), amount: p.amount, status: USDA_STATUS_LABELS[p.status] })}
                onClick={() => {
                  // I transfer del Chat Payment Engine (id "ct_…") non hanno una
                  // scheda dettaglio legacy: se c'è un hash apri PolygonScan.
                  if (p.payment_id.startsWith("ct_")) {
                    if (p.tx_hash) window.open(`https://polygonscan.com/tx/${p.tx_hash}`, "_blank", "noopener");
                    return;
                  }
                  setDetailId(p.payment_id);
                }}
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
              {t("moreTransactionsCount", { count: histTotal - payments.length })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Impostazioni ───────────────────────────────────────────────── */}
      {tab === "impostazioni" && (
        <div id="wc-panel-impostazioni" role="tabpanel" aria-labelledby="wc-tab-impostazioni" className="wc-content">

          {/* Alpha Wallet — wallet nativo */}
          {awPhase !== "initializing" && (
            <>
              <div className="wc-section-title">🔐 Alpha Wallet</div>
              {hasAlphaWallet ? (
                <div className="wc-aw-card wc-aw-card--active">
                  <div className="wc-aw-header">
                    <span className="wc-aw-icon" aria-hidden="true">🔐</span>
                    <div className="wc-aw-title-group">
                      <span className="wc-aw-title">Alpha Wallet</span>
                      <span className="wc-aw-badge">✓ Attivo</span>
                    </div>
                    {awPhase === "locked" && (
                      <span className="wc-aw-locked-badge" title="Wallet bloccato — sblocca in Alpha Wallet">🔒</span>
                    )}
                  </div>
                  {awMeta && (
                    <div className="wc-aw-addr-row">
                      <span className="wc-aw-addr-label">EVM</span>
                      <span className="wc-aw-addr">{awMeta.evmAddress.slice(0, 6)}…{awMeta.evmAddress.slice(-4)}</span>
                    </div>
                  )}
                  {awMeta && (
                    <div className="wc-aw-addr-row">
                      <span className="wc-aw-addr-label">BTC</span>
                      <span className="wc-aw-addr">{awMeta.btcAddress.slice(0, 8)}…{awMeta.btcAddress.slice(-6)}</span>
                    </div>
                  )}
                  <p className="wc-aw-hint">Usa <strong>Paga con Alpha Wallet</strong> in chat per pagamenti diretti P2P senza wallet esterni.</p>
                  {onOpenAlphaWallet && (
                    <button type="button" className="wc-aw-open-btn" onClick={onOpenAlphaWallet}>
                      Apri Alpha Wallet →
                    </button>
                  )}
                </div>
              ) : (
                <div className="wc-aw-card wc-aw-card--empty">
                  <div className="wc-aw-header">
                    <span className="wc-aw-icon" aria-hidden="true">🔐</span>
                    <span className="wc-aw-title">Alpha Wallet — Wallet nativo</span>
                  </div>
                  <p className="wc-aw-desc">Wallet self-custodial integrato in Alpha Chat. Nessun MetaMask o Trust Wallet richiesto per i pagamenti diretti in chat.</p>
                  {onOpenAlphaWallet && (
                    <button type="button" className="wc-aw-setup-btn" onClick={onOpenAlphaWallet}>
                      Configura Alpha Wallet →
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Wallet esterno — Reown AppKit */}
          <div className="wc-section-title" style={{ marginTop: 20 }}>{t("connectedWallet")}</div>
          <div className="wc-tw-section">
            {isWalletConnected && address ? (
              <div className="wc-tw-card">
                <div className="wc-tw-chain-row">
                  <span aria-hidden="true">🟣</span>
                  <span>Polygon Mainnet</span>
                  <span className="wc-tw-badge wc-tw-badge--ok">Chain 137 ✓</span>
                </div>
                <div className="wc-tw-addr-row">
                  <span className="wc-tw-addr-label">{t("addressFromWallet")}</span>
                  <span className="wc-tw-addr">{address}</span>
                </div>
                <div className="wc-tw-connect-btn">
                  <ConnectButton client={client} chain={polygon} wallets={wallets} appMetadata={appMetadata} />
                </div>
              </div>
            ) : (
              <div className="wc-tw-card wc-tw-card--empty">
                <p>{t("noWallet")}</p>
                <p className="wc-tw-hint">
                  {t("noWalletHint")}
                </p>
                <div className="wc-tw-connect-btn">
                  <ConnectButton client={client} chain={polygon} wallets={wallets} appMetadata={appMetadata} />
                </div>
              </div>
            )}
          </div>

          {/* Backend USDA */}
          {(backendInfo || capabilities) && (
            <>
              <div className="wc-section-title" style={{ marginTop: 24 }}>{t("backendUsda")}</div>
              <div className="wc-backend-info">
                {backendInfo && (
                  <>
                    <div className="wc-backend-row"><span>{t("backendName")}</span><span className="wc-backend-val">{backendInfo.name}</span></div>
                    <div className="wc-backend-row"><span>{t("backendVersion")}</span><span className="wc-backend-val">{backendInfo.version}</span></div>
                    <div className="wc-backend-row"><span>API</span><span className="wc-backend-val">{backendInfo.apiVersion}</span></div>
                    <div className="wc-backend-row">
                      <span>{t("environment")}</span>
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


    </div>
  );
}
