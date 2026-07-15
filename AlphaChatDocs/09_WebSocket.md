# Alpha Chat — WebSocket Layer (Sprint 7A)

## Protocollo

- **Path**: `wss://alphachat.replit.app/api/ws`
- **Libreria server**: `ws` (no Socket.io — troppo pesante, protocollo diverso)
- **Trasporto**: WebSocket nativo (RFC 6455)
- **Porta**: stessa dell'API HTTP (upgrade su `/api/ws`)
- **Deployment target**: `vm` (always-running — necessario per mantenere connessioni persistenti)

## Flusso di autenticazione

```
Client                          Server
  │                               │
  │── WS UPGRADE /api/ws ────────>│
  │<─ 101 Switching Protocols ────│
  │                               │
  │── { type:"auth",              │
  │    payload:{token:"<jwt>"} }─>│  (entro 10s)
  │                               │── verifyAccessToken()
  │<─ { type:"auth.ok",           │
  │    payload:{user_id:"..."} } ─│
  │                               │── setOnline(userId)
  │                               │── wsManager.register(userId, conn)
```

Se il token è mancante o invalido → `{ type:"auth.error" }` + disconnect.
Se nessun messaggio `auth` entro 10 secondi → disconnect automatico.

## Heartbeat (ping/pong)

- Ogni 30s il server invia `{ type: "ping" }`
- Il client deve rispondere con `{ type: "pong" }` entro 30s
- Nessun pong → `ws.terminate()`

## Eventi Server → Client

| Evento | Payload | Quando |
|---|---|---|
| `auth.ok` | `{ user_id }` | Autenticazione OK |
| `auth.error` | `{ message }` | Token invalido |
| `ping` | — | Heartbeat |
| `error` | `{ message }` | Errore generico |
| `message.new` | `MessageResult` | Nuovo messaggio nella conversazione |
| `message.delivered` | `{ message_id, conversation_id }` | Messaggio consegnato |
| `presence.online` | `{ user_id }` | Utente connesso |
| `presence.offline` | `{ user_id, last_seen_at }` | Utente disconnesso |
| `typing.start` | `{ user_id, conversation_id }` | Utente sta scrivendo |
| `typing.stop` | `{ user_id, conversation_id }` | Utente ha smesso di scrivere |

## Eventi Client → Server

| Evento | Payload | Descrizione |
|---|---|---|
| `auth` | `{ token: "<jwt>" }` | Autenticazione (primo messaggio) |
| `pong` | — | Risposta al ping |
| `typing.start` | `{ conversation_id }` | Inizia a scrivere |
| `typing.stop` | `{ conversation_id }` | Smette di scrivere |

## Multi-device

Un utente può avere N connessioni attive simultanee (telefono + desktop).
`WsManager` mantiene `Map<userId, Set<Connection>>`.
`presence.offline` emesso solo quando l'ultimo dispositivo si disconnette.

## Typing indicator

- Il server gestisce un timer da 5s per conversazione per utente
- Se il client invia `typing.start` ripetuto → timer viene resettato
- Alla scadenza del timer → `typing.stop` automatico (lato server)
- `typing.stop` esplicito dal client → timer cancellato immediatamente

## Message delivery (Sprint 7A scope)

`POST /conversations/:id/messages` → `sendMessage()` → `wsManager.sendToUsers(memberIds, { type: "message.new", payload: message })`

`message.delivered` è deferred (richiede ACK client → Sprint 8).
