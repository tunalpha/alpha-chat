/**
 * Swap Providers — Admin Panel
 *
 * Gestione provider per il modulo Alpha Swap EVM.
 * ISOLATO da payment, USDA, MultiChain, Li.Fi operativo.
 *
 * Configurazione iniziale garantita:
 *   Li.Fi     → ENABLED / PRIMARY  (operativo)
 *   ChangeNOW → DISABLED           (integrazione futura — NON abilitare senza autorizzazione)
 */

import { useState, useEffect } from "react";
import { getToken } from "../lib/api";

const SWAP_PROVIDERS_BASE = "/api/v1/swap/providers";

async function swapProvidersFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${SWAP_PROVIDERS_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).message ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Tipi ──────────────────────────────────────────────────────────────────────

type SwapProviderStatus = "enabled" | "disabled" | "fallback";

interface SwapProvider {
  providerId:   string;
  displayName:  string;
  status:       SwapProviderStatus;
  isPrimary:    boolean;
  isFallback:   boolean;
  notes?:       string;
  updatedAt?:   string;
  updatedBy?:   string;
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function statusBadge(status: SwapProviderStatus, isPrimary: boolean) {
  if (isPrimary && status === "enabled") {
    return <span style={badge("#16a34a", "#dcfce7")}>🟢 PRIMARY</span>;
  }
  if (status === "enabled") {
    return <span style={badge("#2563eb", "#dbeafe")}>🔵 ENABLED</span>;
  }
  if (status === "fallback") {
    return <span style={badge("#d97706", "#fef3c7")}>🟡 FALLBACK</span>;
  }
  return <span style={badge("#6b7280", "#f3f4f6")}>⚪ DISABLED</span>;
}

function badge(color: string, bg: string) {
  return {
    display: "inline-flex", alignItems: "center", gap: "4px",
    padding: "3px 10px", borderRadius: "999px",
    fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em",
    background: bg, color,
  } as const;
}

// ── Componente principale ─────────────────────────────────────────────────────

export default function SwapProviders() {
  const [providers, setProviders] = useState<SwapProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [updating,  setUpdating]  = useState<string | null>(null); // providerId in aggiornamento
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Carica configurazione ────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await swapProvidersFetch<{ providers: SwapProvider[] }>("");
      setProviders(data.providers ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore caricamento provider");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Aggiorna provider ────────────────────────────────────────────────────────

  async function patch(
    providerId: string,
    body: { status?: SwapProviderStatus; isPrimary?: boolean; isFallback?: boolean; reason?: string },
  ) {
    setUpdating(providerId);
    try {
      await swapProvidersFetch(`/${providerId}`, {
        method: "PATCH",
        body:    JSON.stringify(body),
      });
      showToast("Configurazione aggiornata", true);
      await load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Errore aggiornamento", false);
    } finally {
      setUpdating(null);
    }
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
          Swap Providers
        </h1>
        <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>
          Gestisci i provider per il modulo Alpha Swap EVM.
          Tutti i cambiamenti sono registrati nell'audit log.
        </p>
      </div>

      {/* Notice stato attuale provider */}
      {!loading && providers.length > 0 && (() => {
        const cn   = providers.find(p => p.providerId === "changenow");
        const lifi = providers.find(p => p.providerId === "lifi");
        const cnActive = cn?.status === "enabled" && cn?.isPrimary;
        return cnActive ? (
          <div style={{
            background: "#dcfce7", border: "1px solid #86efac",
            borderRadius: 10, padding: "10px 14px",
            fontSize: 13, color: "#14532d", marginBottom: 20,
            display: "flex", gap: 8, alignItems: "flex-start",
          }}>
            <span>✅</span>
            <span>
              <strong>ChangeNOW</strong> è attivo come provider <strong>PRIMARY</strong>.
              {lifi?.status === "disabled" ? " Li.Fi è DISABLED." : ""}
            </span>
          </div>
        ) : (
          <div style={{
            background: "#fef9c3", border: "1px solid #fde047",
            borderRadius: 10, padding: "10px 14px",
            fontSize: 13, color: "#713f12", marginBottom: 20,
            display: "flex", gap: 8, alignItems: "flex-start",
          }}>
            <span>⚠️</span>
            <span>
              <strong>Li.Fi</strong> è il provider operativo corrente.
              ChangeNOW è{" "}<strong>{cn?.status?.toUpperCase() ?? "DISABLED"}</strong>.
            </span>
          </div>
        );
      })()}

      {/* Stato caricamento */}
      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>
          Caricamento provider…
        </div>
      )}

      {error && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fca5a5",
          borderRadius: 10, padding: "12px 16px",
          color: "#dc2626", fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Provider cards */}
      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {providers.map(p => (
            <ProviderCard
              key={p.providerId}
              provider={p}
              updating={updating === p.providerId}
              onPatch={(body) => patch(p.providerId, body)}
            />
          ))}

          {providers.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
              Nessun provider registrato. Il seed verrà eseguito al prossimo avvio del server.
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: toast.ok ? "#16a34a" : "#dc2626",
          color: "#fff", borderRadius: 10, padding: "10px 20px",
          fontSize: 14, fontWeight: 500, zIndex: 9999,
          boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          animation: "fadeInUp .2s ease",
        }}>
          {toast.ok ? "✅" : "❌"} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── ProviderCard ──────────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: SwapProvider;
  updating: boolean;
  onPatch:  (body: { status?: SwapProviderStatus; isPrimary?: boolean; isFallback?: boolean }) => void;
}

function ProviderCard({ provider: p, updating, onPatch }: ProviderCardProps) {
  const isLifi = p.providerId === "lifi";

  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb",
      borderRadius: 12, padding: "18px 20px",
      boxShadow: "0 1px 4px rgba(0,0,0,.04)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: isLifi ? "#ede9fe" : "#f3f4f6",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>
            {isLifi ? "⚡" : "🔗"}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{p.displayName}</div>
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>{p.providerId}</div>
          </div>
        </div>
        {statusBadge(p.status, p.isPrimary)}
      </div>

      {/* Dettagli */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        gap: 8, background: "#f9fafb", borderRadius: 8,
        padding: "10px 14px", marginBottom: 14, fontSize: 13,
      }}>
        <div>
          <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 2 }}>STATUS</div>
          <div style={{ fontWeight: 600 }}>{p.status.toUpperCase()}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 2 }}>PRIMARY</div>
          <div style={{ fontWeight: 600 }}>{p.isPrimary ? "✅ SÌ" : "—"}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 2 }}>FALLBACK</div>
          <div style={{ fontWeight: 600 }}>{p.isFallback ? "✅ SÌ" : "—"}</div>
        </div>
      </div>

      {/* Note */}
      {p.notes && (
        <div style={{
          fontSize: 12, color: "#6b7280", marginBottom: 12,
          fontStyle: "italic", lineHeight: 1.4,
        }}>
          {p.notes}
        </div>
      )}

      {/* Ultima modifica */}
      {p.updatedAt && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 12 }}>
          Ultima modifica: {new Date(p.updatedAt).toLocaleString("it-IT")}
          {p.updatedBy && ` · da ${p.updatedBy}`}
        </div>
      )}

      {/* Azioni */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {p.status !== "enabled" && (
          <ActionButton
            label="Enable"
            color="#16a34a"
            disabled={updating}
            onClick={() => onPatch({ status: "enabled" })}
          />
        )}
        {p.status !== "disabled" && (
          <ActionButton
            label="Disable"
            color="#dc2626"
            disabled={updating}
            onClick={() => onPatch({ status: "disabled" })}
          />
        )}
        {p.status !== "fallback" && !p.isPrimary && (
          <ActionButton
            label="Set Fallback"
            color="#d97706"
            disabled={updating}
            onClick={() => onPatch({ status: "fallback", isFallback: true })}
          />
        )}
        {!p.isPrimary && p.status === "enabled" && (
          <ActionButton
            label="Set Primary"
            color="#7c3aed"
            disabled={updating}
            onClick={() => onPatch({ isPrimary: true })}
          />
        )}
        {updating && (
          <span style={{ fontSize: 13, color: "#6b7280", alignSelf: "center" }}>
            Aggiornamento…
          </span>
        )}
      </div>
    </div>
  );
}

// ── ActionButton ──────────────────────────────────────────────────────────────

function ActionButton({
  label, color, disabled, onClick,
}: {
  label: string; color: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 14px", borderRadius: 8, border: `1px solid ${color}`,
        background: "transparent", color, fontSize: 13, fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background .12s",
      }}
      onMouseEnter={e => { if (!disabled) (e.target as HTMLButtonElement).style.background = color + "18"; }}
      onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}
