/**
 * WalletCenterPage — Sprint USDA
 * Hub wallet: saldo, storia, impostazioni USDA.
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, polygon, wallets } from "../lib/thirdweb";
import { apiUsdaGetHistory } from "../lib/usda-api";
import type { UsdaPaymentData } from "../lib/usda-types";
import { USDA_STATUS_ICONS } from "../lib/usda-types";
import type { AppView } from "../App";

interface Props {
  onBack: () => void;
  onNavigate?: (view: AppView) => void;
}

const STATUS_ICON = USDA_STATUS_ICONS;

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function WalletCenterPage({ onBack, onNavigate }: Props) {
  const { t } = useTranslation("walletCenter");

  // TAB_META and HISTORY_FILTERS inside component so t() works
  const TAB_META = [
    { key: "overview",  label: t("tabOverview"),  icon: "💳" },
    { key: "history",   label: t("tabHistory"),   icon: "📋" },
    { key: "settings",  label: t("tabSettings"),  icon: "⚙️" },
  ] as const;

  const HISTORY_FILTERS = [
    { key: "all",      label: t("filterAll") },
    { key: "send",     label: t("filterSend") },
    { key: "receive",  label: t("filterReceive") },
    { key: "request",  label: t("filterRequest") },
  ] as const;

  const account = useActiveAccount();
  const address = account?.address;
  const isConnected = !!account;

  const [tab, setTab]               = useState<"overview" | "history" | "settings">("overview");
  const [history, setHistory]       = useState<UsdaPaymentData[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [filter, setFilter]         = useState<"all" | "send" | "receive" | "request">("all");

  const fetchHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const r = await apiUsdaGetHistory({ limit: 50 });
      setHistory(r.payments);
    } catch { /* ignore */ }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === "history") void fetchHistory();
  }, [tab, fetchHistory]);

  const filteredHistory = history.filter(h => {
    if (filter === "all") return true;
    return h.kind === filter;
  });

  return (
    <div className="wc-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="settings-title">💳 {t("title")}</h1>
      </header>

      {/* Tab bar */}
      <div className="wc-tabs">
        {TAB_META.map(tab_ => (
          <button
            key={tab_.key}
            className={`wc-tab${tab === tab_.key ? " wc-tab--active" : ""}`}
            onClick={() => setTab(tab_.key)}
          >
            {tab_.icon} {tab_.label}
          </button>
        ))}
      </div>

      <div className="wc-body">

        {/* ── Overview ── */}
        {tab === "overview" && (
          <>
            {/* Wallet chip */}
            <div className="wc-wallet-card">
              <div className="wc-wallet-top">
                <div className="wc-wallet-label">{t("walletAddress")}</div>
                {isConnected && address && (
                  <button className="wc-copy-btn" onClick={() => navigator.clipboard.writeText(address)}>
                    📋
                  </button>
                )}
              </div>
              {isConnected && address ? (
                <div className="wc-wallet-addr">{shortAddr(address)}</div>
              ) : (
                <div className="wc-no-wallet">{t("noWallet")}</div>
              )}
              <ConnectButton client={client} chain={polygon} wallets={wallets} />
            </div>

            {/* Quick actions */}
            <div className="wc-actions-grid">
              <button className="wc-action-item" onClick={() => onNavigate?.("usda-settings")}>
                <span className="wc-action-icon">📤</span>
                <span>{t("actionSend")}</span>
              </button>
              <button className="wc-action-item" onClick={() => onNavigate?.("usda-settings")}>
                <span className="wc-action-icon">📥</span>
                <span>{t("actionReceive")}</span>
              </button>
              <button className="wc-action-item" onClick={() => setTab("history")}>
                <span className="wc-action-icon">📋</span>
                <span>{t("actionHistory")}</span>
              </button>
              <button className="wc-action-item" onClick={() => onNavigate?.("usda-settings")}>
                <span className="wc-action-icon">⚙️</span>
                <span>{t("actionSettings")}</span>
              </button>
            </div>
          </>
        )}

        {/* ── History ── */}
        {tab === "history" && (
          <>
            <div className="wc-filter-row">
              {HISTORY_FILTERS.map(f => (
                <button
                  key={f.key}
                  className={`wc-filter${filter === f.key ? " wc-filter--active" : ""}`}
                  onClick={() => setFilter(f.key)}
                >{f.label}</button>
              ))}
            </div>

            {histLoading ? (
              <div className="wc-loading">{t("loading")}</div>
            ) : filteredHistory.length === 0 ? (
              <div className="wc-empty">{t("historyEmpty")}</div>
            ) : (
              <div className="wc-history-list">
                {filteredHistory.map(h => (
                  <div key={h.payment_id} className="wc-history-item">
                    <div className="wc-history-icon">{STATUS_ICON[h.status] ?? "•"}</div>
                    <div className="wc-history-body">
                      <div className="wc-history-type">{h.kind}</div>
                      <div className="wc-history-date">{h.created_at ? new Date(h.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"}</div>
                    </div>
                    <div className="wc-history-amount">
                      {h.kind === "send" ? "−" : "+"}
                      {Number(h.amount).toFixed(2)} USDA
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Settings ── */}
        {tab === "settings" && (
          <>
            <div className="settings-section">
              <div className="settings-section-title">{t("settingsSection")}</div>
              <button className="settings-item clickable" onClick={() => onNavigate?.("usda-settings")}>
                <div className="settings-item-icon">⚙️</div>
                <div className="settings-item-content">
                  <div className="settings-item-label">{t("usdaSettingsLabel")}</div>
                  <div className="settings-item-value muted">{t("usdaSettingsDesc")}</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">{t("networkSection")}</div>
              <div className="settings-item">
                <div className="settings-item-icon">🔷</div>
                <div className="settings-item-content">
                  <div className="settings-item-label">Polygon (MATIC)</div>
                  <div className="settings-item-value muted">{t("networkDesc")}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
