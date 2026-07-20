---
name: Web Push Notifications
description: Architettura e stato implementazione sistema push VAPID per Alpha Chat
---

## Stato: implementato, mancano le chiavi VAPID come segreti Replit

### Architettura (Event-Driven, completamente separato dalla messaggistica)

**Backend — nuovi file:**
- `src/models/push-subscription.model.ts` — collection `push_subscriptions`
- `src/repositories/push-subscription.repository.ts` — CRUD MongoDB
- `src/services/push/PushEvents.ts` — tipi eventi (message.new, call.incoming, call.missed)
- `src/services/push/PushDispatcher.ts` — fire-and-forget via setImmediate()
- `src/services/push/PushNotificationService.ts` — web-push VAPID, letto da process.env
- `src/controllers/push.controller.ts` — GET vapid-public-key, POST/DELETE subscribe
- `src/routes/v1/push.routes.ts` — montato su /api/v1/push

**Backend — file modificati:**
- `src/services/message.service.ts` — push fire-and-forget DOPO WS broadcast (solo offline users)
- `src/lib/ws-server.ts` — push call.incoming per utenti offline
- `src/routes/v1/index.ts` — mount /push routes
- `package.json` — aggiunto web-push + @types/web-push

**Frontend — nuovi file:**
- `public/sw.js` — Service Worker (push event, notificationclick, pushsubscriptionchange)
- `src/lib/pushManager.ts` — isPushSupported, requestAndSubscribe, subscribe, unsubscribe, initServiceWorker

**Frontend — file modificati:**
- `src/pages/NotificationsPage.tsx` — sezione push con toggle permesso
- `src/App.tsx` — initServiceWorker() + subscribe() al login (useEffect su auth.userId)
- `src/lib/api.ts` — apiGetVapidPublicKey, apiSubscribePush, apiUnsubscribePush

### Chiavi VAPID generate (NON committate — vanno come segreti Replit)
- VAPID_PUBLIC_KEY: BDeAiOD4hMDqem8kiQJasbIBm6GBJeziyqiLlP-wEwYzr5_lI72iu0LoHITkMs5_CK7THU0KR9S83Al0vimlZlg
- VAPID_PRIVATE_KEY: pmFL8us4zmsoF_Iwq9NQZvjcNxdSh5ji3QukoNgk-EM
- VAPID_SUBJECT: mailto:admin@alphachat.sbs

**Why:** senza queste variabili il server logga WARN e disabilita push (no crash). L'app lato client funziona normalmente.

### Inject point (non toccano la messaggistica)
- message.service.ts: push avviene in un secondo void IIFE, DOPO il return della funzione
- ws-server.ts: dynamic import + dispatchToOne dopo wsManager.sendToUser, mai prima

### Compatibilità push
- ✅ Chrome Android/Desktop, Firefox Desktop/Android, Edge
- ⚠️ Safari iOS ≥16.4 solo da PWA installata (Home Screen)
- ❌ Chrome/Firefox iOS (vincolo Apple WebKit)
