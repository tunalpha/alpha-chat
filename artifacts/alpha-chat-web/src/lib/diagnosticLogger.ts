/**
 * DiagnosticLogger — Alpha Chat
 *
 * Buffer circolare (300 eventi) + flush automatico al backend ogni 5 secondi.
 * Funzione permanente del Call Diagnostics Center (Admin Panel).
 *
 * Attivazione: diagLogger.init() dopo ogni login/restore in AuthContext.
 * Gli eventi vengono inviati in batch e conservati per 7 giorni (TTL server).
 *
 * Privacy: nessun contenuto di messaggi, nessuna chiave Signal.
 * Solo eventi tecnici di chiamata, WebSocket e WebRTC.
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

const BUFFER_SIZE       = 300;
const FLUSH_INTERVAL_MS = 5_000;
const DIAG_ENDPOINT     = '/api/v1/diagnostics/events';

/**
 * Interroga il Service Worker via MessageChannel per ottenere la sua versione.
 * Risolve entro 1500ms — fallback a stringa descrittiva in caso di timeout/errore.
 */
async function querySwVersion(): Promise<string> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'no-sw';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active) return 'no-active-sw';
    return await new Promise<string>((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e: MessageEvent<{ version?: string }>) =>
        resolve(e.data?.version ?? 'unknown');
      reg.active!.postMessage({ type: 'alpha.ping' }, [ch.port2]);
      setTimeout(() => resolve('sw-timeout'), 1500);
    });
  } catch {
    return 'sw-error';
  }
}

class DiagnosticLoggerClass {
  private _buffer: DiagnosticEvent[] = [];
  private _nextId = 0;
  private _callId: string | null = null;
  private _callStart: number | null = null;

  // Flush state
  private _userId:     string | null = null;
  private _username:   string = '';
  private _getToken:   (() => string | null) | null = null;
  private _sessionId:  string | null = null;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _lastFlushedId = -1;

  // Versione del Service Worker (ottenuta via postMessage dopo init)
  private _swVersion: string = 'unknown';

  // ── Stato pubblico ─────────────────────────────────────────────────────────

  /** true dopo init() */
  enabled = false;

  get currentCallId(): string | null {
    return this._callId;
  }

  // ── Inizializzazione ───────────────────────────────────────────────────────

  /**
   * Inizializza il logger con il contesto utente e avvia il flush automatico.
   * Chiamare dopo ogni login/restore in AuthContext.
   */
  init(userId: string, username: string, getToken: () => string | null): void {
    this._userId    = userId;
    this._username  = username || 'unknown';
    this._getToken  = getToken;
    this._sessionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.enabled    = true;

    if (this._flushTimer) clearInterval(this._flushTimer);
    this._flushTimer = setInterval(() => { void this._flush(); }, FLUSH_INTERVAL_MS);
  }

  /**
   * Ferma il flush e azzera il contesto. Chiamare al logout.
   */
  destroy(): void {
    void this._flush(); // flush finale
    if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = null; }
    this._userId    = null;
    this._username  = '';
    this._getToken  = null;
    this._sessionId = null;
    this._callId    = null;
    this._callStart = null;
    this.enabled    = false;
  }

  // ── Gestione chiamata corrente ──────────────────────────────────────────────

  setCurrentCall(callId: string, startedAt: number): void {
    this._callId    = callId;
    this._callStart = startedAt;
  }

  clearCurrentCall(): void {
    this._callId    = null;
    this._callStart = null;
  }

  /** Imposta la versione del Service Worker (chiamare dopo querySwVersion). */
  setSwVersion(v: string): void {
    this._swVersion = v;
  }

  /**
   * Invia l'evento app.start con tutti i metadati di build.
   * Interroga il SW via MessageChannel per ottenere la sua versione reale.
   * Chiamare subito dopo diagLogger.init() in AuthContext.
   */
  async logAppStart(): Promise<void> {
    const swVersion = await querySwVersion();
    this._swVersion = swVersion;
    this.log('app.start', {
      app_version:            __BUILD_COMMIT__,
      build_time:             __BUILD_TIME__,
      service_worker_version: swVersion,
    });
  }

  // ── Registrazione eventi ───────────────────────────────────────────────────

  log(event: string, payload: Record<string, unknown> = {}, callIdOverride?: string | null): void {
    if (!this.enabled) return;
    // callIdOverride permette a acceptCall() di passare uno snapshot del call_id
    // acquisito all'inizio del flusso, anche se clearCurrentCall() è stato chiamato
    // nel frattempo da un WS event (call.ended/call.rejected) concorrente.
    const callId     = callIdOverride !== undefined ? callIdOverride : this._callId;
    const elapsed_ms = this._callStart !== null ? Date.now() - this._callStart : null;
    const entry: DiagnosticEvent = {
      id:        this._nextId++,
      timestamp: new Date().toISOString(),
      call_id:   callId,
      event,
      payload,
      elapsed_ms,
    };
    if (this._buffer.length >= BUFFER_SIZE) this._buffer.shift();
    this._buffer.push(entry);
  }

  // ── Flush al backend ───────────────────────────────────────────────────────

  private async _flush(): Promise<void> {
    if (!this._userId || !this._getToken) return;
    const token = this._getToken();
    if (!token) return;

    const unflushed = this._buffer.filter(e => e.id > this._lastFlushedId);
    if (unflushed.length === 0) return;

    const lastId = unflushed[unflushed.length - 1].id;
    try {
      const res = await fetch(DIAG_ENDPOINT, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: this._sessionId,
          username:   this._username,
          device:     this._getDeviceInfo(),
          events:     unflushed,
        }),
      });
      if (res.ok || res.status === 204) {
        this._lastFlushedId = lastId;
      }
    } catch {
      // Silently fail — eventi rimangono nel buffer per il prossimo tentativo
    }
  }

  private _getDeviceInfo(): Record<string, string | null> {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';

    // iOS version — "iPhone OS 18_7" → "18.7"
    const iosMatch   = /(?:iPhone|iPad|iPod) OS (\d+[_\d]*)/.exec(ua);
    const iosVersion = iosMatch ? iosMatch[1].replace(/_/g, '.') : null;

    // Safari version — "Version/26.5.2" → "26.5.2"
    const safariMatch   = /Version\/([\d.]+)/.exec(ua);
    const safariVersion = safariMatch ? safariMatch[1] : null;

    const platform = typeof navigator !== 'undefined'
      ? ((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform
          ?? navigator.platform
          ?? 'unknown')
      : 'unknown';
    let networkType: string | null = null;
    try {
      const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
      networkType = conn?.effectiveType ?? null;
    } catch { /* noop */ }
    return {
      user_agent:             ua,
      platform,
      network_type:           networkType,
      app_version:            __BUILD_COMMIT__,
      build_time:             __BUILD_TIME__,
      service_worker_version: this._swVersion,
      ios_version:            iosVersion,
      safari_version:         safariVersion,
    };
  }

  // ── Accesso buffer (locale) ────────────────────────────────────────────────

  getEvents(): readonly DiagnosticEvent[] {
    return this._buffer;
  }

  clear(): void {
    this._buffer        = [];
    this._lastFlushedId = -1;
  }

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
      { exported_at: new Date().toISOString(), event_count: this._buffer.length, events: this._buffer },
      null, 2,
    );
  }
}

export const diagLogger = new DiagnosticLoggerClass();

/**
 * Shorthand — registra un evento diagnostico.
 * No-op se diagLogger non è ancora inizializzato (prima del login).
 */
export function diagLog(event: string, payload: Record<string, unknown> = {}, callId?: string | null): void {
  diagLogger.log(event, payload, callId);
}
