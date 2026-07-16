/**
 * notifSound.ts — Suono di notifica condiviso per tutta l'app.
 *
 * Strategia iOS Safari / Chrome iOS:
 * 1. L'elemento Audio viene creato e precaricato al caricamento del modulo.
 * 2. Al PRIMO gesto utente: `unlockNotifAudio()` esegue play() muto →
 *    questo sblocca il subsistema audio iOS per la sessione.
 * 3. Ogni notifica successiva: `playNotifSound()` → currentTime=0; await play().
 * 4. Errori play() vengono loggati per intero (non silenziosamente ignorati).
 */

// WAV 880Hz 120ms — 8-bit mono 8kHz generato programmaticamente
const NOTIF_SRC =
  "data:audio/wav;base64,UklGRuQDAABXQVZFZm10IBAAAAABAAEAQB" +
  "8AAEAfAAABAAgAZGF0YcADAACA0fzvrlgVAil4yvrxtWAaAiRwwvbzvGgg" +
  "AyBou/L1wnAmBRxhtO72x3gsBxlarOr2zX8zCRZTpeX20oc5DBRNneD21" +
  "o5ADxJHltr12pVHExBBjtT03pxOFw88h87y4aNVGw83gMjv46lcIA8yeML" +
  "t5a9kJRAucbvq57VrKhEqa7Xm6LpyLxInZK7i6cB5NRQkXqfe6cSAOxYi" +
  "WKHa6ciGQRkgUprV6cyNRxweTZPQ6NCTTR8dSIzL5tOZVCMcQ4bF5dWfW" +
  "iccP4DA4tikYSscO3m64NmqZy8dOHO03duvbTQeNG2u2tyzczkfMmio1ty" +
  "4ej4hL2Ki0ty8f0MjLV2czty/hUkmLFiWytvDi04oKlORxtrFkFQrKk+L" +
  "wdnIllkvKUuFvNfKm18yKUh/t9XMoGU2KUR6stPNpGo6KkF1rdDOqHA+K" +
  "z9wqM3PrHVDLTxro8rPsHpHLjpmnsfPs4BMMDlimMPPtoVRMjhek7/OuY" +
  "lVNTdajrvNu45aODZWibfMvZJfOzZThLPKv5dkPjZQgK/IwJtpQTdNe6r" +
  "GwZ5tRTdLdqbEwqJySThJcqLBwqV3TDpHbp2+w6h7UDtGapm7wqt/VD1E" +
  "Z5S4wq2EWD9EY5C1wa+IXUJDYIyxwLGMYURDXYeuv7OPZUdDW4OqvbST" +
  "aUpDWICmu7WWbU1EVnyjubWZcVBFVXift7acdVNGU3WbtbaeeFZHUnGXsr" +
  "agfFlJUW6UsLWif11KUGyQrbWkg2BMUGmNqrSmhmROT2eJp7OniWdQUGWG" +
  "pLGojGpTUGODobCpjm5VUGF/nq6pkXFYUV99m6ypk3RaUl96mKqplXdd" +
  "U113laipl3pgVF11kqapmH1jVlxzj6Samn9lV1xxjKKnm4JoWVxviZ+mn" +
  "IRrW1xth52lnYdtXVxshJqknYlwX11qgpijnYpzYV1pf5WhnYx1Y15pfZ" +
  "OgnY13ZV9oe5GenY96Z2Boeo6cnZB8amJneIyanJF+bGNnd4qYm5F/bmRn" +
  "dYiWmpKBcGZodIaUmZKDcmhoc4STmJKEdGlpc4KRl5KFdmtqcoGPlpKGd" +
  "21qcoCNlJKHeW5rcn6Lk5GIe3Bscn2KkZGIfHJucnyIkJCJfXNvcnuGjo" +
  "+Jf3VwcnuFjY6Jf3Zxc3qEi42JgHhzdHqDioyJgXl0dXqCiIuIgnp1dX" +
  "qBh4qIgnt3dnqAhoiHgnx4d3qAhIeGgn15eXt/g4aFgn57ent/goWEgn9" +
  "8e3x/goODgn99fH1/gYKCgX9+fX5/gIGBgH9/fn9/gICAgIA=";

// ── 1. Precarica al caricamento del modulo ────────────────────────────────────
const _audio = new Audio(NOTIF_SRC);
_audio.preload = "auto";
_audio.load();

let _unlocked = false;

// ── 2. Unlock — chiamare sincrono nel primo gesture handler ───────────────────
export async function unlockNotifAudio(): Promise<void> {
  if (_unlocked) return;
  _unlocked = true;                 // evita doppia chiamata

  _audio.volume = 0;                // muto per l'unlock
  try {
    await _audio.play();
  } catch (err) {
    console.warn("[notifSound] unlock play() rejected:", err);
    return;
  }
  _audio.pause();
  _audio.currentTime = 0;
  _audio.volume = 1;
  console.info("[notifSound] audio unlocked ✓");
}

// ── 3. Riproduzione notifica ──────────────────────────────────────────────────
export async function playNotifSound(): Promise<void> {
  _audio.currentTime = 0;
  _audio.volume = 1;
  try {
    await _audio.play();
  } catch (err) {
    console.error("[notifSound] play() rejected:", err);
  }
}

// ── 4. Setup unlock automatico al primo gesto — importare nell'app entry ──────
let _listenerAttached = false;

export function attachAudioUnlockListener(): void {
  if (_listenerAttached) return;
  _listenerAttached = true;

  const events = ["click", "touchstart", "keydown"] as const;

  function onFirstGesture() {
    void unlockNotifAudio();
    events.forEach((e) => document.removeEventListener(e, onFirstGesture));
  }

  events.forEach((e) =>
    document.addEventListener(e, onFirstGesture, { passive: true }),
  );
}
