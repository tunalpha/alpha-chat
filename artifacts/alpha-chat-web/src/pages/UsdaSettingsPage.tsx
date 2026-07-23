/**
 * UsdaSettingsPage — Sprint USDA
 * Panoramica USDA, guida, wallet status e cronologia.
 * I pagamenti avvengono tramite la chat (conversation_id obbligatorio).
 */

import { useState, useEffect } from "react";
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
  recipientUsername?: string | null;
}

type Tab = "overview" | "history" | "howItWorks";

export default function UsdaSettingsPage({ onBack, onNavigate }: Props) {
  const { t } = useTranslation("usdaSettings");
  const account = useActiveAccount();
  const address = account?.address;
  const isConnected = !!account;

  // HOW_SLIDES, GUIDE_STEPS, WALLET_CHIPS inside component so t() works
  const HOW_SLIDES = [
    { icon: "💵", title: t("slideMoneyTitle"), body: t("slideMoneyBody") },
    { icon: "🔒", title: t("slideSecureTitle"), body: t("slideSecureBody") },
    { icon: "⚡", title: t("slideFastTitle"), body: t("slideFastBody") },
    { icon: "🌐", title: t("slideOpenTitle"), body: t("slideOpenBody") },
  ];

  const GUIDE_STEPS = [
    { step: "1", icon: "🦊", title: t("step1Title"), desc: t("step1Desc") },
    { step: "2", icon: "🔷", title: t("step2Title"), desc: t("step2Desc") },
    { step: "3", icon: "💵", title: t("step3Title"), desc: t("step3Desc") },
    { step: "4", icon: "📲", title: t("step4Title"), desc: t("step4Desc") },
  ];

  const WALLET_CHIPS = [
    { id: "metamask",  name: "MetaMask",    icon: "🦊" },
    { id: "rainbow",   name: "Rainbow",     icon: "🌈" },
    { id: "coinbase",  name: "Coinbase",    icon: "💙" },
    { id: "trust",     name: "Trust",       icon: "🛡️" },
    { id: "phantom",   name: "Phantom",     icon: "👻" },
  ];

  const [tab, setTab]         = useState<Tab>("overview");
  const [history, setHistory] = useState<UsdaPaymentData[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [howSlide, setHowSlide]       = useState(0);

  useEffect(() => {
    if (tab === "history") {
      setHistLoading(true);
      apiUsdaGetHistory({ limit: 30 })
        .then(r => setHistory(r.payments))
        .catch(() => {})
        .finally(() => setHistLoading(false));
    }
  }, [tab]);

  return (
    <div className="usda-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="settings-title">{t("title")}</h1>
      </header>

      {/* Tab bar */}
      <div className="usda-tabs">
        <button className={`usda-tab${tab === "overview" ? " usda-tab--active" : ""}`} onClick={() => setTab("overview")}>
          💳 {t("tabOverview")}
        </button>
        <button className={`usda-tab${tab === "history" ? " usda-tab--active" : ""}`} onClick={() => setTab("history")}>
          📋 {t("tabHistory")}
        </button>
        <button className={`usda-tab${tab === "howItWorks" ? " usda-tab--active" : ""}`} onClick={() => setTab("howItWorks")}>
          ❓ {t("tabHowItWorks")}
        </button>
      </div>

      <div className="usda-body">

        {/* ── Overview ── */}
        {tab === "overview" && (
          <>
            {/* Wallet card */}
            <div className="usda-wallet-card">
              <div className="usda-wallet-label">{t("walletAddress")}</div>
              {isConnected && address ? (
                <div className="usda-wallet-addr">{`${address.slice(0, 6)}…${address.slice(-4)}`}</div>
              ) : (
                <div className="usda-no-wallet-text">{t("noWalletDesc")}</div>
              )}
              <ConnectButton client={client} chain={polygon} wallets={wallets} />
              {!isConnected && (
                <div className="usda-wallet-chips">
                  {WALLET_CHIPS.map(w => (
                    <div key={w.id} className="usda-wchip">
                      <span>{w.icon}</span><span>{w.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payments are chat-based */}
            <div className="usda-chat-hint">
              <div className="usda-chat-hint-icon">💬</div>
              <div>
                <div className="usda-chat-hint-title">{t("sendFromChatTitle")}</div>
                <div className="usda-chat-hint-desc">{t("sendFromChatDesc")}</div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="wc-actions-grid">
              <button className="wc-action-item" onClick={() => onNavigate?.("wallet-center")}>
                <span className="wc-action-icon">💳</span>
                <span>{t("actionWallet")}</span>
              </button>
              <button className="wc-action-item" onClick={() => setTab("history")}>
                <span className="wc-action-icon">📋</span>
                <span>{t("actionHistory")}</span>
              </button>
              <button className="wc-action-item" onClick={() => setTab("howItWorks")}>
                <span className="wc-action-icon">❓</span>
                <span>{t("actionHowItWorks")}</span>
              </button>
            </div>
          </>
        )}

        {/* ── History ── */}
        {tab === "history" && (
          <>
            {histLoading ? (
              <div className="wc-loading">{t("loading")}</div>
            ) : history.length === 0 ? (
              <div className="wc-empty">{t("historyEmpty")}</div>
            ) : (
              <div className="wc-history-list">
                {history.map(h => (
                  <div key={h.payment_id} className="wc-history-item">
                    <div className="wc-history-icon">{USDA_STATUS_ICONS[h.status] ?? "•"}</div>
                    <div className="wc-history-body">
                      <div className="wc-history-type">{h.kind}</div>
                      <div className="wc-history-date">
                        {h.created_at ? new Date(h.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"}
                      </div>
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

        {/* ── HOW IT WORKS ── */}
        {tab === "howItWorks" && (
          <>
            {/* Slideshow */}
            <div className="usda-slideshow">
              {HOW_SLIDES.map((s, i) => (
                <div
                  key={i}
                  className={`usda-slide${i === howSlide ? " usda-slide--active" : ""}`}
                  onClick={() => setHowSlide((i + 1) % HOW_SLIDES.length)}
                >
                  <div className="usda-slide-icon">{s.icon}</div>
                  <div className="usda-slide-title">{s.title}</div>
                  <div className="usda-slide-body">{s.body}</div>
                </div>
              ))}
              <div className="usda-slide-dots">
                {HOW_SLIDES.map((_, i) => (
                  <button
                    key={i}
                    className={`usda-dot${i === howSlide ? " usda-dot--active" : ""}`}
                    onClick={() => setHowSlide(i)}
                  />
                ))}
              </div>
            </div>

            {/* Step guide */}
            <div className="usda-guide">
              <div className="usda-guide-title">{t("guideTitle")}</div>
              {GUIDE_STEPS.map(s => (
                <div key={s.step} className="usda-guide-step">
                  <div className="usda-step-number">{s.step}</div>
                  <div className="usda-step-icon">{s.icon}</div>
                  <div className="usda-step-body">
                    <div className="usda-step-title">{s.title}</div>
                    <div className="usda-step-desc">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Supported wallets */}
            <div className="usda-wallet-section">
              <div className="usda-wallet-section-title">{t("supportedWallets")}</div>
              <div className="usda-wallet-chips-row">
                {WALLET_CHIPS.map(w => (
                  <div key={w.id} className="usda-wchip">
                    <span>{w.icon}</span><span>{w.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
