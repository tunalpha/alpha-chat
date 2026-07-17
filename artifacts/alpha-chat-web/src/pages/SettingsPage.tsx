import { type AppView } from "../App";
import { useLock } from "../contexts/LockContext";
import { useAppSettings } from "../contexts/AppSettingsContext";
import { SUPPORTED_LANGUAGES } from "../i18n";
import { useTranslation } from "react-i18next";

interface Props {
  onBack: () => void;
  onNavigate: (view: AppView) => void;
}

export default function SettingsPage({ onBack, onNavigate }: Props) {
  const { hasPINSet, lock } = useLock();
  const { settings } = useAppSettings();
  const { t } = useTranslation();

  const currentLangLabel = SUPPORTED_LANGUAGES.find(l => l.code === settings.language)?.label ?? "Italiano";

  type SettingRow = {
    icon: React.ReactNode;
    label: string;
    value?: string;
    soon?: boolean;
    onClick?: () => void;
    badge?: string;
  };

  const sections: { title: string; rows: SettingRow[] }[] = [
    {
      title: t("settings.appearance"),
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
          label: t("settings.themeColors"),
          value: t("settings.themeValue"),
          onClick: () => onNavigate("appearance"),
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
          label: t("settings.language"),
          value: currentLangLabel,
          onClick: () => onNavigate("language"),
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 22c1.1 0 2-.9 2-2H10c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>,
          label: t("settings.notifications"),
          value: t("settings.notificationsValue"),
          onClick: () => onNavigate("notifications-settings"),
        },
      ],
    },
    {
      title: t("settings.privacySecurity"),
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
          label: t("settings.privacy"),
          onClick: () => onNavigate("privacy"),
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
          label: t("settings.deviceSecurity"),
          value: hasPINSet ? t("settings.pinActive") : t("settings.deviceSecurityValue"),
          onClick: () => onNavigate("security"),
          badge: hasPINSet ? "🔒" : undefined,
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
          label: t("settings.phoenix"),
          value: t("settings.phoenixValue"),
          onClick: () => onNavigate("phoenix"),
        },
      ],
    },
    {
      title: t("settings.security"),
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
          label: `🏆 ${t("settings.trustCenter")}`,
          value: t("settings.trustCenterValue"),
          onClick: () => onNavigate("trust-center"),
          badge: t("common.new"),
        },
      ],
    },
    {
      title: t("settings.recoveryContinuity"),
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>,
          label: t("settings.recoveryDashboard"),
          value: t("settings.recoveryDashboardValue"),
          onClick: () => onNavigate("recovery-dashboard"),
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
          label: t("settings.recoverySettings"),
          value: t("settings.recoverySettingsValue"),
          onClick: () => onNavigate("recovery-settings"),
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
          label: t("settings.deadManSwitch"),
          value: t("settings.deadManSwitchValue"),
          onClick: () => onNavigate("dead-man-switch"),
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
          label: t("settings.contacts"),
          value: t("settings.contactsValue"),
          onClick: () => onNavigate("recovery-contacts"),
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
          label: t("settings.securityTimeline"),
          value: t("settings.securityTimelineValue"),
          onClick: () => onNavigate("security-timeline"),
        },
      ],
    },
    {
      title: "Alpha Chat",
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>,
          label: `🛡️ ${t("settings.securityCenterLabel")}`,
          value: t("settings.securityCenterValue"),
          onClick: () => onNavigate("security-center"),
          badge: "✨",
        },
      ],
    },
    {
      title: t("settings.data"),
      rows: [
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
          label: t("settings.downloadMedia"),
          soon: true,
        },
        {
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
          label: t("settings.storage"),
          soon: true,
        },
      ],
    },
  ];

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">{t("settings.title")}</h1>
        {hasPINSet && (
          <button
            className="settings-lock-btn"
            onClick={lock}
            aria-label="Blocca app"
            title="Blocca app"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </button>
        )}
      </header>

      <div className="settings-body">
        {sections.map((section) => (
          <div key={section.title} className="settings-section">
            <div className="settings-section-title">{section.title}</div>
            {section.rows.map((row) => (
              <div
                key={row.label}
                className={`settings-item${row.soon ? " coming-soon" : ""}${row.onClick ? " clickable" : ""}`}
                onClick={row.onClick}
                role={row.onClick ? "button" : undefined}
                tabIndex={row.onClick ? 0 : undefined}
                onKeyDown={row.onClick ? (e) => { if (e.key === "Enter") row.onClick?.(); } : undefined}
              >
                <div className="settings-item-icon">{row.icon}</div>
                <div className="settings-item-content">
                  <div className="settings-item-label">
                    {row.label}
                    {row.badge && <span className="settings-security-badge">{row.badge}</span>}
                  </div>
                  {row.value && <div className="settings-item-value muted">{row.value}</div>}
                </div>
                {row.soon
                  ? <span className="settings-item-badge">Presto</span>
                  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="settings-item-chevron"><polyline points="9 18 15 12 9 6"/></svg>
                }
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
