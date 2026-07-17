/**
 * SecurityCenterPage — "Perché Alpha Chat è diversa"
 *
 * Modal fullscreen con hero, accordion animati e banner finale.
 * Solo UI informativa — zero modifiche alla logica E2E.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  onClose: () => void;
}

interface Section {
  id: string;
  emoji: string;
  title: string;
  content: React.ReactNode;
  highlight?: boolean;
}

function AccordionItem({ section, isOpen, onToggle }: {
  section: Section;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`sc-accordion${isOpen ? " sc-accordion--open" : ""}${section.highlight ? " sc-accordion--highlight" : ""}`}>
      <button
        className="sc-accordion-header"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="sc-accordion-emoji">{section.emoji}</span>
        <span className="sc-accordion-title">{section.title}</span>
        <span className="sc-accordion-chevron">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div className="sc-accordion-body">
          {section.content}
        </div>
      )}
    </div>
  );
}

export default function SecurityCenterPage({ onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { t } = useTranslation();

  const SECTIONS: Section[] = [
    {
      id: "e2e",
      emoji: "🔒",
      title: t("securityCenter.sections.e2e.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.e2e.p1before")}<strong>{t("securityCenter.sections.e2e.p1bold")}</strong>{t("securityCenter.sections.e2e.p1after")}</p>
          <p>{t("securityCenter.sections.e2e.p2")}</p>
          <div className="sc-badge-row">
            <span className="sc-badge sc-badge--green">✅ Signal Protocol</span>
            <span className="sc-badge sc-badge--green">✅ Zero-knowledge server</span>
          </div>
        </>
      ),
    },
    {
      id: "x3dh",
      emoji: "🔑",
      title: t("securityCenter.sections.x3dh.title"),
      content: (
        <>
          <p><strong>Extended Triple Diffie-Hellman</strong>{t("securityCenter.sections.x3dh.p1after")}</p>
          <p>{t("securityCenter.sections.x3dh.p2")}</p>
          <p>{t("securityCenter.sections.x3dh.p3")}</p>
        </>
      ),
    },
    {
      id: "ratchet",
      emoji: "🔄",
      title: t("securityCenter.sections.ratchet.title"),
      content: (
        <>
          <p>Il <strong>Double Ratchet Algorithm</strong>{t("securityCenter.sections.ratchet.p1after")}</p>
          <div className="sc-feature-list">
            <div className="sc-feature-item">
              <span className="sc-feature-icon">⏩</span>
              <div>
                <strong>{t("securityCenter.sections.ratchet.forwardSecrecyTitle")}</strong>
                <p>{t("securityCenter.sections.ratchet.forwardSecrecyDesc")}</p>
              </div>
            </div>
            <div className="sc-feature-item">
              <span className="sc-feature-icon">🛡️</span>
              <div>
                <strong>{t("securityCenter.sections.ratchet.postCompromiseTitle")}</strong>
                <p>{t("securityCenter.sections.ratchet.postCompromiseDesc")}</p>
              </div>
            </div>
          </div>
        </>
      ),
    },
    {
      id: "media",
      emoji: "📷",
      title: t("securityCenter.sections.media.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.media.p1before")}<strong>AES-256-GCM</strong>{t("securityCenter.sections.media.p1after")}</p>
          <p>{t("securityCenter.sections.media.p2")}</p>
          <div className="sc-badge-row">
            <span className="sc-badge">📸 Photo</span>
            <span className="sc-badge">🎥 Video</span>
            <span className="sc-badge">🎵 Audio</span>
            <span className="sc-badge">📄 Docs</span>
          </div>
        </>
      ),
    },
    {
      id: "zk",
      emoji: "🧩",
      title: t("securityCenter.sections.zk.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.zk.p1")}</p>
          <div className="sc-knows-grid">
            <div className="sc-knows-col">
              <div className="sc-knows-header sc-knows-header--yes">{t("securityCenter.serverKnows")}</div>
              {t("securityCenter.serverKnowsItems").split("|").map(item => (
                <div key={item} className="sc-knows-item">{item}</div>
              ))}
            </div>
            <div className="sc-knows-col">
              <div className="sc-knows-header sc-knows-header--no">{t("securityCenter.serverKnowsNot")}</div>
              {t("securityCenter.serverKnowsNotItems").split("|").map(item => (
                <div key={item} className="sc-knows-item sc-knows-item--no">{item}</div>
              ))}
            </div>
          </div>
        </>
      ),
    },
    {
      id: "ghost",
      emoji: "👻",
      title: t("securityCenter.sections.ghost.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.ghost.p1")}</p>
          <div className="sc-feature-list">
            <div className="sc-feature-item"><span className="sc-feature-icon">🕐</span><div><strong>{t("securityCenter.sections.ghost.lastSeenTitle")}</strong><p>{t("securityCenter.sections.ghost.lastSeenDesc")}</p></div></div>
            <div className="sc-feature-item"><span className="sc-feature-icon">⚫</span><div><strong>{t("securityCenter.sections.ghost.onlineTitle")}</strong><p>{t("securityCenter.sections.ghost.onlineDesc")}</p></div></div>
            <div className="sc-feature-item"><span className="sc-feature-icon">✓</span><div><strong>{t("securityCenter.sections.ghost.receiptsTitle")}</strong><p>{t("securityCenter.sections.ghost.receiptsDesc")}</p></div></div>
          </div>
        </>
      ),
    },
    {
      id: "burn",
      emoji: "🔥",
      title: t("securityCenter.sections.burn.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.burn.p1before")}<strong>{t("securityCenter.sections.burn.p1bold")}</strong>{t("securityCenter.sections.burn.p1after")}</p>
          <p>{t("securityCenter.sections.burn.p2")}</p>
        </>
      ),
    },
    {
      id: "disappearing",
      emoji: "⏳",
      title: t("securityCenter.sections.disappearing.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.disappearing.p1")}</p>
          <p>{t("securityCenter.sections.disappearing.p2")}</p>
        </>
      ),
    },
    {
      id: "destroy",
      emoji: "🗑️",
      title: t("securityCenter.sections.destroy.title"),
      content: (
        <>
          <p><strong>{t("securityCenter.sections.destroy.p1bold")}</strong>{t("securityCenter.sections.destroy.p1after")}</p>
          <p>{t("securityCenter.sections.destroy.p2")}</p>
        </>
      ),
    },
    {
      id: "safety",
      emoji: "👤",
      title: t("securityCenter.sections.safety.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.safety.p1before")}<strong>{t("securityCenter.sections.safety.p1bold")}</strong>{t("securityCenter.sections.safety.p1after")}</p>
          <div className="sc-feature-list">
            <div className="sc-feature-item"><span className="sc-feature-icon">🔍</span><div><strong>{t("securityCenter.sections.safety.mitmTitle")}</strong><p>{t("securityCenter.sections.safety.mitmDesc")}</p></div></div>
            <div className="sc-feature-item"><span className="sc-feature-icon">📱</span><div><strong>{t("securityCenter.sections.safety.qrTitle")}</strong><p>{t("securityCenter.sections.safety.qrDesc")}</p></div></div>
            <div className="sc-feature-item"><span className="sc-feature-icon">🔢</span><div><strong>{t("securityCenter.sections.safety.fingerprintTitle")}</strong><p>{t("securityCenter.sections.safety.fingerprintDesc")}</p></div></div>
          </div>
        </>
      ),
    },
    {
      id: "device-security",
      emoji: "📱",
      title: t("securityCenter.sections.deviceSecurity.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.deviceSecurity.p1")}</p>
          <div className="sc-badge-row sc-badge-row--wrap">
            <span className="sc-badge">👁️ Face ID</span>
            <span className="sc-badge">👆 Touch ID</span>
            <span className="sc-badge">🔢 PIN</span>
            <span className="sc-badge">🕶️ Privacy Screen</span>
            <span className="sc-badge">⏱️ Auto Lock</span>
          </div>
        </>
      ),
    },
    {
      id: "emergency-lock",
      emoji: "🚨",
      title: t("securityCenter.sections.emergencyLock.title"),
      content: (
        <>
          <p><strong>{t("securityCenter.sections.emergencyLock.p1bold")}</strong>{t("securityCenter.sections.emergencyLock.p1after")}</p>
          <div className="sc-scenario-list">
            <div className="sc-scenario">📱 <span>{t("securityCenter.sections.emergencyLock.scenario1")}</span></div>
            <div className="sc-scenario">👤 <span>{t("securityCenter.sections.emergencyLock.scenario2")}</span></div>
            <div className="sc-scenario">⚠️ <span>{t("securityCenter.sections.emergencyLock.scenario3")}</span></div>
          </div>
          <p className="sc-hint">{t("securityCenter.sections.emergencyLock.hint")}</p>
        </>
      ),
    },
    {
      id: "phoenix",
      emoji: "🔥",
      title: t("securityCenter.sections.phoenix.title"),
      highlight: true,
      content: (
        <>
          <div className="sc-phoenix-hero">
            <div className="sc-phoenix-icon">🦅</div>
            <p className="sc-phoenix-tagline">{t("securityCenter.phoenixTagline")}</p>
          </div>
          <p>{t("securityCenter.phoenixIntro")}</p>
          <div className="sc-auth-steps">
            <div className="sc-auth-step"><span>1</span> {t("securityCenter.phoenixStep1")}</div>
            <div className="sc-auth-step"><span>2</span> {t("securityCenter.phoenixStep2")}</div>
            <div className="sc-auth-step"><span>3</span> {t("securityCenter.phoenixStep3")}</div>
          </div>
          <p className="sc-section-label">{t("securityCenter.phoenixScenariosLabel")}</p>
          <div className="sc-scenario-grid">
            <div className="sc-scenario-card">📱<br/><strong>{t("securityCenter.phoenixScenario1")}</strong></div>
            <div className="sc-scenario-card">🚔<br/><strong>{t("securityCenter.phoenixScenario2")}</strong></div>
            <div className="sc-scenario-card">⚠️<br/><strong>{t("securityCenter.phoenixScenario3")}</strong></div>
            <div className="sc-scenario-card">🛂<br/><strong>{t("securityCenter.phoenixScenario4")}</strong></div>
            <div className="sc-scenario-card">📰<br/><strong>{t("securityCenter.phoenixScenario5")}</strong></div>
            <div className="sc-scenario-card">⚖️<br/><strong>{t("securityCenter.phoenixScenario6")}</strong></div>
            <div className="sc-scenario-card">👩‍⚕️<br/><strong>{t("securityCenter.phoenixScenario7")}</strong></div>
            <div className="sc-scenario-card">🛡️<br/><strong>{t("securityCenter.phoenixScenario8")}</strong></div>
          </div>
          <p className="sc-section-label">{t("securityCenter.phoenixDestroyLabel")}</p>
          <div className="sc-destroy-list">
            {t("securityCenter.phoenixDestroyItems").split("|").map(item => (
              <div key={item} className="sc-destroy-item">✅ {item}</div>
            ))}
          </div>
          <div className="sc-phoenix-warning">
            {t("securityCenter.phoenixWarning")}
          </div>
        </>
      ),
    },
    {
      id: "multidevice",
      emoji: "📲",
      title: t("securityCenter.sections.multidevice.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.multidevice.p1")}</p>
          <p>{t("securityCenter.sections.multidevice.p2")}</p>
        </>
      ),
    },
    {
      id: "block",
      emoji: "🚫",
      title: t("securityCenter.sections.block.title"),
      content: (
        <>
          <p>{t("securityCenter.sections.block.p1")}</p>
          <p>{t("securityCenter.sections.block.p2")}</p>
        </>
      ),
    },
  ];

  function toggle(id: string) {
    setOpenId(prev => prev === id ? null : id);
  }

  return (
    <div className="sc-root">
      {/* Header bar */}
      <div className="sc-topbar">
        <button className="sc-close-btn" onClick={onClose} aria-label={t("common.close")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span className="sc-topbar-title">{t("securityCenter.pageTitle")}</span>
      </div>

      <div className="sc-scroll">
        {/* Hero */}
        <div className="sc-hero">
          <div className="sc-hero-logo">α</div>
          <div className="sc-hero-brand">Alpha Chat</div>
          <h1 className="sc-hero-title">{t("securityCenter.heroTitle")}</h1>
          <p className="sc-hero-subtitle">{t("securityCenter.heroSubtitle")}</p>
          <p className="sc-hero-desc">{t("securityCenter.heroDesc")}</p>
        </div>

        {/* Accordion */}
        <div className="sc-accordion-list">
          {SECTIONS.map(section => (
            <AccordionItem
              key={section.id}
              section={section}
              isOpen={openId === section.id}
              onToggle={() => toggle(section.id)}
            />
          ))}
        </div>

        {/* Sezione emozionale finale */}
        <div className="sc-why-section">
          <div className="sc-why-icon">💜</div>
          <h2 className="sc-why-title">{t("securityCenter.whyTitle")}</h2>
          <p className="sc-why-text">{t("securityCenter.whyText1")}</p>
          <p className="sc-why-text">
            {t("securityCenter.whyText2")}
          </p>
          <p className="sc-why-text">
            {t("securityCenter.whyText3")}
            <br />
            <strong>{t("securityCenter.whyText3b")}</strong>
          </p>
        </div>

        {/* Banner finale */}
        <div className="sc-final-banner">
          <div className="sc-final-icon">🛡️</div>
          <h2 className="sc-final-title">{t("securityCenter.finalTitle")}</h2>
          <p className="sc-final-text">
            {t("securityCenter.finalText")}
            <br />
            {t("securityCenter.finalText2")}
          </p>
          <div className="sc-final-divider" />
          <p className="sc-final-motto">{t("securityCenter.finalMotto")}</p>
          <p className="sc-final-submotto">{t("securityCenter.finalSubmotto")}</p>
          <button className="sc-final-btn" onClick={onClose}>
            {t("securityCenter.understood")}
          </button>
        </div>
      </div>
    </div>
  );
}
