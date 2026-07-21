/**
 * LocationMessage — bolla chat per posizioni condivise (E2E cifrate).
 * Mostra miniatura OSM + coordinate. Tap → LocationViewer.
 */
import { useState } from "react";
import type { LocationMeta } from "../lib/api";

interface Props {
  meta:   LocationMeta;
  isMine: boolean;
  onView: (meta: LocationMeta) => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Coordinate tile OSM (Web Mercator) */
function getTile(lat: number, lon: number, z: number) {
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const lr = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n);
  return { x, y, z };
}

function staticTileUrl(lat: number, lon: number, zoom = 15) {
  const { x, y, z } = getTile(lat, lon, zoom);
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function fmtAccuracy(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LocationMessage({ meta, onView }: Props) {
  const [imgErr, setImgErr] = useState(false);
  const tileUrl = staticTileUrl(meta.latitude, meta.longitude);

  return (
    <div
      className="loc-bubble"
      role="button"
      tabIndex={0}
      onClick={() => onView(meta)}
      onKeyDown={(e) => e.key === "Enter" && onView(meta)}
      title="Tocca per aprire la mappa"
    >
      {/* Miniatura mappa */}
      <div className="loc-thumb">
        {!imgErr ? (
          <img
            src={tileUrl}
            alt="Mappa"
            className="loc-tile-img"
            onError={() => setImgErr(true)}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="loc-tile-fallback">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40" opacity="0.4">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              <line x1="8" y1="2" x2="8" y2="18"/>
              <line x1="16" y1="6" x2="16" y2="22"/>
            </svg>
          </div>
        )}
        {/* Pin overlay */}
        <div className="loc-pin" aria-hidden>📍</div>
      </div>

      {/* Info */}
      <div className="loc-info">
        <span className="loc-title">Posizione condivisa</span>
        <span className="loc-coords">
          {meta.latitude.toFixed(5)}° N,&nbsp;{meta.longitude.toFixed(5)}° E
        </span>
        {meta.accuracy > 0 && (
          <span className="loc-accuracy">Precisione: {fmtAccuracy(meta.accuracy)}</span>
        )}
      </div>
    </div>
  );
}
