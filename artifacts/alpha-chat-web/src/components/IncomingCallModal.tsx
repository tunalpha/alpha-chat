/**
 * IncomingCallModal — Sprint 23/24/25
 * Schermata chiamata in arrivo con squillo su iOS.
 *
 * FIX iOS audio:
 * - startRing() chiamato da effetto, ma l'audio element è già sbloccato via unlockNotifAudio()
 * - Sul pulsante "Accetta", chiamiamo unlockNotifAudio() DENTRO il user gesture
 *   prima di acceptCall(), così il remoteAudioRef.play() che arriva dopo
 *   ha il contesto già sbloccato e non viene bloccato da iOS Safari.
 */

import { useEffect, useState } from "react";
import { useCall } from "../contexts/CallContext";
import { startRing, stopRing, unlockNotifAudio } from "../lib/notifSound";
import { primeRemoteAudio } from "../lib/remoteAudio";
import { diagLog } from "../lib/diagnosticLogger";

export default function IncomingCallModal() {
  const { incomingCall, callType, acceptCall, rejectCall } = useCall();
  // true mentre acceptCall() è in volo: blocca re-tap e disabilita il rosso.
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!incomingCall) return;
    void startRing();
    return () => stopRing();
  }, [incomingCall]);

  // ── Reset accepting — doppia protezione ─────────────────────────────────────
  // IncomingCallModal è montato permanentemente in App.tsx (non condizionale),
  // quindi lo stato locale sopravvive tra chiamate diverse.
  //
  // Protezione 1 — terminazione: quando incomingCall diventa null (caller cancella,
  // timeout, ended_elsewhere, reject) resettiamo subito accepting, così lo stato
  // è già pulito prima che arrivi la chiamata successiva.
  //
  // Protezione 2 — nuova chiamata: quando arriva un nuovo callId resettiamo di
  // nuovo, come barriera di sicurezza nel caso in cui la protezione 1 non avesse
  // fatto in tempo (es. due incomingCall consecutivi senza passare per null).
  //
  // Usare callId come dipendenza (invece dell'oggetto incomingCall) è più preciso:
  // il reset avviene solo quando cambia l'identità della chiamata.
  useEffect(() => {
    setAccepting(false);
    diagLog('spinner.stop.reset', { callId: incomingCall?.callId ?? 'null' });
  }, [incomingCall?.callId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Log diagnostico — conferma RCA ──────────────────────────────────────────
  // Permette di verificare se accepting=true prima di qualsiasi tap su "Accetta".
  // Se nei log appare "incomingCall changed accepting=true" PRIMA di "Accept pressed"
  // la RCA è confermata al 100%.
  useEffect(() => {
    console.log('[ICM-DIAG] incomingCall changed callId=%s accepting=%s', incomingCall?.callId ?? 'null', accepting);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall]);

  // ── Safety-net: spinner infinito ────────────────────────────────────────────
  // Se acceptCall() si blocca su qualsiasi step (getUserMedia, ICE, negotiate…)
  // e il timeout interno di 15s non scatta (es. bug nella promise), questo
  // useEffect forza rejectCall() dopo 16s come ultimo baluardo.
  // rejectCall() → cleanup() → setIncomingCall(null) → modal smontato → spinner via.
  useEffect(() => {
    if (!accepting) return;
    const t = setTimeout(() => {
      console.error('[ICM] safety-net 16s — acceptCall() ancora in corso, forzo rejectCall()');
      diagLog('spinner.stop.safety_net', { callId: incomingCall?.callId ?? 'null' });
      rejectCall();
      setAccepting(false);
    }, 16_000);
    return () => clearTimeout(t);
  }, [accepting, rejectCall]);

  if (!incomingCall) return null;

  console.log('[DIAG-CP4] IncomingCallModal MONTATO, from=', incomingCall.fromUserId, incomingCall.fromDisplayName);

  const isVideo = callType === "video" || incomingCall.callType === "video";

  function handleAccept() {
    console.log('[TAP] Accept button pressed');
    if (accepting) {
      console.log('[TAP] IGNORATO — già in corso');
      return;
    }
    setAccepting(true);
    diagLog('spinner.start', { callId: incomingCall?.callId ?? '', from: incomingCall?.fromUserId ?? '' });
    // 🔑 iOS gesture context: fire-and-forget, NON await.
    // getUserMedia() dentro acceptCall() deve essere nel primo tick del gesture.
    // primeRemoteAudio/unlockNotifAudio partono in parallelo come side-effect.
    void primeRemoteAudio().catch(() => {});
    void unlockNotifAudio().catch(() => {});
    stopRing();
    // Cattura il reject: se acceptCall() va in timeout (12s getUserMedia) o lancia
    // per qualsiasi motivo, cleanup() è già stato chiamato internamente (modal si
    // smonterà). setAccepting(false) è un safety-net per il caso in cui il modal
    // fosse ancora montato (evita spinner infinito).
    acceptCall().catch((err) => {
      console.error('[ICM] acceptCall() rejected:', err);
      setAccepting(false);
    });
  }

  function handleReject() {
    console.log('[DIAG-ICM] handleReject() premuto — rosso');
    // Non permettere il rifiuto mentre accept è in corso: evita la race
    // call.reject-declined → call.answer che fa cleanup del caller prima della risposta.
    if (accepting) {
      console.log('[DIAG-ICM] handleReject() IGNORATO — accept in corso');
      return;
    }
    stopRing();
    rejectCall();
  }

  return (
    <>
      {/* Layer puramente decorativo: blur + dimming. pointer-events: none in CSS.
          Separato dal layer interattivo per evitare il bug WebKit:
          backdrop-filter + pointer-events:none sullo stesso elemento causa
          intercettazione ghost dei touch sul layer composited in alcune versioni iOS. */}
      <div className="icm-backdrop" aria-hidden="true" />
      {/* Layer interattivo: nessun backdrop-filter, pointer-events normali (default auto) */}
      <div className="icm-overlay">
      <div className="icm-card">
        <div className="icm-pulse-ring" />
        <div className="icm-avatar">
          {incomingCall.fromDisplayName[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="icm-name">{incomingCall.fromDisplayName}</div>
        <div className="icm-type">{isVideo ? "📹 Videochiamata in arrivo…" : "📞 Chiamata in arrivo…"}</div>

        <div className="icm-actions">
          <button
            className="icm-btn icm-reject"
            onClick={handleReject}
            aria-label="Rifiuta"
            disabled={accepting}
            style={accepting ? { opacity: 0.35, pointerEvents: 'none' } : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              <line x1="23" y1="1" x2="1" y2="23"/>
            </svg>
          </button>
          <button
            className="icm-btn icm-accept"
            onClick={() => void handleAccept()}
            aria-label="Accetta"
            disabled={accepting}
            style={accepting ? { pointerEvents: 'none' } : undefined}
          >
            {accepting
              ? <span className="icm-spinner" />
              : isVideo
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            }
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
