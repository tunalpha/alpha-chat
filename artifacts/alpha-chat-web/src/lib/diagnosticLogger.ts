/**
 * DiagnosticLogger — Alpha Chat
 *
 * Buffer circolare (300 eventi) per il debug delle chiamate su iPhone.
 * Completamente passivo: non altera alcun comportamento dell'app.
 *
 * Attivazione:
 *   1. Build-time:  VITE_DIAGNOSTIC_MODE=true
 *   2. Run-time:    localStorage.setItem('ac_diag', '1')  → ricarica pagina
 *
 * Utilizzo:
 *   import { diagLog, diagLogger } from './diagnosticLogger';
 *   diagLog('call.offer.sent', { to: userId });
 *   diagLogger.setCurrentCall(callId, Date.now());
 */

export interface DiagnosticEvent {
  id: number;
  timestamp: string;         // ISO 8601
  call_id: string | null;
  event: string;
  payload: Record<string, unknown>;
  elapsed_ms: number | null; // ms dall'inizio della chiamata corrente
}

const BUFFER_SIZE = 300;

function checkEnabled(): boolean {
  try {
    if ((import.meta.env as Record<string, string>)['VITE_DIAGNOSTIC_MODE'] === 'true') return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('ac_diag') === '1') return true;
  } catch { /* noop — SSR / private browsing */ }
  return false;
}

class DiagnosticLoggerClass {
  private _buffer: DiagnosticEvent[] = [];
  private _nextId = 0;
  private _callId: string | null = null;
  private _callStart: number | null = null;

  // ── Stato pubblico (read-only) ──────────────────────────────────────────────

  get enabled(): boolean {
    return checkEnabled();
  }

  get currentCallId(): string | null {
    return this._callId;
  }

  // ── Gestione chiamata corrente ──────────────────────────────────────────────

  setCurrentCall(callId: string, startedAt: number): void {
    if (!this.enabled) return;
    this._callId    = callId;
    this._callStart = startedAt;
  }

  clearCurrentCall(): void {
    this._callId    = null;
    this._callStart = null;
  }

  // ── Registrazione eventi ───────────────────────────────────────────────────

  log(event: string, payload: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    const elapsed_ms = this._callStart !== null ? Date.now() - this._callStart : null;
    const entry: DiagnosticEvent = {
      id:        this._nextId++,
      timestamp: new Date().toISOString(),
      call_id:   this._callId,
      event,
      payload,
      elapsed_ms,
    };
    if (this._buffer.length >= BUFFER_SIZE) this._buffer.shift();
    this._buffer.push(entry);
  }

  // ── Accesso buffer ─────────────────────────────────────────────────────────

  getEvents(): readonly DiagnosticEvent[] {
    return this._buffer;
  }

  clear(): void {
    this._buffer = [];
  }

  // ── Esportazione ──────────────────────────────────────────────────────────

  toText(): string {
    return this._buffer
      .map((e) => {
        const ts  = e.timestamp.replace('T', ' ').slice(0, 23);
        const el  = e.elapsed_ms !== null ? `+${e.elapsed_ms}ms`.padStart(9) : '  no-call';
        const cid = e.call_id ? e.call_id.substring(0, 8) : 'no-call ';
        const pl  = Object.keys(e.payload).length > 0 ? '  ' + JSON.stringify(e.payload) : '';
        return `[${ts}] [${el}] [${cid}] ${e.event}${pl}`;
      })
      .join('\n');
  }

  toJSON(): string {
    return JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        event_count: this._buffer.length,
        events:      this._buffer,
      },
      null,
      2,
    );
  }
}

export const diagLogger = new DiagnosticLoggerClass();

/**
 * Shorthand — registra un evento diagnostico.
 * No-op se la modalità diagnostica è disattivata.
 */
export function diagLog(event: string, payload: Record<string, unknown> = {}): void {
  diagLogger.log(event, payload);
}
