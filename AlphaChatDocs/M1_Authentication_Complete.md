# Milestone M1 — Authentication Complete

**Data:** 2026-07-15
**Versione:** 0.4.0
**Status:** ✅ COMPLETO — Maintenance Mode

---

## Definizione

Da questo momento l'autenticazione di Alpha Chat entra in **maintenance mode**.

**Cosa significa:**
- Si correggono bug critici e vulnerabilità di sicurezza
- Si migliorano performance e osservabilità
- **Non si aggiungono nuove funzionalità** a meno che non siano strettamente necessarie per la messaggistica

**Perché ora:**
- Sprint 1–4 hanno costruito una base di autenticazione solida e testata
- Il focus deve spostarsi sulla messaggistica, che è il cuore di Alpha Chat
- Continuare ad espandere auth significa ritardare il prodotto

---

## Feature completate

### Sprint 1 — Infrastructure
- [x] Config Zod fail-fast
- [x] Pino logger
- [x] MongoDB + Mongoose
- [x] Graceful shutdown
- [x] Middleware: RequestID, ClientVersion, Validate
- [x] Error handling: AppError, error-codes (40+ codici IT), error-handler
- [x] Sistema di response standardizzato
- [x] Route versionate `/api/v1/`

### Sprint 2 — Register
- [x] `POST /api/v1/auth/register`
- [x] User model (schema completo, tutti gli indici)
- [x] Session model
- [x] UserPrekeys model (Signal Protocol)
- [x] User repository
- [x] Session repository
- [x] Zod schema RegisterSchema
- [x] Password Argon2id (64MB / 3 iter / 4 parallel)
- [x] JWT ES256 con kid + strategia rotazione chiavi

### Sprint 3 — Login
- [x] `POST /api/v1/auth/login` (username o email)
- [x] Rate limiting (sliding window, Redis-optional)
- [x] Device Trust (login_count, is_trusted dopo 3 login)
- [x] Anti-enumeration (risposta identica per utente non trovato / password errata)
- [x] Blocco account dopo soglie: 10/20/30 tentativi
- [x] Username blacklist (40+ riservati + RESERVED_USERNAMES_EXTRA env)
- [x] ASCII-only decision documentata (anti-omograf attack)
- [x] Audit log: USER_REGISTERED, USER_LOGIN, NEW_DEVICE_LOGIN, USER_LOGIN_FAILED, ACCOUNT_LOCKED

### Sprint 4 — Token + Logout
- [x] `POST /api/v1/auth/refresh` con rotazione obbligatoria
- [x] Refresh Token Family (family_id) — audit trail + theft detection
- [x] REFRESH_TOKEN_REUSED → revoca tutte le sessioni + REFRESH_TOKEN_REUSED audit
- [x] `POST /api/v1/auth/logout` — revoca sessione corrente + JTI blocklist
- [x] `POST /api/v1/auth/logout-all` — revoca tutte le sessioni
- [x] JTI blocklist Redis (revoca immediata AT senza attendere scadenza)
- [x] Middleware `authenticate` per route protette
- [x] Audit: REFRESH_TOKEN_REUSED, USER_LOGOUT, USER_LOGOUT_ALL, SESSION_REVOKED_ALL

---

## Decisioni architetturali bloccate

| Decisione | Scelta | Motivazione |
|---|---|---|
| E2E encryption | Signal Protocol | Trust è il prodotto |
| JWT algorithm | ES256 (ECDSA P-256) | Moderno, compatto |
| JWT revocation | Redis JTI blocklist | Revoca immediata |
| Password | Argon2id 64MB/3i/4p | OWASP 2024 |
| Phone | HMAC-SHA256 + pepper | Anti dictionary attack |
| Username | ASCII-only `[a-z0-9_.]` | Anti-omograph attack |
| Refresh token | SHA-256 in DB, rotazione obbligatoria | S-02 invariant |
| Token family | family_id UUID immutabile | Audit trail + theft detection |

---

## Numeri finali M1

| Metrica | Valore |
|---|---|
| Endpoint auth | 5 (register, login, refresh, logout, logout-all) |
| Test | 79/79 ✅ |
| Errori TypeScript | 0 |
| Regressioni | 0 |
| Sprint | 4 |
| Voto advisor | media 9.6/10 |

---

## Cosa rimane fuori da M1 (backlog auth)

- 2FA TOTP (`POST /auth/2fa/enable`, `/auth/2fa/verify`) — Sprint 5+
- Forgot password / reset via email — Sprint 5+
- OAuth (Google, Apple) — V2
- GeoIP lookup reale (oggi: stub, restituisce null) — Sprint 5
- WebSocket notification "nuovo dispositivo" — Sprint 7

---

## Prossimo: Sprint 5 — Users & Profiles

Obiettivo: ricerca utenti, profilo pubblico, privacy profilo.
Primo endpoint del "cuore" di Alpha Chat.
