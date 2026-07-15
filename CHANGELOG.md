# CHANGELOG — Alpha Chat API

Formato: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [0.9.0] — Sprint 9 — Invita Persona (Privacy-First) — 2026-07-15

### Added (Backend)
- `src/models/invite.model.ts` — collezione `invites`: `code_hash` (SHA-256), `owner_id`, `expires_at`, `used`, `used_by`. TTL index su `expires_at` → auto-delete MongoDB.
- `src/repositories/invite.repository.ts` — `create()`, `findValidByHash()`, `markUsed()` (atomic), `listActive()`, `deleteAllActive()`, `deleteOwned()`
- `src/services/invite.service.ts` — `generateInvite()` (CSPRNG, 16 char, salva solo hash), `redeemInvite()` (verifica hash, atomic markUsed, crea conversazione), `revokeMyInvites()`
- `src/validation/invite.schemas.ts` — `GenerateInviteSchema`, `RedeemInviteSchema` (normalizza codice: uppercase, strip non-alfanumerico)
- `src/controllers/invite.controller.ts` — `generateInvite`, `redeemInvite`, `revokeMyInvites`
- `src/routes/v1/invite.routes.ts` — montato su `/api/v1/invites`
- Nuovi codici errore: `INVITE_INVALID`, `INVITE_SELF_REDEEM`
- Nuovi eventi audit: `INVITE_GENERATED`, `INVITE_REDEEMED`, `INVITE_REDEEM_FAILED`, `INVITE_REVOKED`

### Added (Frontend)
- `src/components/InviteModal.tsx` — genera codice, QR code (libreria `qrcode`), countdown live, pulsante Rigenera
- `src/components/RedeemModal.tsx` — inserisci codice + scanner QR live (camera + `jsqr`), stato successo
- `src/lib/api.ts` — `apiGenerateInvite()`, `apiRedeemInvite()`, `apiRevokeInvites()`
- `src/index.css` — 214 righe CSS: modal, QR frame con angoli animati, code monospace, countdown urgente, scanner overlay

### Changed
- `src/routes/v1/user.routes.ts` — `GET /users/search` ora restituisce **410 Gone** (`ENDPOINT_DEPRECATED`). La ricerca pubblica è eliminata.
- `src/pages/ChatPage.tsx` — rimossa ricerca utenti, aggiunti pulsanti "Invita persona" + "Inserisci codice" nella sidebar + schermata vuota
- `src/tests/user.discovery.integration.test.ts` — 7 test legacy rimossi, sostituiti con 4 test che verificano il comportamento 410

### Security
- Codici CSPRNG: alfabeto 32 caratteri (no I, O, 0, 1), 16 caratteri, ~80 bit di entropia
- Solo SHA-256 hash salvato in DB — il codice grezzo non è mai persistito
- Audit log registra solo `code_hash_prefix` (8 hex) per correlazione, mai il codice grezzo
- Rate limit: max 5 tentativi di riscatto per IP ogni 10 minuti (in-memory / Redis fallback)
- Risposta generica su codice non valido, scaduto o già usato (no oracle)
- Atomic `markUsed` — protezione race condition (due utenti stessi codice contemporaneamente)
- TTL MongoDB → nessun codice scaduto rimane in DB

### Tests
- 122/122 ✅

---

## [0.8.0] — Sprint 8 — UI/UX Polish (Mobile First) — 2026-07-15

### Added (Frontend only — nessuna modifica API/WS/DB)
- `src/pages/ProfilePage.tsx` — profilo utente con avatar grande, nome, username, bio placeholder, pulsante cambia avatar
- `src/pages/SettingsPage.tsx` — impostazioni (Tema, Lingua, Notifiche, Privacy, Archiviazione) con badge "Presto"
- `src/pages/DevicesPage.tsx` — pagina stile Telegram: browser, OS, device ID, data connessione; pulsante "Disconnetti tutti"
- `src/pages/PrivacyPage.tsx` — controllo privacy (Ultimo accesso, Foto profilo, Bio, Blocco utenti, PIN, Biometria, Messaggi effimeri, Verifica Signal)
- `src/pages/ComingSoonPage.tsx` — pagina elegante generica per funzioni non ancora implementate
- `App.tsx` — view routing React state: `"chat" | "profile" | "settings" | "devices" | "privacy" | "archive"`

### Changed
- `src/pages/ChatPage.tsx` — refactor completo Sprint 8:
  - Bolle Signal-style: max 70%, angoli asimmetrici, ombra, padding aumentato, timestamp + icona spunta
  - Input bar redesign: Emoji 😊 | Allega 📎 | textarea auto-expand (6 righe) | Mic 🎤 ↔ Invia ➤ (toggle)
  - `ChatHeader` con avatar, nome, stato online, pulsanti chiamata/video, menu (…) con 6 voci
  - `SidebarMenu` — tutte le voci navigano a pagine reali (Profilo, Privacy, Dispositivi, Impostazioni, Archivio)
  - Lista conversazioni: avatar, nome, ultimo orario, badge unread
  - Auto-scroll solo quando l'utente è già in fondo (`atBottom` state + scroll sentinel)
  - Animazione messaggi (`msg-in` keyframe)
  - Pulsante "scorri in fondo" flottante quando non si è in fondo
  - Enter per inviare, Shift+Enter per newline
- `src/index.css` — riscrittura completa (741 → 1020 linee):
  - `100dvh` + `env(safe-area-inset-*)` ovunque
  - Touch target 44px su mobile (`@media (pointer: coarse)`)
  - Mobile layout: slide CSS `transform: translateX` con `cubic-bezier` al posto di classi show/hide
  - Keyboard avoidance via `padding-bottom: calc(10px + var(--sab))`
  - Nuovi componenti: `.settings-*`, `.device-card`, `.privacy-hero`, `.coming-soon-*`, `.chat-menu-*`, `.scroll-to-bottom`, `.input-icon-btn`, `.chat-textarea`, `.profile-*`
  - Animazioni: `menu-pop`, `msg-in`, `typing-bounce`, `fade-in`
  - Scrollbar viola-tinted custom

### Fixed (backend)
- `sender_key_id` ora accettato come `null` (M1 placeholder): Zod schema `.nullable().optional().default(null)` — rimuove l'asimmetria invio tra Marco e Cricco causata da iOS Safari cache
- `message.repository.ts` — tipo `senderKeyId: number | null`

### Tests
- 126/126 ✅ (invariato — nessuna logica backend modificata)

### Build
- ✅ `vite build` — 232KB JS gzipped 69KB, 21KB CSS gzipped 4.5KB

---

## [0.6.0] — Sprint 6 — First Message — 2026-07-15

### Added
- `src/models/message.model.ts` — collection `messages`: ciphertext opaco E2E, `status` (queued/sent/delivered/read/deleted/failed), `server_received_at` separato da `createdAt`, `sequence_number` monotono per conversazione
- `src/models/conversation.model.ts` — aggiunto `sequence_counter` (atomic $inc per sequence_number)
- `src/repositories/message.repository.ts` — `findByClientId()` (idempotency), `create()` (atomic seq + aggiorna last_message_*), `list()` (paginazione cursor su sequence_number), `updateStatus()`
- `src/validation/message.schemas.ts` — `SendMessageSchema`, `ListMessagesSchema`, `ConversationIdParamSchema`
- `src/services/message.service.ts` — `sendMessage()` (idempotente su client_message_id), `listMessages()`
- `src/controllers/message.controller.ts`
- `src/routes/v1/message.routes.ts` — `mergeParams: true` per :conversationId
- `src/routes/v1/index.ts` — montato `/api/v1/conversations/:conversationId/messages`
- `src/lib/audit.ts` — evento `MESSAGE_SENT`
- `src/__tests__/message.integration.test.ts` — 19 test integrazione

### Behaviour
- `POST /api/v1/conversations/:id/messages` — 201 nuovo, 200 idempotente; server conserva ciphertext invariato (opaco)
- `GET /api/v1/conversations/:id/messages` — DESC per sequence_number; cursor base64 su `{ seq }` per next page
- Atomic: `findOneAndUpdate { $inc: sequence_counter }` su conversazione = sequence_number senza race condition
- Atomic update `last_message_id` + `last_message_at` + `last_activity_at` nella stessa write del sequence_counter

### Tests
- 126/126 ✅ (107 precedenti + 19 message)

---

## [0.5.1] — Sprint 5B — Chat Creation — 2026-07-15

### Added
- `src/models/conversation.model.ts` — collection `conversations` (direct/group/channel), include `last_activity_at` (separato da `updatedAt`), `last_message_id`
- `src/models/conversation-member.model.ts` — collection `conversation_members` include `archived`, `pinned`, `pinned_at` (CTO recommendation)
- `src/repositories/conversation.repository.ts` — `findDirectBetween()`, `create()`, `findById()`, `incrementMemberCount()`
- `src/repositories/conversation-member.repository.ts` — `addMember()`, `findMembership()`, `listMembers()`, `listByUser()`
- `src/validation/conversation.schemas.ts` — `CreateConversationSchema`, `ListConversationsSchema`
- `src/services/conversation.service.ts` — `createDirectConversation()` (idempotente), `listConversations()` (con other_user per direct)
- `src/controllers/conversation.controller.ts`
- `src/routes/v1/conversation.routes.ts` — POST `/`, GET `/`
- `src/routes/v1/index.ts` — montato `/api/v1/conversations`
- `src/lib/audit.ts` — evento `CONVERSATION_CREATED`
- `src/__tests__/conversation.integration.test.ts` — 14 test integrazione

### Behaviour
- `POST /api/v1/conversations { username }` — 201 se nuova, 200 se già esistente (idempotente)
- `GET /api/v1/conversations` — lista ordinata per `last_activity_at` desc; include `other_user` per chat dirette
- `CANNOT_CHAT_WITH_SELF` error code già presente da Sprint 2

### Tests
- 107/107 ✅ (93 precedenti + 14 conversation)

---

## [0.5.0] — Sprint 5A — User Discovery — 2026-07-15

### Added
- `GET /api/v1/users/:username` — profilo pubblico privacy-aware (presence, last_seen)
- `GET /api/v1/users/search?q=&limit=` — ricerca per prefisso username, cursor pagination
- `src/models/presence.model.ts` — collection presenza real-time (status, last_seen, typing, recording, in_call)
- `src/services/user.service.ts` — getUserProfile(), searchUsers()
- `src/controllers/user.controller.ts`
- `src/routes/v1/user.routes.ts` — montato su `/api/v1/users`
- `src/validation/user.schemas.ts` — UserSearchSchema, UsernameParamSchema
- `src/__tests__/user.discovery.integration.test.ts` — 17 test integrazione

### Changed
- `src/repositories/user.repository.ts` — aggiunto searchByUsername() con prefix regex su indice
- `src/middleware/validate.middleware.ts` — fix read-only property: usa Object.defineProperty per `query` e `params`
- `src/models/user.model.ts` — **BUG FIX**: indice `email` e `phone_hash` da `sparse` a `partialFilterExpression` (MongoDB indicizza null con sparse → E11000 su multi-user tests)

### Bug Fixes
- `validate.middleware.ts`: `req.query = data` → `Cannot set property query (read-only getter)` in Express 5 / Node.js http — sostituito con Object.defineProperty
- `user.model.ts`: `{ unique: true, sparse: true }` su campi null-default → E11000 su seconda registrazione — sostituito con `partialFilterExpression: { $type: "string" }`

### Tests
- 93/93 ✅ (76 precedenti + 17 user discovery)

---

## [0.4.0] — Sprint 4 — 2026-07-15

### Added
- `POST /api/v1/auth/refresh` — rotazione obbligatoria RT (invariante S-02)
- `POST /api/v1/auth/logout` — revoca sessione corrente + JTI blocklist
- `POST /api/v1/auth/logout-all` — revoca tutte le sessioni
- `src/lib/jti-blocklist.ts` — blocklist Redis per access token revocati
- `src/lib/geoip.ts` — stub GeoIP (country code only, lookup reale in Sprint 5)
- `src/middleware/authenticate.middleware.ts` — verifica JWT + JTI blocklist
- Milestone `AlphaChatDocs/M1_Authentication_Complete.md` — auth in maintenance mode

### Changed
- `src/models/session.model.ts` — aggiunto `family_id` (UUID immutabile, tracking catena RT)
- `src/services/refresh-token.service.ts` — S-03: revoca per `family_id` (non più per user_id)
- `src/repositories/session.repository.ts` — `upsert` usa `$setOnInsert` per `family_id`; aggiunto `revokeFamilyByFamilyId`, `findByUserDevice`, `revokeByUserDevice`
- `src/types/express.d.ts` — aggiunto `req.user` (userId, deviceId, roles, jti, accessTokenExpiresAt)
- `src/lib/audit.ts` — aggiunto: REFRESH_TOKEN_REUSED, DEVICE_REMOVED, DEVICE_RENAMED, TRUST_STATUS_CHANGED
- `src/lib/redis.ts` — esposto `_resetRedisClient()` per reset tra i test

### Security
- JTI blocklist: AT revocato immediatamente (non attendere scadenza 15min)
- S-03 potenziato: revoca per `family_id` invece di tutti gli utenti (più precisa)
- Token theft detection: REFRESH_TOKEN_REUSED audit con `family_id` in metadata

### Tests
- 79/79 ✅ (25 unit + 17 register + 20 login + 9 refresh + 8 logout)

---

## [0.3.0] — Sprint 3 — 2026-07-15

### Added
- `POST /api/v1/auth/login` — login con username/email + password
- Rate limiting login falliti (sliding window, Redis-optional)
- Device Trust — `is_trusted`, `login_count` nella session
- Notifica nuovo dispositivo (framework: audit + log; WebSocket delivery: Sprint 7)
- `src/lib/redis.ts` — client Upstash opzionale con fallback InMemoryRedis
- `src/lib/rate-limiter.ts` — sliding window rate limiter
- `src/lib/reserved-usernames.ts` — blacklist 40+ username riservati + RESERVED_USERNAMES_EXTRA
- `src/lib/audit.ts` — audit logging strutturato
- Audit log: USER_LOGIN, USER_LOGIN_FAILED, NEW_DEVICE_LOGIN, ACCOUNT_LOCKED
- `src/__tests__/auth.login.integration.test.ts`
- `CHANGELOG.md`

### Changed
- `src/models/session.model.ts` — aggiunto `is_trusted`, `login_count`
- `src/validation/auth.schemas.ts` — blacklist riservata, decisione ASCII-only documentata

### Security
- Anti-enumeration: risposta identica per "utente non trovato" e "password errata"
- Blocco account graduale: 10/20/30 tentativi → 15min/1h/24h
- Ordine: Password Verify PRIMA di Rate Limit (CTO requirement)

### Tests
- 59/59 ✅

---

## [0.2.0] — Sprint 2 — 2026-07-15

### Added
- `POST /api/v1/auth/register` — registrazione completa con Signal keys opzionali
- `src/models/user.model.ts` — Mongoose User model (schema completo 05_Database.md)
- `src/models/session.model.ts` — Mongoose Session model con TTL index
- `src/models/user-prekeys.model.ts` — Signal Protocol keys model
- `src/repositories/user.repository.ts` — CRUD users
- `src/repositories/session.repository.ts` — CRUD sessions con upsert
- `src/validation/auth.schemas.ts` — Zod: RegisterSchema, LoginSchema, RefreshSchema
- `src/services/auth.service.ts` — register() con flusso completo 08_Authentication_Flow.md
- `src/controllers/auth.controller.ts` — thin HTTP layer
- `src/routes/v1/auth.routes.ts` — routing versioned
- `src/__tests__/auth.register.integration.test.ts` — 17 test di integrazione
- `mongodb-memory-server` per test isolati
- `vitest.config.ts` — configurazione test suite

### Changed
- `src/services/jwt.service.ts` — `kid` nell'header JWT, strategia rotazione chiavi
- `src/models/session.model.ts` — aggiunto `user_agent`
- `src/config/index.ts` — `JWT_KEY_ID`, `JWT_PUBLIC_KEYS_LEGACY`, `PHONE_HMAC_PEPPER`

### Fixed
- Mongoose `new: true` → `returnDocument: "after"` (deprecation warning)
- `LOG_LEVEL=silent` aggiunto all'enum Zod per supporto test

### Security
- Password: Argon2id (memoryCost 64MB, timeCost 3, parallelism 4)
- JWT: ES256 con `kid`, `nbf`, `exp`, `iss`, `aud` verificati
- Refresh token: hashati SHA-256, rotazione obbligatoria, token theft detection
- Phone: HMAC-SHA256 con pepper server-side

### Tests
- 42/42 ✅

---

## [0.1.0] — Sprint 1 — 2026-07-15

### Added
- Config Zod fail-fast, Pino logger, MongoDB + graceful shutdown
- AppError, error-codes (40+ codici IT), error-handler globale
- Response factory: successResponse, paginatedResponse, errorResponse
- Middleware: RequestID, ClientVersion, Validate (Zod)
- Route versionate `/api/v1/` con system routes (health, version, status)
- Servizi: password.service (Argon2id), jwt.service (ES256), refresh-token.service

### Security
- JWT: ES256 (ECDSA P-256)
- Password: Argon2id

### Tests
- 25/25 ✅
