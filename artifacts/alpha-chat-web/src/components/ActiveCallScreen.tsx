/**
 * ActiveCallScreen — Alpha Chat Sprint 23/24/25
 *
 * Sprint 25 additions:
 * - Camera switch button (front ↔ back), video calls only
 * - Emergency Lock button in "more" menu
 * - Reconnecting overlay (ICE restart intelligente)
 * - Verify Identity button → CallVerifyModal
 * - Call Shield bar permanente (🔒 Cifrata · P2P/Relay · qualità)
 * - Statistiche dettagliate (RTT, jitter, perdita, bitrate, FPS, codec, ICE type)
 * - Update stats ogni 1s quando pannello aperto
 */
import {
  useRef, useEffect, useCallback, useState,
} from "react";
import { useCall } from "../contexts/CallContext";
import { useLock } from "../contexts/LockContext";
import CallVerifyModal from "./CallVerifyModal";

// ── Utility ───────────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type Quality = "excellent" | "good" | "poor" | null;
function qualityLabel(q: Quality): { dot: string; text: string } | null {
  if (q === "excellent") return { dot: "🟢", text: "Eccellente" };
  if (q === "good")      return { dot: "🟡", text: "Buona" };
  if (q === "poor")      return { dot: "🔴", text: "Scarsa" };
  return null;
}

interface DetailedStats {
  rttMs: number;
  jitter: number;
  lossRatio: number;
  codec: string;
  connType: string;
  audioKbps: number;
  videoKbps: number;
  fps: number;
  resolution: string;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function ActiveCallScreen() {
  const {
    callState, callType, remoteUserId, remoteDisplayName,
    localStream, remoteStream,
    callDuration, isMuted, isCameraOff, isSpeaker,
    isReconnecting,
    peerConnection,
    endCall, toggleMute, toggleCamera, toggleSpeaker, switchCamera,
  } = useCall();
  const { emergencyLock } = useLock();

  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef  = useRef<HTMLVideoElement>(null);

  const [quality, setQuality]       = useState<Quality>(null);
  const [showStats, setShowStats]   = useState(false);
  const [stats, setStats]           = useState<DetailedStats | null>(null);
  const [connType, setConnType]     = useState<string>("P2P");
  const [showMenu, setShowMenu]     = useState(false);
  const [showVerify, setShowVerify] = useState(false);

  // ── Media routing ────────────────────────────────────────────────────────

  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (!audio || !remoteStream) return;
    audio.srcObject = remoteStream;
    void audio.play().catch(() => {});
  }, [remoteStream]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || !remoteStream) return;
    video.srcObject = remoteStream;
    void video.play().catch(() => {});
  }, [remoteStream]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !localStream) return;
    video.srcObject = localStream;
    void video.play().catch(() => {});
  }, [localStream]);

  // ── WebRTC stats ────────────────────────────────────────────────────────

  const sampleStats = useCallback(async () => {
    if (!peerConnection) return;
    try {
      const reports = await peerConnection.getStats();
      let rttMs = 0, jitter = 0, lossRatio = 0;
      let codec = "", connTypeParsed = "";
      let audioBytesSent = 0, videoBytesRecv = 0;
      let fps = 0, resolution = "";

      reports.forEach((r: RTCStats & Record<string, unknown>) => {
        if (r.type === "remote-inbound-rtp" && (r as Record<string,unknown>)["kind"] === "audio") {
          rttMs     = ((r as Record<string,unknown>)["roundTripTime"] as number ?? 0) * 1000;
          jitter    = ((r as Record<string,unknown>)["jitter"] as number ?? 0) * 1000;
          const lost  = (r as Record<string,unknown>)["packetsLost"] as number ?? 0;
          const sent  = (r as Record<string,unknown>)["packetsSent"] as number ?? 1;
          lossRatio = lost / Math.max(sent, 1);
        }
        if (r.type === "outbound-rtp" && (r as Record<string,unknown>)["kind"] === "audio") {
          audioBytesSent = (r as Record<string,unknown>)["bytesSent"] as number ?? 0;
        }
        if (r.type === "inbound-rtp" && (r as Record<string,unknown>)["kind"] === "video") {
          videoBytesRecv = (r as Record<string,unknown>)["bytesReceived"] as number ?? 0;
          fps            = (r as Record<string,unknown>)["framesPerSecond"] as number ?? 0;
          const fw       = (r as Record<string,unknown>)["frameWidth"] as number ?? 0;
          const fh       = (r as Record<string,unknown>)["frameHeight"] as number ?? 0;
          if (fw && fh) resolution = `${fw}×${fh}`;
        }
        if (r.type === "codec" && !codec) {
          codec = (r as Record<string,unknown>)["mimeType"] as string ?? "";
        }
        if (r.type === "candidate-pair" && (r as Record<string,unknown>)["state"] === "succeeded") {
          connTypeParsed = (r as Record<string,unknown>)["localCandidateType"] === "relay" ? "TURN" : "P2P";
        }
      });

      const q: Quality =
        rttMs < 150 && lossRatio < 0.02 ? "excellent" :
        rttMs < 400 && lossRatio < 0.08 ? "good" : "poor";

      setQuality(q);
      setConnType(connTypeParsed || "P2P");
      setStats({
        rttMs:      Math.round(rttMs),
        jitter:     Math.round(jitter),
        lossRatio,
        codec:      codec.replace("audio/", "").replace("video/", ""),
        connType:   connTypeParsed || "P2P",
        audioKbps:  Math.round((audioBytesSent * 8) / 1000),
        videoKbps:  Math.round((videoBytesRecv * 8) / 1000),
        fps:        Math.round(fps),
        resolution,
      });
    } catch { /* ignore */ }
  }, [peerConnection]);

  // Sample ogni 4s; ogni 1s quando il pannello stats è aperto
  useEffect(() => {
    if (callState !== "active") { setQuality(null); setStats(null); return; }
    const interval = showStats ? 1000 : 4000;
    const id = setInterval(() => void sampleStats(), interval);
    return () => clearInterval(id);
  }, [callState, showStats, sampleStats]);

  if (callState !== "active" && callState !== "calling") return null;

  const isVideo      = callType === "video";
  const isConnecting = callState === "calling";
  const ql           = qualityLabel(quality);

  return (
    <>
      <div className={`acs-overlay${isVideo ? " acs-video-mode" : ""}`}>
        {/* ── Audio: earpiece senza autoPlay (iOS routing fix Sprint 24) ─ */}
        <audio ref={remoteAudioRef} playsInline style={{ position: "absolute", width: 0, height: 0, opacity: 0 }} />

        {/* ── Video remoto (altoparlante / video call) ─ */}
        {(isSpeaker || isVideo) && (
          <video
            ref={remoteVideoRef}
            className={isVideo ? "acs-remote-video" : "acs-remote-audio-video"}
            playsInline
          />
        )}

        {/* ── Avatar fallback ─ */}
        {(!isVideo || !remoteStream) && (
          <div className="acs-avatar-bg">
            <div className="acs-avatar">
              {remoteDisplayName?.[0]?.toUpperCase() ?? "?"}
            </div>
          </div>
        )}

        {/* ── Overlay: riconnessione in corso ─ */}
        {isReconnecting && (
          <div className="acs-reconnecting-overlay">
            <div className="acs-reconnecting-spinner" />
            <span className="acs-reconnecting-label">Riconnessione…</span>
          </div>
        )}

        {/* ── Info: nome, stato, qualità ─ */}
        <div className="acs-info">
          <div className="acs-name">{remoteDisplayName}</div>
          <div className="acs-status">
            {isConnecting ? "In chiamata…" :
             isVideo      ? `📹 ${formatDuration(callDuration)}` :
                            `📞 ${formatDuration(callDuration)}`}
          </div>

          {ql && (
            <button className="acs-quality-badge" onClick={() => setShowStats((v) => !v)} title="Statistiche">
              {ql.dot} {ql.text}
            </button>
          )}
        </div>

        {/* ── Pannello statistiche dettagliate ─ */}
        {showStats && stats && (
          <div className="acs-stats-panel">
            <div className="acs-stats-row"><span>RTT</span><span>{stats.rttMs} ms</span></div>
            <div className="acs-stats-row"><span>Jitter</span><span>{stats.jitter} ms</span></div>
            <div className="acs-stats-row"><span>Perdita pacchetti</span><span>{(stats.lossRatio * 100).toFixed(1)}%</span></div>
            <div className="acs-stats-row"><span>Codec</span><span>{stats.codec || "—"}</span></div>
            <div className="acs-stats-row"><span>Connessione</span><span>{stats.connType}</span></div>
            {stats.audioKbps > 0 && <div className="acs-stats-row"><span>Audio</span><span>{stats.audioKbps} kbps</span></div>}
            {isVideo && stats.videoKbps > 0 && <div className="acs-stats-row"><span>Video</span><span>{stats.videoKbps} kbps</span></div>}
            {isVideo && stats.fps > 0   && <div className="acs-stats-row"><span>FPS</span><span>{stats.fps}</span></div>}
            {isVideo && stats.resolution && <div className="acs-stats-row"><span>Risoluzione</span><span>{stats.resolution}</span></div>}
          </div>
        )}

        {/* ── Video locale (PiP) ─ */}
        {isVideo && (
          <video
            ref={localVideoRef}
            className={`acs-local-video${isCameraOff ? " acs-camera-off" : ""}`}
            playsInline
            muted
          />
        )}

        {/* ── Menu "altro" (emergency lock, verifica identità) ─ */}
        {showMenu && (
          <div className="acs-menu">
            <button className="acs-menu-item" onClick={() => { setShowVerify(true); setShowMenu(false); }}>
              🔍 Verifica identità
            </button>
            <button className="acs-menu-item acs-menu-item-danger" onClick={() => { endCall(); emergencyLock(); setShowMenu(false); }}>
              🔒 Emergency Lock
            </button>
            <button className="acs-menu-item" onClick={() => setShowMenu(false)}>
              Annulla
            </button>
          </div>
        )}

        {/* ── Controlli ─ */}
        <div className="acs-controls">
          {/* Microfono */}
          <button className={`acs-btn${isMuted ? " acs-btn-active" : ""}`} onClick={toggleMute}
            aria-label={isMuted ? "Riattiva" : "Silenzia"} title={isMuted ? "Riattiva microfono" : "Silenzia"}>
            {isMuted
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            }
          </button>

          {/* Vivavoce */}
          <button className={`acs-btn${isSpeaker ? " acs-btn-active" : ""}`} onClick={toggleSpeaker}
            aria-label={isSpeaker ? "Auricolare" : "Vivavoce"} title={isSpeaker ? "Auricolare" : "Vivavoce"}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </button>

          {/* Camera toggle — video calls */}
          {isVideo && (
            <button className={`acs-btn${isCameraOff ? " acs-btn-active" : ""}`} onClick={toggleCamera}
              aria-label={isCameraOff ? "Accendi camera" : "Spegni camera"}>
              {isCameraOff
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/></svg>
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              }
            </button>
          )}

          {/* Camera switch — front/back, solo mobile/video */}
          {isVideo && !isConnecting && (
            <button className="acs-btn acs-btn-switch-cam" onClick={() => void switchCamera()}
              aria-label="Cambia camera" title="Cambia camera">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                <path d="M20 7h-3.5l-1.5-2h-6L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
                <path d="M15 3l-3-2-3 2"/>
              </svg>
            </button>
          )}

          {/* Altro / menu */}
          <button className="acs-btn" onClick={() => setShowMenu((v) => !v)} aria-label="Altro" title="Altro">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
              <circle cx="12" cy="5" r="1" fill="currentColor"/>
              <circle cx="12" cy="12" r="1" fill="currentColor"/>
              <circle cx="12" cy="19" r="1" fill="currentColor"/>
            </svg>
          </button>

          {/* Fine chiamata */}
          <button className="acs-btn acs-btn-end" onClick={endCall} aria-label="Termina">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="28" height="28">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 5.55 5.55l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              <line x1="23" y1="1" x2="1" y2="23"/>
            </svg>
          </button>
        </div>

        {/* ── Call Shield Bar permanente ─ */}
        {callState === "active" && (
          <div className="acs-shield-bar">
            <span className="acs-shield-enc">🔒 Cifrata</span>
            <span className="acs-shield-sep">·</span>
            <span className="acs-shield-conn">
              {connType === "TURN" ? "🟡 Relay" : "🟢 P2P"}
            </span>
            {ql && (
              <>
                <span className="acs-shield-sep">·</span>
                <span>{ql.dot} {ql.text}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── CallVerifyModal (portato fuori dall'overlay per z-index corretto) ─ */}
      {showVerify && <CallVerifyModal onClose={() => setShowVerify(false)} />}
    </>
  );
}
