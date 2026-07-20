---
name: BAR timer + Call squillo fixes
description: Root causes e fix per messaggi effimeri (🔥) non autodistrutti e squillo assente su chiamate in arrivo
---

## BAR (Burn After Read) — timer non partiva nel percorso HTTP

**Causa**: `apiMarkRead` era chiamato SOLO dentro il WS `message.new` handler.
- `loadMessages` (apertura conversazione via HTTP) non chiamava mai `apiMarkRead` → BAR messages già nel DB non venivano mai distrutti.
- Dopo il fix `handleSend` (risposta HTTP immediata), il de-dup in `setMessages` non bloccava il resto del handler WS (il timer partiva comunque per il sender via WS echo), ma il caso "recipient apre la chat con messaggi già presenti" rimaneva non coperto.

**Fix applicato (ChatPage.tsx)**:
1. `loadMessages` useEffect: chiama `void apiMarkRead(activeConvId)` dopo aver caricato i messaggi
2. WS reconnect refetch: stessa chiamata dopo il refetch alla riconnessione
3. `handleSend` HTTP path: attiva `markReadTimerRef` (debounce 800ms) subito dopo `setMessages` — garantisce il markRead anche se il WS echo non arriva

**Server (conversation.service.ts)**: timer BAR ridotto da 10_000 a 5_000 ms.

## Squillo (ringtone) — non suonava su iOS Safari

**Causa principale**: `unlockNotifAudio()` usava un `for...of` con `await el.play()` per ogni elemento.
Su iOS Safari, dopo il PRIMO `await`, il gesture context va perso → solo il primo elemento viene sbloccato → i ring elements (`_ringEls`) non venivano mai sbloccati → `startRing()` chiamava `el.play()` silenziosamente bloccato da autoplay policy.

**Fix (notifSound.ts)**: tutti i `.play()` vengono avviati in modo SINCRONO (nello stesso tick del gesture event) accumulando le promise, poi `await Promise.allSettled(...)` fuori dal tick sincrono.

## Audio routing asimmetrico (caller speaker-only)

**Causa**: `acceptCall` (callee) chiamava `primeRemoteAudio()` dentro il gesture context "Accetta". `initiateCall` (caller) non chiamava mai `primeRemoteAudio()` → AudioContext restava `suspended` → routing auricolare falliva per il chiamante.

**Fix (CallContext.tsx)**: aggiunto `void primeRemoteAudio().catch(() => {})` in `initiateCall`, subito dopo `setSpeakerMode`, mentre siamo ancora nel gesture context del tap "Chiama". Import aggiunto: `primeRemoteAudio` da `../lib/remoteAudio`.

## WS types + routing call.missed / call.ended_elsewhere

**Bug**: `call.missed` e `call.ended_elsewhere` non erano nel tipo union `WsEvent` né instradati nel ChatPage WS switch → lo squillo continuava dopo timeout/dismiss su altro device.

**Fix**: aggiunto entrambi i tipi in `useWebSocket.ts` e i due `case` nel switch di ChatPage.
