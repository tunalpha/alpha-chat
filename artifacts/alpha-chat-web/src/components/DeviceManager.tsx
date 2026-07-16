/**
 * DeviceManager — Fase 4.
 * Schermata per gestire i dispositivi registrati con Alpha Chat.
 *
 * Mostra: lista device, device corrente, ultimo accesso, revoca.
 * Revoca: cancella il bundle Signal del device → non può più ricevere messaggi.
 */

import { useState, useEffect } from "react";
import { apiListDevices, apiRevokeDevice, type DeviceInfo } from "../lib/api";
import { getDeviceId } from "../lib/auth";

interface Props {
  onClose: () => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (d.getTime() === 0 || isNaN(d.getTime())) return "Mai";
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000)     return "Adesso";
    if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)} min fa`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ore fa`;
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

export default function DeviceManager({ onClose }: Props) {
  const [devices, setDevices]     = useState<DeviceInfo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [revoking, setRevoking]   = useState<string | null>(null);
  const [confirm, setConfirm]     = useState<DeviceInfo | null>(null);

  const myDeviceId = getDeviceId();

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await apiListDevices();
      // Ordina: dispositivo corrente prima, poi per data decrescente
      list.sort((a, b) => {
        if (a.deviceId === myDeviceId) return -1;
        if (b.deviceId === myDeviceId) return 1;
        return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
      });
      setDevices(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento dispositivi");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(device: DeviceInfo) {
    if (device.deviceId === myDeviceId) return; // non revocare se stesso
    setConfirm(device);
  }

  async function confirmRevoke() {
    if (!confirm) return;
    setRevoking(confirm.deviceId);
    setConfirm(null);
    try {
      await apiRevokeDevice(confirm.deviceId);
      setDevices((prev) => prev.filter((d) => d.deviceId !== confirm.deviceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore revoca dispositivo");
    } finally {
      setRevoking(null);
    }
  }

  const isCurrent = (d: DeviceInfo) => d.deviceId === myDeviceId;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel device-manager-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 480, width: "100%", padding: "24px" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary, #f0f0f0)" }}>
            Dispositivi collegati
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>
          Ogni dispositivo ha un bundle Signal indipendente. Revocare un dispositivo impedisce a quel device di ricevere nuovi messaggi cifrati.
        </p>

        {/* Lista */}
        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-secondary, #888)" }}>
            Caricamento…
          </div>
        )}

        {error && (
          <div className="send-error" style={{ marginBottom: 16 }}>{error}</div>
        )}

        {!loading && devices.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-secondary, #888)" }}>
            Nessun dispositivo trovato
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {devices.map((device) => (
            <div
              key={device.deviceId}
              style={{
                background: "var(--surface-secondary, rgba(255,255,255,0.05))",
                border: isCurrent(device)
                  ? "1px solid var(--accent, #8b5cf6)"
                  : "1px solid transparent",
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Icona */}
              <div style={{
                width: 40, height: 40, borderRadius: 10, display: "flex",
                alignItems: "center", justifyContent: "center",
                background: isCurrent(device)
                  ? "rgba(139,92,246,0.2)"
                  : "rgba(255,255,255,0.07)",
                flexShrink: 0,
              }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  width="20" height="20"
                  style={{ color: isCurrent(device) ? "#8b5cf6" : "var(--text-secondary, #888)" }}>
                  <rect x="5" y="2" width="14" height="20" rx="2"/>
                  <circle cx="12" cy="17" r="1"/>
                </svg>
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
                }}>
                  <span style={{
                    fontSize: 14, fontWeight: 600,
                    color: "var(--text-primary, #f0f0f0)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {isCurrent(device) ? "Questo dispositivo" : "Dispositivo"}
                  </span>
                  {isCurrent(device) && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                      background: "rgba(139,92,246,0.25)", color: "#8b5cf6", flexShrink: 0,
                    }}>ATTIVO</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary, #888)" }}>
                  Ultimo accesso: {formatDate(device.lastActiveAt)}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary, rgba(136,136,136,0.6))", marginTop: 2, fontFamily: "monospace" }}>
                  {device.deviceId.slice(0, 8)}…{device.deviceId.slice(-8)}
                </div>
              </div>

              {/* Revoca */}
              {!isCurrent(device) && (
                <button
                  className="btn-danger-sm"
                  onClick={() => handleRevoke(device)}
                  disabled={revoking === device.deviceId}
                  aria-label="Revoca dispositivo"
                  style={{
                    flexShrink: 0, padding: "6px 12px", fontSize: 12, borderRadius: 8,
                    background: "rgba(239,68,68,0.15)", color: "#f87171",
                    border: "1px solid rgba(239,68,68,0.3)", cursor: "pointer",
                    opacity: revoking === device.deviceId ? 0.5 : 1,
                  }}
                >
                  {revoking === device.deviceId ? "…" : "Revoca"}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Aggiorna */}
        <button
          className="btn-secondary"
          onClick={load}
          disabled={loading}
          style={{ marginTop: 20, width: "100%", padding: "10px", borderRadius: 10, fontSize: 14 }}
        >
          {loading ? "Aggiornamento…" : "↻ Aggiorna lista"}
        </button>
      </div>

      {/* Dialogo conferma revoca */}
      {confirm && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => setConfirm(null)}
        >
          <div
            style={{
              background: "var(--surface-primary, #1a1a2e)", borderRadius: 16,
              padding: "24px 28px", maxWidth: 360, width: "90%",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "#f87171" }}>
              Revocare il dispositivo?
            </h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>
              Il dispositivo <code style={{ fontSize: 12 }}>{confirm.deviceId.slice(0, 8)}…</code>{" "}
              non potrà più ricevere nuovi messaggi cifrati. L'azione è irreversibile.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirm(null)}
                style={{
                  flex: 1, padding: "10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent", color: "var(--text-secondary, #888)", cursor: "pointer", fontSize: 14,
                }}
              >
                Annulla
              </button>
              <button
                onClick={confirmRevoke}
                style={{
                  flex: 1, padding: "10px", borderRadius: 8, border: "none",
                  background: "#ef4444", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14,
                }}
              >
                Revoca
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
