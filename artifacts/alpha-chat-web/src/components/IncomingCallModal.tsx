/**
 * IncomingCallModal — Sprint 23
 * Schermata di chiamata in arrivo con accetta/rifiuta.
 */

import { useEffect, useRef } from "react";
import { useCall } from "../contexts/CallContext";

export default function IncomingCallModal() {
  const { incomingCall, callType, acceptCall, rejectCall } = useCall();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Suono squillo (beep sintetico via Web Audio)
  useEffect(() => {
    if (!incomingCall) return;
    let ctx: AudioContext | null = null;
    let stopped = false;

    async function ring() {
      try {
        ctx = new AudioContext();
        while (!stopped) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 440;
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
          osc.start();
          osc.stop(ctx.currentTime + 0.6);
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch { /* ignore */ }
    }
    void ring();
    return () => { stopped = true; ctx?.close(); };
  }, [incomingCall]);

  if (!incomingCall) return null;

  const isVideo = callType === "video" || incomingCall.callType === "video";

  return (
    <div className="icm-overlay">
      <div className="icm-card">
        <div className="icm-pulse-ring" />
        <div className="icm-avatar">
          {incomingCall.fromDisplayName[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="icm-name">{incomingCall.fromDisplayName}</div>
        <div className="icm-type">{isVideo ? "📹 Videochiamata in arrivo…" : "📞 Chiamata in arrivo…"}</div>

        <div className="icm-actions">
          <button className="icm-btn icm-reject" onClick={rejectCall} aria-label="Rifiuta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              <line x1="23" y1="1" x2="1" y2="23"/>
            </svg>
          </button>
          <button className="icm-btn icm-accept" onClick={() => void acceptCall()} aria-label="Accetta">
            {isVideo
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            }
          </button>
        </div>
      </div>
      <audio ref={audioRef} />
    </div>
  );
}
