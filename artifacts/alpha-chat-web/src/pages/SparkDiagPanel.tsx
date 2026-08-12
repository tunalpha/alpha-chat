/**
 * SparkDiagPanel — pannello diagnostico temporaneo Spark.
 *
 * Visibile direttamente nella pagina Alpha Wallet.
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
  return "#d1d5db";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      marginBottom: 5, gap: 8,
    }}>
      <span style={{ color: "#9ca3af", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
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
  const [open, setOpen] = useState(true);

  useEffect(() => subscribeSparkDiag(() => setDiag(getSparkDiag())), []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed", bottom: 88, right: 14, zIndex: 9999,
          background: "#7c3aed", color: "#fff", border: "none",
          borderRadius: 8, padding: "5px 10px", fontSize: 12,
          cursor: "pointer", opacity: 0.9,
          boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
        }}
      >
        ⚡ Diag
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed",
      bottom: 72,
      left: 10,
      right: 10,
      zIndex: 9999,
      background: "rgba(10,10,18,0.97)",
      border: "1.5px solid #7c3aed",
      borderRadius: 14,
      padding: "12px 14px",
      boxShadow: "0 6px 28px rgba(0,0,0,0.7)",
      fontFamily: "'Courier New', monospace",
    }}>
      {/* header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 10, borderBottom: "1px solid #2d2d3a", paddingBottom: 8,
      }}>
        <span style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>
          ⚡ Spark Diagnostics
        </span>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: "none", border: "none", color: "#6b7280",
            cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px",
          }}
        >
          ✕
        </button>
      </div>

      {/* rows */}
      <Row label="Feature flag"      value={diag.featureFlag} />
      <Row label="Wallet unlocked"   value={diag.walletUnlocked} />
      <Row label="connect() called"  value={diag.connectCalled} />
      <Row label="getMnemonic()"     value={diag.getMnemonic} />
      {diag.getMnemonicError && (
        <Row label="  ↳ error" value={diag.getMnemonicError} />
      )}
      <Row label="Breez connect"     value={diag.breezConnect} />
      {diag.breezConnectError && (
        <Row label="  ↳ error" value={diag.breezConnectError} />
      )}
      <Row label="syncWallet()"      value={diag.syncWallet} />
      <div style={{ borderTop: "1px solid #2d2d3a", marginTop: 6, paddingTop: 8 }} />
      <Row label="Spark state"       value={diag.sparkState} />
      <Row label="sparkSat"          value={diag.sparkSat} />

      {/* timestamp */}
      <div style={{
        marginTop: 8, color: "#4b5563", fontSize: 9, textAlign: "right",
      }}>
        upd {diag.lastUpdate.slice(11, 19)} UTC
      </div>
    </div>
  );
}
