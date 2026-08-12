/**
 * SparkDiagPanel — pannello diagnostico temporaneo Spark.
 *
 * ARCHITETTURA: NON usa position:fixed (clippato da overflow:hidden su iOS Safari PWA).
 * È un elemento nel flex layout di .aw-root — flex-shrink:0 lo àncora in fondo.
 *
 * SICUREZZA: mostra SOLO stato, booleani, codici errore.
 * MAI mnemonic, PIN, seed, private key, API key.
 *
 * TEMPORANEO — rimuovere dopo aver identificato la root cause.
 */

import { useState, useEffect } from "react";
import { getSparkDiag, subscribeSparkDiag } from "../lib/spark/spark-diag";
import type { SparkDiagState } from "../lib/spark/spark-diag";

// ── helpers ──────────────────────────────────────────────────────────────────

function statusColor(v: string): string {
  if (v === "PASS" || v === "YES" || v === "ON" || v === "connected") return "#4ade80";
  if (v === "FAIL" || v === "NO" || v === "OFF" || v === "error")     return "#f87171";
  if (v === "connecting" || v === "syncing")                           return "#fbbf24";
  return "#94a3b8";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "3px 0", gap: 8,
    }}>
      <span style={{ color: "#94a3b8", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
        {label}
      </span>
      <span style={{
        color: statusColor(value), fontSize: 11, fontWeight: 700,
        textAlign: "right", wordBreak: "break-all",
      }}>
        {value || "—"}
      </span>
    </div>
  );
}

// ── component ────────────────────────────────────────────────────────────────

export function SparkDiagPanel() {
  const [diag, setDiag] = useState<SparkDiagState>(getSparkDiag);
  const [open, setOpen] = useState(false); // collassato di default

  useEffect(() => subscribeSparkDiag(() => setDiag(getSparkDiag())), []);

  // Barra sempre visibile in fondo alla pagina (parte del flex layout, non fixed)
  return (
    <div
      style={{
        flexShrink: 0,           // non viene schiacciato dal main scrollabile
        background: "#0d0d1a",
        borderTop: "1.5px solid #7c3aed",
        fontFamily: "'Courier New', monospace",
        // Safe area bottom per iPhone con notch
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Toggle header — sempre visibile */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#a78bfa",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>
          ⚡ Spark Diagnostics
        </span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          {open ? "▲ chiudi" : "▼ espandi"}
        </span>
      </button>

      {/* Contenuto espanso */}
      {open && (
        <div style={{ padding: "0 14px 10px" }}>
          <Row label="Feature flag"     value={diag.featureFlag} />
          <Row label="Wallet unlocked"  value={diag.walletUnlocked} />
          <Row label="connect() called" value={diag.connectCalled} />
          <Row label="getMnemonic()"    value={diag.getMnemonic} />
          {diag.getMnemonicError ? (
            <Row label="  ↳ error" value={diag.getMnemonicError} />
          ) : null}
          <Row label="Breez connect"    value={diag.breezConnect} />
          {diag.breezConnectError ? (
            <Row label="  ↳ error" value={diag.breezConnectError} />
          ) : null}
          <Row label="syncWallet()"     value={diag.syncWallet} />
          <div style={{ height: 1, background: "#1e1e2e", margin: "6px 0" }} />
          <Row label="Spark state"      value={diag.sparkState} />
          <Row label="sparkSat"         value={diag.sparkSat} />
          <div style={{ marginTop: 6, color: "#374151", fontSize: 9, textAlign: "right" }}>
            upd {diag.lastUpdate.slice(11, 19)} UTC
          </div>
        </div>
      )}
    </div>
  );
}
