# CHANGELOG — Alpha Chat API

Formato: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased] — Sprint 3

### Added
- `POST /api/v1/auth/login` — login con username/email + password
- Rate limiting login falliti (sliding window, Redis-optional)
- Device Trust — `is_trusted`, `login_count` nella session
- Notifica nuovo dispositivo (framework WebSocket — Sprint 4)
- `src/lib/redis.ts` — client Upstash opzionale con fallback InMemoryRedis
- `src/lib/rate-limiter.ts` — sliding window rate limiter
- Audit log `USER_LOGIN`, `USER_LOGIN_FAILED`, `NEW_DEVICE_LOGIN`
- `src/__tests__/auth.login.integration.test.ts`

### Changed
- `src/models/session.model.ts` — aggiunto `is_trusted`, `login_count`

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
- Password: Argon2id (memoryCost 64MB, timeCost 3, parallelism 4) — OWASP 2024
- JWT: ES256 con `kid`, `nbf`, `exp`, `iss`, `aud` verificati
- Refresh token: hashati SHA-256, rotazione obbligatoria, token theft detection
- Phone: HMAC-SHA256 con pepper server-side

### Tests
- 42/42 ✅ (25 unit + 17 integrazione)

---

## [0.1.0] — Sprint 1 — 2026-07-15

### Added
- `src/config/index.ts` — Zod env validation, fail-fast se env mancante
- `src/errors/AppError.ts` — classe base errori con code, httpStatus, field, details
- `src/errors/error-codes.ts` — 40+ codici errore con messaggi in italiano
- `src/errors/error-handler.ts` — global Express error handler
- `src/utils/response.ts` — factory successResponse, paginatedResponse, errorResponse
- `src/middleware/request-id.middleware.ts` — UUID per ogni request
- `src/middleware/client-version.middleware.ts` — X-Client-Version check
- `src/middleware/validate.middleware.ts` — Zod wrapper per body/query/params
- `src/lib/mongodb.ts` — connessione Mongoose con graceful shutdown
- `src/routes/v1/system.routes.ts` — GET /health, /version, /status
- `src/services/password.service.ts` — Argon2id hash/verify
- `src/services/jwt.service.ts` — ES256 JWT sign/verify
- `src/services/refresh-token.service.ts` — generate, hash, rotate, revoke
- Helmet, CORS, pino-http nel middleware stack
- Graceful shutdown SIGTERM/SIGINT in `src/index.ts`

### Security
- Algoritmo JWT: ES256 (ECDSA P-256) — conforme 04b_Security.md
- Password: Argon2id
- Refresh token: formato `rt_<32 byte hex>`, SHA-256 nel DB

### Tests
- 25/25 ✅ (unit tests: password, jwt, refresh-token)
