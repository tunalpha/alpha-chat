/**
 * SignalReinstallBanner
 *
 * Banner informativo mostrato una sola volta dopo il login su una PWA reinstallata.
 *
 * Contesto: quando l'utente reinstalla la PWA, iOS elimina IndexedDB, con essa
 * le sessioni Double Ratchet. I messaggi precedenti diventano indecifrabili per
 * design del protocollo Signal (Forward Secrecy). L'Identity Key viene ripristinata
 * correttamente dal blob cifrato sul server, quindi i NUOVI messaggi funzionano.
 *
 * Il flag localStorage "signal:reinstall_warning" viene impostato da AuthContext.tsx
 * durante il login quando rileva IDB vuota + IK recuperata dal server.
 */

import { useState, useEffect } from "react";

const FLAG_KEY = "signal:reinstall_warning";

export default function SignalReinstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(FLAG_KEY) === "1") {
      setVisible(true);
      localStorage.removeItem(FLAG_KEY);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="signal-reinstall-banner" role="status" aria-live="polite">
      <span className="signal-reinstall-banner__icon">🔒</span>
      <p className="signal-reinstall-banner__text">
        Per motivi di sicurezza, i messaggi precedenti alla reinstallazione
        dell&apos;app non sono più decifrabili.{" "}
        <strong>I nuovi messaggi funzionano normalmente.</strong>
      </p>
      <button
        className="signal-reinstall-banner__close"
        onClick={() => setVisible(false)}
        aria-label="Chiudi avviso"
      >
        ✕
      </button>
    </div>
  );
}
