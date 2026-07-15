# Alpha Chat — API Specification
### Specifica Definitiva — Livello Enterprise
> Versione 1.0 — Luglio 2025
> Status: Pre-Backend — Fonte di Verità per tutti gli endpoint
> Nessun endpoint viene implementato senza essere prima definito qui.
> NON modificare questa specifica in produzione senza revisione CTO + aggiornamento versione.

---

## Principi di Design

### Versioning
Tutte le API sono prefissate `/api/v1/`. Quando un breaking change è necessario, si crea `/api/v2/` e si mantiene `/api/v1/` per almeno 18 mesi con header `Deprecation` e `Sunset`.

### Formato Risposta Standard

**Successo:**
```json
{
  "data": { ... },
  "meta": {
    "request_id": "req_01HZ8K4J7PQRST",
    "timestamp": "2025-07-15T19:30:00.000Z"
  }
}
```

**Lista paginata:**
```json
{
  "data": [ ... ],
  "pagination": {
    "cursor": "eyJpZCI6Ijk4NyJ9",
    "has_more": true,
    "total": 1284
  },
  "meta": {
    "request_id": "req_01HZ8K4J7PQRST",
    "timestamp": "2025-07-15T19:30:00.000Z"
  }
}
```

**Errore:**
```json
{
  "error": {
    "code": "AUTH_TOKEN_EXPIRED",
    "message": "Il token di accesso è scaduto.",
    "field": null,
    "details": null,
    "docs": "https://api.alphachat.app/docs/errors/AUTH_TOKEN_EXPIRED"
  },
  "meta": {
    "request_id": "req_01HZ8K4J7PQRST",
    "timestamp": "2025-07-15T19:30:00.000Z"
  }
}
```

### Header Obbligatori (ogni request)
| Header | Valore | Note |
|---|---|---|
| `X-Client-Version` | `1.0.0` | Versione app — permette di bloccare versioni obsolete |
| `X-Device-ID` | `uuid-v4` | ID device generato al primo avvio, persistente |
| `X-Request-ID` | `uuid-v4` | Generato dal client — ritornato nel meta per il debug |
| `Accept-Language` | `it-IT` | Per messaggi di errore localizzati |
| `Authorization` | `Bearer <access_token>` | Tutti gli endpoint autenticati |

### Autenticazione
- **Access Token:** JWT ES256, TTL 15 minuti
- **Refresh Token:** opaque token, TTL 30 giorni, one-time use (rotation)
- **Revoca:** Redis blocklist su `jti` — effetto immediato

### Paginazione
Cursor-based. Mai offset/page. Il cursor è un base64 dell'`_id` MongoDB dell'ultimo documento restituito.

### Rate Limiting
Header di risposta standard:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1720996200
Retry-After: 42  (solo su 429)
```

### Codici HTTP Utilizzati
| Codice | Significato |
|---|---|
| `200` | OK |
| `201` | Created |
| `204` | No Content (delete, logout) |
| `400` | Bad Request — corpo malformato o validazione fallita |
| `401` | Unauthorized — token mancante o non valido |
| `403` | Forbidden — autenticato ma senza permessi |
| `404` | Not Found |
| `409` | Conflict — risorsa già esistente |
| `410` | Gone — risorsa eliminata definitivamente |
| `422` | Unprocessable Entity — validazione semantica fallita |
| `429` | Too Many Requests |
| `500` | Internal Server Error |
| `503` | Service Unavailable |

---

## Indice Moduli

| # | Modulo | Prefisso |
|---|---|---|
| 1 | Authentication | `/api/v1/auth` |
| 2 | Users | `/api/v1/users` |
| 3 | Usernames | `/api/v1/usernames` |
| 4 | Contacts | `/api/v1/contacts` |
| 5 | Chats | `/api/v1/chats` |
| 6 | Messages | `/api/v1/chats/:id/messages` |
| 7 | Message Reactions | `/api/v1/messages/:id/reactions` |
| 8 | Delete Message | `/api/v1/messages/:id` |
| 9 | Read Receipts | `/api/v1/chats/:id/read` |
| 10 | Typing | WebSocket |
| 11 | Presence | `/api/v1/presence` + WebSocket |
| 12 | Groups | `/api/v1/groups` |
| 13 | Channels | `/api/v1/channels` |
| 14 | Media | `/api/v1/media` |
| 15 | Calls | `/api/v1/calls` |
| 16 | Notifications | `/api/v1/notifications` |
| 17 | Reports | `/api/v1/reports` |
| 18 | Settings | `/api/v1/settings` |
| 19 | Devices | `/api/v1/devices` |
| 20 | Admin | `/api/v1/admin` |

---

## Modulo 1 — Authentication

### `POST /api/v1/auth/register`
Registra un nuovo account con username, password e numero di telefono (opzionale).

**Autenticazione:** Nessuna

**Rate Limit:** 5 richieste / ora / IP

**Request Body:**
```json
{
  "username": "marco_rossi",
  "display_name": "Marco Rossi",
  "password": "S3cur3P@ss!",
  "phone": "+39 335 123 4567",
  "email": "marco@example.com"
}
```
| Campo | Tipo | Required | Validazione |
|---|---|---|---|
| `username` | string | ✅ | 3-30 chars, `[a-z0-9_.]`, non può iniziare/finire con `.` |
| `display_name` | string | ✅ | 1-60 chars |
| `password` | string | ✅ | Min 8 chars, almeno 1 maiuscola, 1 numero |
| `phone` | string | ❌ | Formato E.164 |
| `email` | string | ❌ | Email valida |

**Response `201 Created`:**
```json
{
  "data": {
    "user": {
      "id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "username": "marco_rossi",
      "display_name": "Marco Rossi",
      "email": "marco@example.com",
      "email_verified": false,
      "created_at": "2025-07-15T19:30:00.000Z"
    },
    "tokens": {
      "access_token": "eyJhbGciOiJFUzI1NiJ9...",
      "refresh_token": "rt_01HZ8K4J7PQRST...",
      "access_token_expires_at": "2025-07-15T19:45:00.000Z",
      "refresh_token_expires_at": "2025-08-14T19:30:00.000Z"
    }
  },
  "meta": { "request_id": "req_01HZ", "timestamp": "2025-07-15T19:30:00.000Z" }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `409` | `USERNAME_TAKEN` | Username già in uso |
| `409` | `EMAIL_TAKEN` | Email già in uso |
| `409` | `PHONE_TAKEN` | Numero già registrato |
| `400` | `VALIDATION_ERROR` | Campo non valido (`.field` indica il campo) |

---

### `POST /api/v1/auth/login`
Login con username/email + password.

**Autenticazione:** Nessuna

**Rate Limit:** 10 tentativi / 15 min / IP — blocco account dopo 10 falliti con backoff esponenziale

**Request Body:**
```json
{
  "identifier": "marco_rossi",
  "password": "S3cur3P@ss!",
  "device_name": "iPhone 15 Pro di Marco"
}
```
| Campo | Tipo | Required | Note |
|---|---|---|---|
| `identifier` | string | ✅ | Username o email |
| `password` | string | ✅ | |
| `device_name` | string | ❌ | Nome leggibile del device per la lista sessioni |

**Response `200 OK`:**
```json
{
  "data": {
    "user": {
      "id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "username": "marco_rossi",
      "display_name": "Marco Rossi",
      "avatar_url": "https://r2.alphachat.app/avatars/64a1.jpg"
    },
    "tokens": {
      "access_token": "eyJhbGciOiJFUzI1NiJ9...",
      "refresh_token": "rt_01HZ8K4J7PQRST...",
      "access_token_expires_at": "2025-07-15T19:45:00.000Z",
      "refresh_token_expires_at": "2025-08-14T19:30:00.000Z"
    },
    "requires_2fa": false
  }
}
```

Se `requires_2fa: true`, non vengono restituiti i token. Il client deve completare il 2FA:

**Response `200 OK` (2FA richiesto):**
```json
{
  "data": {
    "requires_2fa": true,
    "totp_challenge_token": "chall_01HZ8K...",
    "totp_challenge_expires_at": "2025-07-15T19:35:00.000Z"
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `401` | `INVALID_CREDENTIALS` | Username/password errati |
| `403` | `ACCOUNT_LOCKED` | Troppi tentativi — `.details.locked_until` |
| `403` | `ACCOUNT_SUSPENDED` | Account sospeso |

---

### `POST /api/v1/auth/refresh`
Rinnova l'access token usando il refresh token. Il refresh token viene ruotato ad ogni uso.

**Autenticazione:** Nessuna (ma richiede refresh_token valido)

**Rate Limit:** 60 / ora / device

**Request Body:**
```json
{
  "refresh_token": "rt_01HZ8K4J7PQRST..."
}
```

**Response `200 OK`:**
```json
{
  "data": {
    "access_token": "eyJhbGciOiJFUzI1NiJ9...",
    "refresh_token": "rt_02NEW_TOKEN...",
    "access_token_expires_at": "2025-07-15T20:00:00.000Z",
    "refresh_token_expires_at": "2025-08-14T19:45:00.000Z"
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `401` | `REFRESH_TOKEN_INVALID` | Token non trovato |
| `401` | `REFRESH_TOKEN_EXPIRED` | Token scaduto |
| `401` | `REFRESH_TOKEN_REUSED` | Token già usato — possibile furto, tutte le sessioni revocate |

---

### `POST /api/v1/auth/logout`
Revoca la sessione corrente.

**Autenticazione:** Bearer token

**Rate Limit:** 20 / ora

**Request Body:**
```json
{
  "refresh_token": "rt_01HZ8K4J7PQRST..."
}
```

**Response `204 No Content`**

---

### `POST /api/v1/auth/logout/all`
Revoca tutte le sessioni dell'utente su tutti i device.

**Autenticazione:** Bearer token

**Response `204 No Content`**

---

### `POST /api/v1/auth/2fa/setup`
Inizia il setup del 2FA TOTP. Restituisce il QR code URI.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "totp_uri": "otpauth://totp/AlphaChat:marco_rossi?secret=BASE32SECRET&issuer=AlphaChat",
    "secret": "JBSWY3DPEHPK3PXP",
    "backup_codes": [
      "ABC12-DEF34",
      "GHI56-JKL78",
      "MNO90-PQR12",
      "STU34-VWX56",
      "YZA78-BCD90",
      "EFG12-HIJ34",
      "KLM56-NOP78",
      "QRS90-TUV12"
    ]
  }
}
```
> I backup codes vengono mostrati UNA SOLA VOLTA. Il server salva solo i loro hash.

---

### `POST /api/v1/auth/2fa/verify`
Confirma il codice TOTP per attivare il 2FA o per completare il login.

**Autenticazione:** Bearer token (setup) o challenge token (login)

**Request Body:**
```json
{
  "code": "123456",
  "challenge_token": "chall_01HZ8K..."
}
```

**Response `200 OK` (login completato):**
```json
{
  "data": {
    "tokens": {
      "access_token": "eyJhbGciOiJFUzI1NiJ9...",
      "refresh_token": "rt_01HZ8K4J7PQRST...",
      "access_token_expires_at": "2025-07-15T19:45:00.000Z",
      "refresh_token_expires_at": "2025-08-14T19:30:00.000Z"
    }
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `401` | `TOTP_CODE_INVALID` | Codice errato |
| `401` | `TOTP_CHALLENGE_EXPIRED` | Challenge token scaduto (5 minuti) |
| `429` | `TOTP_TOO_MANY_ATTEMPTS` | 5 tentativi falliti |

---

### `DELETE /api/v1/auth/2fa`
Disabilita il 2FA. Richiede conferma con codice TOTP.

**Autenticazione:** Bearer token

**Request Body:**
```json
{
  "code": "123456"
}
```

**Response `204 No Content`**

---

### `POST /api/v1/auth/email/verify`
Verifica l'email tramite OTP inviato via email.

**Autenticazione:** Bearer token

**Request Body:**
```json
{
  "otp": "847291"
}
```

**Response `200 OK`:**
```json
{
  "data": {
    "email_verified": true,
    "email": "marco@example.com"
  }
}
```

---

### `POST /api/v1/auth/email/verify/resend`
Reinvia l'OTP di verifica email.

**Autenticazione:** Bearer token

**Rate Limit:** 3 / ora

**Response `204 No Content`**

---

## Modulo 2 — Users

### `GET /api/v1/users/me`
Profilo completo dell'utente autenticato.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "username": "marco_rossi",
    "display_name": "Marco Rossi",
    "bio": "CTO @ Alpha Chat",
    "avatar_url": "https://r2.alphachat.app/avatars/signed/64a1...?expires=1720999800&sig=...",
    "email": "marco@example.com",
    "email_verified": true,
    "phone_linked": true,
    "is_verified": false,
    "totp_enabled": true,
    "created_at": "2025-07-15T10:00:00.000Z",
    "storage_used_bytes": 104857600,
    "privacy": {
      "show_last_seen": "contacts",
      "show_online_status": "contacts",
      "show_read_receipts": true,
      "allow_adding_to_groups": "contacts",
      "allow_calls_from": "contacts"
    }
  }
}
```

---

### `PATCH /api/v1/users/me`
Aggiorna i campi del profilo dell'utente autenticato.

**Autenticazione:** Bearer token

**Rate Limit:** 10 / ora

**Request Body (tutti i campi sono opzionali):**
```json
{
  "display_name": "Marco Rossi",
  "bio": "CTO @ Alpha Chat. Privacy-first."
}
```

| Campo | Tipo | Validazione |
|---|---|---|
| `display_name` | string | 1-60 chars |
| `bio` | string \| null | Max 200 chars, null per rimuovere |

**Response `200 OK`:** profilo aggiornato (stesso formato di `GET /users/me`)

---

### `PUT /api/v1/users/me/password`
Cambia la password. Richiede la password attuale.

**Autenticazione:** Bearer token

**Rate Limit:** 5 / ora

**Request Body:**
```json
{
  "current_password": "S3cur3P@ss!",
  "new_password": "N3wP@ssw0rd!"
}
```

**Response `204 No Content`**

> Dopo il cambio password tutte le altre sessioni vengono revocate. La sessione corrente rimane attiva.

**WebSocket Event emesso a tutti i device:**
```json
{
  "event": "security.password_changed",
  "data": { "revoked_at": "2025-07-15T19:30:00.000Z" }
}
```

---

### `DELETE /api/v1/users/me`
Elimina l'account in modo permanente dopo un periodo di grazia di 30 giorni.

**Autenticazione:** Bearer token

**Rate Limit:** 1 / giorno

**Request Body:**
```json
{
  "password": "S3cur3P@ss!",
  "confirmation": "ELIMINA IL MIO ACCOUNT"
}
```

**Response `200 OK`:**
```json
{
  "data": {
    "deletion_scheduled_at": "2025-07-15T19:30:00.000Z",
    "deletion_at": "2025-08-14T19:30:00.000Z",
    "cancellation_possible_until": "2025-08-14T19:30:00.000Z"
  }
}
```

> Durante il periodo di grazia l'account è inaccessibile ma non eliminato. L'utente può annullare la cancellazione riaprendo l'app e facendo login.

---

### `POST /api/v1/users/me/deletion/cancel`
Annulla la cancellazione pianificata dell'account durante il periodo di grazia.

**Autenticazione:** Bearer token (credenziali valide)

**Response `200 OK`:**
```json
{
  "data": {
    "status": "active",
    "message": "La cancellazione del tuo account è stata annullata."
  }
}
```

---

### `GET /api/v1/users/:id_or_username`
Profilo pubblico di un utente. Le informazioni restituite dipendono dalle impostazioni privacy dell'utente target e dalla relazione con il richiedente.

**Autenticazione:** Bearer token

**Parametri URL:** `:id_or_username` — ObjectId o username (preceduto da `@`)

**Response `200 OK`:**
```json
{
  "data": {
    "id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "username": "alice_chat",
    "display_name": "Alice",
    "bio": "Privacy is not a feature, it's a right.",
    "avatar_url": "https://r2.alphachat.app/avatars/signed/64a1...?expires=...",
    "is_verified": true,
    "is_contact": true,
    "is_blocked_by_me": false,
    "is_blocking_me": false,
    "last_seen": "2025-07-15T19:00:00.000Z",
    "online": false
  }
}
```
> `last_seen` e `online` sono `null` se l'utente ha impostato la privacy su "nobody" o "contacts" e il richiedente non è un contatto.

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `404` | `USER_NOT_FOUND` | Utente non esiste o account eliminato |
| `403` | `USER_BLOCKED` | L'utente ha bloccato il richiedente |

---

### `POST /api/v1/users/discover`
Phone-based contact discovery. Il client invia gli hash HMAC-SHA256 dei numeri in rubrica. Il server risponde con i match trovati su Alpha Chat.

**Autenticazione:** Bearer token

**Rate Limit:** 1 / 24 ore / utente

**Request Body:**
```json
{
  "phone_hashes": [
    "a1b2c3d4e5f6a7b8c9d0...",
    "b2c3d4e5f6a7b8c9d0e1...",
    "c3d4e5f6a7b8c9d0e1f2..."
  ]
}
```
> Massimo 5000 hash per chiamata. Il client deve calcolare `HMAC-SHA256(PEPPER, normalize(phone))`. Il PEPPER viene distribuito al client tramite `GET /api/v1/settings/pepper` (autenticato, TTL 24h).

**Response `200 OK`:**
```json
{
  "data": {
    "matches": [
      {
        "phone_hash": "a1b2c3d4e5f6a7b8c9d0...",
        "user": {
          "id": "64a1b2c3d4e5f6a7b8c9d0e1",
          "username": "alice_chat",
          "display_name": "Alice",
          "avatar_url": "https://r2.alphachat.app/avatars/..."
        }
      }
    ],
    "matches_count": 1
  }
}
```

---

## Modulo 3 — Usernames

### `GET /api/v1/usernames/check`
Verifica la disponibilità di uno username.

**Autenticazione:** Bearer token

**Query Params:**
| Param | Tipo | Required |
|---|---|---|
| `username` | string | ✅ |

**Response `200 OK`:**
```json
{
  "data": {
    "username": "marco_rossi",
    "available": false,
    "reason": "USERNAME_TAKEN"
  }
}
```
```json
{
  "data": {
    "username": "super_mario",
    "available": true
  }
}
```

---

### `PUT /api/v1/usernames/me`
Cambia lo username dell'utente autenticato.

**Autenticazione:** Bearer token

**Rate Limit:** 1 cambio / 14 giorni

**Request Body:**
```json
{
  "username": "marco_r_new"
}
```

**Response `200 OK`:**
```json
{
  "data": {
    "old_username": "marco_rossi",
    "new_username": "marco_r_new",
    "changed_at": "2025-07-15T19:30:00.000Z",
    "next_change_allowed_at": "2025-07-29T19:30:00.000Z"
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `409` | `USERNAME_TAKEN` | Username già in uso |
| `429` | `USERNAME_CHANGE_TOO_SOON` | `.details.next_change_allowed_at` |

---

## Modulo 4 — Contacts

### `GET /api/v1/contacts`
Lista dei contatti dell'utente autenticato.

**Autenticazione:** Bearer token

**Query Params:**
| Param | Tipo | Default | Note |
|---|---|---|---|
| `cursor` | string | — | Cursor per paginazione |
| `limit` | number | 50 | Max 200 |
| `relationship` | string | `contact` | `contact` \| `blocked` |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "64a1b2c3d4e5f6a7b8c9d0e1",
      "username": "alice_chat",
      "display_name": "Alice",
      "nickname": "Alice lavoro",
      "avatar_url": "https://r2.alphachat.app/avatars/...",
      "online": true,
      "last_seen": null,
      "added_at": "2025-06-01T10:00:00.000Z"
    }
  ],
  "pagination": { "cursor": "eyJpZCI6IjY0YTEifQ==", "has_more": false, "total": 47 }
}
```

---

### `POST /api/v1/contacts`
Aggiunge un utente ai contatti.

**Autenticazione:** Bearer token

**Rate Limit:** 100 / giorno

**Request Body:**
```json
{
  "user_id": "64a1b2c3d4e5f6a7b8c9d0e1",
  "nickname": "Alice lavoro"
}
```

**Response `201 Created`:**
```json
{
  "data": {
    "contact_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "username": "alice_chat",
    "display_name": "Alice",
    "added_at": "2025-07-15T19:30:00.000Z"
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `409` | `CONTACT_ALREADY_EXISTS` | Già in rubrica |
| `400` | `CANNOT_ADD_SELF` | L'utente sta cercando di aggiungere sé stesso |
| `404` | `USER_NOT_FOUND` | Utente non esiste |

---

### `DELETE /api/v1/contacts/:user_id`
Rimuove un contatto dalla rubrica.

**Autenticazione:** Bearer token

**Response `204 No Content`**

---

### `PATCH /api/v1/contacts/:user_id`
Aggiorna il nickname di un contatto.

**Autenticazione:** Bearer token

**Request Body:**
```json
{
  "nickname": "Alice CEO"
}
```

**Response `200 OK`:** contatto aggiornato

---

### `POST /api/v1/contacts/:user_id/block`
Blocca un utente.

**Autenticazione:** Bearer token

**Rate Limit:** 20 / giorno

**Response `200 OK`:**
```json
{
  "data": {
    "blocked_user_id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "blocked_at": "2025-07-15T19:30:00.000Z"
  }
}
```

> Effetti del blocco:
> - L'utente bloccato non può inviare messaggi al bloccante
> - L'utente bloccato non vede lo stato online/last seen del bloccante
> - Se erano in una conversazione diretta, la chat rimane ma i messaggi futuri sono bloccati
> - Le notifiche dall'utente bloccato vengono soppresse

---

### `DELETE /api/v1/contacts/:user_id/block`
Sblocca un utente.

**Autenticazione:** Bearer token

**Response `204 No Content`**

---

## Modulo 5 — Chats

### `GET /api/v1/chats`
Lista di tutte le conversazioni dell'utente autenticato, ordinate per ultimo messaggio.

**Autenticazione:** Bearer token

**Query Params:**
| Param | Tipo | Default | Note |
|---|---|---|---|
| `cursor` | string | — | Cursor paginazione |
| `limit` | number | 20 | Max 50 |
| `type` | string | — | `direct` \| `group` — filtra per tipo |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "64b1c2d3e4f5a6b7c8d9e0f1",
      "type": "direct",
      "partner": {
        "id": "64a1b2c3d4e5f6a7b8c9d0e1",
        "username": "alice_chat",
        "display_name": "Alice",
        "avatar_url": "https://r2.alphachat.app/avatars/...",
        "online": true
      },
      "last_message": {
        "id": "64c1d2e3f4a5b6c7d8e9f0a1",
        "sender_id": "64a1b2c3d4e5f6a7b8c9d0e1",
        "message_type": "text",
        "preview": "[messaggio cifrato]",
        "sent_at": "2025-07-15T19:28:00.000Z",
        "is_mine": false
      },
      "unread_count": 3,
      "is_muted": false,
      "disappearing_messages_enabled": false
    },
    {
      "id": "64d1e2f3a4b5c6d7e8f9a0b1",
      "type": "group",
      "name": "Alpha Chat Team",
      "avatar_url": "https://r2.alphachat.app/group-avatars/...",
      "member_count": 5,
      "last_message": { ... },
      "unread_count": 0,
      "is_muted": false,
      "my_role": "admin"
    }
  ],
  "pagination": { "cursor": "eyJpZCI6IjY0ZDEifQ==", "has_more": false, "total": 12 }
}
```

---

### `GET /api/v1/chats/:id`
Dettaglio di una conversazione specifica.

**Autenticazione:** Bearer token

**Response `200 OK`:** singola conversazione con tutti i dettagli (stessa struttura del listato, con campi aggiuntivi come `invite_link`, `disappearing_messages_duration`, ecc.)

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `404` | `CHAT_NOT_FOUND` | Conversazione non esiste o utente non è membro |

---

### `POST /api/v1/chats/direct`
Crea o recupera una conversazione diretta con un altro utente.

**Autenticazione:** Bearer token

**Rate Limit:** 20 / ora

**Request Body:**
```json
{
  "user_id": "64a1b2c3d4e5f6a7b8c9d0e1"
}
```

**Response `200 OK`** (chat già esistente) o **`201 Created`** (chat nuova):
```json
{
  "data": {
    "id": "64b1c2d3e4f5a6b7c8d9e0f1",
    "type": "direct",
    "created": true,
    "partner": { ... }
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `403` | `USER_BLOCKED` | Utente ha bloccato il richiedente o viceversa |
| `400` | `CANNOT_CHAT_WITH_SELF` | |

---

### `PATCH /api/v1/chats/:id/mute`
Silenzia o de-silenzia una conversazione.

**Autenticazione:** Bearer token

**Request Body:**
```json
{
  "muted": true,
  "until": "2025-07-16T07:00:00.000Z"
}
```
> `until: null` = silenzio permanente

**Response `200 OK`:**
```json
{
  "data": {
    "is_muted": true,
    "muted_until": "2025-07-16T07:00:00.000Z"
  }
}
```

---

### `PATCH /api/v1/chats/:id/disappearing`
Attiva/disattiva i messaggi a scomparsa in una conversazione.

**Autenticazione:** Bearer token (entrambi i partecipanti in direct; admin in gruppi)

**Request Body:**
```json
{
  "enabled": true,
  "duration_seconds": 86400
}
```
> Durate valide: `3600` (1h), `86400` (24h), `604800` (7gg), `2592000` (30gg)

**Response `200 OK`:**
```json
{
  "data": {
    "disappearing_messages_enabled": true,
    "disappearing_messages_duration": 86400
  }
}
```

**WebSocket Event emesso a tutti i membri:**
```json
{
  "event": "chat.disappearing_changed",
  "data": {
    "chat_id": "64b1c2d3...",
    "enabled": true,
    "duration_seconds": 86400,
    "changed_by": "64a1b2c3..."
  }
}
```

---

## Modulo 6 — Messages

### `POST /api/v1/chats/:id/messages`
Invia un messaggio in una conversazione.

**Autenticazione:** Bearer token

**Rate Limit:** 100 / minuto

**Request Body:**
```json
{
  "client_message_id": "550e8400-e29b-41d4-a716-446655440000",
  "message_type": "text",
  "ciphertext": "MwgAEpEB...",
  "ciphertext_type": 1,
  "sender_key_id": 42,
  "reply_to_message_id": null,
  "media_id": null
}
```
| Campo | Tipo | Required | Note |
|---|---|---|---|
| `client_message_id` | UUID v4 | ✅ | Idempotenza — stessa richiesta = stesso messaggio |
| `message_type` | enum | ✅ | `text` \| `media` \| `reply` \| `forward` |
| `ciphertext` | base64 | ✅ | Payload cifrato Signal Protocol |
| `ciphertext_type` | number | ✅ | 1=PreKeyWhisperMessage, 2=WhisperMessage |
| `sender_key_id` | number | ✅ | ID della chiave usata |
| `reply_to_message_id` | ObjectId \| null | ❌ | Solo per `message_type: 'reply'` |
| `media_id` | ObjectId \| null | ❌ | Solo per `message_type: 'media'` |

**Response `201 Created`:**
```json
{
  "data": {
    "id": "64c1d2e3f4a5b6c7d8e9f0a1",
    "client_message_id": "550e8400-e29b-41d4-a716-446655440000",
    "sequence_number": 1428,
    "sent_at": "2025-07-15T19:30:00.000Z",
    "status": "sent"
  }
}
```

> **Idempotenza:** se `client_message_id` è già presente nel DB, il server risponde `200 OK` con il messaggio originale — non crea un duplicato.

**WebSocket Event emesso a tutti i membri della chat:**
```json
{
  "event": "message.new",
  "data": {
    "id": "64c1d2e3f4a5b6c7d8e9f0a1",
    "chat_id": "64b1c2d3...",
    "sender_id": "64a1b2c3...",
    "message_type": "text",
    "ciphertext": "MwgAEpEB...",
    "ciphertext_type": 1,
    "sender_key_id": 42,
    "sequence_number": 1428,
    "sent_at": "2025-07-15T19:30:00.000Z",
    "reply_to_message_id": null,
    "media_id": null
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `403` | `NOT_CHAT_MEMBER` | Utente non è membro della chat |
| `403` | `BLOCKED` | Uno dei partecipanti ha bloccato l'altro |
| `404` | `CHAT_NOT_FOUND` | |
| `404` | `MEDIA_NOT_FOUND` | media_id non esiste o non appartiene all'utente |
| `400` | `MEDIA_NOT_READY` | Il media è ancora in processing |

---

### `GET /api/v1/chats/:id/messages`
Recupera i messaggi di una conversazione in ordine cronologico inverso.

**Autenticazione:** Bearer token

**Rate Limit:** 60 / minuto

**Query Params:**
| Param | Tipo | Default | Note |
|---|---|---|---|
| `cursor` | string | — | Cursor per paginazione (basato su sequence_number) |
| `limit` | number | 50 | Max 100 |
| `before_sequence` | number | — | Fetch messaggi prima di questo sequence_number |
| `after_sequence` | number | — | Fetch messaggi dopo questo sequence_number |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "64c1d2e3f4a5b6c7d8e9f0a1",
      "sender_id": "64a1b2c3...",
      "message_type": "text",
      "ciphertext": "MwgAEpEB...",
      "ciphertext_type": 2,
      "sender_key_id": 42,
      "sequence_number": 1428,
      "sent_at": "2025-07-15T19:30:00.000Z",
      "reply_to": null,
      "media": null,
      "deleted_for_everyone": false,
      "reactions_summary": {
        "❤️": 3,
        "👍": 1
      },
      "my_reaction": null
    }
  ],
  "pagination": { "cursor": "eyJzZXEiOjE0MDB9", "has_more": true }
}
```

---

### `GET /api/v1/chats/:id/messages/:message_id`
Recupera un singolo messaggio.

**Autenticazione:** Bearer token

**Response `200 OK`:** singolo messaggio con tutte le reazioni e i dettagli di delivery.

---

## Modulo 7 — Message Reactions

### `POST /api/v1/messages/:id/reactions`
Aggiunge una reazione emoji a un messaggio.

**Autenticazione:** Bearer token

**Rate Limit:** 30 / minuto

**Request Body:**
```json
{
  "emoji": "❤️"
}
```

**Response `201 Created`:**
```json
{
  "data": {
    "message_id": "64c1d2e3f4a5b6c7d8e9f0a1",
    "emoji": "❤️",
    "reacted_at": "2025-07-15T19:31:00.000Z"
  }
}
```

**WebSocket Event emesso a tutti i membri:**
```json
{
  "event": "message.reaction_added",
  "data": {
    "message_id": "64c1d2e3...",
    "chat_id": "64b1c2d3...",
    "user_id": "64a1b2c3...",
    "emoji": "❤️"
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `409` | `REACTION_ALREADY_EXISTS` | Stessa emoji già aggiunta |
| `400` | `INVALID_EMOJI` | Emoji non consentita (lista whitelist) |
| `404` | `MESSAGE_NOT_FOUND` | |

---

### `DELETE /api/v1/messages/:id/reactions/:emoji`
Rimuove la propria reazione da un messaggio.

**Autenticazione:** Bearer token

**Parametri URL:** `:emoji` — URL-encoded Unicode emoji

**Response `204 No Content`**

**WebSocket Event emesso a tutti i membri:**
```json
{
  "event": "message.reaction_removed",
  "data": {
    "message_id": "64c1d2e3...",
    "chat_id": "64b1c2d3...",
    "user_id": "64a1b2c3...",
    "emoji": "❤️"
  }
}
```

---

### `GET /api/v1/messages/:id/reactions`
Lista completa delle reazioni a un messaggio.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "message_id": "64c1d2e3f4a5b6c7d8e9f0a1",
    "reactions": {
      "❤️": {
        "count": 3,
        "users": [
          { "id": "64a1...", "username": "alice_chat", "display_name": "Alice" }
        ]
      },
      "👍": {
        "count": 1,
        "users": [ ... ]
      }
    },
    "total": 4
  }
}
```

---

## Modulo 8 — Delete Message

### Comportamento Definito

| Scenario | Elimina per me | Elimina per tutti |
|---|---|---|
| Mittente | ✅ Sempre | ✅ Entro 48 ore dall'invio |
| Destinatario | ✅ Sempre | ❌ Non permesso |
| Admin di gruppo | ✅ Sempre | ✅ Qualsiasi messaggio |

### `DELETE /api/v1/messages/:id`
Elimina un messaggio.

**Autenticazione:** Bearer token

**Rate Limit:** 60 / minuto

**Request Body:**
```json
{
  "scope": "for_me",
  "reason": null
}
```
| Campo | Tipo | Valori | Note |
|---|---|---|---|
| `scope` | enum | `for_me` \| `for_everyone` | |
| `reason` | string \| null | — | Solo per admin — loggato nell'audit log |

---

#### `scope: "for_me"` — Elimina solo per me

**Comportamento:**
- Il documento in MongoDB non viene eliminato
- L'`_id` del messaggio viene aggiunto all'array `hidden_message_ids` nel `conversation_members` dell'utente richiedente
- Gli altri membri non ricevono notifiche
- Su tutti i device dello stesso utente viene inviato il WebSocket event
- Il messaggio è permanentemente nascosto per l'utente su tutti i suoi device

**Response `200 OK`:**
```json
{
  "data": {
    "message_id": "64c1d2e3f4a5b6c7d8e9f0a1",
    "scope": "for_me",
    "deleted_at": "2025-07-15T19:30:00.000Z"
  }
}
```

**WebSocket Event emesso solo ai device dello stesso utente:**
```json
{
  "event": "message.hidden_for_me",
  "data": {
    "message_id": "64c1d2e3...",
    "chat_id": "64b1c2d3..."
  }
}
```

**Gestione allegati:** il media NON viene rimosso da R2. Il file rimane accessibile agli altri membri. Solo i metadata nascosti all'utente.

---

#### `scope: "for_everyone"` — Elimina per tutti

**Comportamento:**
- Verifica: l'utente è il mittente E il messaggio ha meno di 48 ore. OPPURE l'utente è un admin del gruppo.
- Il flag `deleted_for_everyone: true` viene impostato nel documento
- Il campo `ciphertext` viene impostato a `null` (irrecuperabile)
- Tutti i membri ricevono il WebSocket event
- Su tutti i client il messaggio mostra il placeholder "Questo messaggio è stato eliminato"
- Comportamento offline: se un membro è offline, al reconnect riceve l'evento nel proprio message queue
- Il documento in MongoDB NON viene eliminato fisicamente (audit log, moderazione)
- La sincronizzazione su tutti i device avviene tramite WebSocket con fallback GET all'apertura della chat

**Response `200 OK`:**
```json
{
  "data": {
    "message_id": "64c1d2e3f4a5b6c7d8e9f0a1",
    "scope": "for_everyone",
    "deleted_at": "2025-07-15T19:30:00.000Z"
  }
}
```

**WebSocket Event emesso a TUTTI i membri della chat:**
```json
{
  "event": "message.deleted_for_everyone",
  "data": {
    "message_id": "64c1d2e3...",
    "chat_id": "64b1c2d3...",
    "deleted_by": "64a1b2c3...",
    "deleted_at": "2025-07-15T19:30:00.000Z"
  }
}
```

**Gestione allegati per `for_everyone`:**
- Se il messaggio contiene un media, il file su R2 viene schedulato per la rimozione dopo 24 ore (processo asincrono)
- Durante le 24 ore il file è ancora tecnicamente accessibile tramite URL firmato se qualcuno aveva l'URL
- Dopo 24 ore il file viene eliminato definitivamente da R2 e il documento `media` viene marcato `deleted_at`
- La thumbnail (se presente) viene rimossa insieme al file originale

**Audit Log — solo per admin:**
```
DELETE message_id=64c1d2... scope=for_everyone deleted_by=admin_id=64a1... reason="violazione regole"
```
L'audit log è conservato per 90 giorni ed è accessibile solo tramite `GET /api/v1/admin/audit-log`.

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `403` | `CANNOT_DELETE_FOR_EVERYONE` | Non mittente e non admin, OPPURE messaggio > 48 ore |
| `403` | `NOT_CHAT_MEMBER` | Utente non è nella chat |
| `404` | `MESSAGE_NOT_FOUND` | |
| `410` | `MESSAGE_ALREADY_DELETED` | Già eliminato per tutti |

---

## Modulo 9 — Read Receipts

### `PUT /api/v1/chats/:id/read`
Marca i messaggi come letti fino a un determinato messaggio.

**Autenticazione:** Bearer token

**Rate Limit:** 60 / minuto

**Request Body:**
```json
{
  "last_read_message_id": "64c1d2e3f4a5b6c7d8e9f0a1"
}
```

**Response `204 No Content`**

**WebSocket Event emesso al mittente dei messaggi letti:**
```json
{
  "event": "message.read",
  "data": {
    "chat_id": "64b1c2d3...",
    "reader_id": "64a1b2c3...",
    "last_read_message_id": "64c1d2e3...",
    "read_at": "2025-07-15T19:32:00.000Z"
  }
}
```
> Se il destinatario ha disabilitato le conferme di lettura (`show_read_receipts: false`), l'evento WebSocket NON viene emesso.

---

### `GET /api/v1/messages/:id/receipts`
Lista degli utenti che hanno letto un messaggio.

**Autenticazione:** Bearer token (solo per messaggi propri o in gruppi di cui si è admin)

**Response `200 OK`:**
```json
{
  "data": {
    "message_id": "64c1d2e3f4a5b6c7d8e9f0a1",
    "receipts": [
      {
        "user_id": "64a1b2c3...",
        "username": "alice_chat",
        "read_at": "2025-07-15T19:31:00.000Z"
      }
    ],
    "total_members": 3,
    "read_count": 1
  }
}
```

---

## Modulo 10 — Typing Indicator

Il typing indicator funziona **esclusivamente via WebSocket**. Nessun endpoint REST.

### WebSocket — Client → Server: inizia a scrivere
```json
{
  "event": "typing.start",
  "data": {
    "chat_id": "64b1c2d3..."
  }
}
```

### WebSocket — Client → Server: smette di scrivere
```json
{
  "event": "typing.stop",
  "data": {
    "chat_id": "64b1c2d3..."
  }
}
```

### WebSocket — Server → Client: propagazione agli altri membri
```json
{
  "event": "typing.start",
  "data": {
    "chat_id": "64b1c2d3...",
    "user_id": "64a1b2c3...",
    "username": "alice_chat",
    "display_name": "Alice"
  }
}
```
```json
{
  "event": "typing.stop",
  "data": {
    "chat_id": "64b1c2d3...",
    "user_id": "64a1b2c3..."
  }
}
```

> **TTL automatico:** se il server non riceve `typing.stop` entro 8 secondi da `typing.start`, lo stato viene automaticamente resettato. Il client invia `typing.start` ogni 5 secondi finché l'utente continua a scrivere.

---

## Modulo 11 — Presence

### `GET /api/v1/presence/:user_id`
Stato online/last_seen di un utente.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "user_id": "64a1b2c3...",
    "online": false,
    "last_seen": "2025-07-15T19:00:00.000Z",
    "visible": true
  }
}
```
> `visible: false` se l'utente ha privacy su "nobody" o non è un contatto del richiedente.

---

### `POST /api/v1/presence/batch`
Stato online di più utenti in una sola request (per caricare la lista chat).

**Autenticazione:** Bearer token

**Rate Limit:** 30 / minuto

**Request Body:**
```json
{
  "user_ids": [
    "64a1b2c3...",
    "64b2c3d4...",
    "64c3d4e5..."
  ]
}
```
> Max 100 user_id per request.

**Response `200 OK`:**
```json
{
  "data": {
    "64a1b2c3...": { "online": true, "last_seen": null },
    "64b2c3d4...": { "online": false, "last_seen": "2025-07-15T18:00:00.000Z" },
    "64c3d4e5...": { "online": false, "last_seen": null, "visible": false }
  }
}
```

---

### WebSocket — Presence Updates (sottoscrizione automatica)

Il server emette automaticamente eventi di presenza per i contatti dell'utente connesso.

```json
{
  "event": "presence.online",
  "data": {
    "user_id": "64a1b2c3..."
  }
}
```
```json
{
  "event": "presence.offline",
  "data": {
    "user_id": "64a1b2c3...",
    "last_seen": "2025-07-15T19:30:00.000Z"
  }
}
```

---

## Modulo 12 — Groups

### `POST /api/v1/groups`
Crea un nuovo gruppo.

**Autenticazione:** Bearer token

**Rate Limit:** 10 gruppi / giorno

**Request Body:**
```json
{
  "name": "Alpha Chat Team",
  "description": "Il team del progetto.",
  "member_ids": [
    "64a1b2c3...",
    "64b2c3d4..."
  ]
}
```
| Campo | Tipo | Required | Validazione |
|---|---|---|---|
| `name` | string | ✅ | 1-60 chars |
| `description` | string | ❌ | Max 300 chars |
| `member_ids` | ObjectId[] | ✅ | Min 1, max 255, escluso sé stesso |

**Response `201 Created`:** la conversazione gruppo creata con i dettagli completi.

---

### `PATCH /api/v1/groups/:id`
Modifica nome, descrizione o avatar del gruppo. Solo admin.

**Autenticazione:** Bearer token (admin)

**Request Body:**
```json
{
  "name": "Nuovo Nome",
  "description": "Nuova descrizione."
}
```

**Response `200 OK`:** gruppo aggiornato

**WebSocket Event:**
```json
{
  "event": "group.updated",
  "data": {
    "chat_id": "64d1e2f3...",
    "updated_by": "64a1b2c3...",
    "changes": { "name": "Nuovo Nome" }
  }
}
```

---

### `POST /api/v1/groups/:id/members`
Aggiunge uno o più membri al gruppo. Solo admin.

**Autenticazione:** Bearer token (admin)

**Rate Limit:** 50 aggiunte / ora / gruppo

**Request Body:**
```json
{
  "user_ids": ["64a1b2c3...", "64b2c3d4..."]
}
```

**Response `200 OK`:**
```json
{
  "data": {
    "added": ["64a1b2c3...", "64b2c3d4..."],
    "failed": [],
    "member_count": 7
  }
}
```

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `403` | `NOT_GROUP_ADMIN` | |
| `400` | `GROUP_FULL` | Raggiunto il limite di 256 membri |
| `403` | `BLOCKED_BY_USER` | Un utente target ha bloccato chi aggiunge |

---

### `DELETE /api/v1/groups/:id/members/:user_id`
Rimuove un membro dal gruppo.

**Autenticazione:** Bearer token (admin)

**Response `204 No Content`**

**WebSocket Event emesso a tutti i membri:**
```json
{
  "event": "group.member_removed",
  "data": {
    "chat_id": "64d1e2f3...",
    "removed_user_id": "64a1b2c3...",
    "removed_by": "64b2c3d4..."
  }
}
```

---

### `DELETE /api/v1/groups/:id/members/me`
Abbandona il gruppo.

**Autenticazione:** Bearer token

**Response `204 No Content`**

> Se l'utente che esce è l'unico admin, viene assegnato automaticamente il ruolo admin al membro più anziano.

---

### `PATCH /api/v1/groups/:id/members/:user_id/role`
Promuove o declassa un membro. Solo admin.

**Autenticazione:** Bearer token (admin)

**Request Body:**
```json
{
  "role": "admin"
}
```

**Response `200 OK`:**
```json
{
  "data": {
    "user_id": "64a1b2c3...",
    "role": "admin",
    "updated_by": "64b2c3d4...",
    "updated_at": "2025-07-15T19:30:00.000Z"
  }
}
```

---

### `POST /api/v1/groups/:id/invite-link`
Genera o rigenera il link di invito.

**Autenticazione:** Bearer token (admin)

**Request Body:**
```json
{
  "expires_in_hours": 168
}
```
> `expires_in_hours: null` = link permanente

**Response `200 OK`:**
```json
{
  "data": {
    "link": "https://alphachat.app/join/AbCdEfGhIjKl",
    "token": "AbCdEfGhIjKl",
    "expires_at": "2025-07-22T19:30:00.000Z"
  }
}
```

---

### `DELETE /api/v1/groups/:id/invite-link`
Revoca il link di invito.

**Autenticazione:** Bearer token (admin)

**Response `204 No Content`**

---

### `POST /api/v1/groups/join/:token`
Entra in un gruppo tramite link di invito.

**Autenticazione:** Bearer token

**Response `200 OK`:** la conversazione gruppo a cui si è uniti.

**Errori:**
| Codice HTTP | `error.code` | Causa |
|---|---|---|
| `404` | `INVITE_LINK_INVALID` | Token non trovato |
| `410` | `INVITE_LINK_EXPIRED` | Link scaduto |
| `409` | `ALREADY_MEMBER` | Già nel gruppo |
| `400` | `GROUP_FULL` | |

---

## Modulo 13 — Channels

### `POST /api/v1/channels`
Crea un canale.

**Autenticazione:** Bearer token

**Rate Limit:** 3 canali / account

**Request Body:**
```json
{
  "username": "alphachat_updates",
  "name": "Alpha Chat Updates",
  "description": "Aggiornamenti ufficiali dal team.",
  "is_public": true
}
```

**Response `201 Created`:** canale creato.

---

### `GET /api/v1/channels`
Lista dei canali pubblici (discovery).

**Autenticazione:** Bearer token

**Query Params:**
| Param | Tipo | Default | Note |
|---|---|---|---|
| `cursor` | string | — | |
| `limit` | number | 20 | Max 50 |
| `query` | string | — | Ricerca per nome/username |
| `sort` | string | `subscribers` | `subscribers` \| `recent` |

**Response `200 OK`:** lista di canali.

---

### `GET /api/v1/channels/:id_or_username`
Dettaglio canale pubblico.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "id": "64e1f2a3...",
    "username": "alphachat_updates",
    "name": "Alpha Chat Updates",
    "description": "...",
    "avatar_url": "...",
    "is_verified": true,
    "is_public": true,
    "subscriber_count": 12847,
    "is_subscribed": false,
    "my_role": null
  }
}
```

---

### `POST /api/v1/channels/:id/subscribe`
Iscriviti a un canale.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "channel_id": "64e1f2a3...",
    "subscribed_at": "2025-07-15T19:30:00.000Z"
  }
}
```

---

### `DELETE /api/v1/channels/:id/subscribe`
Disiscriviti da un canale.

**Autenticazione:** Bearer token

**Response `204 No Content`**

---

### `POST /api/v1/channels/:id/messages`
Pubblica un messaggio nel canale. Solo owner e editor.

**Autenticazione:** Bearer token (owner \| editor)

**Request Body:** stessa struttura di `POST /api/v1/chats/:id/messages`

**Response `201 Created`:** messaggio pubblicato.

---

## Modulo 14 — Media

### `POST /api/v1/media/upload-url`
Richiede un URL firmato per caricare un file direttamente su Cloudflare R2. Il file NON passa per il server Alpha Chat.

**Autenticazione:** Bearer token

**Rate Limit:** 100 / ora

**Request Body:**
```json
{
  "filename": "foto.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 2457600,
  "conversation_id": "64b1c2d3...",
  "is_encrypted": true
}
```
| Campo | Validazione |
|---|---|
| `mime_type` | Whitelist: `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `audio/mp4`, `audio/mpeg`, `application/pdf` |
| `size_bytes` | Max 100 MB (immagini: 25 MB) |

**Response `200 OK`:**
```json
{
  "data": {
    "media_id": "64f1a2b3...",
    "upload_url": "https://r2-upload.alphachat.app/upload?X-Amz-Signature=...",
    "upload_url_expires_at": "2025-07-15T19:45:00.000Z",
    "r2_key": "media/2025/07/15/64f1a2b3.jpg"
  }
}
```

> Il client carica il file direttamente su R2 via PUT all'`upload_url`. Poi chiama `POST /api/v1/media/:id/confirm`.

---

### `POST /api/v1/media/:id/confirm`
Conferma che il file è stato caricato con successo su R2.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "media_id": "64f1a2b3...",
    "status": "processing",
    "estimated_ready_seconds": 5
  }
}
```

> Il server verifica che il file esiste su R2, avvia il processing asincrono (EXIF strip, virus scan, thumbnail).

---

### `GET /api/v1/media/:id`
Metadata e URL firmato per scaricare il file.

**Autenticazione:** Bearer token (solo utenti che hanno accesso alla conversazione)

**Response `200 OK`:**
```json
{
  "data": {
    "id": "64f1a2b3...",
    "mime_type": "image/jpeg",
    "size_bytes": 2457600,
    "width": 3024,
    "height": 4032,
    "status": "ready",
    "is_encrypted": true,
    "download_url": "https://r2.alphachat.app/media/2025/07/15/64f1a2b3.jpg?X-Amz-Signature=...&Expires=1720999800",
    "download_url_expires_at": "2025-07-15T20:30:00.000Z",
    "thumbnail_url": "https://r2.alphachat.app/thumbs/64f1a2b3_thumb.jpg?...",
    "thumbnail_url_expires_at": "2025-07-15T20:30:00.000Z"
  }
}
```

> URL TTL: immagini 1 ora, documenti 15 minuti.

---

### `DELETE /api/v1/media/:id`
Elimina un file media. Solo chi l'ha caricato.

**Autenticazione:** Bearer token

**Response `204 No Content`**

> Il file viene rimosso da R2 in modo asincrono entro 24 ore.

---

## Modulo 15 — Calls

### `POST /api/v1/calls/initiate`
Avvia una chiamata audio o video.

**Autenticazione:** Bearer token

**Rate Limit:** 20 / ora

**Request Body:**
```json
{
  "conversation_id": "64b1c2d3...",
  "call_type": "video"
}
```

**Response `201 Created`:**
```json
{
  "data": {
    "call_id": "64g1h2i3...",
    "daily_room_url": "https://alphachat.daily.co/AbCdEf",
    "daily_token": "eyJhbGci...",
    "expires_at": "2025-07-15T20:30:00.000Z"
  }
}
```

**WebSocket Event emesso ai destinatari:**
```json
{
  "event": "call.incoming",
  "data": {
    "call_id": "64g1h2i3...",
    "caller_id": "64a1b2c3...",
    "caller_display_name": "Marco Rossi",
    "caller_avatar_url": "...",
    "call_type": "video",
    "conversation_id": "64b1c2d3..."
  }
}
```

---

### `POST /api/v1/calls/:id/answer`
Accetta una chiamata in arrivo.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "daily_room_url": "https://alphachat.daily.co/AbCdEf",
    "daily_token": "eyJhbGci..."
  }
}
```

---

### `POST /api/v1/calls/:id/decline`
Rifiuta una chiamata in arrivo.

**Autenticazione:** Bearer token

**Request Body:**
```json
{
  "reason": "busy"
}
```
> `reason`: `declined` \| `busy` \| `unavailable`

**Response `204 No Content`**

**WebSocket Event emesso al chiamante:**
```json
{
  "event": "call.declined",
  "data": {
    "call_id": "64g1h2i3...",
    "declined_by": "64a1b2c3...",
    "reason": "busy"
  }
}
```

---

### `POST /api/v1/calls/:id/end`
Termina una chiamata attiva.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "call_id": "64g1h2i3...",
    "duration_seconds": 187,
    "ended_at": "2025-07-15T19:33:07.000Z"
  }
}
```

---

### `GET /api/v1/calls`
Storico chiamate dell'utente autenticato.

**Autenticazione:** Bearer token

**Query Params:** `cursor`, `limit` (max 50)

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "64g1h2i3...",
      "call_type": "video",
      "direction": "outgoing",
      "participants": [
        { "user_id": "64a1b2c3...", "display_name": "Alice", "status": "answered" }
      ],
      "duration_seconds": 187,
      "end_reason": "completed",
      "started_at": "2025-07-15T19:30:00.000Z",
      "ended_at": "2025-07-15T19:33:07.000Z"
    }
  ]
}
```

---

## Modulo 16 — Notifications

### `POST /api/v1/notifications/push/register`
Registra o aggiorna il push token del device corrente.

**Autenticazione:** Bearer token

**Request Body:**
```json
{
  "push_token": "ExponentPushToken[xxxxxx]",
  "platform": "ios"
}
```

**Response `200 OK`:**
```json
{
  "data": {
    "registered": true
  }
}
```

---

### `DELETE /api/v1/notifications/push/register`
Deregistra il push token del device (es. al logout).

**Autenticazione:** Bearer token

**Response `204 No Content`**

---

### `PATCH /api/v1/notifications/settings`
Aggiorna le impostazioni di notifica.

**Autenticazione:** Bearer token

**Request Body:**
```json
{
  "messages": true,
  "calls": true,
  "groups": true,
  "preview_text": false
}
```

**Response `200 OK`:** impostazioni aggiornate.

---

## Modulo 17 — Reports

### `POST /api/v1/reports`
Segnala un utente, un messaggio o una conversazione.

**Autenticazione:** Bearer token

**Rate Limit:** 10 / giorno

**Request Body:**
```json
{
  "reported_user_id": "64a1b2c3...",
  "reported_message_id": null,
  "reason": "harassment",
  "description": "Sta inviando messaggi offensivi."
}
```

**Response `201 Created`:**
```json
{
  "data": {
    "report_id": "64h1i2j3...",
    "status": "pending",
    "created_at": "2025-07-15T19:30:00.000Z",
    "message": "La tua segnalazione è stata ricevuta e sarà esaminata dal nostro team."
  }
}
```

---

## Modulo 18 — Settings

### `GET /api/v1/settings`
Tutte le impostazioni dell'utente autenticato.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "privacy": {
      "show_last_seen": "contacts",
      "show_online_status": "contacts",
      "show_read_receipts": true,
      "allow_adding_to_groups": "contacts",
      "allow_calls_from": "contacts"
    },
    "notifications": {
      "messages": true,
      "calls": true,
      "groups": true,
      "preview_text": false
    },
    "appearance": {
      "theme": "dark",
      "font_size": "medium"
    }
  }
}
```

---

### `PATCH /api/v1/settings/privacy`
Aggiorna le impostazioni di privacy.

**Autenticazione:** Bearer token

**Request Body:** subset dei campi `privacy` da `GET /settings`.

**Response `200 OK`:** privacy aggiornata.

---

### `PATCH /api/v1/settings/notifications`
Aggiorna le impostazioni di notifica.

**Autenticazione:** Bearer token

**Request Body:** subset dei campi `notifications`.

**Response `200 OK`:** notifiche aggiornate.

---

### `GET /api/v1/settings/pepper`
Restituisce il PEPPER corrente per la phone discovery. Cached 24 ore sul client.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "pepper": "v2:a1b2c3d4e5f6...",
    "algorithm": "HMAC-SHA256",
    "expires_at": "2025-07-16T19:30:00.000Z"
  }
}
```

---

## Modulo 19 — Devices

### `GET /api/v1/devices`
Lista di tutti i device/sessioni attivi dell'utente.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": [
    {
      "session_id": "64i1j2k3...",
      "device_name": "iPhone 15 Pro di Marco",
      "device_type": "ios",
      "last_used_at": "2025-07-15T19:30:00.000Z",
      "country_code": "IT",
      "city": "Milano",
      "is_current": true,
      "is_suspicious": false
    },
    {
      "session_id": "64j2k3l4...",
      "device_name": "MacBook Pro",
      "device_type": "desktop",
      "last_used_at": "2025-07-15T09:00:00.000Z",
      "country_code": "IT",
      "city": "Roma",
      "is_current": false,
      "is_suspicious": false
    }
  ]
}
```

---

### `DELETE /api/v1/devices/:session_id`
Revoca una sessione specifica (logout da un device remoto).

**Autenticazione:** Bearer token

**Response `204 No Content`**

**WebSocket Event emesso al device revocato:**
```json
{
  "event": "session.revoked",
  "data": {
    "session_id": "64j2k3l4...",
    "revoked_by_session": "64i1j2k3...",
    "revoked_at": "2025-07-15T19:30:00.000Z"
  }
}
```

---

### `GET /api/v1/devices/prekeys/status`
Verifica quante OPK il server ha per il device corrente. Il client usa questa info per decidere se caricare nuove chiavi.

**Autenticazione:** Bearer token

**Response `200 OK`:**
```json
{
  "data": {
    "device_id": "550e8400-e29b-41d4-a716-446655440000",
    "one_time_prekeys_count": 3,
    "needs_replenishment": true,
    "recommended_upload": 20
  }
}
```

---

### `PUT /api/v1/devices/prekeys`
Carica nuove OPK e/o aggiorna la Signed PreKey.

**Autenticazione:** Bearer token

**Request Body:**
```json
{
  "identity_key": "base64==",
  "signed_prekey": {
    "key_id": 5,
    "public_key": "base64==",
    "signature": "base64=="
  },
  "one_time_prekeys": [
    { "key_id": 101, "public_key": "base64==" },
    { "key_id": 102, "public_key": "base64==" }
  ]
}
```

**Response `200 OK`:**
```json
{
  "data": {
    "one_time_prekeys_stored": 2,
    "one_time_prekeys_total": 5
  }
}
```

---

### `GET /api/v1/devices/:user_id/prekeys`
Recupera le prekeys pubbliche di un utente per iniziare una sessione Signal Protocol.

**Autenticazione:** Bearer token

**Query Params:**
| Param | Tipo | Note |
|---|---|---|
| `device_id` | string | Opzionale — se omesso ritorna le chiavi di tutti i device |

**Response `200 OK`:**
```json
{
  "data": {
    "user_id": "64a1b2c3...",
    "devices": [
      {
        "device_id": "550e8400-...",
        "identity_key": "base64==",
        "signed_prekey": {
          "key_id": 5,
          "public_key": "base64==",
          "signature": "base64=="
        },
        "one_time_prekey": {
          "key_id": 87,
          "public_key": "base64=="
        }
      }
    ]
  }
}
```

> La OPK viene restituita UNA sola volta — il server la rimuove dal pool dopo questa response.

---

## Modulo 20 — Admin

> Tutti gli endpoint `/api/v1/admin/` richiedono il ruolo `admin` nel JWT. Accesso negato con `403 INSUFFICIENT_PERMISSIONS` per utenti normali.

### `GET /api/v1/admin/users`
Lista utenti con filtri avanzati.

**Autenticazione:** Bearer token (admin)

**Query Params:**
| Param | Tipo | Note |
|---|---|---|
| `cursor` | string | |
| `limit` | number | Max 100 |
| `status` | string | `active` \| `suspended` \| `deleted` |
| `query` | string | Ricerca per username o email |
| `created_after` | ISO date | |
| `created_before` | ISO date | |

---

### `GET /api/v1/admin/users/:id`
Profilo completo di un utente (include campi non pubblici).

**Autenticazione:** Bearer token (admin)

---

### `POST /api/v1/admin/users/:id/suspend`
Sospende un account utente.

**Autenticazione:** Bearer token (admin)

**Request Body:**
```json
{
  "reason": "Violazione termini di servizio — spam.",
  "duration_days": 30
}
```
> `duration_days: null` = sospensione permanente

**Response `200 OK`:**
```json
{
  "data": {
    "user_id": "64a1b2c3...",
    "status": "suspended",
    "suspension_reason": "Violazione termini di servizio — spam.",
    "suspended_until": "2025-08-14T19:30:00.000Z"
  }
}
```

---

### `POST /api/v1/admin/users/:id/unsuspend`
Rimuove la sospensione.

**Autenticazione:** Bearer token (admin)

**Response `200 OK`:** utente riattivato.

---

### `GET /api/v1/admin/reports`
Lista delle segnalazioni con filtri.

**Autenticazione:** Bearer token (admin)

**Query Params:**
| Param | Tipo | Note |
|---|---|---|
| `cursor` | string | |
| `limit` | number | Max 100 |
| `status` | string | `pending` \| `reviewing` \| `actioned` \| `dismissed` |
| `reason` | string | Tipo di segnalazione |

---

### `PATCH /api/v1/admin/reports/:id`
Aggiorna lo stato di una segnalazione.

**Autenticazione:** Bearer token (admin)

**Request Body:**
```json
{
  "status": "actioned",
  "action_taken": "user_suspended"
}
```

**Response `200 OK`:** segnalazione aggiornata.

---

### `GET /api/v1/admin/metrics`
Metriche operative in tempo reale.

**Autenticazione:** Bearer token (admin)

**Response `200 OK`:**
```json
{
  "data": {
    "users": {
      "total": 48291,
      "active_today": 12847,
      "new_today": 234,
      "suspended": 12
    },
    "messages": {
      "sent_today": 1284729,
      "sent_this_hour": 48291
    },
    "media": {
      "storage_used_bytes": 10737418240,
      "uploads_today": 8472
    },
    "calls": {
      "active_now": 47,
      "completed_today": 1284
    },
    "reports": {
      "pending": 8,
      "resolved_today": 3
    }
  }
}
```

---

### `GET /api/v1/admin/audit-log`
Log delle azioni admin (delete message, suspend user, ecc.).

**Autenticazione:** Bearer token (admin)

**Query Params:**
| Param | Tipo | Note |
|---|---|---|
| `cursor` | string | |
| `limit` | number | Max 100 |
| `action` | string | Es. `message_deleted`, `user_suspended` |
| `actor_id` | ObjectId | Admin che ha eseguito l'azione |
| `from` | ISO date | |
| `to` | ISO date | |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "64k1l2m3...",
      "action": "message_deleted_for_everyone",
      "actor_id": "64a1b2c3...",
      "actor_username": "admin_alpha",
      "target_type": "message",
      "target_id": "64c1d2e3...",
      "metadata": {
        "reason": "violazione regole",
        "chat_id": "64b1c2d3..."
      },
      "created_at": "2025-07-15T19:30:00.000Z"
    }
  ]
}
```

---

## WebSocket — Connessione e Autenticazione

### Endpoint
```
wss://api.alphachat.app/api/v1/ws?token=<access_token>
```

### Heartbeat
Il client invia un ping ogni 25 secondi. Il server risponde con pong. Dopo 3 ping mancati il server chiude la connessione con codice `4001`.

### Envelope standard — tutti gli eventi WebSocket
```json
{
  "event": "namespace.action",
  "data": { ... },
  "meta": {
    "timestamp": "2025-07-15T19:30:00.000Z",
    "sequence": 42
  }
}
```

### Lista completa eventi WebSocket

| Namespace | Evento | Direzione | Descrizione |
|---|---|---|---|
| `message` | `message.new` | Server→Client | Nuovo messaggio |
| `message` | `message.deleted_for_everyone` | Server→Client | Messaggio eliminato per tutti |
| `message` | `message.hidden_for_me` | Server→Client | Messaggio nascosto per il client |
| `message` | `message.reaction_added` | Server→Client | Nuova reazione |
| `message` | `message.reaction_removed` | Server→Client | Reazione rimossa |
| `message` | `message.read` | Server→Client | Conferma di lettura |
| `typing` | `typing.start` | Bidirezionale | Inizia a scrivere |
| `typing` | `typing.stop` | Bidirezionale | Smette di scrivere |
| `presence` | `presence.online` | Server→Client | Contatto va online |
| `presence` | `presence.offline` | Server→Client | Contatto va offline |
| `chat` | `chat.disappearing_changed` | Server→Client | Impostazione scomparsa modificata |
| `group` | `group.updated` | Server→Client | Gruppo modificato |
| `group` | `group.member_added` | Server→Client | Nuovo membro aggiunto |
| `group` | `group.member_removed` | Server→Client | Membro rimosso |
| `group` | `group.member_role_changed` | Server→Client | Ruolo membro modificato |
| `call` | `call.incoming` | Server→Client | Chiamata in arrivo |
| `call` | `call.declined` | Server→Client | Chiamata rifiutata |
| `call` | `call.ended` | Server→Client | Chiamata terminata |
| `session` | `session.revoked` | Server→Client | Sessione revocata |
| `security` | `security.password_changed` | Server→Client | Password modificata |
| `media` | `media.ready` | Server→Client | Media processing completato |

---

## Errori Standard — Codici Completi

| `error.code` | HTTP | Descrizione |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Campo mancante o non valido (`error.field` indica il campo) |
| `AUTH_TOKEN_MISSING` | 401 | Header Authorization assente |
| `AUTH_TOKEN_INVALID` | 401 | JWT malformato o firma non valida |
| `AUTH_TOKEN_EXPIRED` | 401 | JWT scaduto |
| `AUTH_TOKEN_REVOKED` | 401 | JWT nella blocklist Redis |
| `REFRESH_TOKEN_INVALID` | 401 | |
| `REFRESH_TOKEN_EXPIRED` | 401 | |
| `REFRESH_TOKEN_REUSED` | 401 | Possibile furto — tutte le sessioni revocate |
| `INVALID_CREDENTIALS` | 401 | Username/password errati |
| `ACCOUNT_LOCKED` | 403 | Troppi tentativi (`error.details.locked_until`) |
| `ACCOUNT_SUSPENDED` | 403 | |
| `INSUFFICIENT_PERMISSIONS` | 403 | Ruolo non sufficiente |
| `NOT_CHAT_MEMBER` | 403 | Utente non è membro della conversazione |
| `NOT_GROUP_ADMIN` | 403 | |
| `BLOCKED` | 403 | Utente bloccato |
| `USER_NOT_FOUND` | 404 | |
| `CHAT_NOT_FOUND` | 404 | |
| `MESSAGE_NOT_FOUND` | 404 | |
| `MEDIA_NOT_FOUND` | 404 | |
| `INVITE_LINK_INVALID` | 404 | |
| `MESSAGE_ALREADY_DELETED` | 410 | |
| `INVITE_LINK_EXPIRED` | 410 | |
| `USERNAME_TAKEN` | 409 | |
| `EMAIL_TAKEN` | 409 | |
| `PHONE_TAKEN` | 409 | |
| `CONTACT_ALREADY_EXISTS` | 409 | |
| `ALREADY_MEMBER` | 409 | |
| `REACTION_ALREADY_EXISTS` | 409 | |
| `CANNOT_DELETE_FOR_EVERYONE` | 403 | Non mittente, o messaggio > 48h, o non admin |
| `GROUP_FULL` | 400 | |
| `MEDIA_NOT_READY` | 400 | File ancora in processing |
| `INVALID_EMOJI` | 400 | Emoji non nella whitelist |
| `CANNOT_CHAT_WITH_SELF` | 400 | |
| `CANNOT_ADD_SELF` | 400 | |
| `USERNAME_CHANGE_TOO_SOON` | 429 | (`error.details.next_change_allowed_at`) |
| `RATE_LIMIT_EXCEEDED` | 429 | |
| `INTERNAL_ERROR` | 500 | |
| `SERVICE_UNAVAILABLE` | 503 | |

---

## Rate Limiting — Tabella Completa

| Endpoint / Gruppo | Limite | Finestra | Per |
|---|---|---|---|
| `POST /auth/register` | 5 | 1 ora | IP |
| `POST /auth/login` | 10 | 15 min | IP |
| `POST /auth/login` (account bloccato) | Backoff esponenziale | — | Account |
| `POST /auth/refresh` | 60 | 1 ora | Device |
| `POST /auth/2fa/verify` | 5 | 15 min | Account |
| `POST /auth/email/verify/resend` | 3 | 1 ora | Utente |
| `PATCH /users/me` | 10 | 1 ora | Utente |
| `PUT /users/me/password` | 5 | 1 ora | Utente |
| `POST /users/discover` | 1 | 24 ore | Utente |
| `POST /contacts` | 100 | 1 giorno | Utente |
| `POST /contacts/:id/block` | 20 | 1 giorno | Utente |
| `POST /chats/direct` | 20 | 1 ora | Utente |
| `POST /chats/:id/messages` | 100 | 1 min | Utente |
| `GET /chats/:id/messages` | 60 | 1 min | Utente |
| `DELETE /messages/:id` | 60 | 1 min | Utente |
| `POST /media/upload-url` | 100 | 1 ora | Utente |
| `POST /groups` | 10 | 1 giorno | Utente |
| `POST /groups/:id/members` | 50 | 1 ora | Gruppo |
| `POST /calls/initiate` | 20 | 1 ora | Utente |
| `POST /reports` | 10 | 1 giorno | Utente |
| `GET /admin/*` | 1000 | 1 ora | Admin |

---

*Alpha Chat API Specification v1.0 — Luglio 2025*
*Aggiornare questo documento prima di implementare, modificare o deprecare qualsiasi endpoint.*
*Breaking changes richiedono: nuovo prefisso versione + 18 mesi di retrocompatibilità + header `Deprecation` e `Sunset`.*
