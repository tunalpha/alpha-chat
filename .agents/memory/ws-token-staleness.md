---
name: WS token staleness bug
description: Il WebSocket riconnetteva con il token scaduto perché leggeva da React state invece di localStorage
---

## Il bug

`useWebSocket(accessToken)` riceveva il token come prop React e lo usava nella `connect()` closure.

Il refresh HTTP (`attemptRefresh` in `api.ts`) aggiorna **solo localStorage** via `updateAccessToken()` + `saveAuth()` — **mai `setAuth()` in AuthContext**. Quindi React state `auth.accessToken` è stale dopo ogni refresh.

Quando il WS cadeva (proxy timeout, rete mobile, ecc.) e cercava di riconnettersi, usava il token originale (scaduto) → il server rifiutava → `auth.error` → `ws.terminate()` → `onclose` → reconnect con lo stesso token scaduto → loop infinito.

**Evidenza nei log di produzione:**
```
401 url=/api/v1/signal/audit   ← token scaduto, HTTP refresh OK (localStorage aggiornato)
OFFLINE userId=...             ← WS cade
WS-AUTH userId=...             ← reconnette (a volte con grace period)
OFFLINE userId=... [+2s]       ← cade immediatamente (token scaduto rifiutato)
```

## Fix applicato

In `connect()` dentro `useWebSocket.ts`: sostituita la prop chiusa `accessToken` con `getAccessToken()` (lettura diretta da localStorage) per l'auth WS.

```typescript
// PRIMA (bug): usava il prop chiuso nella closure — stale dopo refresh
ws.send(JSON.stringify({ type: "auth", payload: { token: accessToken } }));

// DOPO (fix): legge sempre il token fresco da localStorage
const freshToken = getAccessToken();
ws.send(JSON.stringify({ type: "auth", payload: { token: freshToken } }));
```

La dipendenza `[accessToken]` nello useEffect è stata mantenuta come **gate binario** (login presente / logout), non come sorgente del token per l'auth WS.

## Effetti collaterali del bug

Tutti i sintomi osservati derivavano dall'instabilità WS:
- typing.start scartati silenziosamente (WS non OPEN, `send()` era no-op)
- `call.incoming` non ricevuti → chiamate mute senza squillo
- Presenza online/offline incoerente
- Message echo non tornava al mittente → bubble orfano
- [Messaggio non decifrabile] aggravato: WS down durante decrypt → cache non scritta

## Fix aggiuntivo: event queue

`send()` ora accoda gli eventi quando il WS non è OPEN invece di scartarli.
Flush su `auth.ok` con TTL di 5s (scarta typing/call stale).
Cap a 50 eventi per evitare memory leak.

**Why:** `send()` era un silenzioso no-op se WS chiuso — gli eventi typing e call venivano persi senza nessuna notifica al chiamante.
