/**
 * VoiceHoldRecorder — UX registrazione vocale stile WhatsApp/Telegram.
 *
 * Orchestrazione (NON tocca encoding/upload/E2E — usa useVoiceRecorder che
 * incapsula la logica MediaRecorder originale, e produce lo stesso VoiceBlob):
 *   • Press & hold sul microfono per registrare (pointer/touch).
 *   • Rilascia per inviare.
 *   • Swipe a sinistra oltre soglia → annulla (feedback progressivo).
 *   • Slide verso l'alto oltre soglia → lock: si può togliere il dito, compaiono
 *     i controlli Elimina/Invia e il timer continua.
 *   • Tap semplice (senza tenere premuto) → hint "Tieni premuto per registrare".
 *
 * Presenza: onRecordingChange(true/false) permette al parent di inviare
 * l'evento typing con activity="recording" al destinatario.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVoiceRecorder, type VoiceBlob } from "../hooks/useVoiceRecorder";

interface Props {
  onSend: (voice: VoiceBlob) => void;
  /** true quando la registrazione è realmente attiva; false a fine/annulla/invio. */
  onRecordingChange: (active: boolean) => void;
  /** Tap senza hold → mostra hint "Tieni premuto per registrare". */
  onTapHint: () => void;
  disabled?: boolean;
}

type Phase = "idle" | "recording" | "locked";

const CANCEL_THRESHOLD = 90;  // px verso sinistra per annullare
const LOCK_THRESHOLD   = 70;  // px verso l'alto per bloccare
const TAP_MS           = 500; // sotto questa durata = tap, non registrazione
const PRESENCE_DELAY   = 400; // ritardo prima di segnalare "sta registrando"

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function VoiceHoldRecorder({ onSend, onRecordingChange, onTapHint, disabled }: Props) {
  const { t } = useTranslation();
  const rec = useVoiceRecorder();

  const [phase, setPhase]           = useState<Phase>("idle");
  const [slideX, setSlideX]         = useState(0);        // <= 0
  const [lockProgress, setLockProg] = useState(0);        // 0..1

  // Stato del gesto (refs → nessun re-render inutile durante il move)
  const gestureRef = useRef({ startX: 0, startY: 0, pointerId: -1, startedAt: 0, active: false, started: false });
  const presenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceActiveRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const stopPresence = useCallback(() => {
    if (presenceTimerRef.current) { clearTimeout(presenceTimerRef.current); presenceTimerRef.current = null; }
    if (presenceActiveRef.current) { presenceActiveRef.current = false; onRecordingChange(false); }
  }, [onRecordingChange]);

  const resetVisual = useCallback(() => {
    setSlideX(0);
    setLockProg(0);
  }, []);

  // ── Cleanup su unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (presenceTimerRef.current) clearTimeout(presenceTimerRef.current);
      if (presenceActiveRef.current) onRecordingChange(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Invio / Annulla ────────────────────────────────────────────────────────
  const doSend = useCallback(async () => {
    stopPresence();
    resetVisual();
    setPhase("idle");
    const voice = await rec.finish();
    if (voice && voice.durationMs >= 300) onSend(voice);
  }, [rec, onSend, stopPresence, resetVisual]);

  const doCancel = useCallback(() => {
    stopPresence();
    resetVisual();
    setPhase("idle");
    rec.cancel();
  }, [rec, stopPresence, resetVisual]);

  // ── Pointer handlers (mic button) ──────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    if (e.button !== undefined && e.button !== 0) return; // solo tasto sinistro / touch
    e.preventDefault();
    const g = gestureRef.current;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.pointerId = e.pointerId;
    g.startedAt = Date.now();
    g.active = true;
    g.started = false;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }

    setPhase("recording");
    resetVisual();

    // Segnala "sta registrando" solo dopo un breve ritardo → un tap non spamma presenza.
    presenceTimerRef.current = setTimeout(() => {
      presenceActiveRef.current = true;
      onRecordingChange(true);
    }, PRESENCE_DELAY);

    void rec.start().then((ok) => {
      g.started = ok;
      if (!ok) {
        // Permesso negato o errore microfono → annulla tutto.
        stopPresence();
        resetVisual();
        setPhase("idle");
        g.active = false;
      }
    });
  }, [disabled, rec, onRecordingChange, stopPresence, resetVisual]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g.active || phaseRef.current !== "recording") return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    // Slide verso l'alto → lock (prevale se il movimento verticale domina)
    if (dy <= -LOCK_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
      g.active = false;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(g.pointerId); } catch { /* noop */ }
      resetVisual();
      setPhase("locked");
      return;
    }

    // Swipe a sinistra → annulla progressivo
    const left = Math.min(0, dx);
    setSlideX(left);
    setLockProg(Math.max(0, Math.min(1, -dy / LOCK_THRESHOLD)));

    if (left <= -CANCEL_THRESHOLD) {
      g.active = false;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(g.pointerId); } catch { /* noop */ }
      doCancel();
    }
  }, [doCancel, resetVisual]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const g = gestureRef.current;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(g.pointerId); } catch { /* noop */ }
    if (!g.active) return; // già gestito (cancel/lock) o non attivo
    g.active = false;
    if (phaseRef.current !== "recording") return;

    const elapsed = Date.now() - g.startedAt;
    const dx = e.clientX - g.startX;

    if (dx <= -CANCEL_THRESHOLD) { doCancel(); return; }

    // Tap: rilascio troppo rapido → nessun vocale, mostra hint.
    if (elapsed < TAP_MS) {
      doCancel();
      onTapHint();
      return;
    }
    void doSend();
  }, [doSend, doCancel, onTapHint]);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    const g = gestureRef.current;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(g.pointerId); } catch { /* noop */ }
    if (!g.active) return;
    g.active = false;
    if (phaseRef.current === "recording") doCancel();
  }, [doCancel]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const nearCancel = slideX <= -CANCEL_THRESHOLD * 0.6;
  const cancelOpacity = Math.max(0.15, 1 - Math.abs(slideX) / CANCEL_THRESHOLD);

  return (
    <>
      <button
        type="button"
        className={`send-btn mic-btn${phase === "recording" ? " mic-btn-recording" : ""}`}
        aria-label={t("chat.voiceMessage")}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
      </button>

      {phase !== "idle" && (
        <div className={`voice-hold-overlay${phase === "locked" ? " locked" : ""}`}>
          {phase === "locked" ? (
            <>
              <button type="button" className="vh-trash" onClick={doCancel} aria-label={t("chat.recDelete")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
              <span className="vh-dot" />
              <span className="vh-timer">{fmt(rec.durationMs)}</span>
              <div className="vh-wave">
                {rec.bars.slice(-28).map((h, i) => (
                  <span key={i} className="vh-wave-bar" style={{ height: `${Math.max(3, h * 22)}px` }} />
                ))}
              </div>
              <button type="button" className="vh-send" onClick={() => void doSend()} aria-label={t("chat.recSend")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </>
          ) : (
            <>
              <span className="vh-dot" />
              <span className="vh-timer">{fmt(rec.durationMs)}</span>
              <div
                className={`vh-slide${nearCancel ? " near" : ""}`}
                style={{ transform: `translateX(${slideX * 0.6}px)`, opacity: cancelOpacity }}
              >
                {t("chat.slideToCancel")}
              </div>
              <div className="vh-lock" style={{ opacity: 0.5 + lockProgress * 0.5 }} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"
                     style={{ transform: `translateY(${-lockProgress * 8}px)` }}>
                  {lockProgress >= 1
                    ? <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>
                    : <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/></>}
                </svg>
                <svg className="vh-lock-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12">
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
