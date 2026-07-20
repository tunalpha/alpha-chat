/**
 * CallMetrics — Contatori in-memory per le chiamate WebRTC.
 *
 * Singleton: un'unica istanza per processo (resettata a ogni riavvio del server).
 * Incrementati in ws-server.ts nei punti chiave del signaling.
 * Esposti tramite GET /api/v1/admin/call-metrics (requireAdmin).
 *
 * Contatori:
 *   calls_started      — nuova call.offer elaborata (non duplicata)
 *   calls_answered     — call.answer ricevuto (callee ha accettato)
 *   calls_completed    — call.end ricevuto (qualsiasi motivo)
 *   calls_failed       — call.end reason=timeout/cancelled + call.reject
 *   calls_retried      — call.offer ricevuto con call_id già noto (retry client)
 *   calls_deduplicated — call.offer bloccato perché duplicato (= calls_retried)
 */

export interface CallMetricsSnapshot {
  calls_started:      number;
  calls_answered:     number;
  calls_completed:    number;
  calls_failed:       number;
  calls_retried:      number;
  calls_deduplicated: number;
  /** Percentuale chiamate risposte su totale avviate (null se calls_started=0). */
  answer_rate_pct:    number | null;
  /** Percentuale retry su totale avviate (null se calls_started=0). */
  retry_rate_pct:     number | null;
  /** Percentuale chiamate fallite su totale avviate (null se calls_started=0). */
  failure_rate_pct:   number | null;
  /** ISO timestamp del reset più recente (riavvio server). */
  since: string;
}

class CallMetricsStore {
  calls_started      = 0;
  calls_answered     = 0;
  calls_completed    = 0;
  calls_failed       = 0;
  calls_retried      = 0;
  calls_deduplicated = 0;

  readonly since = new Date().toISOString();

  private pct(num: number, den: number): number | null {
    if (den === 0) return null;
    return Math.round((num / den) * 1000) / 10; // 1 decimale
  }

  snapshot(): CallMetricsSnapshot {
    return {
      calls_started:      this.calls_started,
      calls_answered:     this.calls_answered,
      calls_completed:    this.calls_completed,
      calls_failed:       this.calls_failed,
      calls_retried:      this.calls_retried,
      calls_deduplicated: this.calls_deduplicated,
      answer_rate_pct:    this.pct(this.calls_answered,     this.calls_started),
      retry_rate_pct:     this.pct(this.calls_retried,      this.calls_started),
      failure_rate_pct:   this.pct(this.calls_failed,       this.calls_started),
      since: this.since,
    };
  }
}

// Singleton — un'unica istanza condivisa per processo
export const callMetrics = new CallMetricsStore();
