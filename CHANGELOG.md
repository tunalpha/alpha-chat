# CHANGELOG — Alpha Chat API

Formato: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

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
