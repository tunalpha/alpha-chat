# 08 — Authentication Flow
**Alpha Chat — Documento di Architettura**
*Versione 1.0 — Luglio 2026*

> **Scopo di questo documento**
> Descrivere il flusso completo di autenticazione prima di scrivere una riga di codice.
> Non è una spec API (quella è in `06_API.md`). È il modello mentale condiviso che governa ogni decisione implementativa.
>
> Regola: se il codice fa qualcosa che non è descritto qui, il codice è sbagliato — non il documento.

---

## Indice

1. [Concetti fondamentali](#1-concetti-fondamentali)
2. [Device Trust Model](#2-device-trust-model)
3. [Registrazione](#3-registrazione)
4. [Login](#4-login)
5. [Login con 2FA (TOTP)](#5-login-con-2fa-totp)
6. [Refresh Token](#6-refresh-token)
7. [Logout](#7-logout)
8. [Logout da tutti i dispositivi](#8-logout-da-tutti-i-dispositivi)
9. [Notifica nuovo dispositivo](#9-notifica-nuovo-dispositivo)
10. [Sessione scaduta](#10-sessione-scaduta)
11. [Refresh token compromesso](#11-refresh-token-compromesso)
12. [Cambio password](#12-cambio-password)
13. [Password dimenticata](#13-password-dimenticata)
14. [Nuovo dispositivo — Signal key provisioning](#14-nuovo-dispositivo--signal-key-provisioning)
15. [Revoca dispositivo remoto](#15-revoca-dispositivo-remoto)
16. [Cambio username](#16-cambio-username)
17. [Eliminazione account](#17-eliminazione-account)
18. [Matrice di sicurezza](#18-matrice-di-sicurezza)

---

## 1. Concetti fondamentali

### Token model

```
┌─────────────────────────────────────────────────────────────┐
│                      ACCESS TOKEN (JWT)                      │
│                                                              │
│  Algoritmo:  ES256 (ECDSA P-256)                             │
│  Durata:     15 minuti                                       │
│  Payload:    { sub, jti, device_id, roles, iat, exp }        │
│  Revoca:     jti → blocklist Redis (TTL = exp - now)         │
│  Trasporto:  Header  Authorization: Bearer <token>           │
│  Storage:    Solo in memoria (mai localStorage/cookie)       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     REFRESH TOKEN                            │
│                                                              │
│  Formato:    rt_<ULID>  (es. rt_01HZ8K4J7PQRST...)          │
│  Durata:     30 giorni                                       │
│  Rotazione:  Sì — ogni uso genera un nuovo RT                │
│  Storage DB: SHA-256(token) nella collection sessions        │
│  Mai in chiaro nel DB. Mai nel JWT.                          │
│  Trasporto:  Body JSON (non cookie, app mobile)              │
└─────────────────────────────────────────────────────────────┘
```

### Invarianti di sicurezza (non derogabili)

| # | Regola |
|---|--------|
| S-01 | Il server non conserva mai un refresh token in chiaro. Solo SHA-256(token). |
| S-02 | Un refresh token usato viene immediatamente revocato (rotation). |
| S-03 | Se un refresh token revocato viene usato di nuovo → revoca di TUTTE le sessioni dell'utente (token theft detection). |
| S-04 | La password non viene mai loggata, mai restituita, mai trasmessa in chiaro. |
| S-05 | Le chiavi private Signal non lasciano mai il dispositivo. Il server vede solo le chiavi pubbliche. |
| S-06 | Ogni device ha il proprio `jti` nello access token. La revoca di un device non tocca gli altri. |
| S-07 | Il `device_id` è generato dal client al primo avvio (UUID v4) e non cambia mai per quel dispositivo. |

---

## 2. Device Trust Model

Ogni sessione attiva corrisponde a un dispositivo fidato. L'utente può vedere e gestire i propri dispositivi in `Impostazioni → Dispositivi`.

### Struttura di un dispositivo fidato

```
┌──────────────────────────────────────────────────────────┐
│  DISPOSITIVO FIDATO                                       │
│                                                           │
│  device_id:       550e8400-e29b-41d4-a716-446655440001   │
│  device_name:     "iPhone 16 Pro di Marco"               │
│  device_type:     ios | android | web | desktop          │
│  first_seen_at:   2026-07-15T19:42:00.000Z               │
│  last_active_at:  2026-07-15T23:11:00.000Z               │
│  ip_country:      IT (risolto al momento del login)      │
│  signal_keys:     IK pubblica + SPK corrente             │
│  status:          active | revoked                       │
└──────────────────────────────────────────────────────────┘
```

### Come appare nell'app

```
DISPOSITIVI ATTIVI

  📱 iPhone 16 Pro                    ← questo dispositivo
     Italia · Online ora

  💻 MacBook Pro
     Italia · Ultimo accesso ieri

  💻 Windows PC
     Tunisia · Ultimo accesso 3 giorni fa   ⚠️

  🗑 Samsung Galaxy S22               ← revocato
     Revocato il 10 luglio 2026

                        [+ Disconnetti tutti gli altri]
```

---

## 3. Registrazione

```
CLIENT                          SERVER                          DATABASE
  │                                │                               │
  │── POST /api/v1/auth/register ─→│                               │
  │   { username, password,        │                               │
  │     email?, phone?,            │                               │
  │     device_id, device_name,    │                               │
  │     device_type }              │                               │
  │                                │                               │
  │                                ├─ Valida body (Zod) ──────────→│
  │                                │  • username: 3-30 chars       │
  │                                │  • password: min 8 chars,     │
  │                                │    1 maiusc, 1 numero         │
  │                                │                               │
  │                                ├─ Username già esiste? ────────→ users.findOne({username})
  │                                │                               │
  │←── 409 USERNAME_TAKEN ─────────┤  (se sì)                      │
  │                                │                               │
  │                                ├─ Email già esiste? ───────────→ users.findOne({email})
  │←── 409 EMAIL_TAKEN ────────────┤  (se sì)                      │
  │                                │                               │
  │                                ├─ Phone già esiste? ───────────→ users.findOne({phone_hash})
  │←── 409 PHONE_TAKEN ────────────┤  (se sì) HMAC-SHA256(phone)   │
  │                                │                               │
  │                                ├─ Hash password ───────────────│
  │                                │  Argon2id(password, salt)     │
  │                                │                               │
  │                                ├─ Crea utente ─────────────────→ users.insertOne({
  │                                │                               │   _id, username,
  │                                │                               │   password_hash,
  │                                │                               │   phone_hash?,
  │                                │                               │   created_at, ...
  │                                │                               │ })
  │                                │                               │
  │                                ├─ Genera Signal keys ──────────→ signal_keys.insertOne({
  │                                │  (IK, SPK, OPKs × 100)       │   user_id, device_id,
  │                                │  [vengono inviate dal client] │   identity_key,
  │                                │                               │   signed_prekey,
  │                                │                               │   one_time_prekeys[]
  │                                │                               │ })
  │                                │                               │
  │                                ├─ Genera access token ─────────│
  │                                │  JWT ES256                    │
  │                                │  { sub: user_id, jti, device_id,
  │                                │    exp: now+15min }           │
  │                                │                               │
  │                                ├─ Genera refresh token ────────→ sessions.insertOne({
  │                                │  rt_<ULID>                    │   user_id, device_id,
  │                                │  SHA-256 → DB                 │   device_name, device_type,
  │                                │                               │   refresh_token_hash,
  │                                │                               │   expires_at: now+30d,
  │                                │                               │   ip_country,
  │                                │                               │   first_seen_at: now,
  │                                │                               │   last_active_at: now
  │                                │                               │ })
  │                                │                               │
  │←── 201 Created ────────────────┤                               │
  │    { user, access_token,       │                               │
  │      refresh_token,            │                               │
  │      expires_at }              │                               │
  │                                │                               │
  │ [Naviga a Home]                │                               │
```

### Note di implementazione — Registrazione

- Le chiavi Signal (IK, SPK, OPKs) vengono **generate sul client** prima di inviare la richiesta. Il server riceve solo le chiavi pubbliche. Le private non viaggiano mai.
- La SPK deve essere firmata dalla IK prima di essere inviata (verifica lato server con `crypto.verify`).
- Il `device_id` (UUID v4) viene generato dal client al primo avvio e persistito nello storage locale. Non cambia mai.
- Il check `username`, `email`, `phone` deve avvenire in questo ordine per restituire l'errore più specifico possibile.
- `phone_hash` = `HMAC-SHA256(normalize(phone), SERVER_PHONE_PEPPER)` dove `normalize` rimuove spazi e porta in formato E.164.

---

## 4. Login

```
CLIENT                          SERVER                          DATABASE / REDIS
  │                                │                                │
  │── POST /api/v1/auth/login ────→│                                │
  │   { identifier,  ← username o email                            │
  │     password,                  │                                │
  │     device_id,                 │                                │
  │     device_name,               │                                │
  │     device_type }              │                                │
  │                                │                                │
  │                                ├─ Cerca utente ────────────────→ users.findOne(
  │                                │                                │  { $or: [username, email] })
  │←── 401 INVALID_CREDENTIALS ───┤  (se non trovato)              │
  │                                │                                │
  │                                ├─ Account sospeso? ─────────────│
  │←── 403 ACCOUNT_SUSPENDED ─────┤                                │
  │                                │                                │
  │                                ├─ Account bloccato? ────────────→ Redis: login_attempts:{user_id}
  │←── 423 ACCOUNT_LOCKED ────────┤  (se > 10 tentativi falliti)   │
  │                                │                                │
  │                                ├─ Verifica password ────────────│
  │                                │  Argon2id.verify(hash, input) │
  │                                │                                │
  │                                │  [se errata]                   │
  │                                ├─ Incrementa contatore ────────→ Redis: INCR login_attempts:{user_id}
  │                                │  (TTL sliding 1h)              │   EXPIRE 3600
  │←── 401 INVALID_CREDENTIALS ───┤                                │
  │                                │                                │
  │                                │  [se corretta]                 │
  │                                ├─ Azzera contatore ────────────→ Redis: DEL login_attempts:{user_id}
  │                                │                                │
  │                                ├─ 2FA abilitato? ───────────────→ users.totp_enabled
  │                                │                                │
  │                                │  [se sì → flusso 5]           │
  │                                │  [se no → continua]           │
  │                                │                                │
  │                                ├─ Sessione device già esiste? ─→ sessions.findOne(
  │                                │                                │  { user_id, device_id })
  │                                │  [se sì: aggiorna]             │
  │                                │  [se no: crea nuova]           │
  │                                │                                │
  │                                ├─ Genera access token + RT ─────│
  │                                │  (come in Registrazione)       │
  │                                │                                │
  │                                ├─ Nuovo device? ────────────────→ [flusso 9: notifica]
  │                                │                                │
  │←── 200 OK ─────────────────────┤                                │
  │    { user, access_token,       │                                │
  │      refresh_token,            │                                │
  │      requires_2fa: false }     │                                │
```

### Soglie di blocco

| Tentativi | Azione |
|-----------|--------|
| 5 | Warning silenzioso (log) |
| 10 | Blocco account 15 minuti |
| 20 | Blocco account 1 ora + email di avviso |
| 30 | Blocco account 24 ore + email di avviso urgente |

---

## 5. Login con 2FA (TOTP)

```
CLIENT                          SERVER                          DATABASE / REDIS
  │                                │                                │
  │── POST /api/v1/auth/login ────→│                                │
  │   (password corretta,          │                                │
  │    2FA abilitato)              │                                │
  │                                │                                │
  │                                ├─ Genera challenge token ──────→ Redis: totp_challenge:{token}
  │                                │  chall_<ULID>                 │   = { user_id, device_id,
  │                                │  TTL: 5 minuti                │     device_name, attempt: 0 }
  │                                │                               │   EXPIRE 300
  │                                │                                │
  │←── 200 OK ─────────────────────┤                                │
  │    { requires_2fa: true,       │                                │
  │      totp_challenge_token,     │                                │
  │      totp_challenge_expires_at }│                               │
  │                                │                                │
  │  [Mostra schermata TOTP]       │                                │
  │                                │                                │
  │── POST /api/v1/auth/2fa/verify→│                                │
  │   { totp_challenge_token,      │                                │
  │     code: "123456" }           │                                │
  │                                │                                │
  │                                ├─ Legge challenge ─────────────→ Redis: GET totp_challenge:{token}
  │←── 401 TOTP_CHALLENGE_EXPIRED ─┤  (se non esiste)               │
  │                                │                                │
  │                                ├─ Tentativi > 5? ───────────────→ Redis: challenge.attempt
  │←── 429 TOTP_TOO_MANY_ATTEMPTS ─┤                                │
  │                                │                                │
  │                                ├─ Verifica codice TOTP ─────────→ users.totp_secret
  │                                │  RFC 6238 (finestra ±1)        │
  │                                │                                │
  │                                │  [se errato]                   │
  │                                ├─ Incrementa attempt ──────────→ Redis: INCR challenge.attempt
  │←── 401 TOTP_CODE_INVALID ──────┤                                │
  │                                │                                │
  │                                │  [se corretto]                 │
  │                                ├─ Elimina challenge ───────────→ Redis: DEL totp_challenge:{token}
  │                                ├─ Genera access token + RT ─────│
  │                                │  (come login normale)          │
  │                                │                                │
  │←── 200 OK ─────────────────────┤                                │
  │    { user, access_token,       │                                │
  │      refresh_token }           │                                │
```

---

## 6. Refresh Token

```
CLIENT                          SERVER                          DATABASE / REDIS
  │                                │                                │
  │  [Access token scaduto]        │                                │
  │                                │                                │
  │── POST /api/v1/auth/refresh ──→│                                │
  │   { refresh_token }            │                                │
  │                                │                                │
  │                                ├─ Hash RT in input ─────────────│
  │                                │  SHA-256(refresh_token)        │
  │                                │                                │
  │                                ├─ Cerca sessione ──────────────→ sessions.findOne(
  │                                │                                │  { refresh_token_hash })
  │←── 401 REFRESH_TOKEN_INVALID ──┤  (se non trovata)              │
  │                                │                                │
  │                                ├─ Sessione scaduta? ────────────│
  │←── 401 REFRESH_TOKEN_EXPIRED ──┤  (se expires_at < now)         │
  │                                │                                │
  │                                ├─ Token già revocato? ──────────→ [flusso 11]
  │                                │  (status = revoked)            │
  │                                │                                │
  │                                ├─ Genera nuovo RT ──────────────│
  │                                │  rt_<ULID>                     │
  │                                │                                │
  │                                ├─ Aggiorna sessione ───────────→ sessions.updateOne({
  │                                │  (rotazione atomica)           │   refresh_token_hash: SHA-256(newRT),
  │                                │                                │   last_active_at: now,
  │                                │                                │   expires_at: now+30d
  │                                │                                │ })
  │                                │                                │
  │                                ├─ Invalida vecchio AT ──────────→ Redis: SET jti_blocklist:{jti}
  │                                │  (se passato nel body)         │   EX (exp - now)
  │                                │                                │
  │                                ├─ Genera nuovo AT ──────────────│
  │                                │  nuovo jti                     │
  │                                │                                │
  │←── 200 OK ─────────────────────┤                                │
  │    { access_token, refresh_token,│                              │
  │      expires_at }              │                                │
```

> **Nota:** La rotazione è atomica. Se l'update del DB fallisce, il nuovo RT non viene restituito. Il vecchio è ancora valido.

---

## 7. Logout

```
CLIENT                          SERVER                          DATABASE / REDIS
  │                                │                                │
  │── POST /api/v1/auth/logout ───→│                                │
  │   Authorization: Bearer <AT>   │                                │
  │   { refresh_token }            │                                │
  │                                │                                │
  │                                ├─ Revoca AT ───────────────────→ Redis: SET jti_blocklist:{jti}
  │                                │                                │   EX (exp - now)
  │                                │                                │
  │                                ├─ Revoca sessione ─────────────→ sessions.updateOne(
  │                                │                                │  { refresh_token_hash: SHA-256(RT) },
  │                                │                                │  { deleted_at: now })
  │                                │                                │
  │                                ├─ Deregistra push token ────────→ sessions.updateOne(
  │                                │                                │  { push_token: null })
  │                                │                                │
  │←── 204 No Content ─────────────┤                                │
  │                                │                                │
  │  [Cancella AT e RT da memoria] │                                │
  │  [Naviga a Login]              │                                │
```

---

## 8. Logout da tutti i dispositivi

```
CLIENT                          SERVER                          DATABASE / REDIS
  │                                │                                │
  │── POST /api/v1/auth/logout/all─→│                               │
  │   Authorization: Bearer <AT>   │                                │
  │   { refresh_token }            │                                │
  │                                │                                │
  │                                ├─ Carica tutte le sessioni ────→ sessions.find({ user_id })
  │                                │                                │
  │                                ├─ Revoca tutti gli AT attivi ──→ Redis: MSET
  │                                │  (per ogni sessione con AT     │   jti_blocklist:{jti_1} EX ...
  │                                │   ancora valido)               │   jti_blocklist:{jti_2} EX ...
  │                                │                                │
  │                                ├─ Revoca tutte le sessioni ────→ sessions.updateMany(
  │                                │                                │  { user_id },
  │                                │                                │  { deleted_at: now })
  │                                │                                │
  │                                ├─ Emette WebSocket event ───────→ WS: security.force_logout
  │                                │  a tutti gli altri device      │   { reason: "user_requested" }
  │                                │                                │
  │←── 204 No Content ─────────────┤                                │
```

---

## 9. Notifica nuovo dispositivo

Quando un utente fa login da un dispositivo che non ha mai usato, **tutti gli altri dispositivi attivi** ricevono una notifica di sicurezza.

```
SERVER                          DISPOSITIVI ESISTENTI
  │                                │
  ├─ Nuovo login rilevato          │
  │  device_id non in sessions     │
  │                                │
  ├─ Carica sessioni attive ───────→ sessions.find(
  │                                │  { user_id, deleted_at: null })
  │                                │
  ├─ Per ogni device attivo ───────→ Push notification:
  │                                │
  │                                │  ┌─────────────────────────────┐
  │                                │  │ 🔐 Nuovo accesso a Alpha Chat│
  │                                │  │                             │
  │                                │  │  iPhone 16 Pro              │
  │                                │  │  Tunisi, Tunisia            │
  │                                │  │  Oggi 19:42                 │
  │                                │  │                             │
  │                                │  │  Era un tuo accesso?        │
  │                                │  │                             │
  │                                │  │  [Sì, ero io]  [No, blocca] │
  │                                │  └─────────────────────────────┘
  │                                │
```

### Risposta dell'utente

**"Sì, ero io"** → Nessuna azione. Notifica chiusa.

**"No, blocca"** →
```
  [Tap "No, blocca"]
        │
        ├─ POST /api/v1/auth/logout/all
        │  (con AT del device che ha ricevuto la notifica)
        │
        ├─ Tutte le sessioni revocate (incluso il nuovo device sospetto)
        │
        ├─ Mostra schermata: "Tutte le sessioni sono state disconnesse.
        │                     Cambia la tua password."
        │
        └─ Redirect a cambio password forzato
```

### Implementazione

- Il `device_id` del nuovo login viene confrontato con tutti i `sessions.device_id` esistenti dell'utente.
- Se non è presente → `is_new_device = true`.
- La notifica viene inviata tramite Expo Push a tutti i device con `push_token != null`.
- Il payload push include: `new_device_name`, `new_device_type`, `ip_country`, `timestamp`.
- La notifica ha `priority: "high"` per passare in modalità Do Not Disturb.
- Il client gestisce il tap aprendo direttamente la schermata di conferma (deep link).

---

## 10. Sessione scaduta

```
CLIENT                          SERVER
  │                                │
  │  [AT scaduto — exp < now]      │
  │                                │
  │── Qualsiasi request ──────────→│
  │   Authorization: Bearer <AT>   │
  │                                │
  │                                ├─ Verifica JWT exp
  │←── 401 AUTH_TOKEN_EXPIRED ─────┤
  │                                │
  │  [Interceptor HTTP]            │
  │  Prova silenzioso refresh ─────→ POST /api/v1/auth/refresh
  │                                │   { refresh_token }
  │                                │
  │    [se successo]               │
  │    Aggiorna AT in memoria      │
  │    Riprova request originale   │
  │                                │
  │    [se RT scaduto / invalido]  │
  │    Cancella tutto da memoria   │
  │    Naviga a Login              │
  │    Mostra: "Sessione scaduta.  │
  │    Accedi di nuovo."           │
```

> Il client deve implementare un **interceptor** (Axios / fetch wrapper) che gestisce questo flusso in modo trasparente per l'utente. L'utente non deve vedere l'errore 401 — deve vedere solo il risultato della request originale.

---

## 11. Refresh token compromesso

Quando un refresh token **già revocato** viene usato, significa che qualcuno lo aveva rubato. Il server reagisce in modo aggressivo.

```
CLIENT LEGITTIMO                SERVER                  CLIENT ATTACCANTE
  │                               │                          │
  │  [Refresh normale in corso]   │                          │
  │                               │←── POST /auth/refresh ───┤
  │                               │    { refresh_token: RT_X }
  │                               │    (RT_X era già stato
  │                               │     ruotato e revocato)
  │                               │
  │                               ├─ Cerca SHA-256(RT_X) → trovato, status = revoked
  │                               │
  │                               ├─ ⚠️  ATTACCO RILEVATO
  │                               │
  │                               ├─ Revoca TUTTE le sessioni ────→ sessions.updateMany(
  │                               │  dell'utente                   │  { user_id: X },
  │                               │                                │  { deleted_at: now })
  │                               │
  │                               ├─ Invalida TUTTI gli AT ────────→ Redis: MSET jti_blocklist:*
  │                               │
  │                               ├─ Emette WS event ──────────────→ security.session_revoked
  │                               │  a tutti i device               { reason: "token_reuse_detected" }
  │                               │
  │←── WS: force_logout ──────────┤
  │    reason: token_reuse         │←── 401 REFRESH_TOKEN_REUSED ───┤
  │                               │
  │  [Tutti i device vengono      │
  │   disconnessi]                │
  │                               │
  │  [Schermata: "Per la tua      │
  │   sicurezza, tutte le sessioni│
  │   sono state revocate.        │
  │   Un token di accesso sembra  │
  │   compromesso. Cambia la tua  │
  │   password."]                 │
```

---

## 12. Cambio password

```
CLIENT                          SERVER                          DATABASE
  │                                │                                │
  │── PUT /api/v1/users/me/password→│                               │
  │   Authorization: Bearer <AT>   │                                │
  │   { current_password,          │                                │
  │     new_password }             │                                │
  │                                │                                │
  │                                ├─ Verifica AT valido ───────────│
  │                                ├─ Carica utente ───────────────→ users.findOne({ _id: sub })
  │                                ├─ Verifica current_password ────│
  │                                │  Argon2id.verify(hash, input) │
  │←── 401 INVALID_CREDENTIALS ────┤  (se errata)                   │
  │                                │                                │
  │                                ├─ Hash nuova password ──────────│
  │                                │  Argon2id(new_password, salt) │
  │                                │                                │
  │                                ├─ Aggiorna password ───────────→ users.updateOne(
  │                                │                                │  { password_hash: newHash,
  │                                │                                │    password_changed_at: now })
  │                                │                                │
  │                                ├─ Revoca TUTTE le altre sessioni→ sessions.updateMany(
  │                                │  (tutte tranne quella corrente)│  { user_id, device_id: {$ne: current} },
  │                                │                                │  { deleted_at: now })
  │                                │                                │
  │                                ├─ Emette WS event ──────────────→ security.password_changed
  │                                │  a tutti gli altri device       { revoked_at: now }
  │                                │                                │
  │←── 204 No Content ─────────────┤                                │
  │                                │                                │
  │  [Mostra: "Password cambiata   │                                │
  │   con successo. Gli altri      │                                │
  │   dispositivi sono stati       │                                │
  │   disconnessi."]               │                                │
```

---

## 13. Password dimenticata

```
CLIENT                          SERVER                          DATABASE / REDIS
  │                                │                                │
  │── POST /api/v1/auth/           │                                │
  │      forgot-password ─────────→│                                │
  │   { email }                    │                                │
  │                                │                                │
  │                                ├─ Risponde SEMPRE 200 ──────────│
  │←── 200 OK ─────────────────────┤  (anti-enumeration)            │
  │    { message: "Se l'email      │                                │
  │      è registrata, riceverai   │                                │
  │      le istruzioni." }         │                                │
  │                                │                                │
  │                                ├─ Cerca utente per email (async)→ users.findOne({ email })
  │                                │                                │
  │                                │  [se non trovato: stop silenzioso]
  │                                │                                │
  │                                ├─ Genera reset token ──────────→ Redis: SET pwd_reset:{token}
  │                                │  reset_<ULID>                 │   = { user_id }
  │                                │  TTL: 1 ora                   │   EXPIRE 3600
  │                                │                                │
  │                                ├─ Invia email ──────────────────│
  │                                │  Link: https://app.alphachat. │
  │                                │  app/reset-password?token=... │
  │                                │                                │
  │  [Utente apre link]            │                                │
  │                                │                                │
  │── POST /api/v1/auth/           │                                │
  │      reset-password ──────────→│                                │
  │   { token, new_password }      │                                │
  │                                │                                │
  │                                ├─ Legge token ─────────────────→ Redis: GET pwd_reset:{token}
  │←── 400 TOKEN_INVALID ──────────┤  (se non esiste o scaduto)     │
  │                                │                                │
  │                                ├─ Hash nuova password ──────────│
  │                                ├─ Aggiorna password ───────────→ users.updateOne({password_hash})
  │                                ├─ Elimina token ───────────────→ Redis: DEL pwd_reset:{token}
  │                                ├─ Revoca TUTTE le sessioni ────→ sessions.updateMany(
  │                                │                                │  { user_id, deleted_at: now })
  │                                │                                │
  │←── 200 OK ─────────────────────┤                                │
  │    { message: "Password        │                                │
  │      reimpostata con successo"}│                                │
  │                                │                                │
  │  [Redirect a Login]            │                                │
```

---

## 14. Nuovo dispositivo — Signal key provisioning

Ogni dispositivo ha le sue chiavi Signal. Quando un utente aggiunge un nuovo device, le chiavi vengono generate sul client **prima** di inviare qualsiasi richiesta.

```
NUOVO DEVICE (CLIENT)           SERVER                          DATABASE
  │                                │                                │
  │  [Al primo avvio / nuovo login]│                                │
  │                                │                                │
  │  1. Genera device_id ──────────│  UUID v4, persistito nello     │
  │     (se non esiste già)         │  storage locale                │
  │                                │                                │
  │  2. Genera Signal keys ────────│                                │
  │     • Identity Key (IK)        │  Curve25519 key pair           │
  │       - privata: storage locale│  Permanente per questo device  │
  │       - pubblica: inviata al server                             │
  │     • Signed PreKey (SPK)      │  Ruotata ogni 7 giorni         │
  │       - firma: IK.sign(SPK.pub)│                                │
  │     • One-Time PreKeys (OPK) × 100                             │
  │       - generate in batch      │  Monouso (X3DH)                │
  │                                │                                │
  │── POST /api/v1/auth/register   │                                │
  │   oppure /auth/login ─────────→│                                │
  │   (con signal_keys nel body)   │                                │
  │                                │                                │
  │                                ├─ Verifica firma SPK ───────────│
  │                                │  crypto.verify(SPK.pub,        │
  │                                │    SPK.signature, IK.pub)      │
  │←── 400 VALIDATION_ERROR ───────┤  (se firma invalida)           │
  │                                │                                │
  │                                ├─ Salva chiavi ────────────────→ signal_keys.insertOne({
  │                                │                                │   user_id, device_id,
  │                                │                                │   identity_key,
  │                                │                                │   signed_prekey,
  │                                │                                │   one_time_prekeys: [100],
  │                                │                                │   created_at: now
  │                                │                                │ })
  │                                │                                │
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  DOPO IL LOGIN — Rifornimento OPK                                 ║
  ╚═══════════════════════════════════════════════════════════════════╝
  │                                │                                │
  │── GET /api/v1/devices/         │                                │
  │      prekeys/status ──────────→│                                │
  │                                ├───────────────────────────────→ signal_keys.one_time_prekeys.length
  │←── { one_time_prekeys_count: 3}│                                │
  │                                │                                │
  │  [Se count < 20]               │                                │
  │  Genera 100 nuove OPK          │                                │
  │                                │                                │
  │── PUT /api/v1/devices/prekeys ─→│                               │
  │   { one_time_prekeys: [100] }  │                                │
  │                                ├───────────────────────────────→ signal_keys.updateOne({
  │                                │                                │  $push: { one_time_prekeys }
  │                                │                                │ })
  │←── 200 OK ─────────────────────┤                                │
```

---

## 15. Revoca dispositivo remoto

```
CLIENT (device A)               SERVER                          DATABASE / REDIS
  │                                │                                │
  │── DELETE /api/v1/devices/      │                                │
  │      :session_id ─────────────→│                                │
  │   Authorization: Bearer <AT>   │                                │
  │                                │                                │
  │                                ├─ Verifica ownership ───────────→ sessions.findOne(
  │                                │  session_id appartiene         │  { _id: session_id,
  │                                │  all'utente corrente?          │    user_id: sub })
  │←── 404 NOT_FOUND ──────────────┤  (se non trovata)              │
  │                                │                                │
  │                                ├─ Revoca sessione ─────────────→ sessions.updateOne(
  │                                │                                │  { deleted_at: now })
  │                                │                                │
  │                                ├─ Invalida AT ─────────────────→ Redis: SET jti_blocklist:{jti}
  │                                │  (se ancora valido)            │
  │                                │                                │
  │                                ├─ Emette WS event ──────────────→ WS al device B revocato:
  │                                │                                │  security.session_revoked
  │                                │                                │  { reason: "remote_revoke",
  │                                │                                │    revoked_by_device: A }
  │                                │                                │
  │←── 204 No Content ─────────────┤                                │
  │                                │                                │
  ╔═══════════════════════════════╗ │                                │
  ║  DEVICE B (revocato)          ║ │                                │
  ╚═══════════════════════════════╝ │                                │
  │                                │                                │
  │  [Riceve WS event]             │                                │
  │  [Cancella AT e RT da memoria] │                                │
  │  [Mostra: "Questo dispositivo  │                                │
  │   è stato disconnesso da un    │                                │
  │   altro dispositivo."]         │                                │
  │  [Naviga a Login]              │                                │
```

---

## 16. Cambio username

```
CLIENT                          SERVER                          DATABASE
  │                                │                                │
  │── PUT /api/v1/users/me/        │                                │
  │      username ────────────────→│                                │
  │   Authorization: Bearer <AT>   │                                │
  │   { username: "nuovo_user" }   │                                │
  │                                │                                │
  │                                ├─ Verifica AT valido ───────────│
  │                                ├─ Username disponibile? ────────→ users.findOne({username})
  │←── 409 USERNAME_TAKEN ─────────┤  (se occupato)                 │
  │                                │                                │
  │                                ├─ Controllo cooldown ───────────→ users.username_changed_at
  │                                │  Cambio bloccato se            │
  │                                │  username_changed_at > 30gg fa│
  │←── 429 USERNAME_CHANGE_TOO_SOON┤                                │
  │                                │                                │
  │                                ├─ Aggiorna username ───────────→ users.updateOne({
  │                                │                                │   username: nuovo,
  │                                │                                │   username_changed_at: now
  │                                │                                │ })
  │                                │                                │
  │←── 200 OK ─────────────────────┤                                │
  │    { user: { username: nuovo } }│                               │
```

**Regola:** Un utente può cambiare username al massimo **ogni 30 giorni**. Questo previene abusi e impersonation.

---

## 17. Eliminazione account

```
CLIENT                          SERVER                          DATABASE
  │                                │                                │
  │── DELETE /api/v1/users/me ────→│                                │
  │   Authorization: Bearer <AT>   │                                │
  │   { password }                 │                                │
  │                                │                                │
  │                                ├─ Verifica password ────────────│
  │←── 401 INVALID_CREDENTIALS ────┤  (se errata)                   │
  │                                │                                │
  │                                ├─ Avvia periodo di grazia ─────→ users.updateOne({
  │                                │  30 giorni                     │   status: "pending_deletion",
  │                                │                                │   deletion_scheduled_at: now+30d
  │                                │                                │ })
  │                                │                                │
  │                                ├─ Revoca tutte le sessioni ────→ sessions.updateMany(
  │                                │                                │  { user_id, deleted_at: now })
  │                                │                                │
  │                                ├─ Invia email di conferma ──────│
  │                                │  "Il tuo account verrà elim.  │
  │                                │   il [data]. Per annullare,   │
  │                                │   accedi di nuovo entro       │
  │                                │   30 giorni."                 │
  │                                │                                │
  │←── 200 OK ─────────────────────┤                                │
  │    { deletion_scheduled_at }   │                                │
  │                                │                                │
  │  [Naviga a schermata di        │                                │
  │   conferma eliminazione]       │                                │
  │                                │                                │
  ╔════════════════════════════════════════════════════════════════╗
  ║  PERIODO DI GRAZIA (30 giorni)                                 ║
  ╚════════════════════════════════════════════════════════════════╝
  │                                │                                │
  │  [Login durante il periodo     │                                │
  │   di grazia]                   │                                │
  │                                │                                │
  │── POST /api/v1/auth/login ────→│                                │
  │                                │                                │
  │                                ├─ Account in pending_deletion? ─│
  │                                │  [sì: mostra dialog]           │
  │                                │                                │
  │←── 200 OK + flag ──────────────┤                                │
  │    { account_pending_deletion: │                                │
  │      { scheduled_at, days_left }}                               │
  │                                │                                │
  │  [Dialog: "Il tuo account      │                                │
  │   verrà eliminato tra X giorni.│                                │
  │   Vuoi annullare?"]            │                                │
  │                                │                                │
  │── POST /api/v1/users/me/       │                                │
  │      cancel-deletion ─────────→│                                │
  │                                ├───────────────────────────────→ users.updateOne({
  │                                │                                │   status: "active",
  │                                │                                │   deletion_scheduled_at: null
  │                                │                                │ })
  │←── 200 OK ─────────────────────┤                                │
  │                                │                                │
  ╔════════════════════════════════════════════════════════════════╗
  ║  DOPO 30 GIORNI (job schedulato)                               ║
  ╚════════════════════════════════════════════════════════════════╝
  │                                │                                │
  │                                ├─ Anonimizza dati ─────────────→ users.updateOne({
  │                                │  (GDPR — non elimina)          │   username: "[deleted]",
  │                                │                                │   email: null,
  │                                │                                │   phone_hash: null,
  │                                │                                │   status: "deleted",
  │                                │                                │   deleted_at: now
  │                                │                                │ })
  │                                ├─ Elimina Signal keys ─────────→ signal_keys.deleteMany({user_id})
  │                                ├─ Elimina media su R2 ──────────│
  │                                ├─ Mantiene messaggi ────────────│  (testo anonimizzato a "[deleted]")
```

---

## 18. Matrice di sicurezza

Riepilogo delle garanzie di sicurezza per ogni flusso.

| Flusso | Rate limit | Brute-force protection | Token revoca | Notifica utente |
|--------|-----------|----------------------|--------------|-----------------|
| Registrazione | 5/ora/IP | — | — | — |
| Login | 10/ora/IP | Blocco account progressivo | — | Push se nuovo device |
| Login 2FA | 5 tentativi per challenge | Challenge scadenza 5min | Challenge eliminato | — |
| Refresh | 60/ora/device | — | Rotazione obbligatoria | — |
| Logout | — | — | AT + RT revocati subito | — |
| Logout all | — | — | Tutte le sessioni revocate | WS event tutti i device |
| Token compromise | — | — | Tutte le sessioni revocate | WS event + push |
| Cambio password | 3/giorno | Password attuale richiesta | Tutte le altre sessioni | WS event altri device |
| Password dimenticata | 3/ora/email | Risposta sempre 200 | Reset token TTL 1h | Email |
| Revoca device remoto | — | Ownership verificata | AT + sessione revocati | WS event al device revocato |
| Eliminazione account | — | Password richiesta | Tutte le sessioni | Email + 30gg grazia |

---

## Riferimenti

| Documento | Contenuto correlato |
|-----------|---------------------|
| `04b_Security.md` | Decisioni crittografiche (Argon2id, ES256, HMAC-SHA256) |
| `05_Database.md` | Schema collections `users`, `sessions`, `signal_keys` |
| `06_API.md` | Specifica request/response/error per ogni endpoint |
| `07_Backend_Standards.md` | Struttura del codice, error handler, middleware stack |

---

*Alpha Chat — Authentication Flow v1.0 — Luglio 2026*
*Prossimo documento: `09_Auth_Implementation.md` (implementazione, 5-10 pagine)*
