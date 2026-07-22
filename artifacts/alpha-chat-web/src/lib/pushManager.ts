/**
 * PushManager — gestione Web Push lato frontend.
 *
 * Responsabilità:
 *   - Verifica supporto browser (SW + PushManager API)
 *   - Richiesta permesso notifiche
 *   - Registrazione Service Worker (/sw.js)
 *   - Subscribe / Unsubscribe
 *   - Invio subscription al backend
 *   - Refresh subscription in caso di pushsubscriptionchange
 *
 * NON tocca:
 *   - ChatPage, handleSend, Signal, WebSocket, AuthContext
 *   - Nessuna logica di messaggistica
 *
 * Compatibilità:
 *   ✅ Chrome Android / Desktop
 *   ✅ Firefox Desktop / Android
 *   ✅ Edge
 *   ⚠️  Safari iOS ≥16.4 — solo da PWA installata (Home Screen)
 *   ❌  Chrome/Firefox iOS — motore WebKit obbligatorio, stessi limiti di Safari
 *   ❌  Safari < 16.4 — nessun supporto push
 */

import { getAccessToken } from "./auth";

const BASE = "/api/v1";

// ── Rilevamento aggiornamento SW — a livello di modulo ────────────────────────
//
// ⚠️  DEVE stare QUI, al livello di modulo, NON dentro initServiceWorker().
//
// Motivo: controllerchange può emettere decine/centinaia di ms PRIMA che
// initServiceWorker() venga chiamata (che dipende da auth?.userId nel
// useEffect di App.tsx). Se il listener venisse attaccato nell'effetto,
// l'evento sarebbe già andato perso → nessun banner.
//
// Attaccandolo al momento della valutazione del modulo (sincrono, prima
// del primo tick), catturiamo QUALSIASI controllerchange emesso nella
// sessione corrente.
//
// Scenari gestiti correttamente:
//   1. Prima installazione       → _hasBeenControlled=false → nessun banner ✓
//   2. Deploy nuova versione     → controllerchange catturato → banner ✓
//   3. Riapertura senza deploy   → nessun controllerchange → nessun banner ✓
//   4. Deploy durante sessione   → banner immediato ✓
//   5. Mount tardivo SwUpdateBanner → isSwUpdateReady() = true → visible=true ✓

let _swUpdateReady = false;
let _hasBeenControlled = false;

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  // Cattura lo stato del controller PRIMA che qualsiasi evento possa emettere
  _hasBeenControlled = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_hasBeenControlled) {
      // Un controller precedente esiste → questo è un vero aggiornamento
      _swUpdateReady = true;
      window.dispatchEvent(new CustomEvent("pwa:update-ready"));
    }
    // Dopo il primo cambio, qualsiasi cambio successivo è un aggiornamento
    _hasBeenControlled = true;
  });
}

/**
 * Ritorna true se il browser ha già rilevato un aggiornamento del SW
 * nella sessione corrente. Usato da SwUpdateBanner per gestire il caso
 * in cui il componente venga montato DOPO l'evento pwa:update-ready.
 */
export function isSwUpdateReady(): boolean {
  return _swUpdateReady;
}

// ── Rilevamento browser / piattaforma ────────────────────────────────────────

function detectPlatform(): { platform: string; browser: string } {
  const ua  = navigator.userAgent;
  const uaL = ua.toLowerCase();

  let platform = "unknown";
  if (/android/i.test(ua))        platform = "android";
  else if (/ipad|iphone|ipod/i.test(ua)) platform = "ios";
  else if (/macintosh/i.test(ua)) platform = "macos";
  else if (/windows/i.test(ua))   platform = "windows";
  else if (/linux/i.test(ua))     platform = "linux";

  let browser = "unknown";
  if (uaL.includes("edg/"))    browser = "edge";
  else if (uaL.includes("opr/") || uaL.includes("opera")) browser = "opera";
  else if (uaL.includes("firefox")) browser = "firefox";
  else if (uaL.includes("chrome"))  browser = "chrome";
  else if (uaL.includes("safari"))  browser = "safari";

  return { platform, browser };
}

// ── Supporto ─────────────────────────────────────────────────────────────────

export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPermissionStatus(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

// ── VAPID public key ──────────────────────────────────────────────────────────

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/push/vapid-public-key`);
    if (!r.ok) return null;
    const body = await r.json() as { data?: { publicKey?: string } };
    return body.data?.publicKey ?? null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = atob(base64);
  // Allocazione esplicita con ArrayBuffer (non SharedArrayBuffer) per soddisfare
  // il tipo di applicationServerKey in PushSubscriptionOptionsInit.
  const buf = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ── Invio subscription al backend ────────────────────────────────────────────

async function sendSubscriptionToServer(sub: PushSubscription): Promise<void> {
  const keys   = sub.toJSON().keys as { p256dh: string; auth: string };
  const { platform, browser } = detectPlatform();
  const token  = getAccessToken() ?? "";

  const resp = await fetch(`${BASE}/push/subscribe`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh:   keys.p256dh,
      auth:     keys.auth,
      platform,
      browser,
      device: navigator.userAgent.slice(0, 200),
    }),
  });
  if (!resp.ok) {
    console.warn(`[push] subscribe: server ha risposto ${resp.status} — subscription non salvata`);
    throw new Error(`[push] subscribe failed: ${resp.status}`);
  }
}

async function deleteSubscriptionFromServer(endpoint: string): Promise<void> {
  const token = getAccessToken() ?? "";
  await fetch(`${BASE}/push/subscribe`, {
    method:  "DELETE",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {}); // best-effort
}

// ── Registrazione SW ──────────────────────────────────────────────────────────

let _swRegistration: ServiceWorkerRegistration | null = null;

async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (_swRegistration) return _swRegistration;
  try {
    // updateViaCache:'none' → il browser verifica SEMPRE se sw.js è cambiato
    // sul server, ignorando la cache HTTP. Senza questa opzione, in produzione
    // il browser può servire il vecchio sw.js cachato e non rilevare mai il deploy.
    _swRegistration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    console.log("[push] Service Worker registrato ✓", _swRegistration.scope);
    return _swRegistration;
  } catch (err) {
    console.warn("[push] SW registration failed:", err);
    return null;
  }
}

// ── API pubblica ─────────────────────────────────────────────────────────────

/**
 * Inizializza il Service Worker al caricamento dell'app.
 * Chiamato una volta sola dopo il login — non richiede permesso.
 */
export async function initServiceWorker(): Promise<void> {
  if (!isPushSupported()) return;
  await getSwRegistration();

  // Gestisce pushsubscriptionchange dal SW
  // NOTA: il rilevamento aggiornamento (controllerchange) è gestito a livello
  // di modulo (vedi in alto) — NON qui — per evitare la race condition con il
  // ciclo di vita React/auth.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if ((e.data as { type?: string })?.type === "push.subscriptionchange") {
      void subscribe().catch(() => {});
    }
  });
}

/**
 * Richiede il permesso all'utente e sottoscrive le push.
 * Ritorna "granted" | "denied" | "default" | "unsupported".
 */
export async function requestAndSubscribe(): Promise<NotificationPermission | "unsupported" | "error"> {
  if (!isPushSupported()) return "unsupported";

  let permission = Notification.permission;
  console.log("[push] Notification.permission =", permission);

  if (permission === "default") {
    permission = await Notification.requestPermission();
    console.log("[push] Permission result =", permission);
  }
  if (permission !== "granted") return permission;

  try {
    await subscribe();
    return "granted";
  } catch (err) {
    console.warn("[push] subscribe failed:", err);
    return "error";
  }
}

/**
 * Crea la subscription push e la invia al backend.
 * Idempotente — se la subscription esiste già la aggiorna.
 */
export async function subscribe(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== "granted") return;

  const reg = await getSwRegistration();
  if (!reg) return;

  const vapidKey = await fetchVapidPublicKey();
  if (!vapidKey) {
    console.warn("[push] VAPID public key non disponibile");
    return;
  }

  const applicationServerKey = urlBase64ToUint8Array(vapidKey);
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  console.log("[push] PushManager.subscribe() success — endpoint:", sub.endpoint.slice(0, 60) + "…");

  await sendSubscriptionToServer(sub);
  console.log("[push] Subscription registrata ✓");
}

/**
 * Cancella la subscription push corrente.
 */
export async function unsubscribe(): Promise<void> {
  const reg = await getSwRegistration();
  if (!reg) return;

  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await deleteSubscriptionFromServer(endpoint);
  console.log("[push] Subscription rimossa ✓");
}

/**
 * Ritorna la subscription attiva, o null se non esiste.
 */
export async function getActiveSubscription(): Promise<PushSubscription | null> {
  const reg = await getSwRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}
