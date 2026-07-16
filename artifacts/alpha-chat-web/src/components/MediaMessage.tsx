/**
 * MediaMessage — bubble per foto, video e documenti.
 * Audio (vocali) viene gestito da VoiceMessage.tsx separatamente.
 *
 * Fase 3: se il meta contiene `e2e: true` con `key` e `iv`,
 * il blob è cifrato AES-256-GCM → viene decifrato localmente.
 */

import { useState, useEffect, useRef } from "react";
import { apiFetchMediaBlob, apiFetchAndDecryptMediaBlob } from "../lib/api";
import type { MediaMeta } from "../lib/api";

type NonVoiceMedia = Extract<MediaMeta, { type: "image" | "video" | "document" }>;

interface Props {
  meta: NonVoiceMedia;
  isMine: boolean;
  onView: (blobUrl: string, type: "image" | "video") => void;
}

// ── Icona documento ────────────────────────────────────────────────────────────
function DocIcon({ mime }: { mime: string }) {
  const isPdf = mime.includes("pdf");
  const isDoc = mime.includes("word") || mime.includes("document");
  const isXls = mime.includes("sheet") || mime.includes("excel");

  if (isPdf) return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <text x="6" y="19" fontSize="5" strokeWidth="0" fill="currentColor" fontFamily="sans-serif">
        {isPdf ? "PDF" : isDoc ? "DOC" : isXls ? "XLS" : "FILE"}
      </text>
    </svg>
  );

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaMessage({ meta, isMine, onView }: Props) {
  const [blobUrl, setBlobUrl]   = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const fetchedRef              = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // Fase 3: se il media è E2E cifrato, decifra localmente
    const fetchPromise = (meta.e2e && meta.key && meta.iv)
      ? apiFetchAndDecryptMediaBlob(meta.media_id, meta.key, meta.iv, meta.mime_type)
      : apiFetchMediaBlob(meta.media_id);

    fetchPromise
      .then((url) => { setBlobUrl(url); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.media_id]);

  // ── Immagine ────────────────────────────────────────────────────────────────
  if (meta.type === "image") {
    return (
      <div
        className={`media-bubble-img ${loading ? "loading" : ""}`}
        onClick={() => blobUrl && onView(blobUrl, "image")}
        title="Tocca per ingrandire"
      >
        {loading && <div className="media-skeleton" />}
        {error   && <div className="media-error">⚠ Immagine non disponibile</div>}
        {blobUrl && (
          <img
            src={blobUrl}
            alt={meta.filename || "Immagine"}
            className="media-img-preview"
            onLoad={() => setLoading(false)}
          />
        )}
        {meta.filename && !loading && (
          <div className="media-filename">{meta.filename}</div>
        )}
      </div>
    );
  }

  // ── Video ───────────────────────────────────────────────────────────────────
  if (meta.type === "video") {
    return (
      <div
        className={`media-bubble-video ${loading ? "loading" : ""}`}
        onClick={() => blobUrl && onView(blobUrl, "video")}
        title="Tocca per riprodurre"
      >
        {loading && <div className="media-skeleton" />}
        {error   && <div className="media-error">⚠ Video non disponibile</div>}
        {blobUrl && (
          <>
            <video
              src={blobUrl}
              className="media-video-preview"
              preload="metadata"
              playsInline
              muted
            />
            <div className="media-play-overlay">
              <svg viewBox="0 0 24 24" fill="currentColor" width="36" height="36">
                <circle cx="12" cy="12" r="12" fill="rgba(0,0,0,0.55)"/>
                <polygon points="10,8 18,12 10,16" fill="white"/>
              </svg>
            </div>
          </>
        )}
        {meta.filename && !loading && (
          <div className="media-filename">{meta.filename}</div>
        )}
      </div>
    );
  }

  // ── Documento ──────────────────────────────────────────────────────────────
  return (
    <div className="media-bubble-doc">
      <div className="media-doc-icon">
        <DocIcon mime={meta.mime_type} />
      </div>
      <div className="media-doc-info">
        <span className="media-doc-name">{meta.filename || "Documento"}</span>
        <span className="media-doc-size">{meta.size ? formatSize(meta.size) : meta.mime_type}</span>
      </div>
      {blobUrl && (
        <a
          href={blobUrl}
          download={meta.filename || "file"}
          className="media-doc-download"
          onClick={(e) => e.stopPropagation()}
          title="Scarica"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>
      )}
      {loading && <div className="media-doc-loading">…</div>}
      {error   && <div className="media-doc-error">⚠</div>}
    </div>
  );
}
