/**
 * ActiveCallScreen — Sprint 23/24
 *
 * FIX: aggiunto elemento <audio>/<video> per lo stream remoto —
 * senza di esso le chiamate audio erano completamente mute sul ricevitore.
 *
 * Vivavoce: su iOS, <audio> → auricolare; <video> → altoparlante.
 * La modalità altoparlante switcha il srcObject tra i due elementi.
 *
 * Qualità: campiona RTCPeerConnection.getStats() ogni 4 s.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useCall } from "../contexts/CallContext";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

type Quality = "excellent" | "good" | "poor" | null;

function qualityLabel(q: Quality) {
  if (q === "excellent") return { dot: "🟢", text: "Eccellente" };
  if (q === "good")      return { dot: "🟡", text: "Media" };
  if (q === "poor")      return { dot: "🔴", text: "Debole" };
  return null;
}

export default function ActiveCallScreen() {
  const {
    callState, callType, remoteDisplayName,
    localStream, remoteStream,
    callDuration, isMuted, isCameraOff, isSpeaker,
    endCall, toggleMute, toggleCamera, toggleSpeaker,
    peerConnection,
  } = useCall();

  const localVideoRef   = useRef<HTMLVideoElement>(null);
  const remoteVideoRef  = useRef<HTMLVideoElement>(null);   // loudspeaker / video
  const remoteAudioRef  = useRef<HTMLAudioElement>(null);   // earpiece (audio-only)

  const [quality, setQuality] = useState<Quality>(null);
  const [showStats, setShowStats] = useState(false);
  const [statsText, setStatsText] = useState("");

  // ── Collega stream locale ───────────────────────────────────────────────────
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // ── Collega stream remoto all'elemento corretto ──────────────────────────────
  // iOS: <video> → altoparlante, <audio> → auricolare
  useEffect(() => {
    if (!remoteStream) return;
    if (isSpeaker || callType === "video") {
      if (remoteVideoRef.current)  remoteVideoRef.current.srcObject = remoteStream;
      if (remoteAudioRef.current)  remoteAudioRef.current.srcObject = null;
    } else {
      if (remoteAudioRef.current)  remoteAudioRef.current.srcObject = remoteStream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    }
  }, [remoteStream, isSpeaker, callType]);

  // ── Polling statistiche qualità ─────────────────────────────────────────────
  const sampleStats = useCallback(async () => {
    if (!peerConnection || peerConnection.connectionState !== "connected") return;
    try {
      const stats = await peerConnection.getStats();
      let rttMs = 0, lossRatio = 0, jitter = 0, codec = "", connType = "";
      stats.forEach((report) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = report as any;
        if (report.type === "remote-inbound-rtp") {
          rttMs     = (r.roundTripTime ?? 0) * 1000;
          lossRatio = r.fractionLost ?? 0;
          jitter    = (r.jitter ?? 0) * 1000;
        }
        if (report.type === "codec" && !codec) {
          codec = r.mimeType ?? "";
        }
        if (report.type === "candidate-pair" && r.state === "succeeded") {
          connType = r.localCandidateType === "relay" ? "TURN" : "P2P";
        }
      });
      if (rttMs === 0 && lossRatio === 0) return; // dati non ancora disponibili
      const q: Quality = rttMs < 150 && lossRatio < 0.02 ? "excellent"
                       : rttMs < 400 && lossRatio < 0.08 ? "good"
                       : "poor";
      setQuality(q);
      setStatsText(`RTT ${Math.round(rttMs)} ms · Perdita ${(lossRatio * 100).toFixed(1)}% · Jitter ${Math.round(jitter)} ms · ${codec} · ${connType || "P2P"}`);
    } catch { /* ignore */ }
  }, [peerConnection]);

  useEffect(() => {
    if (callState !== "active") { setQuality(null); return; }
    const id = setInterval(() => void sampleStats(), 4000);
    return () => clearInterval(id);
  }, [callState, sampleStats]);

  if (callState !== "active" && callState !== "calling") return null;

  const isVideo = callType === "video";
  const isConnecting = callState === "calling";
  const ql = qualityLabel(quality);

  return (
    <div className={`acs-overlay${isVideo ? " acs-video-mode" : ""}`}>
      {/* Audio earpiece — sempre montato, srcObject gestito sopra */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />

      {/* Video loudspeaker / sfondo per video call.
          ⚠️ iOS routing: <video autoPlay> presente nel DOM → altoparlante sempre.
          Montiamo l'elemento SOLO quando vivavoce è attivo o è una video call,
          così in modalità auricolare non c'è nessun video nel DOM. */}
      {(isSpeaker || callType === "video") && (
        <video
          ref={remoteVideoRef}
          className={isVideo ? "acs-remote-video" : "acs-remote-audio-video"}
          autoPlay
          playsInline
        />
      )}

      {/* Avatar fallback */}
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

        {/* Badge qualità */}
        {ql && (
          <button
            className="acs-quality-badge"
            onClick={() => setShowStats((v) => !v)}
            title="Dettagli connessione"
          >
            {ql.dot} {ql.text}
          </button>
        )}
        {showStats && statsText && (
          <div className="acs-stats-popup">{statsText}</div>
        )}

        {/* Badge connessione cifrata — WebRTC usa sempre DTLS-SRTP */}
        <div className="acs-enc-badge">🔒 Cifrata</div>
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

        {/* Vivavoce */}
        <button
          className={`acs-btn${isSpeaker ? " acs-btn-active" : ""}`}
          onClick={toggleSpeaker}
          aria-label={isSpeaker ? "Auricolare" : "Vivavoce"}
          title={isSpeaker ? "Passa ad auricolare" : "Attiva vivavoce"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
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
