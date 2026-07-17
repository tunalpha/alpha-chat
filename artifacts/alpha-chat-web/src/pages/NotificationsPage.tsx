import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings, type NotifPrefs } from "../contexts/AppSettingsContext";
import { apiUpdateNotificationSettings } from "../lib/api";

interface Props { onBack: () => void; }

interface ToggleRow {
  key: keyof NotifPrefs;
  label: string;
  desc: string;
  icon: string;
}

export default function NotificationsPage({ onBack }: Props) {
  const { t } = useTranslation();
  const { settings, setNotif } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const rows: ToggleRow[] = [
    { key: "messages",       label: t("notifications.messages"),       desc: t("notifications.messagesDesc"),       icon: "💬" },
    { key: "groups",         label: t("notifications.groups"),         desc: t("notifications.groupsDesc"),         icon: "👥" },
    { key: "calls",          label: t("notifications.calls"),          desc: t("notifications.callsDesc"),          icon: "📞" },
    { key: "videoCalls",     label: t("notifications.videoCalls"),     desc: t("notifications.videoCallsDesc"),     icon: "📹" },
    { key: "phoenix",        label: t("notifications.phoenix"),        desc: t("notifications.phoenixDesc"),        icon: "⚡" },
    { key: "emergencyLock",  label: t("notifications.emergencyLock"),  desc: t("notifications.emergencyLockDesc"),  icon: "🔒" },
    { key: "recovery",       label: t("notifications.recovery"),       desc: t("notifications.recoveryDesc"),       icon: "🔑" },
    { key: "previewText",    label: t("notifications.previewText"),    desc: t("notifications.previewTextDesc"),    icon: "👁️" },
    { key: "sounds",         label: t("notifications.sounds"),         desc: t("notifications.soundsDesc"),         icon: "🔔" },
    { key: "vibration",      label: t("notifications.vibration"),      desc: t("notifications.vibrationDesc"),      icon: "📳" },
    { key: "badge",          label: t("notifications.badge"),          desc: t("notifications.badgeDesc"),          icon: "🔴" },
    { key: "silenceUnknown", label: t("notifications.silenceUnknown"), desc: t("notifications.silenceUnknownDesc"), icon: "🔇" },
    { key: "contactsOnly",   label: t("notifications.contactsOnly"),   desc: t("notifications.contactsOnlyDesc"),   icon: "👤" },
    { key: "doNotDisturb",   label: t("notifications.doNotDisturb"),   desc: t("notifications.doNotDisturbDesc"),   icon: "🌙" },
  ];

  async function handleToggle(key: keyof NotifPrefs, value: boolean) {
    setNotif({ [key]: value });

    // Sync server-side fields (only those the backend tracks)
    const serverKeys: (keyof NotifPrefs)[] = ["messages", "calls", "groups", "previewText"];
    if (!serverKeys.includes(key)) return;

    setSaving(true);
    try {
      await apiUpdateNotificationSettings({ [key]: value });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* silent — local state already updated */ }
    finally { setSaving(false); }
  }

  return (
    <div className="notifications-page">
      {/* Header */}
      <div className="notif-header">
        <button className="notif-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="notif-title">{t("notifications.title")}</h1>
        {saving && <span className="notif-status">{t("notifications.saving")}</span>}
        {saved && !saving && <span className="notif-status saved">{t("notifications.saved")} ✓</span>}
      </div>

      <div className="notif-body">
        {rows.map(row => (
          <div key={row.key} className="notif-row">
            <span className="notif-row-icon">{row.icon}</span>
            <div className="notif-row-text">
              <span className="notif-row-label">{row.label}</span>
              <span className="notif-row-desc">{row.desc}</span>
            </div>
            <button
              className={`notif-toggle ${settings.notif[row.key] ? "on" : "off"}`}
              role="switch"
              aria-checked={settings.notif[row.key]}
              onClick={() => void handleToggle(row.key, !settings.notif[row.key])}
            >
              <span className="notif-toggle-thumb" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
