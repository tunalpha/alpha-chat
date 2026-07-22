/**
 * WcDebugPanel — pannello di diagnostica WalletConnect in-app.
 *
 * Visibile toccando 5 volte la scritta "Debug" in fondo alla pagina.
 * Cattura console.log/warn/error e unhandledrejection in tempo reale,
 * filtra i messaggi rilevanti per WalletConnect e li mostra a schermo.
 * Invia anche gli errori al backend /api/v1/debug/wc per chi non ha Mac.
 *
 * RIMUOVERE dopo la diagnosi.
 */
import { useEffect, useRef, useState, useCallback } from "react";

interface LogEntry {
  ts: string;
  level: "log" | "warn" | "error" | "rejection";
  phase: string;
  msg: string;
}

const MAX_ENTRIES = 200;
const WC_RE = /walletconnect|thirdweb|session|relay|wc:|display_uri|proposal|settle|pairing|projectId|namespace|wcm|wc_/i;

function ts() {
  return new Date().toISOString().slice(11, 23);
}

function serialize(v: unknown): string {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 0); } catch { return String(v); }
}

function extractPhase(msg: string): string {
  if (/display_uri/i.test(msg))     return "display_uri";
  if (/session_proposal/i.test(msg)) return "session_proposal";
  if (/session_settle/i.test(msg))   return "session_settle";
  if (/session_delete/i.test(msg))   return "session_delete";
  if (/pairing/i.test(msg))          return "pairing";
  if (/relay/i.test(msg))            return "relay";
  if (/namespace/i.test(msg))        return "namespaces";
  if (/projectId/i.test(msg))        return "projectId";
  return "wc";
}

// Invia al backend senza bloccare la UI
async function postToBackend(entry: LogEntry) {
  try {
    await fetch("/api/v1/debug/wc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase: entry.phase, error: entry.msg, level: entry.level }),
    });
  } catch { /* silenzioso */ }
}

export default function WcDebugPanel() {
  const [logs,    setLogs]    = useState<LogEntry[]>([]);
  const [visible, setVisible] = useState(false);
  const [taps,    setTaps]    = useState(0);
  const tapTimer              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef             = useRef<HTMLDivElement>(null);

  const push = useCallback((level: LogEntry["level"], rawMsg: string) => {
    if (!WC_RE.test(rawMsg)) return;
    const entry: LogEntry = {
      ts:    ts(),
      level,
      phase: extractPhase(rawMsg),
      msg:   rawMsg.slice(0, 2000),
    };
    setLogs(prev => [...prev.slice(-MAX_ENTRIES + 1), entry]);
    if (level === "error" || level === "rejection") postToBackend(entry);
  }, []);

  useEffect(() => {
    // Intercetta console
    const orig = {
      log:   console.log.bind(console),
      warn:  console.warn.bind(console),
      error: console.error.bind(console),
    };

    const wrap = (level: LogEntry["level"], fn: (...a: unknown[]) => void) =>
      (...args: unknown[]) => {
        fn(...args);
        push(level, args.map(serialize).join(" "));
      };

    console.log   = wrap("log",   orig.log);
    console.warn  = wrap("warn",  orig.warn);
    console.error = wrap("error", orig.error);

    const onRejection = (ev: PromiseRejectionEvent) => {
      const msg = [String(ev.reason), ev.reason?.stack, serialize(ev.reason)].filter(Boolean).join(" | ");
      push("rejection", msg);
    };
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      console.log   = orig.log;
      console.warn  = orig.warn;
      console.error = orig.error;
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [push]);

  // Scroll to bottom on new logs
  useEffect(() => {
    if (visible) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, visible]);

  // 5 tap sul trigger per aprire
  // Usiamo onTouchEnd + preventDefault su iOS per evitare che lo scroll engine
  // assorba i tap veloci prima che onClick arrivi.
  const handleTriggerTap = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    setTaps(n => {
      const next = n + 1;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => setTaps(0), 3000);
      if (next >= 5) { setVisible(true); return 0; }
      return next;
    });
  };

  const levelColor: Record<LogEntry["level"], string> = {
    log:       "#94a3b8",
    warn:      "#fbbf24",
    error:     "#f87171",
    rejection: "#f43f5e",
  };

  return (
    <>
      {/* Trigger invisibile — tocca 5 volte */}
      <button
        type="button"
        onClick={handleTriggerTap}
        style={{
          background: "transparent", border: "none", padding: "8px 16px",
          color: taps > 0 ? "#9b40f8" : "rgba(255,255,255,0.15)",
          fontSize: "0.7rem", cursor: "default", userSelect: "none",
        }}
        aria-label="Debug WalletConnect"
      >
        {taps > 0 ? `Debug (${5 - taps} tap...)` : "Debug"}
      </button>

      {/* Pannello */}
      {visible && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column",
          fontFamily: "monospace",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderBottom: "1px solid #333", flexShrink: 0,
          }}>
            <span style={{ color: "#9b40f8", fontWeight: 700 }}>
              🔍 WC Debug ({logs.length} eventi)
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setLogs([])}
                style={{ background: "#333", border: "none", color: "#fff", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: "0.75rem" }}
              >
                Pulisci
              </button>
              <button
                type="button"
                onClick={() => setVisible(false)}
                style={{ background: "#9b40f8", border: "none", color: "#fff", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: "0.75rem" }}
              >
                ✕ Chiudi
              </button>
            </div>
          </div>

          {/* Log list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {logs.length === 0 && (
              <div style={{ color: "#666", padding: "24px 16px", textAlign: "center", fontSize: "0.8rem" }}>
                Nessun log WalletConnect ancora.{"\n"}
                Prova a toccare "Collega Wallet" e poi WalletConnect.
              </div>
            )}
            {logs.map((e, i) => (
              <div key={i} style={{ padding: "4px 12px", borderBottom: "1px solid #1a1a2e" }}>
                <span style={{ color: "#555", fontSize: "0.65rem", marginRight: 8 }}>{e.ts}</span>
                <span style={{ color: "#818cf8", fontSize: "0.65rem", marginRight: 8, fontWeight: 700 }}>[{e.phase}]</span>
                <span style={{ color: levelColor[e.level], fontSize: "0.7rem", wordBreak: "break-all" }}>{e.msg}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Footer hint */}
          <div style={{ padding: "8px 16px", borderTop: "1px solid #333", color: "#555", fontSize: "0.65rem", flexShrink: 0 }}>
            Gli errori (rossi) vengono inviati automaticamente al backend → controlla i log API.
          </div>
        </div>
      )}
    </>
  );
}
