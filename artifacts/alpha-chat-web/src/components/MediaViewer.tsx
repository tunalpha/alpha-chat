/**
 * MediaViewer — visualizzatore full-screen per immagini e video.
 * Si chiude con tap/click o tasto Escape.
 */

import { useEffect } from "react";

interface Props {
  blobUrl: string;
  type: "image" | "video";
  onClose: () => void;
}

export default function MediaViewer({ blobUrl, type, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="media-viewer-backdrop" onClick={onClose}>
      <button className="media-viewer-close" onClick={onClose} aria-label="Chiudi">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="22" height="22">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {type === "image" ? (
        <img
          src={blobUrl}
          className="media-viewer-img"
          alt="Immagine"
          onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}
