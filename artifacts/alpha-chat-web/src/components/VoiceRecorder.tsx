/**
 * VoiceRecorder — Sprint 11
 * Registrazione messaggi vocali con waveform, pausa/riprendi, annulla/invia.
 */

import { useEffect, useRef, useState, useCallback } from "react";

export interface VoiceBlob {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  waveform: number[]; // 50 valori 0–1
}

interface Props {
  onSend: (voice: VoiceBlob) => void;
  onCancel: () => void;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const WAVEFORM_BARS = 40;

export default function VoiceRecorder({ onSend, onCancel }: Props) {
  const [state, setState] = useState<"recording" | "paused">("recording");
  const [durationMs, setDurationMs] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(WAVEFORM_BARS).fill(0.1));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const animFrameRef     = useRef<number>(0);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef     = useRef<number>(Date.now());
  const pausedMsRef      = useRef<number>(0);
  const waveformDataRef  = useRef<number[]>([]); // campioni continui

  // ── Avvia la registrazione ────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Web Audio API per waveform
      const audioCtx = new AudioContext();
      const source   = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Scegli il MIME supportato (Safari: mp4, Chrome/FF: webm)
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(100); // chunk ogni 100ms
      mediaRecorderRef.current = recorder;

      startTimeRef.current = Date.now();

      // Timer durata
      timerRef.current = setInterval(() => {
        setDurationMs(pausedMsRef.current + (Date.now() - startTimeRef.current));
      }, 100);

      // Animazione waveform
      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      const animate = () => {
        analyser.getByteFrequencyData(dataArr);
        const avg = Array.from(dataArr).reduce((s, v) => s + v, 0) / dataArr.length;
        const norm = Math.min(avg / 128, 1);
        // campiona e genera barre con varianza
        waveformDataRef.current.push(norm);
        setBars((prev) => {
          const next = [...prev.slice(1)];
          const jitter = (Math.random() - 0.5) * 0.15;
          next.push(Math.max(0.05, Math.min(1, norm + jitter)));
          return next;
        });
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animFrameRef.current = requestAnimationFrame(animate);
    } catch {
      onCancel();
    }
  }, [onCancel]);

  useEffect(() => {
    void startRecording();
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [startRecording]);

  // ── Pausa / Riprendi ──────────────────────────────────────────────────────
  function handlePause() {
    if (!mediaRecorderRef.current) return;
    if (state === "recording") {
      mediaRecorderRef.current.pause();
      pausedMsRef.current += Date.now() - startTimeRef.current;
      if (timerRef.current) clearInterval(timerRef.current);
      cancelAnimationFrame(animFrameRef.current);
      setState("paused");
    } else {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setDurationMs(pausedMsRef.current + (Date.now() - startTimeRef.current));
      }, 100);
      // riavvia animazione
      const analyser = analyserRef.current;
      if (analyser) {
        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        const animate = () => {
          analyser.getByteFrequencyData(dataArr);
          const avg = Array.from(dataArr).reduce((s, v) => s + v, 0) / dataArr.length;
          const norm = Math.min(avg / 128, 1);
          waveformDataRef.current.push(norm);
          setBars((prev) => {
            const next = [...prev.slice(1)];
            next.push(Math.max(0.05, Math.min(1, norm + (Math.random() - 0.5) * 0.15)));
            return next;
          });
          animFrameRef.current = requestAnimationFrame(animate);
        };
        animFrameRef.current = requestAnimationFrame(animate);
      }
      setState("recording");
    }
  }

  // ── Annulla ───────────────────────────────────────────────────────────────
  function handleCancel() {
    cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCancel();
  }

  // ── Invia ─────────────────────────────────────────────────────────────────
  function handleSend() {
    cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    const finalDuration = pausedMsRef.current + (Date.now() - startTimeRef.current);

    // Campiona 50 valori dalla waveform raccolta
    const raw = waveformDataRef.current;
    const waveform: number[] = [];
    for (let i = 0; i < 50; i++) {
      const idx = Math.floor((i / 50) * raw.length);
      waveform.push(raw[idx] ?? 0.1);
    }

    recorder.onstop = () => {
      const mimeType = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mimeType });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onSend({ blob, mimeType, durationMs: finalDuration, waveform });
    };
    recorder.stop();
  }

  return (
    <div className="voice-recorder">
      <button className="voice-cancel-btn" onClick={handleCancel} aria-label="Annulla">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <div className="voice-waveform">
        {bars.map((h, i) => (
          <div
            key={i}
            className={`voice-bar ${state === "recording" ? "active" : "paused"}`}
            style={{ height: `${Math.max(4, h * 36)}px` }}
          />
        ))}
      </div>

      <span className="voice-duration">{formatDuration(durationMs)}</span>

      <button className="voice-pause-btn" onClick={handlePause} aria-label={state === "recording" ? "Pausa" : "Riprendi"}>
        {state === "recording" ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        )}
      </button>

      <button className="voice-send-btn" onClick={handleSend} aria-label="Invia messaggio vocale">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/>
        </svg>
      </button>
    </div>
  );
}
