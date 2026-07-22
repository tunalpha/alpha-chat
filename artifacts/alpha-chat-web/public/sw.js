/**
 * Alpha Chat — Service Worker per Web Push Notifications.
 *
 * Responsabilità:
 *   - Ricezione eventi push dal server
 *   - Visualizzazione notifiche native
 *   - Gestione click notifica → apertura app / focus tab
 *
 * NON contiene:
 *   - Logica Signal / decrypt / encrypt
 *   - Logica chat
 *   - Token di sessione o chiavi crittografiche
 */

/* global self, clients */
'use strict';

const APP_NAME   = 'Alpha Chat';

// ── Lifecycle: aggiornamento automatico ───────────────────────────────────────
// skipWaiting() forza l'attivazione immediata del nuovo SW senza aspettare
// che tutte le schede vengano chiuse (risolve il problema reinstallazione PWA).

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// clients.claim() fa sì che il nuovo SW prenda subito il controllo di tutte
// le schede aperte (senza aspettare il prossimo caricamento della pagina).

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
// Sostituito da vite plugin 'inject-sw-version' al momento del build.
// In dev rimane '__SW_VERSION__' (accettabile per debug locale).
const SW_VERSION = '__SW_VERSION__';

// ── Push event ────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = {
      type:  'message.new',
      title: APP_NAME,
      body:  'Nuovo messaggio',
      data:  { url: '/' },
    };
  }

  const title   = data.title  ?? APP_NAME;
  const body    = data.body   ?? '';
  const tag     = data.tag    ?? 'alpha-chat';
  const icon    = data.icon   ?? '/favicon-192.png';
  const badge   = data.badge  ?? '/favicon-192.png'; // iOS richiede PNG — SVG ignorato
  const vibrate = data.vibrate ?? [200, 100, 200];

  const options = {
    body,
    tag,
    icon,
    badge,
    vibrate,
    data:              data.data ?? { url: '/' },
    requireInteraction: data.requireInteraction ?? false,
    renotify:           data.renotify ?? false,
    silent:             false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData      = event.notification.data ?? {};
  const conversationId = notifData.conversationId ?? null;
  const callerId       = notifData.callerId       ?? null;

  // Costruisce l'URL di fallback (usato solo se non c'è nessuna finestra aperta)
  let targetUrl = '/';
  if (conversationId) targetUrl = `/?push_conv=${encodeURIComponent(conversationId)}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Se c'è già una finestra aperta → invia postMessage e porta in foreground
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          // Comunica alla app quale conversazione aprire
          if (conversationId) {
            client.postMessage({
              type: 'push.openConversation',
              conversationId,
            });
          } else if (callerId) {
            client.postMessage({
              type: 'push.openCall',
              callerId,
            });
          }
          return client.focus();
        }
      }
      // Altrimenti apri una nuova finestra con il param di navigazione
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    }),
  );
});

// ── Notification close ────────────────────────────────────────────────────────

self.addEventListener('notificationclose', (_event) => {
  // Analytics / dismiss tracking — non necessario ora
});

// ── Push subscription change ──────────────────────────────────────────────────
// Fired quando il browser rinnova automaticamente la subscription (es. Firefox)

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    // Notifica all'app che la subscription è cambiata — la gestirà PushManager.ts
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        client.postMessage({ type: 'push.subscriptionchange' });
      }
    }),
  );
});

// ── Version query ─────────────────────────────────────────────────────────────
// L'app interroga il SW via MessageChannel per scoprire quale build sta girando.
// Risponde con { type: 'alpha.pong', version: SW_VERSION }.

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'alpha.ping') return;
  const port = event.ports && event.ports[0];
  if (port) {
    port.postMessage({ type: 'alpha.pong', version: SW_VERSION });
  }
});
