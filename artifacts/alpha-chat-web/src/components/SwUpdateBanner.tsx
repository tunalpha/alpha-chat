/**
 * SwUpdateBanner — appare quando il Service Worker è stato aggiornato.
 *
 * Flusso:
 *   1. sw.js: install → skipWaiting() → il nuovo SW si attiva subito
 *   2. sw.js: activate → clients.claim() → prende controllo della pagina
 *   3. navigator.serviceWorker emette "controllerchange"
 *   4. pushManager chiama window.dispatchEvent("pwa:update-ready")
 *   5. Questo banner appare con il pulsante "Aggiorna"
 *   6. Al click → window.location.reload() carica tutti i nuovi asset
 */
import { useState, useEffect } from "react";

export default function SwUpdateBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onUpdate = () => setVisible(true);
    window.addEventListener("pwa:update-ready", onUpdate);
    return () => window.removeEventListener("pwa:update-ready", onUpdate);
  }, []);

  if (!visible) return null;

  return (
    <div className="sw-update-banner" role="alert" aria-live="assertive">
      <span className="sw-update-icon">🔄</span>
      <span className="sw-update-text">Nuova versione disponibile</span>
      <button
        className="sw-update-btn"
        onClick={() => window.location.reload()}
      >
        Aggiorna
      </button>
    </div>
  );
}
