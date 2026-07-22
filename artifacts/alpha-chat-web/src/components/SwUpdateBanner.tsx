/**
 * SwUpdateBanner — appare quando il Service Worker è stato aggiornato.
 *
 * Flusso:
 *   1. sw.js: install → skipWaiting() → il nuovo SW si attiva subito
 *   2. sw.js: activate → clients.claim() → prende controllo della pagina
 *   3. navigator.serviceWorker emette "controllerchange"
 *   4. pushManager.ts (livello di modulo) intercetta e dispatch "pwa:update-ready"
 *   5. Questo banner appare con il pulsante "Aggiorna"
 *   6. Al click → window.location.reload() carica tutti i nuovi asset
 *
 * Gestione mount tardivo:
 *   Se il componente viene montato DOPO che "pwa:update-ready" è già stato
 *   emesso (es. l'aggiornamento è avvenuto durante il caricamento iniziale),
 *   isSwUpdateReady() restituisce true → il banner appare immediatamente.
 */
import { useState, useEffect } from "react";
import { isSwUpdateReady } from "../lib/pushManager";

export default function SwUpdateBanner() {
  // Inizializzazione lazy: controlla se l'aggiornamento è già avvenuto
  // PRIMA che questo componente fosse montato.
  const [visible, setVisible] = useState(() => isSwUpdateReady());

  useEffect(() => {
    // Gestisce aggiornamenti che avvengono DOPO il mount del componente
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
