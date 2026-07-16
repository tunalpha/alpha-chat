/**
 * ActiveCallScreen — Sprint 23
 * Schermata chiamata attiva (overlay sopra la chat).
 * Mostra video locale/remoto per video call, avatar per audio.
 */

import { useEffect, useRef } from "react";
import { useCall } from "../contexts/CallContext";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function ActiveCallScreen() {
  const {
    callState, callType, remoteDisplayName,
    localStream, remoteStream,
    callDuration, isMuted, isCameraOff,
    endCall, toggleMute, toggleCamera,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  if (callState !== "active" && callState !== "calling") return null;

  const isVideo = callType === "video";
  const isConnecting = callState === "calling";

  return (
    <div className={`acs-overlay${isVideo ? " acs-video-mode" : ""}`}>
      {/* Video remoto (sfondo) */}
      {isVideo && (
        <video
          ref={remoteVideoRef}
          className="acs-remote-video"
          autoPlay
          playsInline
        />
      )}

      {/* Fallback avatar quando non c'è video */}
      {(!isVideo || !remoteStream) && (
        <div className="acs-avatar-bg">
          <div className="acs-avatar">
            {remoteDisplayName?.[0]?.toUpperCase() ?? "?"}
          </div>
        </div>
      )}

      {/* Info chiamata */}
      <div className="acs-info">
        <div className="acs-name">{remoteDisplayName}</div>
        <div className="acs-status">
          {isConnecting
            ? "In chiamata…"
            : isVideo ? `📹 ${formatDuration(callDuration)}` : `📞 ${formatDuration(callDuration)}`
          }
        </div>
      </div>

      {/* Video locale (PiP) */}
      {isVideo && (
        <video
          ref={localVideoRef}
          className={`acs-local-video${isCameraOff ? " acs-camera-off" : ""}`}
          autoPlay
          playsInline
          muted
        />
      )}

      {/* Controlli */}
      <div className="acs-controls">
        {/* Mute */}
        <button
          className={`acs-btn${isMuted ? " acs-btn-active" : ""}`}
          onClick={toggleMute}
          aria-label={isMuted ? "Riattiva microfono" : "Silenzia microfono"}
          title={isMuted ? "Riattiva microfono" : "Silenzia"}
        >
          {isMuted
            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          }
        </button>

        {/* Camera toggle — solo video call */}
        {isVideo && (
          <button
            className={`acs-btn${isCameraOff ? " acs-btn-active" : ""}`}
            onClick={toggleCamera}
            aria-label={isCameraOff ? "Accendi camera" : "Spegni camera"}
            title={isCameraOff ? "Accendi camera" : "Spegni camera"}
          >
            {isCameraOff
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            }
          </button>
        )}

        {/* Fine chiamata */}
        <button className="acs-btn acs-btn-end" onClick={endCall} aria-label="Termina chiamata">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            <line x1="23" y1="1" x2="1" y2="23"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
