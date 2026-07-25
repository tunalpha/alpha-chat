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
// Motivo: controllerchange / message possono emettere decine/centinaia di ms
// PRIMA che initServiceWorker() venga chiamata. Se i listener fossero dentro
// l'effetto, l'evento sarebbe già andato perso → nessun banner.
//
// Due segnali complementari (entrambi necessari per coprire tutti gli scenari):
//
//  1. controllerchange  — copre: app aperta durante il deploy (SW swap live)
//
//  2. postMessage SW_UPDATED + confronto versione (NUOVO) — copre:
//       a. Deploy mentre la PWA era chiusa/sospesa:
//          il nuovo SW si attiva PRIMA del primo JS tick → controllerchange
//          non catturato → solo postMessage garantisce il banner.
//       b. iOS cold start: navigator.serviceWorker.controller è null al momento
//          della valutazione del modulo (il claim non è ancora avvenuto) →
//          _hasBeenControlled=false → controllerchange ignorato →
//          solo postMessage salva la situazione.
//       c. Riapertura senza deploy: stessa versione → nessun banner ✓
//       d. Prima installazione: nessuna versione in localStorage → nessun banner ✓
//
// Scenari gestiti correttamente (combinato):
//   1. Prima installazione       → nessuna sw_version in LS → nessun banner ✓
//   2. Deploy nuova versione     → controllerchange OPPURE postMessage → banner ✓
//   3. Riapertura senza deploy   → stessa versione in postMessage → nessun banner ✓
//   4. Deploy durante sessione   → banner immediato (entrambi i segnali) ✓
//   5. Mount tardivo SwUpdateBanner → isSwUpdateReady() = true → visible=true ✓
//   6. App sospesa poi riapertura → postMessage dall'SW già attivo → banner ✓  ← NEW
//   7. iOS cold start con nuova versione → postMessage → banner ✓              ← NEW

const SW_VERSION_KEY = "sw_version";

function _fireSwUpdateReady(): void {
  _swUpdateReady = true;
  window.dispatchEvent(new CustomEvent("pwa:update-ready"));
}

let _swUpdateReady = false;
let _hasBeenControlled = false;

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  // ── Segnale 1: controllerchange ──────────────────────────────────────────
  // Cattura lo stato del controller PRIMA che qualsiasi evento possa emettere
  _hasBeenControlled = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_hasBeenControlled) {
      // Un controller precedente esiste → questo è un vero aggiornamento
      _fireSwUpdateReady();
    }
    // Dopo il primo cambio, qualsiasi cambio successivo è un aggiornamento
    _hasBeenControlled = true;
  });

  // ── Segnale 2: postMessage SW_UPDATED + confronto versione ───────────────
  // Il SW invia questo messaggio dopo clients.claim() su ogni attivazione.
  // Confrontiamo la versione ricevuta con quella salvata in localStorage:
  //   - versione diversa + versione precedente presente → deploy → banner
  //   - stessa versione → nessuna azione (riapertura senza deploy)
  //   - nessuna versione in LS → prima installazione → salva e basta
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type !== "SW_UPDATED") return;
    const newVersion  = String(event.data.version ?? "");
    const prevVersion = localStorage.getItem(SW_VERSION_KEY) ?? "";
    if (prevVersion && prevVersion !== newVersion && !_swUpdateReady) {
      // Versione cambiata rispetto all'ultima sessione → nuovo deploy
      _fireSwUpdateReady();
    }
    // Aggiorna sempre la versione in localStorage (anche prima installazione)
    if (newVersion) localStorage.setItem(SW_VERSION_KEY, newVersion);
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
