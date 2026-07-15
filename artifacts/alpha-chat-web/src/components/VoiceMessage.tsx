/**
 * VoiceMessage — Sprint 11
 * Player per messaggi vocali con waveform, speed control (1x/1.5x/2x).
 * Fetch autenticato tramite apiFetchMediaBlob — l'elemento <audio> non
 * può passare Bearer token da solo.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { apiFetchMediaBlob } from "../lib/api";

interface Props {
  mediaId: string;
  durationMs: number;
  waveform: number[];
  isMine: boolean;
}

const SPEEDS = [1, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function VoiceMessage({ mediaId, durationMs, waveform, isMine }: Props) {
  const [playing, setPlaying]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed]   = useState(0);
  const [speed, setSpeed]       = useState<Speed>(1);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Crea l'elemento audio all'mount
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.ontimeupdate = () => {
      const dur = audio.duration || durationMs / 1000;
      if (dur > 0) {
        setProgress(audio.currentTime / dur);
        setElapsed(audio.currentTime * 1000);
      }
    };
    audio.onended = () => {
      setPlaying(false);
      setProgress(0);
      setElapsed(0);
    };
    audio.onerror = () => {
      setPlaying(false);
      setError("Errore riproduzione");
    };

    return () => {
      audio.pause();
      audio.src = "";
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // Carica il blob URL la prima volta che l'utente preme play
  const loadAndPlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    setError(null);

    // Se già caricato — pausa o riproduci
    if (blobUrlRef.current) {
      if (playing) {
        audio.pause();
        setPlaying(false);
      } else {
        audio.playbackRate = speed;
        await audio.play().catch(() => setError("Errore riproduzione"));
        setPlaying(true);
      }
      return;
    }

    // Prima volta: fetch autenticato
    setLoading(true);
    try {
      const url = await apiFetchMediaBlob(mediaId);
      blobUrlRef.current = url;
      audio.src = url;
      audio.playbackRate = speed;
      await audio.play();
      setPlaying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setLoading(false);
    }
  }, [mediaId, playing, speed]);

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !blobUrlRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * (audio.duration || durationMs / 1000);
  }

  function cycleSpeed() {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev);
      return SPEEDS[(idx + 1) % SPEEDS.length];
    });
  }

  const bars = waveform.length >= 10 ? waveform : Array(40).fill(0.3);
  const displayDuration = elapsed > 0 ? elapsed : durationMs;

  return (
    <div className={`voice-msg ${isMine ? "mine" : "theirs"}`}>
      <button
        className="voice-msg-play"
        onClick={() => void loadAndPlay()}
        disabled={loading}
        aria-label={playing ? "Pausa" : "Riproduci"}
      >
        {loading ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
            <circle cx="12" cy="12" r="10" strokeDasharray="40" strokeDashoffset="30">
              <animateTransform attributeName="transform" type="rotate" dur="1s" from="0 12 12" to="360 12 12" repeatCount="indefinite"/>
            </circle>
          </svg>
        ) : playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        )}
      </button>

      <div className="voice-msg-body">
        <div className="voice-msg-wave" onClick={handleSeek} role="slider" aria-label="Avanzamento">
          {bars.map((h, i) => {
            const ratio = i / bars.length;
            const isPlayed = ratio < progress;
            return (
              <div
                key={i}
                className={`voice-msg-bar ${isPlayed ? "played" : ""}`}
                style={{ height: `${Math.max(3, h * 28)}px` }}
              />
            );
          })}
        </div>
        {error ? (
          <span className="voice-msg-time" style={{ color: "#f87171" }}>{error}</span>
        ) : (
          <span className="voice-msg-time">{formatDuration(displayDuration)}</span>
        )}
      </div>

      <button className="voice-msg-speed" onClick={cycleSpeed} aria-label={`Velocità: ${speed}x`}>
        {speed}x
      </button>
    </div>
  );
}
