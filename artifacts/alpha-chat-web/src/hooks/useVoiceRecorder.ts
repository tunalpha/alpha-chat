/**
 * useVoiceRecorder — logica di registrazione audio estratta da VoiceRecorder.tsx.
 *
 * IMPORTANTE: la logica MediaRecorder / waveform / conversione webm→wav è
 * IDENTICA a quella originale del componente VoiceRecorder (Sprint 11). Qui è
 * solo incapsulata in un hook così la nuova UI "press & hold" stile WhatsApp
 * (VoiceHoldRecorder) può orchestrare start/stop/cancel tramite gesture, senza
 * modificare encoding, formato o il flusso di invio (VoiceBlob invariato).
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { webmToWav } from "../lib/audioConvert";

/** Risultato di una registrazione vocale, pronto per l'invio (formato invariato). */
export interface VoiceBlob {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  waveform: number[]; // 50 valori 0–1
}

const WAVEFORM_BARS = 40;

export interface VoiceRecorderApi {
  /** Avvia registrazione. Restituisce true se partita, false se permesso negato/errore. */
  start: () => Promise<boolean>;
  /** Ferma e produce il VoiceBlob finale (con conversione webm→wav se necessario). */
  finish: () => Promise<VoiceBlob | null>;
  /** Annulla e scarta l'audio. */
  cancel: () => void;
  durationMs: number;
  bars: number[];
  isRecording: boolean;
}

export function useVoiceRecorder(): VoiceRecorderApi {
  const [durationMs, setDurationMs]   = useState(0);
  const [bars, setBars]               = useState<number[]>(Array(WAVEFORM_BARS).fill(0.1));
  const [isRecording, setIsRecording] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const animFrameRef     = useRef<number>(0);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef     = useRef<number>(0);
  const waveformDataRef  = useRef<number[]>([]);
  const mimeTypeRef      = useRef<string>("");

  /**
   * Rilascia TUTTE le risorse hardware/timer. Idempotente: i null-check fanno sì
   * che chiamarla più volte (es. onstop + unmount) sia un no-op sicuro. NON tocca
   * mediaRecorderRef (gestito da stopRecorderSafe).
   */
  const teardown = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    // Hard-stop di ogni MediaStreamTrack → spegne il microfono (indicatore OS off).
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  /**
   * Ferma il MediaRecorder al massimo UNA volta per sessione. La guardia
   * `state !== "inactive"` garantisce l'idempotenza: dopo stop() lo stato passa
   * sincronicamente a "inactive", quindi una seconda chiamata (es. unmount dopo
   * finish/cancel) è un no-op e non lancia InvalidStateError.
   * @returns true se ha effettivamente fermato il recorder in questa chiamata.
   */
  const stopRecorderSafe = useCallback((): boolean => {
    const r = mediaRecorderRef.current;
    if (r && r.state !== "inactive") {
      try { r.stop(); } catch { /* già inattivo — ignora */ }
      return true;
    }
    return false;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Reset stato per una nuova registrazione
      chunksRef.current = [];
      waveformDataRef.current = [];
      setBars(Array(WAVEFORM_BARS).fill(0.1));
      setDurationMs(0);

      // Web Audio API per waveform
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
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

      mimeTypeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(100); // chunk ogni 100ms
      mediaRecorderRef.current = recorder;

      startTimeRef.current = Date.now();
      setIsRecording(true);

      // Timer durata
      timerRef.current = setInterval(() => {
        setDurationMs(Date.now() - startTimeRef.current);
      }, 100);

      // Animazione waveform
      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      const animate = () => {
        analyser.getByteFrequencyData(dataArr);
        const avg = Array.from(dataArr).reduce((s, v) => s + v, 0) / dataArr.length;
        const norm = Math.min(avg / 128, 1);
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
      return true;
    } catch {
      teardown();
      setIsRecording(false);
      return false;
    }
  }, [teardown]);

  const finish = useCallback((): Promise<VoiceBlob | null> => {
    return new Promise((resolve) => {
      cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const recorder = mediaRecorderRef.current;
      // Nessun recorder o già fermato (es. cancel/unmount ha già chiuso la sessione):
      // niente blob da produrre. teardown() è idempotente.
      if (!recorder || recorder.state === "inactive") { teardown(); setIsRecording(false); resolve(null); return; }

      const finalDuration = Date.now() - startTimeRef.current;

      // Campiona 50 valori dalla waveform raccolta
      const raw = waveformDataRef.current;
      const waveform: number[] = [];
      for (let i = 0; i < 50; i++) {
        const idx = Math.floor((i / 50) * raw.length);
        waveform.push(raw[idx] ?? 0.1);
      }

      recorder.onstop = () => {
        // Su alcuni iOS Safari, recorder.mimeType restituisce "" dopo la stop.
        const effectiveMime = recorder.mimeType || mimeTypeRef.current || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: effectiveMime });
        mediaRecorderRef.current = null;
        teardown();
        setIsRecording(false);

        if (effectiveMime.includes("webm")) {
          // Android Chrome registra solo WebM/Opus, non riproducibile su iOS Safari.
          // Convertiamo in WAV PCM (universale) prima dell'invio/cifratura.
          webmToWav(blob)
            .then((wavBlob) => {
              resolve({ blob: wavBlob, mimeType: "audio/wav", durationMs: finalDuration, waveform });
            })
            .catch(() => {
              resolve({ blob, mimeType: effectiveMime, durationMs: finalDuration, waveform });
            });
        } else {
          resolve({ blob, mimeType: effectiveMime, durationMs: finalDuration, waveform });
        }
      };
      stopRecorderSafe(); // stop idempotente → innesca onstop una volta sola
    });
  }, [teardown, stopRecorderSafe]);

  const cancel = useCallback(() => {
    // Percorso "scarta": rimuovi onstop così lo stop NON produce un blob, poi
    // hard-stop idempotente di recorder + tracce. Nessun doppio stop.
    const r = mediaRecorderRef.current;
    if (r) r.onstop = null;
    stopRecorderSafe();
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    teardown();
    setIsRecording(false);
  }, [teardown, stopRecorderSafe]);

  // ── Cleanup GARANTITO su unmount ────────────────────────────────────────────
  // Se il componente si smonta mentre registra (cambio vista, navigazione,
  // unmount condizionale) il microfono DEVE spegnersi. Rimuoviamo onstop (niente
  // blob orfano), fermiamo il recorder e tutte le tracce. Idempotente rispetto a
  // un eventuale finish()/cancel() già avvenuto (state="inactive" → no-op).
  useEffect(() => {
    return () => {
      const r = mediaRecorderRef.current;
      if (r) r.onstop = null;
      stopRecorderSafe();
      mediaRecorderRef.current = null;
      teardown();
    };
    // teardown e stopRecorderSafe sono stabili (useCallback [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { start, finish, cancel, durationMs, bars, isRecording };
}
