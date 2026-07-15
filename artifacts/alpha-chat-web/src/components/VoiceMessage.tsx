/**
 * VoiceMessage — Sprint 11
 * Player per messaggi vocali con waveform, speed control (1x/1.5x/2x).
 */

import { useEffect, useRef, useState } from "react";

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
  const [progress, setProgress] = useState(0); // 0–1
  const [elapsed, setElapsed]   = useState(0); // ms
  const [speed, setSpeed]       = useState<Speed>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const srcRef   = useRef<string | null>(null);

  // Carica l'audio on-demand (lazy — solo al primo play)
  const getAudioUrl = () => {
    if (srcRef.current) return srcRef.current;
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    const url = `${base}/api/v1/media/${mediaId}`;
    srcRef.current = url;
    return url;
  };

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.ontimeupdate = () => {
      const dur = audio.duration || durationMs / 1000;
      setProgress(audio.currentTime / dur);
      setElapsed(audio.currentTime * 1000);
    };
    audio.onended = () => { setPlaying(false); setProgress(0); setElapsed(0); };
    audio.playbackRate = speed;

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  function handlePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src) audio.src = getAudioUrl();

    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src) audio.src = getAudioUrl();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * (audio.duration || durationMs / 1000);
  }

  function cycleSpeed() {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  }

  const bars = waveform.length > 0 ? waveform : Array(40).fill(0.3);
  const displayDuration = playing ? elapsed : durationMs;

  return (
    <div className={`voice-msg ${isMine ? "mine" : "theirs"}`}>
      <button className="voice-msg-play" onClick={handlePlay} aria-label={playing ? "Pausa" : "Riproduci"}>
        {playing ? (
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
        {/* Waveform + seekbar */}
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
        <span className="voice-msg-time">{formatDuration(displayDuration)}</span>
      </div>

      <button className="voice-msg-speed" onClick={cycleSpeed} aria-label={`Velocità: ${speed}x`}>
        {speed}x
      </button>
    </div>
  );
}
