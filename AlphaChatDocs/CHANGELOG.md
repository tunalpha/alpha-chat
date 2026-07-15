# Alpha Chat — CHANGELOG

---

## Sprint 7 — WebSocket + Frontend MVP (2026-07-15)

### Sprint 7A — Backend WebSocket

**Nuovi file:**
- `artifacts/api-server/src/types/ws-events.ts` — Tipi TypeScript `WsInboundEvent` / `WsOutboundEvent`; tutti i literal types degli eventi WS
- `artifacts/api-server/src/lib/ws-manager.ts` — `WsManager` singleton; `Map<userId, Set<ClientConnection>>`; metodi `sendToUser`, `sendToUsers`; gestione timer typing per userId+conversationId
- `artifacts/api-server/src/lib/ws-server.ts` — `createWsServer(httpServer)`: HTTP upgrade handler su `/api/ws`, autenticazione JWT sul primo messaggio, heartbeat JSON ping/pong ogni 30s, broadcast typing, cleanup on disconnect
- `artifacts/api-server/src/services/presence.service.ts` — `setOnline`, `setOffline`, `setTyping` — upsert su `PresenceModel`; errori non-fatali (warn only)

**File modificati:**
- `artifacts/api-server/src/index.ts` — aggiunto `createWsServer(server)` dopo `app.listen()`
- `artifacts/api-server/src/services/message.service.ts` — aggiunto `wsManager.sendToUsers(memberIds, { type:"message.new", payload })` non-blocking void dopo il salvataggio messaggio
- `artifacts/api-server/src/routes/index.ts` — montato `healthRouter` (fix deploy precedente)

**Documentazione:**
- `AlphaChatDocs/09_WebSocket.md` — spec completa: protocollo, eventi, auth flow, timer typing, heartbeat

**Deployment:**
- `artifacts/api-server/.replit-artifact/artifact.toml` — target cambiato da `autoscale` a `vm` (always-running, richiesto per WebSocket persistenti)

### Sprint 7B — Frontend React

**Nuovo artifact:** `alpha-chat-web` (React + Vite, previewPath `/`)

**Nuovi file:**
- `artifacts/alpha-chat-web/src/lib/auth.ts` — storage token in localStorage; `saveAuth`, `loadAuth`, `clearAuth`, `getDeviceId` (UUID stabile per browser)
- `artifacts/alpha-chat-web/src/lib/api.ts` — fetch client con refresh automatico del token su 401; queue di richieste durante il refresh; `encodeMessage`/`decodeMessage` (base64 UTF-8 safe)
- `artifacts/alpha-chat-web/src/contexts/AuthContext.tsx` — `AuthProvider` con stato auth globale; `login`, `register`, `logout`; listener `auth:expired` per logout automatico
- `artifacts/alpha-chat-web/src/hooks/useWebSocket.ts` — connessione WS con exponential backoff; autenticazione via primo messaggio `{ type:"auth", payload:{ token } }`; handler ping→pong; dispatch eventi a tutti i subscriber
- `artifacts/alpha-chat-web/src/pages/AuthPage.tsx` — login + registrazione con tab; validazione client-side; gestione errori API
- `artifacts/alpha-chat-web/src/pages/ChatPage.tsx` — sidebar conversazioni + ricerca utenti + indicatore presenza online/offline; area chat con messaggi + typing indicator animato; invio messaggi con stop typing automatico; tutto realtime via WS
- `artifacts/alpha-chat-web/src/App.tsx` — router semplice: AuthPage ↔ ChatPage in base allo stato auth
- `artifacts/alpha-chat-web/src/index.css` — dark messenger theme (sfondo `#0f0f10`, accent `#5865f2`)

**Funzionalità implementate (10/10):**
1. ✅ Registrazione nuovo account
2. ✅ Login con username o email
3. ✅ Ricerca utenti (debounce 300ms)
4. ✅ Creazione conversazione diretta (find-or-create)
5. ✅ Lista conversazioni (ordinata per attività recente)
6. ✅ Lista messaggi con scroll to bottom
7. ✅ Invio messaggio (ciphertext = base64 UTF-8)
8. ✅ Ricezione realtime via `message.new` WebSocket
9. ✅ Typing indicator animato (start/stop, auto-stop 3s)
10. ✅ Stato online/offline in sidebar e header chat

**Test:** 126/126 ✅ (test backend esistenti invariati; test WS integration pianificati Sprint 7C)

---

## Sprint 6 — First Message (2026-07-08)

**Approvato: 10/10**

- `POST /conversations/:id/messages` — invio messaggio E2E-cifrato
- `GET /conversations/:id/messages` — lista messaggi con cursor pagination
- `MessageModel` con `sequence_number` atomico (findOneAndUpdate)
- 126/126 test passati

---

## Sprint 5B — Conversations (2026-07-01)

**Approvato: 10/10**

- `POST /conversations` — crea conversazione diretta (find-or-create idempotente)
- `GET /conversations` — lista con `other_user` popolato
- `ConversationModel`, `ConversationRepository`, `ConversationService`
- Tests: 97/97 ✅

---

## Sprint 5A — Contact System (2026-06-24)

**Approvato: 10/10**

- `POST /contacts/request`, accept, reject, block, unblock
- `GET /contacts`, `GET /contacts/requests`
- `ContactModel`, stati: pending/accepted/blocked
- Tests: 78/78 ✅

---

## Sprint 4 — User Profile + Search (2026-06-17)

**Approvato: 10/10**

- `GET /users/:username` — profilo pubblico
- `GET /users/search?q=` — ricerca per username/display_name
- `PATCH /users/me` — aggiorna display_name, avatar_url, bio
- `UserRepository` pattern
- Tests: 52/52 ✅

---

## Sprint 3 — Device Trust + JWT Rotation (2026-06-10)

**Approvato: 9.8/10**

- `DeviceModel`, device_id stabile per browser/client
- `POST /auth/refresh` con rotazione refresh token
- `POST /auth/logout` — revoca token
- `POST /auth/logout/all` — revoca tutti i dispositivi
- Tests: 38/38 ✅

---

## Sprint 2 — Auth Core (2026-06-03)

**Approvato: 9.5/10**

- `POST /auth/register`, `POST /auth/login`
- Argon2id 64MB/3i/4p; ES256 JWT (ECDSA P-256)
- `UserModel`, `SessionModel`
- Tests: 18/18 ✅

---

## Sprint 1 — Fondamenta (2026-05-27)

**Approvato: 9.5/10**

- Monorepo pnpm, Express 5, MongoDB/Mongoose, Pino logger
- `GET /api/healthz`, config centralizzata
- CI/CD base, vitest configurato
- Tests: 3/3 ✅
