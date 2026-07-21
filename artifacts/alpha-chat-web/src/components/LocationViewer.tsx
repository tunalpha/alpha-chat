/**
 * LocationViewer — viewer full-screen per posizioni condivise.
 *   • Mappa interattiva OSM (iframe, no API key)
 *   • Coordinate + precisione + timestamp
 *   • "Apri in Mappe" → Apple Maps / Google Maps / OSM
 *   • "Copia coordinate"
 */
import { useEffect, useCallback } from "react";
import type { LocationMeta } from "../lib/api";

interface Props {
  meta:    LocationMeta;
  onClose: () => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getMapsUrl(lat: number, lon: number): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua))
    return `https://maps.apple.com/?ll=${lat},${lon}&q=Posizione`;
  if (/Android/i.test(ua))
    return `https://maps.google.com/?q=${lat},${lon}`;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
}

function fmtAccuracy(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("it-IT", {
    day:    "numeric",
    month:  "long",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LocationViewer({ meta, onClose }: Props) {
  const { latitude: lat, longitude: lon, accuracy, timestamp } = meta;

  // Escape key
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  // bbox centrato ±0.005° (~500 m) attorno al punto
  const iframeSrc =
    `https://www.openstreetmap.org/export/embed.html` +
    `?bbox=${lon - 0.006},${lat - 0.006},${lon + 0.006},${lat + 0.006}` +
    `&layer=mapnik&marker=${lat},${lon}`;

  const handleCopy = useCallback(() => {
    const text = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    void navigator.clipboard.writeText(text).catch(() => {});
  }, [lat, lon]);

  const handleOpenMaps = useCallback(() => {
    window.open(getMapsUrl(lat, lon), "_blank", "noopener,noreferrer");
  }, [lat, lon]);

  return (
    <div className="loc-viewer-backdrop" onClick={onClose}>

      {/* ── Barra superiore ────────────────────────────────────────────── */}
      <div className="mv-top-bar" onClick={(e) => e.stopPropagation()}>
        <span className="mv-filename">Posizione condivisa</span>
        <button
          className="media-viewer-close mv-close-inline"
          onClick={onClose}
          aria-label="Chiudi"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* ── Mappa interattiva OSM ───────────────────────────────────────── */}
      <iframe
        src={iframeSrc}
        className="loc-viewer-map"
        title="Mappa posizione"
        referrerPolicy="no-referrer"
        loading="lazy"
        onClick={(e) => e.stopPropagation()}
      />

      {/* ── Barra inferiore: info + azioni ─────────────────────────────── */}
      <div className="loc-viewer-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="loc-viewer-info">
          <span className="loc-viewer-coord">
            {lat.toFixed(6)}° N,&nbsp;{lon.toFixed(6)}° E
          </span>
          <span className="loc-viewer-sub">
            {accuracy > 0 && <>Precisione {fmtAccuracy(accuracy)} · </>}
            {fmtDate(timestamp)}
          </span>
        </div>
        <div className="mv-bottom-bar" style={{ position: "static", background: "none", padding: "8px 0 0" }}>
          <button className="mv-action-btn" onClick={handleOpenMaps} aria-label="Apri in Mappe">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <polygon points="3 11 22 2 13 21 11 13 3 11"/>
            </svg>
            <span>Apri in Mappe</span>
          </button>
          <button className="mv-action-btn" onClick={handleCopy} aria-label="Copia coordinate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span>Copia</span>
          </button>
        </div>
      </div>
    </div>
  );
}
