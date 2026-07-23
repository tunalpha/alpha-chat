/**
 * PwaGuidePage — Sprint 27
 * Guida installazione PWA (iOS Safari + Android Chrome).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props { onBack: () => void }

type Platform = "ios" | "android" | "desktop";

export default function PwaGuidePage({ onBack }: Props) {
  const { t } = useTranslation("pwa");
  const [platform, setPlatform] = useState<Platform>(detectPlatform());

  function detectPlatform(): Platform {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "desktop";
  }

  const isPwaInstalled =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;

  const PLATFORMS: { key: Platform; icon: string; label: string }[] = [
    { key: "ios",     icon: "",  label: "iOS" },
    { key: "android", icon: "🤖", label: "Android" },
    { key: "desktop", icon: "🖥️", label: t("desktop") },
  ];

  const STEPS_IOS = [
    { icon: "🧭", title: t("iosStep1Title"), desc: t("iosStep1Desc") },
    { icon: "📤", title: t("iosStep2Title"), desc: t("iosStep2Desc") },
    { icon: "🏠", title: t("iosStep3Title"), desc: t("iosStep3Desc") },
    { icon: "✅", title: t("iosStep4Title"), desc: t("iosStep4Desc") },
  ];

  const STEPS_ANDROID = [
    { icon: "🌐", title: t("andStep1Title"), desc: t("andStep1Desc") },
    { icon: "⋮",  title: t("andStep2Title"), desc: t("andStep2Desc") },
    { icon: "📲", title: t("andStep3Title"), desc: t("andStep3Desc") },
    { icon: "✅", title: t("andStep4Title"), desc: t("andStep4Desc") },
  ];

  const STEPS_DESKTOP = [
    { icon: "🌐", title: t("dskStep1Title"), desc: t("dskStep1Desc") },
    { icon: "💻", title: t("dskStep2Title"), desc: t("dskStep2Desc") },
    { icon: "✅", title: t("dskStep3Title"), desc: t("dskStep3Desc") },
  ];

  const steps =
    platform === "ios"     ? STEPS_IOS :
    platform === "android" ? STEPS_ANDROID :
    STEPS_DESKTOP;

  const BENEFITS = [
    { icon: "⚡", label: t("benefitFast") },
    { icon: "📵", label: t("benefitOffline") },
    { icon: "🔔", label: t("benefitNotif") },
    { icon: "🔒", label: t("benefitSecure") },
  ];

  return (
    <div className="pwa-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t("common:back", "Back")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="settings-title">{t("title")}</h1>
      </header>

      <div className="pwa-body">

        {/* Hero */}
        <div className="pwa-hero">
          <div className="pwa-hero-icon">📲</div>
          <div className="pwa-hero-title">{t("heroTitle")}</div>
          <div className="pwa-hero-desc">{t("heroDesc")}</div>
          {isPwaInstalled && (
            <div className="pwa-installed-badge">✅ {t("alreadyInstalled")}</div>
          )}
        </div>

        {/* Benefits */}
        <div className="pwa-benefits">
          {BENEFITS.map((b, i) => (
            <div key={i} className="pwa-benefit">
              <span className="pwa-benefit-icon">{b.icon}</span>
              <span className="pwa-benefit-label">{b.label}</span>
            </div>
          ))}
        </div>

        {/* Platform picker */}
        <div className="pwa-section-title">{t("choosePlatform")}</div>
        <div className="pwa-platform-tabs">
          {PLATFORMS.map(p => (
            <button
              key={p.key}
              className={`pwa-platform-tab${platform === p.key ? " pwa-platform-tab--active" : ""}`}
              onClick={() => setPlatform(p.key)}
            >
              <span>{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        {/* Steps */}
        <div className="pwa-steps">
          {steps.map((s, i) => (
            <div key={i} className="pwa-step">
              <div className="pwa-step-num">{i + 1}</div>
              <div className="pwa-step-icon">{s.icon}</div>
              <div className="pwa-step-body">
                <div className="pwa-step-title">{s.title}</div>
                <div className="pwa-step-desc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* iOS tip */}
        {platform === "ios" && (
          <div className="pwa-tip">
            <div className="pwa-tip-icon">💡</div>
            <div className="pwa-tip-body">
              <strong>{t("tipTitle")}</strong> {t("iosTip")}
            </div>
          </div>
        )}

        {/* Android tip */}
        {platform === "android" && (
          <div className="pwa-tip">
            <div className="pwa-tip-icon">💡</div>
            <div className="pwa-tip-body">
              <strong>{t("tipTitle")}</strong> {t("androidTip")}
            </div>
          </div>
        )}

        {/* Desktop tip */}
        {platform === "desktop" && (
          <div className="pwa-tip">
            <div className="pwa-tip-icon">💡</div>
            <div className="pwa-tip-body">
              <strong>{t("tipTitle")}</strong> {t("desktopTip")}
            </div>
          </div>
        )}

        {/* Bottom note */}
        <div className="pwa-note">{t("note")}</div>
      </div>
    </div>
  );
}
