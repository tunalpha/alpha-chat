import { useState, useEffect } from "react";
import type { StoredAuth } from "../lib/auth";
import { apiLogoutAll } from "../lib/api";

interface Props {
  auth: StoredAuth;
  onBack: () => void;
  onLoggedOut: () => void;
}

function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  if (ua.includes("CriOS")) return "Chrome (iOS)";
  if (ua.includes("FxiOS")) return "Firefox (iOS)";
  if (ua.includes("EdgiOS")) return "Edge (iOS)";
  if (ua.includes("Safari") && ua.includes("Mobile")) return "Safari Mobile";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari")) return "Safari";
  if (ua.includes("Edge")) return "Edge";
  return "Browser sconosciuto";
}

function getOSInfo(): string {
  const ua = navigator.userAgent;
  if (ua.includes("iPhone")) return "iOS (iPhone)";
  if (ua.includes("iPad")) return "iOS (iPad)";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  return "Sistema sconosciuto";
}

export default function DevicesPage({ auth, onBack, onLoggedOut }: Props) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [now] = useState(() => new Date());

  const browser = getBrowserInfo();
  const os = getOSInfo();
  const deviceId = auth.deviceId ?? "—";

  async function handleDisconnectAll() {
    if (!confirm("Vuoi disconnettere tutti gli altri dispositivi?")) return;
    setLoggingOut(true);
    try {
      await apiLogoutAll();
      onLoggedOut();
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <div className="settings-root">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Indietro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="settings-title">Dispositivi</h1>
      </header>

      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">Questo dispositivo</div>

          <div className="device-card active">
            <div className="device-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28">
                <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </div>
            <div className="device-card-info">
              <div className="device-card-name">{browser}</div>
              <div className="device-card-meta">{os}</div>
              <div className="device-card-meta">
                Connesso ora · {now.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}
              </div>
              <div className="device-card-id">ID: {deviceId.slice(0, 8)}…</div>
            </div>
            <div className="device-card-badge">Attivo</div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Altri dispositivi</div>
          <div className="device-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40" style={{ opacity: 0.3 }}>
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
            <p>Nessun altro dispositivo connesso</p>
          </div>
        </div>

        <div className="settings-section">
          <button
            className="settings-danger-btn"
            onClick={handleDisconnectAll}
            disabled={loggingOut}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            {loggingOut ? "Disconnessione…" : "Disconnetti tutti gli altri dispositivi"}
          </button>
        </div>
      </div>
    </div>
  );
}
