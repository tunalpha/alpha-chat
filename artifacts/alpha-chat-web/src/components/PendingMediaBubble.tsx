/**
 * PendingMediaBubble — mostra il messaggio media/vocale nella chat
 * IMMEDIATAMENTE dopo il tap su invia, con stati di avanzamento e retry.
 *
 * Sequenza tipica:
 *   preparing  → "Preparazione..."
 *   encrypting → "🔐 Cifratura..."
 *   uploading  → "⬆ Caricamento 35%" + barra progresso
 *   sending    → "📤 Invio..."
 *   failed     → "⚠ Invio non riuscito – Tocca per riprovare"
 */

export type MediaUploadPhase =
  | "preparing"
  | "encrypting"
  | "uploading"
  | "sending"
  | "failed";

export interface MediaUploadState {
  phase:      MediaUploadPhase;
  progress?:  number;          // 0–100 durante 'uploading'
  localUrl?:  string;          // objectURL per anteprima locale
  filename?:  string;
  mimeType:   string;
  mediaType:  "image" | "video" | "voice" | "document";
  size?:      number;
  durationMs?: number;         // voice
  waveform?:  number[];        // voice
  retryFn?:   () => void;      // disponibile in 'failed'
}

interface Props {
  state: MediaUploadState;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function phaseLabel(phase: MediaUploadPhase, progress?: number): string {
  switch (phase) {
    case "preparing":  return "Preparazione...";
    case "encrypting": return "🔐 Cifratura...";
    case "uploading":  return progress != null ? `⬆ Caricamento ${progress}%` : "⬆ Caricamento...";
    case "sending":    return "📤 Invio...";
    case "failed":     return "⚠ Invio non riuscito";
  }
}

// Waveform placeholder: 30 barre calcolate con seno per sembrare plausibili
const WAVEFORM_PLACEHOLDER = Array.from({ length: 30 }, (_, i) =>
  (Math.sin(i * 0.7) * 0.4 + 0.5) * 0.8 + 0.2,
);

// ── Progress bar shared ───────────────────────────────────────────────────────

function ProgressBar({ progress, slim }: { progress: number; slim?: boolean }) {
  return (
    <div className={`pmb-progress-wrap${slim ? " pmb-progress-wrap-sm" : ""}`}>
      <div className="pmb-progress-bar" style={{ width: `${progress}%` }} />
    </div>
  );
}

// ── Phase row shared ──────────────────────────────────────────────────────────

function PhaseRow({
  phase, progress, retryFn, white,
}: {
  phase: MediaUploadPhase;
  progress?: number;
  retryFn?: () => void;
  white?: boolean;
}) {
  const isFailed = phase === "failed";
  return (
    <div className="pmb-phase-row">
      {!isFailed && <div className={`pmb-spinner${white ? " pmb-spinner-white" : ""}`} />}
      <span className={white ? "pmb-label-white" : "pmb-label"}>
        {phaseLabel(phase, progress)}
      </span>
      {isFailed && retryFn && (
        <button
          className={`pmb-retry-btn${white ? " pmb-retry-btn-white" : ""}`}
          onClick={retryFn}
          aria-label="Riprova invio"
        >
          ↺ Riprova
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PendingMediaBubble({ state }: Props) {
  const { phase, progress, localUrl, filename, mimeType, mediaType, size, durationMs, waveform, retryFn } = state;
  const isFailed = phase === "failed";

  // ── Vocale ───────────────────────────────────────────────────────────────
  if (mediaType === "voice") {
    const bars = (waveform && waveform.length > 0 ? waveform : WAVEFORM_PLACEHOLDER).slice(0, 40);
    return (
      <div className={`pmb-voice${isFailed ? " pmb-failed" : ""}`}>
        <div className="pmb-voice-row">
          {/* Play disabilitato durante il caricamento */}
          <div className="pmb-voice-play" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <circle cx="12" cy="12" r="12" fill="rgba(255,255,255,0.12)" />
              <polygon points="10,8 17,12 10,16" fill="white" opacity="0.5" />
            </svg>
          </div>
          {/* Waveform */}
          <div className="pmb-waveform" aria-hidden>
            {bars.map((h, i) => (
              <div
                key={i}
                className="pmb-waveform-bar"
                style={{ height: `${Math.max(3, Math.round(h * 28))}px` }}
              />
            ))}
          </div>
          {durationMs != null && (
            <span className="pmb-voice-dur">{formatDuration(durationMs)}</span>
          )}
        </div>
        <PhaseRow phase={phase} progress={progress} retryFn={retryFn} />
        {phase === "uploading" && progress != null && (
          <ProgressBar progress={progress} />
        )}
      </div>
    );
  }

  // ── Immagine ──────────────────────────────────────────────────────────────
  if (mediaType === "image") {
    return (
      <div className={`pmb-img${isFailed ? " pmb-failed" : ""}`}>
        {localUrl
          ? <img src={localUrl} alt={filename || "Immagine"} className="pmb-img-preview" />
          : <div className="media-skeleton" style={{ width: 200, height: 140 }} />
        }
        <div className="pmb-img-overlay">
          <PhaseRow phase={phase} progress={progress} retryFn={retryFn} white />
          {phase === "uploading" && progress != null && (
            <ProgressBar progress={progress} slim />
          )}
        </div>
        {filename && <div className="media-filename">{filename}</div>}
      </div>
    );
  }

  // ── Video ─────────────────────────────────────────────────────────────────
  if (mediaType === "video") {
    return (
      <div className={`pmb-img pmb-video${isFailed ? " pmb-failed" : ""}`}>
        {localUrl ? (
          <video src={localUrl} className="pmb-img-preview" preload="metadata" playsInline muted />
        ) : (
          <div className="media-skeleton" style={{ width: 200, height: 140 }} />
        )}
        <div className="pmb-img-overlay">
          {/* icona videocamera */}
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" width="28" height="28" style={{ opacity: 0.75 }}>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
          <PhaseRow phase={phase} progress={progress} retryFn={retryFn} white />
          {phase === "uploading" && progress != null && (
            <ProgressBar progress={progress} slim />
          )}
        </div>
        {filename && <div className="media-filename">{filename}</div>}
      </div>
    );
  }

  // ── Documento ─────────────────────────────────────────────────────────────
  return (
    <div className={`pmb-doc${isFailed ? " pmb-failed" : ""}`}>
      <div className="pmb-doc-icon" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <div className="pmb-doc-info">
        <span className="pmb-doc-name">{filename || "Documento"}</span>
        {size != null && <span className="pmb-doc-size">{formatSize(size)}</span>}
        <PhaseRow phase={phase} progress={progress} retryFn={retryFn} />
        {phase === "uploading" && progress != null && (
          <ProgressBar progress={progress} />
        )}
      </div>
    </div>
  );
}
