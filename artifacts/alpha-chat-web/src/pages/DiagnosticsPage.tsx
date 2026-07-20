/**
 * DiagnosticsPage — Alpha Chat
 *
 * Schermata di debug nascosta, accessibile con 5 tap sul logo α in ChatPage
 * (solo quando DIAGNOSTIC_MODE è attivo).
 *
 * Funzionalità:
 *   - Log cronologico (300 eventi, più recenti in cima)
 *   - Copia log (testo plain)
 *   - Esporta JSON (Web Share API su iOS, download su desktop)
 *   - Svuota log
 */

import { useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { diagLogger, type DiagnosticEvent } from "../lib/diagnosticLogger";

interface Props {
  onBack: () => void;
}

// ── Colori per categoria di evento ──────────────────────────────────────────

function eventColor(ev: string): string {
  if (ev.startsWith('ws.'))                          return '#60a5fa'; // blu  — WebSocket
  if (ev.startsWith('getUserMedia'))                 return '#fbbf24'; // giallo — media
  if (ev.startsWith('ice.') || ev.startsWith('pc.')) return '#a78bfa'; // viola — WebRTC state
  if (ev.startsWith('spinner') || ev.startsWith('accept.')) return '#fb923c'; // arancio — flusso accept
  if (ev.includes('offer') || ev.includes('answer')) return '#34d399'; // verde — segnalazione
  if (ev.includes('reject') || ev.includes('.end') || ev.includes('busy') || ev.includes('missed')) return '#f87171'; // rosso
  if (ev.includes('error') || ev.includes('timeout')) return '#ef4444'; // rosso vivo — errori
  if (ev.includes('cleanup'))                        return '#94a3b8'; // grigio — fine chiamata
  return '#cbd5e1';
}

// ── Stili base ───────────────────────────────────────────────────────────────

const BASE_BTN: CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  fontSize: 13,
  cursor: 'pointer',
  padding: '7px 14px',
  borderRadius: 8,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  flexShrink: 0,
  WebkitTapHighlightColor: 'transparent',
} as CSSProperties;

function btn(color: string): CSSProperties {
  return { ...BASE_BTN, color, borderColor: `${color}40` };
}

// ── Utilità download ─────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Componente ───────────────────────────────────────────────────────────────

export default function DiagnosticsPage({ onBack }: Props) {
  const [events, setEvents] = useState<readonly DiagnosticEvent[]>(() => diagLogger.getEvents());
  const [toast,  setToast]  = useState<string | null>(null);

  function showToast(msg: string): void {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  const refresh = (): void => setEvents([...diagLogger.getEvents()]);

  const handleClear = (): void => {
    diagLogger.clear();
    setEvents([]);
    showToast('🗑 Log svuotato');
  };

  const handleCopy = useCallback(async (): Promise<void> => {
    const text = diagLogger.toText();
    try {
      await navigator.clipboard.writeText(text);
      showToast('✓ Copiato negli appunti');
    } catch {
      // Fallback per iOS WebView / safari senza permessi clipboard
      const el = document.createElement('textarea');
      el.value = text;
      Object.assign(el.style, {
        position: 'fixed', opacity: '0', fontSize: '16px', top: '0', left: '0',
      });
      document.body.appendChild(el);
      el.focus(); el.select();
      try {
        document.execCommand('copy');
        showToast('✓ Copiato');
      } catch {
        showToast('✗ Impossibile copiare — prova "Esporta JSON"');
      }
      document.body.removeChild(el);
    }
  }, []);

  const handleExport = useCallback((): void => {
    const json = diagLogger.toJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const name = `ac-diag-${Date.now()}.json`;

    if (typeof navigator.share === 'function') {
      const file = new File([blob], name, { type: 'application/json' });
      void navigator.share({ files: [file], title: 'Alpha Chat Diagnostics' } as ShareData)
        .catch(() => downloadBlob(blob, name));
    } else {
      downloadBlob(blob, name);
    }
  }, []);

  // Mostra più recenti in cima
  const reversed = [...events].reverse();

  return (
    <div style={{
      position:        'fixed',
      inset:           0,
      zIndex:          9999,
      background:      '#0f172a',
      color:           '#e2e8f0',
      display:         'flex',
      flexDirection:   'column',
      fontFamily:      'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize:        12,
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        paddingTop:   'env(safe-area-inset-top, 44px)',
        background:   '#1e293b',
        borderBottom: '1px solid #334155',
        flexShrink:    0,
      }}>

        {/* Barra titolo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 0' }}>
          <button
            onClick={onBack}
            style={{ ...BASE_BTN, color: '#60a5fa', border: 'none', background: 'transparent', padding: '4px 2px' }}
          >
            ← Indietro
          </button>
          <span style={{
            flex:        1,
            fontWeight:  700,
            fontSize:    14,
            color:       '#f1f5f9',
            fontFamily:  'system-ui, -apple-system, sans-serif',
            textAlign:   'center',
          }}>
            🔬 Diagnostics
          </span>
          <button
            onClick={refresh}
            style={{ ...BASE_BTN, color: '#94a3b8', padding: '4px 10px', fontSize: 16, border: 'none', background: 'transparent' }}
            title="Aggiorna"
          >
            ↻
          </button>
        </div>

        {/* Riga stato */}
        <div style={{
          padding:    '6px 16px 0',
          fontSize:   11,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color:      '#64748b',
        }}>
          <span style={{ color: diagLogger.enabled ? '#4ade80' : '#f87171', fontWeight: 700 }}>
            ● {diagLogger.enabled ? 'ATTIVO' : 'DISATTIVO'}
          </span>
          {' · '}{events.length} / {300} eventi
          {diagLogger.currentCallId && (
            <span style={{ color: '#94a3b8' }}>
              {' · '}call: <span style={{ color: '#60a5fa' }}>{diagLogger.currentCallId.substring(0, 8)}…</span>
            </span>
          )}
        </div>

        {/* Pulsanti azione */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px 12px', overflowX: 'auto' }}>
          <button onClick={handleClear}               style={btn('#f87171')}>🗑 Svuota</button>
          <button onClick={() => void handleCopy()}   style={btn('#60a5fa')}>📋 Copia log</button>
          <button onClick={handleExport}              style={btn('#a78bfa')}>↑ Esporta JSON</button>
        </div>
      </div>

      {/* ── Lista log ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {reversed.length === 0 ? (
          <div style={{
            padding:    '40px 20px',
            color:      '#475569',
            textAlign:  'center',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
            <div>Nessun evento registrato.</div>
            {!diagLogger.enabled && (
              <div style={{
                marginTop:    16,
                fontSize:     11,
                color:        '#94a3b8',
                background:   '#1e293b',
                padding:      '12px 16px',
                borderRadius: 8,
                textAlign:    'left',
                lineHeight:   1.6,
              }}>
                Attiva con:<br />
                <code style={{ color: '#60a5fa' }}>localStorage.setItem('ac_diag','1')</code><br />
                poi ricarica la pagina.
              </div>
            )}
          </div>
        ) : (
          reversed.map((e) => (
            <div key={e.id} style={{ borderBottom: '1px solid #1e293b', padding: '5px 12px' }}>
              <div style={{
                display:    'flex',
                gap:         6,
                alignItems: 'baseline',
                flexWrap:   'nowrap',
                overflow:   'hidden',
              }}>
                {/* Timestamp */}
                <span style={{ color: '#334155', flexShrink: 0, fontSize: 10 }}>
                  {e.timestamp.slice(11, 23)}
                </span>
                {/* Elapsed */}
                <span style={{
                  color:      '#475569',
                  flexShrink: 0,
                  fontSize:   10,
                  width:      60,
                  textAlign:  'right',
                }}>
                  {e.elapsed_ms !== null ? `+${e.elapsed_ms}ms` : ''}
                </span>
                {/* Nome evento */}
                <span style={{ color: eventColor(e.event), fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
                  {e.event}
                </span>
              </div>
              {/* Payload */}
              {Object.keys(e.payload).length > 0 && (
                <div style={{ color: '#475569', marginTop: 1, fontSize: 10, wordBreak: 'break-all' }}>
                  {JSON.stringify(e.payload)}
                </div>
              )}
            </div>
          ))
        )}

        {/* Spazio per home indicator iOS */}
        <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }} />
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position:    'fixed',
          bottom:      'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          left:        '50%',
          transform:   'translateX(-50%)',
          background:  '#334155',
          color:       '#f1f5f9',
          padding:     '8px 20px',
          borderRadius: 20,
          fontSize:    13,
          fontFamily:  'system-ui, -apple-system, sans-serif',
          boxShadow:   '0 4px 20px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          whiteSpace:  'nowrap',
          zIndex:      10000,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
