/**
 * MediaViewer — visualizzatore full-screen per immagini e video.
 * Funzionalità:
 *   - Chiusura con tap sul backdrop o tasto Escape
 *   - Pulsante Salva/Condividi: usa navigator.share (iOS Share Sheet → "Salva in Foto")
 *   - Pulsante Scarica: fallback via <a download> per browser desktop / PDF
 */

import { useEffect, useCallback } from "react";

interface Props {
  blobUrl:   string;
  type:      "image" | "video";
  filename?: string;
  mimeType?: string;
  onClose:   () => void;
}

export default function MediaViewer({ blobUrl, type, filename, mimeType, onClose }: Props) {
  const safeName = filename || (type === "image" ? "immagine.jpg" : "video.mp4");

  // Chiude con Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** iOS Share Sheet (include "Salva in Foto/Video") — fallback a <a download> */
  const handleShare = useCallback(async () => {
    try {
      if (typeof navigator.share === "function") {
        const blob = await fetch(blobUrl).then((r) => r.blob());
        const file = new File([blob], safeName, { type: mimeType || blob.type });
        const data: ShareData = { files: [file], title: safeName };
        if (typeof navigator.canShare === "function" && navigator.canShare(data)) {
          await navigator.share(data);
          return;
        }
        // navigator.share senza files (fallback)
        await navigator.share({ title: safeName, url: blobUrl });
        return;
      }
    } catch {
      // annullato dall'utente o non supportato
    }
    // Fallback download
    triggerDownload();
  }, [blobUrl, safeName, mimeType]);

  /** Download diretto — funziona per PDF/documenti e su browser desktop */
  const triggerDownload = useCallback(() => {
    const a = document.createElement("a");
    a.href  = blobUrl;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [blobUrl, safeName]);

  return (
    <div className="media-viewer-backdrop" onClick={onClose}>
      {/* ── Barra superiore ──────────────────────────────────────────────── */}
      <div className="mv-top-bar" onClick={(e) => e.stopPropagation()}>
        <span className="mv-filename" title={safeName}>{safeName}</span>
        <button className="media-viewer-close mv-close-inline" onClick={onClose} aria-label="Chiudi">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* ── Contenuto ────────────────────────────────────────────────────── */}
      {type === "image" ? (
        <img
          src={blobUrl}
          className="media-viewer-img"
          alt={safeName}
        />
      ) : (
        <video
          src={blobUrl}
          className="media-viewer-video"
          controls
          autoPlay
          playsInline
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {/* ── Barra inferiore: Share + Download ───────────────────────────── */}
      <div className="mv-bottom-bar" onClick={(e) => e.stopPropagation()}>
        {/* Condividi / Salva in Foto (iOS Share Sheet) */}
        <button className="mv-action-btn" onClick={handleShare} aria-label="Condividi / Salva">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
          <span>{typeof navigator.share === "function" ? "Condividi" : "Scarica"}</span>
        </button>

        {/* Download diretto (sempre visibile come alternativa) */}
        <button className="mv-action-btn" onClick={triggerDownload} aria-label="Scarica">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Scarica</span>
        </button>
      </div>
    </div>
  );
}
