/**
 * useSecurePhraseDisplay — Protezione anti-screenshot / anti-screen-share
 *
 * Nasconde il contenuto sensibile (recovery phrase) quando:
 *   1. L'app perde il focus (blur) — cattura il gesto iOS per aprire
 *      il centro di controllo prima di uno screenshot
 *   2. document.hidden → true (visibilitychange) — cattura switch app,
 *      lock screen, notifiche
 *   3. navigator.mediaDevices.getDisplayMedia() viene chiamato — cattura
 *      l'avvio di una condivisione schermo dal browser
 *
 * L'overlay NON si chiude automaticamente quando il focus torna:
 * richiede un'azione esplicita dell'utente (tap "Rivela").
 * Questo impedisce che un breve alt-tab nasconda e poi riveli la frase
 * automaticamente durante una registrazione.
 *
 * Limitazioni note:
 *   - Strumenti di registrazione esterni (OBS, QuickTime sul Mac collegato)
 *     non sono rilevabili via API web. Questo hook mitiga i casi più comuni.
 *   - Su iOS Safari PWA, lo screenshot Hardware Key non emette `blur`,
 *     ma l'apertura del Control Center sì.
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface SecurePhraseState {
  /** true = mostrare l'overlay di protezione (nasconde la frase) */
  isProtected:    boolean;
  /** true = rilevata condivisione schermo attiva */
  isScreenShare:  boolean;
  /** Chiamato dall'utente per rivelare di nuovo la frase */
  reveal:         () => void;
}

export function useSecurePhraseDisplay(): SecurePhraseState {
  // Overlay visibile per default — l'utente deve scegliere attivamente di vedere
  const [isProtected,   setIsProtected]   = useState(false);
  const [isScreenShare, setIsScreenShare] = useState(false);

  // Ref per la funzione originale di getDisplayMedia (per il ripristino)
  const originalGetDisplayMediaRef = useRef<typeof navigator.mediaDevices.getDisplayMedia | null>(null);

  const protect       = useCallback(() => setIsProtected(true),  []);
  const reveal        = useCallback(() => setIsProtected(false), []);
  const endScreenShare = useCallback(() => {
    setIsScreenShare(false);
    // Non rivela automaticamente — richiede tap utente
  }, []);

  useEffect(() => {
    // ── 1. Visibility change (switch app, lock screen, notification pull-down) ──
    const onVisibilityChange = () => {
      if (document.hidden) protect();
      // Non riviela al ritorno — l'utente deve toccare "Rivela"
    };

    // ── 2. Window blur (iOS Control Center, alt-tab, cambio app) ──────────────
    const onBlur  = () => protect();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);

    // ── 3. Intercetta getDisplayMedia per rilevare screen sharing ─────────────
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function") {
      originalGetDisplayMediaRef.current = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

      navigator.mediaDevices.getDisplayMedia = async function (
        ...args: Parameters<typeof navigator.mediaDevices.getDisplayMedia>
      ) {
        // Proteggi immediatamente prima che l'anteprima di condivisione mostri la frase
        protect();
        setIsScreenShare(true);

        try {
          const stream = await originalGetDisplayMediaRef.current!(...args);
          // Monitora la fine della condivisione
          stream.getTracks().forEach(track => {
            track.addEventListener("ended", endScreenShare);
          });
          return stream;
        } catch (err) {
          // L'utente ha rifiutato — rimuovi il flag screen share
          setIsScreenShare(false);
          throw err;
        }
      };
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);

      // Ripristina getDisplayMedia originale
      if (originalGetDisplayMediaRef.current && navigator.mediaDevices) {
        navigator.mediaDevices.getDisplayMedia = originalGetDisplayMediaRef.current;
        originalGetDisplayMediaRef.current = null;
      }
    };
  }, [protect, endScreenShare]);

  return { isProtected, isScreenShare, reveal };
}
