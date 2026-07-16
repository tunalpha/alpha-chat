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

import { useEffect } from "react";
import { useCall } from "../contexts/CallContext";
import { startRing, stopRing, unlockNotifAudio } from "../lib/notifSound";
import { primeRemoteAudio } from "../lib/remoteAudio";

export default function IncomingCallModal() {
  const { incomingCall, callType, acceptCall, rejectCall } = useCall();

  useEffect(() => {
    if (!incomingCall) return;
    void startRing();
    return () => stopRing();
  }, [incomingCall]);

  if (!incomingCall) return null;

  const isVideo = callType === "video" || incomingCall.callType === "video";

  function handleAccept() {
    // 🔑 iOS gesture context: fire-and-forget, NON await.
    // getUserMedia() dentro acceptCall() deve essere nel primo tick del gesture.
    // primeRemoteAudio/unlockNotifAudio partono in parallelo come side-effect.
    void primeRemoteAudio().catch(() => {});
    void unlockNotifAudio().catch(() => {});
    stopRing();
    void acceptCall();
  }

  function handleReject() {
    stopRing();
    rejectCall();
  }

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
          <button className="icm-btn icm-reject" onClick={handleReject} aria-label="Rifiuta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              <line x1="23" y1="1" x2="1" y2="23"/>
            </svg>
          </button>
          <button className="icm-btn icm-accept" onClick={() => void handleAccept()} aria-label="Accetta">
            {isVideo
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
