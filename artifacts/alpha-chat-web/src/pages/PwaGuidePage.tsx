/**
 * PwaGuidePage — Come installare AlphaChat come app
 * Guida passo-passo per iPhone (Safari) e Android (Chrome)
 * con illustrazioni emoji e istruzioni per abilitare le notifiche.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  onBack: () => void;
}

export default function PwaGuidePage({ onBack }: Props) {
  const { t } = useTranslation("pwa");
  const [tab, setTab] = useState<"iphone" | "android">("iphone");

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("backAriaLabel")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">{t("title")}</h1>
      </header>

      <div className="settings-body">

        {/* Hero */}
        <div className="pwa-hero">
          <div className="pwa-hero-icon">📲</div>
          <div className="pwa-hero-text">
            <div className="pwa-hero-title">{t("heroTitle")}</div>
            <div className="pwa-hero-sub">
              {t("heroSub")}
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="pwa-benefits">
          <div className="pwa-benefit"><span>⚡</span><span>{t("benefitSpeed")}</span></div>
          <div className="pwa-benefit"><span>🔔</span><span>{t("benefitNotifs")}</span></div>
          <div className="pwa-benefit"><span>📴</span><span>{t("benefitOffline")}</span></div>
          <div className="pwa-benefit"><span>🔒</span><span>{t("benefitNoTrack")}</span></div>
        </div>

        {/* Tab switcher */}
        <div className="pwa-tabs">
          <button
            className={`pwa-tab${tab === "iphone" ? " pwa-tab--active" : ""}`}
            onClick={() => setTab("iphone")}
          >
            {t("tabIphone")}
          </button>
          <button
            className={`pwa-tab${tab === "android" ? " pwa-tab--active" : ""}`}
            onClick={() => setTab("android")}
          >
            {t("tabAndroid")}
          </button>
        </div>

        {/* ─── iPhone ─────────────────────────────────────────────── */}
        {tab === "iphone" && (
          <div className="pwa-steps">

            <div className="pwa-section-label">{t("sectionAddHome")}</div>

            <div className="pwa-step">
              <div className="pwa-step-num">1</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("iphoneStep1Title")}</div>
                <div className="pwa-step-desc">
                  {t("iphoneStep1DescA")}<strong>{t("iphoneStep1DescStrong")}</strong>{t("iphoneStep1DescB")}
                </div>
                <div className="pwa-phone-mock">
                  <div className="pwa-mock-bar">
                    <span className="pwa-mock-dot" />
                    <span className="pwa-mock-url">🔒 alphachat.app</span>
                    <span className="pwa-mock-icon">⟳</span>
                  </div>
                  <div className="pwa-mock-tip">← {t("mockUseBrowser")}</div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">2</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("iphoneStep2Title")}</div>
                <div className="pwa-step-desc">
                  {t("iphoneStep2DescA")}<strong>{t("iphoneStep2DescStrong")}</strong>{t("iphoneStep2DescB")}
                </div>
                <div className="pwa-phone-mock">
                  <div className="pwa-mock-toolbar">
                    <span className="pwa-mock-tb-btn">←</span>
                    <span className="pwa-mock-tb-btn">→</span>
                    <span className="pwa-mock-tb-btn pwa-mock-tb-share">⬆</span>
                    <span className="pwa-mock-tb-btn">⊡</span>
                    <span className="pwa-mock-tb-btn">≡</span>
                  </div>
                  <div className="pwa-mock-arrow">↑ {t("mockTapHere")}</div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">3</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("iphoneStep3Title")}</div>
                <div className="pwa-step-desc">
                  {t("iphoneStep3Desc")}
                </div>
                <div className="pwa-share-sheet">
                  <div className="pwa-share-row">📬 <span>{t("shareAirDrop")}</span></div>
                  <div className="pwa-share-row">✉️ <span>{t("shareMail")}</span></div>
                  <div className="pwa-share-row">💬 <span>{t("shareMessages")}</span></div>
                  <div className="pwa-share-row pwa-share-row--highlight">
                    <span>⊞</span>
                    <span><strong>{t("shareAddHome")}</strong></span>
                    <span className="pwa-share-arrow">›</span>
                  </div>
                  <div className="pwa-share-row">📋 <span>{t("shareCopyLink")}</span></div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">4</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("iphoneStep4Title")}</div>
                <div className="pwa-step-desc">
                  {t("iphoneStep4DescA")}<strong>{t("iphoneStep4DescStrong")}</strong>{t("iphoneStep4DescB")}
                </div>
                <div className="pwa-confirm-mock">
                  <div className="pwa-confirm-header">
                    <span className="pwa-confirm-cancel">{t("confirmCancel")}</span>
                    <span className="pwa-confirm-title">{t("confirmAddHomeTitle")}</span>
                    <span className="pwa-confirm-add">{t("confirmAdd")}</span>
                  </div>
                  <div className="pwa-confirm-icon">🔒</div>
                  <div className="pwa-confirm-name">AlphaChat</div>
                </div>
              </div>
            </div>

            <div className="pwa-step pwa-step--success">
              <div className="pwa-step-num">✓</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("iphoneSuccessTitle")}</div>
                <div className="pwa-step-desc">
                  {t("iphoneSuccessDesc")}
                </div>
              </div>
            </div>

            {/* Notifications iPhone */}
            <div className="pwa-section-label" style={{ marginTop: 24 }}>{t("sectionNotifIos")}</div>

            <div className="pwa-notif-box">
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">1</span>
                <span>{t("notifStep1IosA")}<strong>{t("notifStep1IosStrong")}</strong>{t("notifStep1IosB")}</span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">2</span>
                <span>{t("notifStep2SettingsA")}<strong>{t("notifStep2SettingsStrong")}</strong></span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">3</span>
                <span>{t("notifStep3EnableA")}<strong>{t("notifStep3EnableStrong")}</strong></span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">4</span>
                <span>{t("notifStep4AllowA")}<strong>{t("notifStep4AllowStrong")}</strong>{t("notifStep4AllowB")}</span>
              </div>
            </div>

            <div className="pwa-note">
              <span>⚠️</span>
              <span>{t("iphoneNoteWarn")}</span>
            </div>
          </div>
        )}

        {/* ─── Android ─────────────────────────────────────────────── */}
        {tab === "android" && (
          <div className="pwa-steps">

            <div className="pwa-section-label">{t("sectionAddHome")}</div>

            <div className="pwa-step">
              <div className="pwa-step-num">1</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("androidStep1Title")}</div>
                <div className="pwa-step-desc">
                  {t("androidStep1DescA")}<strong>{t("androidStep1DescStrong")}</strong>{t("androidStep1DescB")}
                </div>
                <div className="pwa-phone-mock">
                  <div className="pwa-mock-bar">
                    <span className="pwa-mock-dot" />
                    <span className="pwa-mock-url">🔒 alphachat.app</span>
                    <span className="pwa-mock-icon">⋮</span>
                  </div>
                  <div className="pwa-mock-tip">← {t("mockUseBrowser")}</div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">2</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("androidStep2Title")}</div>
                <div className="pwa-step-desc">
                  {t("androidStep2DescA")}<strong>{t("androidStep2DescStrong")}</strong>{t("androidStep2DescB")}
                </div>
                <div className="pwa-phone-mock">
                  <div className="pwa-mock-bar">
                    <span className="pwa-mock-url" style={{ flex: 1 }}>🔒 alphachat.app</span>
                    <span className="pwa-mock-icon pwa-mock-icon--highlight">⋮</span>
                  </div>
                  <div className="pwa-mock-arrow" style={{ textAlign: "right" }}>↑ {t("mockTapHere")}</div>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">3</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("androidStep3Title")}</div>
                <div className="pwa-step-desc">
                  {t("androidStep3DescA")}<em>{t("androidStep3DescEm")}</em>{t("androidStep3DescB")}
                </div>
                <div className="pwa-share-sheet">
                  <div className="pwa-share-row">🔖 <span>{t("shareBookmark")}</span></div>
                  <div className="pwa-share-row pwa-share-row--highlight">
                    <span>⊞</span>
                    <span><strong>{t("shareAddHome")}</strong></span>
                    <span className="pwa-share-arrow">›</span>
                  </div>
                  <div className="pwa-share-row">🖨️ <span>{t("sharePrint")}</span></div>
                  <div className="pwa-share-row">ℹ️ <span>{t("shareSiteInfo")}</span></div>
                </div>
                <div className="pwa-or-divider">{t("orDivider")}</div>
                <div className="pwa-install-banner">
                  <span>🔒</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t("installBannerTitle")}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>alphachat.app</div>
                  </div>
                  <button className="pwa-install-btn">{t("installBtn")}</button>
                </div>
              </div>
            </div>

            <div className="pwa-step">
              <div className="pwa-step-num">4</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("androidStep4Title")}</div>
                <div className="pwa-step-desc">
                  {t("androidStep4DescA")}<strong>{t("androidStep4DescStrong")}</strong>{t("androidStep4DescB")}
                </div>
                <div className="pwa-confirm-mock">
                  <div className="pwa-confirm-icon">🔒</div>
                  <div className="pwa-confirm-name">AlphaChat</div>
                  <div className="pwa-confirm-domain">alphachat.app</div>
                  <div className="pwa-confirm-actions">
                    <span className="pwa-confirm-cancel-btn">{t("confirmCancel")}</span>
                    <span className="pwa-confirm-install-btn">{t("installBtn")}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pwa-step pwa-step--success">
              <div className="pwa-step-num">✓</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{t("androidSuccessTitle")}</div>
                <div className="pwa-step-desc">
                  {t("androidSuccessDesc")}
                </div>
              </div>
            </div>

            {/* Notifications Android */}
            <div className="pwa-section-label" style={{ marginTop: 24 }}>{t("sectionNotifAndroid")}</div>

            <div className="pwa-notif-box">
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">1</span>
                <span>{t("androidInstalled")}</span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">2</span>
                <span>{t("notifStep2SettingsA")}<strong>{t("notifStep2SettingsStrong")}</strong></span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">3</span>
                <span>{t("notifStep3EnableA")}<strong>{t("notifStep3EnableStrong")}</strong></span>
              </div>
              <div className="pwa-notif-row">
                <span className="pwa-notif-num">4</span>
                <span>{t("notifStep4AllowA")}<strong>{t("notifStep4AllowStrong")}</strong>{t("notifStep4AndroidB")}</span>
              </div>
            </div>

            <div className="pwa-note pwa-note--green">
              <span>✅</span>
              <span>{t("androidNoteOk")}</span>
            </div>
          </div>
        )}

        {/* Troubleshooting */}
        <div className="pwa-section-label" style={{ marginTop: 8 }}>{t("sectionTroubleshooting")}</div>
        <div className="pwa-faq">
          <details className="pwa-faq-item">
            <summary>{t("faqNoAddHomeIphone")}</summary>
            <p>{t("faqNoAddHomeIphoneAns")}</p>
          </details>
          <details className="pwa-faq-item">
            <summary>{t("faqNoNotifsIphone")}</summary>
            <p>{t("faqNoNotifsIphoneAns")}</p>
          </details>
          <details className="pwa-faq-item">
            <summary>{t("faqNoInstallAndroid")}</summary>
            <p>{t("faqNoInstallAndroidAns")}</p>
          </details>
          <details className="pwa-faq-item">
            <summary>{t("faqOpensInBrowser")}</summary>
            <p>{t("faqOpensInBrowserAns")}</p>
          </details>
        </div>

      </div>
    </div>
  );
}
