import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings, type NotifPrefs } from "../contexts/AppSettingsContext";
import { apiUpdateNotificationSettings } from "../lib/api";
import { savePendingNotif, notifToBackend } from "../hooks/useNotifSync";
import {
  isPushSupported,
  getPermissionStatus,
  requestAndSubscribe,
  unsubscribe as pushUnsubscribe,
  getActiveSubscription,
} from "../lib/pushManager";

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

  // ── Push state ──────────────────────────────────────────────────────────
  const [pushSupported,   setPushSupported]   = useState(false);
  const [pushPermission,  setPushPermission]  = useState<NotificationPermission | "unsupported">("default");
  const [pushSubscribed,  setPushSubscribed]  = useState(false);
  const [pushWorking,     setPushWorking]     = useState(false);

  useEffect(() => {
    const supported = isPushSupported();
    setPushSupported(supported);
    if (!supported) return;
    setPushPermission(getPermissionStatus());
    void getActiveSubscription().then((sub) => setPushSubscribed(!!sub));
  }, []);

  async function handlePushToggle() {
    if (pushWorking) return;
    setPushWorking(true);
    try {
      if (pushSubscribed) {
        await pushUnsubscribe();
        setPushSubscribed(false);
        setPushPermission(getPermissionStatus());
      } else {
        const result = await requestAndSubscribe();
        if (result === "granted") {
          setPushSubscribed(true);
          setPushPermission("granted");
        } else {
          setPushPermission(result as NotificationPermission);
        }
      }
    } finally {
      setPushWorking(false);
    }
  }

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

    const backendPatch = notifToBackend({ [key]: value });
    setSaving(true);
    try {
      await apiUpdateNotificationSettings(backendPatch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Offline — salva per la sincronizzazione al prossimo login
      savePendingNotif(backendPatch);
    }
    finally { setSaving(false); }
  }

  // Etichetta stato push
  function pushStatusLabel() {
    if (!pushSupported) return "Non supportato su questo browser";
    if (pushPermission === "denied") return "Bloccate dal browser — abilita nelle impostazioni";
    if (pushSubscribed && pushPermission === "granted") return "Attive ✓";
    return "Disattivate";
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

        {/* ── Sezione Push Notifications ───────────────────────────────── */}
        <div className="notif-section-header">Notifiche Push</div>
        <div className="notif-row notif-push-row">
          <span className="notif-row-icon">🔔</span>
          <div className="notif-row-text">
            <span className="notif-row-label">Notifiche push</span>
            <span className="notif-row-desc">{pushStatusLabel()}</span>
          </div>
          {pushSupported && pushPermission !== "denied" && (
            <button
              className={`notif-toggle ${pushSubscribed ? "on" : "off"}${pushWorking ? " notif-toggle-loading" : ""}`}
              role="switch"
              aria-checked={pushSubscribed}
              disabled={pushWorking}
              onClick={() => void handlePushToggle()}
            >
              <span className="notif-toggle-thumb" />
            </button>
          )}
          {pushPermission === "denied" && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)", marginLeft: "auto" }}>
              Bloccate
            </span>
          )}
        </div>

        {!pushSupported && (
          <div className="notif-push-compat">
            <span>⚠️</span>
            <span>
              Le notifiche push richiedono Chrome, Firefox o Edge su Android/desktop.
              Su iOS sono supportate solo dalla PWA installata (≥ iOS 16.4).
            </span>
          </div>
        )}

        {/* ── Impostazioni in-app ──────────────────────────────────────── */}
        <div className="notif-section-header" style={{ marginTop: "1.5rem" }}>Impostazioni in-app</div>
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
