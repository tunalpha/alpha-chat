/**
 * VoiceMessage — Sprint 11 (fix iOS Safari) + Sprint 16 Fase 3 (E2E decrypt)
 *
 * Due problemi noti di iOS Safari risolti:
 * 1. objectURL + <audio> inaffidabile su iOS → usiamo data URL (base64)
 * 2. audio.play() dopo await non conta come gesto utente su iOS →
 *    pre-carichiamo l'audio al mount, così il click chiama play() sincrono
 *
 * Fase 3: se encryptedKey + encryptedIv sono presenti, il blob audio
 * è cifrato AES-256-GCM → viene decifrato localmente prima della riproduzione.
 */

import { useEffect, useRef, useState } from "react";
import { apiFetchMediaBlob, apiFetchAndDecryptMediaBlob } from "../lib/api";

interface Props {
  mediaId: string;
  durationMs: number;
  waveform: number[];
  isMine: boolean;
  /** Fase 3: chiave AES-256 in base64 (dal metadata Signal-decifrato) */
  encryptedKey?: string;
  /** Fase 3: IV AES-GCM in base64 (dal metadata Signal-decifrato) */
  encryptedIv?: string;
  /**
   * MIME type del blob audio originale (es. "audio/mp4" su iOS, "audio/webm" su Android).
   * Passato a apiFetchAndDecryptMediaBlob come hint; i magic bytes hanno precedenza.
   * Per messaggi vecchi (senza mime_type nel metadata) i magic bytes rilevano il formato automaticamente.
   */
  mimeType?: string;
}

const SPEEDS = [1, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function VoiceMessage({ mediaId, durationMs, waveform, isMine, encryptedKey, encryptedIv, mimeType }: Props) {
  const [ready, setReady]       = useState(false);
  const [playing, setPlaying]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed]   = useState(0);
  const [speed, setSpeed]       = useState<Speed>(1);
  const [loadErr, setLoadErr]   = useState<string | null>(null);
  const [playErr, setPlayErr]   = useState<string | null>(null);

  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const dataUrlRef  = useRef<string | null>(null);

  // ── Pre-carica l'audio al mount ───────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.preload = "auto";
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
      const code = audio.error?.code;
      const msg =
        code === 4 ? "Formato non supportato"
        : code === 3 ? "Errore decodifica"
        : code === 2 ? "Errore di rete"
        : "Errore riproduzione";
      setPlaying(false);
      setPlayErr(msg);
    };

    let cancelled = false;

    (async () => {
      try {
        let objectUrl: string;

        if (encryptedKey && encryptedIv) {
          // Fase 3: scarica blob cifrato e decifra localmente (AES-256-GCM)
          // mimeType è un hint; apiFetchAndDecryptMediaBlob usa magic bytes come
          // fonte primaria → funziona anche per messaggi vecchi senza mime_type
          objectUrl = await apiFetchAndDecryptMediaBlob(
            mediaId,
            encryptedKey,
            encryptedIv,
            mimeType,
          );
        } else {
          // Legacy: blob in chiaro
          objectUrl = await apiFetchMediaBlob(mediaId);
        }

        // Converti objectURL → Blob → base64 data URL (iOS-safe)
        const blobRes = await fetch(objectUrl);
        const blob = await blobRes.blob();
        URL.revokeObjectURL(objectUrl);

        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        if (cancelled) return;
        dataUrlRef.current = dataUrl;
        audio.src = dataUrl;
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setLoadErr(err instanceof Error ? err.message : "Errore caricamento");
      }
    })();

    return () => {
      cancelled = true;
      audio.pause();
      audio.src = "";
    };
  }, [mediaId, durationMs, encryptedKey, encryptedIv]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // ── Play / Pausa sincrono (no await = gesto utente valido su iOS) ─────────
  function handlePlayPause() {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    setPlayErr(null);

    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.playbackRate = speed;
      const promise = audio.play();
      if (promise !== undefined) {
        promise
          .then(() => setPlaying(true))
          .catch((err: Error) => {
            setPlayErr(err.name === "NotAllowedError" ? "Tocca di nuovo" : "Errore avvio");
          });
      } else {
        setPlaying(true);
      }
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !ready) return;
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
  const isLoading = !ready && !loadErr;
  const error = loadErr ?? playErr;

  return (
    <div className={`voice-msg ${isMine ? "mine" : "theirs"}`}>
      {/* Play / Pausa */}
      <button
        className="voice-msg-play"
        onClick={handlePlayPause}
        disabled={isLoading || !!loadErr}
        aria-label={playing ? "Pausa" : "Riproduci"}
      >
        {isLoading ? (
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

      {/* Waveform + durata */}
      <div className="voice-msg-body">
        <div className="voice-msg-wave" onClick={handleSeek} role="slider" aria-label="Avanzamento">
          {bars.map((h, i) => {
            const isPlayed = (i / bars.length) < progress;
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
          <span className="voice-msg-time" style={{ color: "#f87171", fontSize: "10px" }}>{error}</span>
        ) : (
          <span className="voice-msg-time">{formatDuration(displayDuration)}</span>
        )}
      </div>

      {/* Velocità */}
      <button className="voice-msg-speed" onClick={cycleSpeed} aria-label={`Velocità: ${speed}x`}>
        {speed}x
      </button>
    </div>
  );
}
