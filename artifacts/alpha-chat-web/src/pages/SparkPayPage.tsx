/**
 * SparkPayPage — pagina pubblica di pagamento Lightning.
 *
 * Accessibile a:  https://alphachat.sbs/pay/lightning/:invoiceId
 * Destinatari:    chiunque riceva un link da un utente Alpha Wallet
 * Auth richiesta: NO — endpoint GET è pubblico, nessun dato personale esposto
 *
 * Responsabilità:
 *   - Mostra la BOLT11 specifica + QR + importo
 *   - Gestisce invoice scaduta con messaggio chiaro
 *   - NON modifica la BOLT11
 *   - QR contiene SOLO la BOLT11 (mai URL)
 *   - Offre "Copia invoice" (clipboard = solo BOLT11) e "Paga con wallet Lightning"
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface InvoiceData {
  bolt11:    string;
  amountSat: number | null;
  expiresAt: number;  // Unix secondi
  isExpired: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInvoiceId(): string | null {
  // Estrae l'ID dal pathname: /pay/lightning/:invoiceId
  const match = window.location.pathname.match(/^\/pay\/lightning\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function formatSat(sat: number): string {
  return sat.toLocaleString("it-IT");
}

function formatBtc(sat: number): string {
  return (sat / 1e8).toFixed(8);
}

function secondsLeft(expiresAt: number): number {
  return Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return "Scaduta";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Componente principale ─────────────────────────────────────────────────────

export default function SparkPayPage() {
  const invoiceId = getInvoiceId();

  // ── Override scroll — index.css applica overflow:hidden a html,body,#root
  // per l'app principale. Questa pagina pubblica è standalone e richiede
  // scroll libero su iOS Safari / PWA / Android Chrome.
  useEffect(() => {
    const targets: HTMLElement[] = [document.documentElement, document.body];
    const root = document.getElementById("root");
    if (root) targets.push(root);
    const saved = targets.map((el) => ({
      el,
      overflow: el.style.overflow,
      height:   el.style.height,
    }));
    targets.forEach((el) => {
      el.style.overflow = "visible";
      el.style.height   = "auto";
    });
    return () => {
      saved.forEach(({ el, overflow, height }) => {
        el.style.overflow = overflow;
        el.style.height   = height;
      });
    };
  }, []);

  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [data,      setData]      = useState<InvoiceData | null>(null);
  const [qrUrl,     setQrUrl]     = useState<string>("");
  const [copied,    setCopied]    = useState(false);
  const [countdown, setCountdown] = useState<number>(0);
  const [expired,   setExpired]   = useState(false);

  // ── Fetch invoice ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!invoiceId) {
      setError("Link invoice non valido.");
      setLoading(false);
      return;
    }

    fetch(`/api/v1/lightning/invoice-links/${invoiceId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? (res.status === 404 ? "Invoice non trovata o già scaduta." : "Errore nel recupero dell'invoice."));
        }
        return res.json() as Promise<InvoiceData>;
      })
      .then(async (inv) => {
        setData(inv);
        setExpired(inv.isExpired);
        setCountdown(secondsLeft(inv.expiresAt));

        // Genera QR della BOLT11 (mai dell'URL)
        if (!inv.isExpired) {
          try {
            const mod = await import("qrcode");
            const url = await mod.toDataURL(inv.bolt11.toUpperCase(), {
              width: 260, margin: 2, errorCorrectionLevel: "M",
              color: { dark: "#111111", light: "#ffffff" },
            });
            setQrUrl(url);
          } catch { /* QR non disponibile — l'utente può ancora copiare la BOLT11 */ }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Errore sconosciuto."))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  // ── Countdown ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!data || expired) return;
    const tick = setInterval(() => {
      const secs = secondsLeft(data.expiresAt);
      setCountdown(secs);
      if (secs === 0) { setExpired(true); clearInterval(tick); }
    }, 1_000);
    return () => clearInterval(tick);
  }, [data, expired]);

  // ── Copia BOLT11 ───────────────────────────────────────────────────────────
  const copyBolt11 = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.bolt11).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3_000);
    }).catch(() => {});
  };

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div style={styles.page}>
      {/* Keyframe per spinner — necessario perché usiamo solo inline styles */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div style={styles.header}>
        <img src="/logo.png" alt="Alpha Wallet" style={styles.logo} />
        <span style={styles.headerTitle}>Alpha Wallet</span>
      </div>

      <div style={styles.card}>

        {/* Loading */}
        {loading && (
          <div style={styles.center}>
            <div style={styles.spinner} />
            <p style={styles.mutedText}>Caricamento invoice…</p>
          </div>
        )}

        {/* Errore / non trovata */}
        {!loading && error && (
          <div style={styles.center}>
            <div style={styles.expiredIcon}>⚠️</div>
            <h2 style={styles.expiredTitle}>Invoice non trovata</h2>
            <p style={styles.mutedText}>{error}</p>
            <p style={styles.mutedText}>Il link potrebbe essere scaduto o non valido.</p>
          </div>
        )}

        {/* Invoice scaduta */}
        {!loading && !error && data && expired && (
          <div style={styles.center}>
            <div style={styles.expiredIcon}>⏱️</div>
            <h2 style={styles.expiredTitle}>Invoice scaduta</h2>
            {data.amountSat !== null && data.amountSat > 0 && (
              <p style={styles.amountMuted}>
                {formatSat(data.amountSat)} sat · {formatBtc(data.amountSat)} BTC
              </p>
            )}
            <p style={styles.mutedText}>
              Questa invoice Lightning è scaduta e non può essere pagata.
            </p>
            <p style={styles.mutedText}>
              Chiedi al mittente di generare una nuova richiesta di pagamento.
            </p>
          </div>
        )}

        {/* Invoice attiva */}
        {!loading && !error && data && !expired && (
          <>
            {/* Titolo */}
            <div style={styles.lnBadge}>⚡ Richiesta di pagamento Lightning</div>

            {/* Importo */}
            {data.amountSat !== null && data.amountSat > 0 ? (
              <div style={styles.amountBlock}>
                <span style={styles.satAmount}>{formatSat(data.amountSat)} sat</span>
                <span style={styles.btcAmount}>{formatBtc(data.amountSat)} BTC</span>
              </div>
            ) : (
              <div style={styles.amountBlock}>
                <span style={styles.btcAmount}>Importo libero</span>
              </div>
            )}

            {/* Countdown scadenza */}
            <div style={{
              ...styles.countdown,
              color: countdown < 120 ? "#ef4444" : "#f59e0b",
            }}>
              ⏱ Scade tra: {formatCountdown(countdown)}
            </div>

            {/* QR — contiene SOLO la BOLT11 */}
            {qrUrl && (
              <div style={styles.qrCard}>
                <img src={qrUrl} alt="QR invoice Lightning" style={styles.qrImg} />
                <p style={styles.qrCaption}>Scansiona con il tuo wallet Lightning</p>
              </div>
            )}

            {/* Bottoni azione */}
            <div style={styles.btnRow}>
              <button style={styles.btnSecondary} onClick={copyBolt11}>
                {copied ? "✅ Copiata!" : "📋 Copia indirizzo Lightning"}
              </button>
              <a
                href={`lightning:${data.bolt11}`}
                style={styles.btnPrimary}
                onClick={(e) => {
                  // Se il dispositivo non ha un wallet Lightning, l'href fallirà silenziosamente.
                  // Non preveniamo il default: lasciamo che il SO tenti l'apertura.
                  void e;
                }}
              >
                ⚡ Paga con wallet Lightning
              </a>
            </div>

            {/* BOLT11 truncata (per ispezione) */}
            <details style={styles.bolt11Details}>
              <summary style={styles.bolt11Summary}>Mostra invoice BOLT11 completa</summary>
              <p style={styles.bolt11Text}>{data.bolt11}</p>
            </details>

            {/* Sezione info per chi non ha un wallet */}
            <div style={styles.infoBox}>
              <p style={styles.infoTitle}>Non hai un wallet Lightning?</p>
              <p style={styles.infoText}>
                Bitcoin Lightning è un sistema di pagamento istantaneo. Per pagare questa richiesta
                ti serve un wallet Lightning compatibile.
              </p>
              <div style={styles.walletList}>
                <a href="https://phoenix.acinq.co"         target="_blank" rel="noopener noreferrer" style={styles.walletLink}>Phoenix Wallet (iOS/Android)</a>
                <a href="https://breez.technology"          target="_blank" rel="noopener noreferrer" style={styles.walletLink}>Breez Wallet (iOS/Android)</a>
                <a href="https://muun.com"                  target="_blank" rel="noopener noreferrer" style={styles.walletLink}>Muun Wallet (iOS/Android)</a>
                <a href="https://bluewallet.io"             target="_blank" rel="noopener noreferrer" style={styles.walletLink}>Blue Wallet (iOS/Android)</a>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <p style={styles.footer}>
        Ricevuto tramite{" "}
        <a href="https://alphachat.sbs" style={styles.footerLink}>Alpha Wallet</a>
        {" "}· Bitcoin Lightning
      </p>
    </div>
  );
}

// ── Stili inline — zero dipendenze CSS esterne, funziona su qualsiasi device ──

const styles = {
  page: {
    minHeight:       "100dvh",
    background:      "linear-gradient(160deg, #0a0a0f 0%, #111827 60%, #0d1117 100%)",
    display:         "flex",
    flexDirection:   "column" as const,
    alignItems:      "center",
    padding:         "24px 16px 40px",
    fontFamily:      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color:           "#f1f5f9",
    boxSizing:       "border-box" as const,
  },
  header: {
    display:         "flex",
    alignItems:      "center",
    gap:             10,
    marginBottom:    24,
  },
  logo: {
    width:           36,
    height:          36,
    borderRadius:    8,
    objectFit:       "cover" as const,
  },
  headerTitle: {
    fontSize:        "1.1rem",
    fontWeight:      700,
    letterSpacing:   "0.01em",
    color:           "#f8fafc",
  },
  card: {
    width:           "100%",
    maxWidth:        440,
    background:      "rgba(255,255,255,0.04)",
    border:          "1px solid rgba(255,255,255,0.09)",
    borderRadius:    20,
    padding:         "28px 20px",
    backdropFilter:  "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  },
  center: {
    display:         "flex",
    flexDirection:   "column" as const,
    alignItems:      "center",
    gap:             12,
    textAlign:       "center" as const,
    padding:         "16px 0",
  },
  spinner: {
    width:           40,
    height:          40,
    border:          "3px solid rgba(251,191,36,0.2)",
    borderTop:       "3px solid #fbbf24",
    borderRadius:    "50%",
    animation:       "spin 0.9s linear infinite",
  },
  mutedText: {
    color:           "#94a3b8",
    fontSize:        "0.9rem",
    margin:          0,
    lineHeight:      1.5,
  },
  expiredIcon: {
    fontSize:        "2.4rem",
  },
  expiredTitle: {
    fontSize:        "1.3rem",
    fontWeight:      700,
    margin:          0,
    color:           "#f8fafc",
  },
  amountMuted: {
    color:           "#94a3b8",
    fontSize:        "1rem",
    margin:          0,
  },
  lnBadge: {
    display:         "inline-flex",
    alignItems:      "center",
    background:      "rgba(251,191,36,0.12)",
    color:           "#fbbf24",
    border:          "1px solid rgba(251,191,36,0.25)",
    borderRadius:    20,
    padding:         "4px 14px",
    fontSize:        "0.85rem",
    fontWeight:      600,
    marginBottom:    20,
  },
  amountBlock: {
    display:         "flex",
    flexDirection:   "column" as const,
    alignItems:      "center",
    gap:             4,
    marginBottom:    12,
  },
  satAmount: {
    fontSize:        "2rem",
    fontWeight:      800,
    color:           "#f8fafc",
    letterSpacing:   "-0.02em",
  },
  btcAmount: {
    fontSize:        "1rem",
    color:           "#fbbf24",
    fontWeight:      600,
  },
  countdown: {
    fontSize:        "0.82rem",
    fontWeight:      600,
    marginBottom:    20,
    textAlign:       "center" as const,
  },
  qrCard: {
    background:      "#ffffff",
    borderRadius:    16,
    padding:         "16px",
    display:         "flex",
    flexDirection:   "column" as const,
    alignItems:      "center",
    gap:             8,
    marginBottom:    20,
  },
  qrImg: {
    width:           "100%",
    maxWidth:        240,
    height:          "auto",
    display:         "block",
  },
  qrCaption: {
    color:           "#64748b",
    fontSize:        "0.75rem",
    margin:          0,
  },
  btnRow: {
    display:         "flex",
    flexDirection:   "column" as const,
    gap:             10,
    marginBottom:    16,
  },
  btnPrimary: {
    display:         "flex",
    justifyContent:  "center",
    alignItems:      "center",
    background:      "linear-gradient(135deg, #f59e0b, #fbbf24)",
    color:           "#000",
    border:          "none",
    borderRadius:    12,
    padding:         "14px 20px",
    fontSize:        "0.95rem",
    fontWeight:      700,
    cursor:          "pointer",
    textDecoration:  "none",
    textAlign:       "center" as const,
    letterSpacing:   "0.01em",
  } as CSSProperties,
  btnSecondary: {
    background:      "rgba(255,255,255,0.07)",
    color:           "#e2e8f0",
    border:          "1px solid rgba(255,255,255,0.12)",
    borderRadius:    12,
    padding:         "12px 20px",
    fontSize:        "0.9rem",
    fontWeight:      600,
    cursor:          "pointer",
    width:           "100%",
  } as CSSProperties,
  bolt11Details: {
    marginBottom:    16,
  },
  bolt11Summary: {
    color:           "#64748b",
    fontSize:        "0.8rem",
    cursor:          "pointer",
    userSelect:      "none" as const,
  },
  bolt11Text: {
    color:           "#94a3b8",
    fontSize:        "0.7rem",
    wordBreak:       "break-all" as const,
    marginTop:       8,
    lineHeight:      1.5,
    fontFamily:      "monospace",
    background:      "rgba(0,0,0,0.3)",
    borderRadius:    8,
    padding:         "10px",
  },
  infoBox: {
    background:      "rgba(255,255,255,0.03)",
    border:          "1px solid rgba(255,255,255,0.07)",
    borderRadius:    12,
    padding:         "14px 16px",
    marginTop:       4,
  },
  infoTitle: {
    color:           "#cbd5e1",
    fontSize:        "0.85rem",
    fontWeight:      600,
    marginTop:       0,
    marginBottom:    6,
  },
  infoText: {
    color:           "#94a3b8",
    fontSize:        "0.8rem",
    lineHeight:      1.5,
    marginTop:       0,
    marginBottom:    10,
  },
  walletList: {
    display:         "flex",
    flexDirection:   "column" as const,
    gap:             4,
  },
  walletLink: {
    color:           "#60a5fa",
    fontSize:        "0.82rem",
    textDecoration:  "none",
  },
  footer: {
    marginTop:       28,
    fontSize:        "0.78rem",
    color:           "rgba(255,255,255,0.35)",
    textAlign:       "center" as const,
  },
  footerLink: {
    color:           "rgba(255,255,255,0.45)",
    textDecoration:  "none",
  },
} satisfies Record<string, CSSProperties | object>;
