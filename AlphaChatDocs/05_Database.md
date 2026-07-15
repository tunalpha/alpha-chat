# Alpha Chat — Database Schema
### Specifica Completa MongoDB — Ogni Collection, Campo, Indice
> Versione 1.0 — Luglio 2025
> Status: Engineering Phase — Pre-Backend Development
> Questo documento è la fonte di verità per ogni schema Mongoose.
> Nessun campo viene aggiunto al codice senza essere prima documentato qui.

---

## Indice Collection

| # | Collection | Scopo |
|---|---|---|
| 1 | `users` | Account utente, autenticazione, profilo |
| 2 | `sessions` | Sessioni attive, refresh token |
| 3 | `conversations` | Chat 1-to-1 e gruppi |
| 4 | `conversation_members` | Appartenenza a conversazioni |
| 5 | `messages` | Messaggi (E2E cifrati) |
| 6 | `message_reactions` | Reazioni emoji ai messaggi |
| 7 | `media` | Metadata file caricati su R2 |
| 8 | `user_prekeys` | Chiavi pubbliche Signal Protocol |
| 9 | `contacts` | Rubrica e blocklist utente |
| 10 | `reports` | Segnalazioni di contenuto |
| 11 | `channels` | Canali broadcast |
| 12 | `channel_members` | Appartenenza ai canali |
| 13 | `call_logs` | Storico chiamate audio/video |

---

## Convenzioni

- **ObjectId** — tutti gli `_id` sono `mongoose.Schema.Types.ObjectId`
- **Timestamp** — tutti i documenti hanno `createdAt` e `updatedAt` via `{ timestamps: true }`
- **Soft delete** — nessuna collection usa hard delete; ogni document ha un campo `deleted_at: Date | null`
- **Valori null** — un campo assente e un campo `null` hanno significato diverso; usare `null` esplicitamente quando il campo è opzionale ma presente
- **Enum come string** — tutti gli enum sono stringhe TypeScript literal (`'active' | 'inactive'`), non numeri
- **Indici** — documentati per ogni collection con motivazione e tipo (single field, compound, unique, sparse, TTL)

---

## 1. Collection `users`

Contiene un documento per ogni account registrato su Alpha Chat.

### Schema

```typescript
{
  _id: ObjectId,

  // --- Identità ---
  username: string,           // unico, 3-30 chars, lowercase, solo [a-z0-9_.]
  display_name: string,       // nome pubblico, max 60 chars
  bio: string | null,         // max 200 chars
  avatar_media_id: ObjectId | null,  // riferimento a media collection

  // --- Autenticazione ---
  email: string | null,       // unico se presente, lowercase
  email_verified: boolean,    // default: false
  email_verified_at: Date | null,
  password_hash: string | null,  // Argon2id — null per account OAuth futuri
  phone_hash: string | null,     // HMAC-SHA256(PEPPER, E164) — mai il numero in chiaro

  // --- 2FA ---
  totp_secret: string | null,    // chiave TOTP cifrata con env key
  totp_enabled: boolean,         // default: false
  backup_codes: string[],        // hash Argon2id dei backup codes

  // --- Sicurezza ---
  failed_login_attempts: number,   // default: 0, reset a 0 al login riuscito
  locked_until: Date | null,       // null = non bloccato
  last_login_at: Date | null,
  last_login_ip_hash: string | null,  // ultimi 3 ottetti dell'IP (privacy)
  last_login_country: string | null,  // codice ISO 3166-1 alpha-2

  // --- Impostazioni Privacy ---
  privacy: {
    show_last_seen: 'everyone' | 'contacts' | 'nobody',   // default: 'contacts'
    show_online_status: 'everyone' | 'contacts' | 'nobody', // default: 'contacts'
    show_read_receipts: boolean,   // default: true
    allow_adding_to_groups: 'everyone' | 'contacts' | 'nobody', // default: 'contacts'
    allow_calls_from: 'everyone' | 'contacts' | 'nobody', // default: 'contacts'
  },

  // --- Notifiche ---
  notification_settings: {
    messages: boolean,   // default: true
    calls: boolean,      // default: true
    groups: boolean,     // default: true
    preview_text: boolean,  // default: false (non mostrare testo in notifica)
  },

  // --- Stato Account ---
  status: 'active' | 'suspended' | 'deleted',  // default: 'active'
  deleted_at: Date | null,
  suspension_reason: string | null,
  is_verified: boolean,   // account verificato Alpha Chat (badge ufficiale)

  // --- Wallet (V2 — opzionale) ---
  wallet_enabled: boolean,  // default: false
  wallet_id: string | null, // ID esterno sistema wallet

  // Timestamps automatici
  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `username` | unique | Lookup per username in ricerca e mention |
| `email` | unique, sparse | Login via email; sparse perché nullable |
| `phone_hash` | unique, sparse | Contact discovery; sparse perché nullable |
| `status` | single | Filter utenti attivi vs sospesi |
| `{ status, createdAt }` | compound | Dashboard admin — nuovi utenti filtrati per status |

---

## 2. Collection `sessions`

Una sessione per ogni device autenticato. Contiene il refresh token (hashato).

### Schema

```typescript
{
  _id: ObjectId,

  user_id: ObjectId,           // ref: users
  device_id: string,           // UUID v4 generato dal client al primo login
  device_name: string | null,  // es. "iPhone 15 Pro di Marco"
  device_type: 'ios' | 'android' | 'web' | 'desktop',

  // --- Token ---
  refresh_token_hash: string,  // SHA-256 del refresh token — mai il token in chiaro
  expires_at: Date,            // default: now + 30 giorni

  // --- Geolocalizzazione (per anomaly detection) ---
  ip_hash: string | null,      // SHA-256(IP) — mai l'IP in chiaro
  country_code: string | null, // ISO 3166-1 alpha-2
  city: string | null,         // solo il nome della città, non le coordinate

  // --- Push Notifications ---
  push_token: string | null,   // Expo push token per questo device
  push_enabled: boolean,       // default: true

  // --- Sicurezza ---
  is_suspicious: boolean,      // flagged da anomaly detection
  last_used_at: Date,

  deleted_at: Date | null,     // null = sessione attiva

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `refresh_token_hash` | unique | Lookup refresh token — path critico |
| `user_id` | single | Fetch tutte le sessioni di un utente |
| `{ user_id, device_id }` | compound, unique | Una sola sessione per device per utente |
| `expires_at` | TTL (deleteAfterSeconds: 0) | Auto-cleanup sessioni scadute |

---

## 3. Collection `conversations`

Ogni chat 1-to-1 e ogni gruppo è un documento in questa collection.

### Schema

```typescript
{
  _id: ObjectId,

  type: 'direct' | 'group',

  // --- Solo per gruppi ---
  name: string | null,           // null per direct
  description: string | null,    // null per direct, max 300 chars
  avatar_media_id: ObjectId | null,
  invite_link_token: string | null,   // token UUID per link di invito pubblico
  invite_link_enabled: boolean,       // default: false
  invite_link_expires_at: Date | null,

  // --- Amministrazione (solo gruppi) ---
  created_by: ObjectId | null,        // ref: users
  max_members: number,                // default: 256 per gruppi standard, 1000 per supergroups V2

  // --- Impostazioni Messaggi ---
  disappearing_messages_enabled: boolean,  // default: false
  disappearing_messages_duration: number | null,  // secondi, es. 86400 = 24h

  // --- Stato ---
  last_message_at: Date | null,       // per ordinare la lista conversazioni
  last_message_preview: string | null, // testo cifrato o "[media]" — solo per sort, non mostrare
  member_count: number,               // denormalizzato per evitare COUNT query

  deleted_at: Date | null,

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `invite_link_token` | unique, sparse | Lookup link invito |
| `last_message_at` | single | Sort lista conversazioni (DESC) |
| `type` | single | Filter direct vs group |

---

## 4. Collection `conversation_members`

Join table tra utenti e conversazioni. Contiene i metadati di appartenenza.

### Schema

```typescript
{
  _id: ObjectId,

  conversation_id: ObjectId,   // ref: conversations
  user_id: ObjectId,           // ref: users

  role: 'admin' | 'member',   // default: 'member'
  // In direct: entrambi gli utenti hanno role 'member'
  // In gruppi: almeno un admin (il creatore)

  // --- Notifiche per questa conversazione ---
  is_muted: boolean,           // default: false
  muted_until: Date | null,    // null = silenzio permanente finché non si de-muta

  // --- Stato lettura ---
  last_read_message_id: ObjectId | null,  // ref: messages
  last_read_at: Date | null,

  // --- Messaggi nascosti (eliminati "solo per me") ---
  hidden_message_ids: ObjectId[],   // messaggi visibili agli altri ma nascosti a questo utente
  // Array tenuto piccolo (max 100); oltre si usa soft-delete sul messaggio per l'utente

  // --- Stato Membership ---
  joined_at: Date,
  left_at: Date | null,           // null = membro attivo
  removed_by: ObjectId | null,    // ref: users — chi ha rimosso questo membro (se espulso)
  deleted_at: Date | null,

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `{ conversation_id, user_id }` | compound, unique | Verifica appartenenza — path critico |
| `user_id` | single | Fetch tutte le conversazioni di un utente |
| `{ user_id, last_read_at }` | compound | Calcolo unread count per utente |
| `{ conversation_id, role }` | compound | Fetch admin di un gruppo |

---

## 5. Collection `messages`

Il core del sistema. Ogni messaggio è un documento.  
**Il contenuto è sempre cifrato E2E — il server conserva solo il ciphertext.**

### Schema

```typescript
{
  _id: ObjectId,

  client_message_id: string,    // UUID v4 generato dal client — per idempotenza
  conversation_id: ObjectId,    // ref: conversations
  sender_id: ObjectId,          // ref: users

  // --- Contenuto cifrato (Signal Protocol) ---
  // Per messaggi E2E: il server conserva solo il ciphertext opaco
  ciphertext: string | null,    // base64 — null solo per messaggi di sistema
  ciphertext_type: number | null, // Signal Protocol message type (1=PreKeyWhisperMessage, 2=WhisperMessage)
  sender_key_id: number | null, // quale SPK/OPK del mittente è stato usato

  // --- Tipo Messaggio ---
  message_type: 'text' | 'media' | 'system' | 'reply' | 'forward',

  // --- Reply ---
  reply_to_message_id: ObjectId | null,   // ref: messages
  reply_to_snapshot: {                    // snapshot al momento dell'invio (in caso di eliminazione)
    sender_id: ObjectId,
    message_type: string,
    // ciphertext del messaggio originale NON conservato qui — solo metadata
  } | null,

  // --- Media ---
  media_id: ObjectId | null,     // ref: media

  // --- Messaggi di Sistema (non E2E) ---
  system_event: string | null,   // es. 'group_created', 'member_added', 'member_removed'
  system_metadata: Record<string, unknown> | null,

  // --- Ordine e Delivery ---
  sequence_number: number,        // monotonic per conversation_id — assegnato dal server
  sent_at: Date,                  // timestamp del client (incluso nel ciphertext)

  // --- Eliminazione ---
  deleted_for_everyone: boolean,     // default: false
  deleted_for_everyone_at: Date | null,
  deleted_for: ObjectId[],           // utenti per cui è eliminato "solo per me"

  // --- Messaggi a Scomparsa ---
  expires_at: Date | null,           // null = non scade

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `client_message_id` | unique | Idempotenza — prevenire duplicati |
| `{ conversation_id, sequence_number }` | compound, unique | Fetch messaggi paginati in ordine — path critico |
| `{ conversation_id, createdAt }` | compound | Paginazione per timestamp come fallback |
| `sender_id` | single | Storico messaggi di un utente |
| `expires_at` | TTL (deleteAfterSeconds: 0), sparse | Auto-delete messaggi a scomparsa |
| `reply_to_message_id` | single, sparse | Fetch tutte le risposte a un messaggio |

---

## 6. Collection `message_reactions`

Le reazioni emoji ai messaggi. Una per utente per messaggio per emoji.

### Schema

```typescript
{
  _id: ObjectId,

  message_id: ObjectId,    // ref: messages
  user_id: ObjectId,       // ref: users
  emoji: string,           // es. "❤️", "👍", "😂" — Unicode emoji character

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `{ message_id, user_id, emoji }` | compound, unique | Un utente non può mettere la stessa emoji due volte |
| `message_id` | single | Fetch tutte le reazioni di un messaggio |
| `user_id` | single | Storico reazioni di un utente |

---

## 7. Collection `media`

Metadata dei file caricati su Cloudflare R2. Il file fisico è su R2; qui ci sono solo i metadata.

### Schema

```typescript
{
  _id: ObjectId,

  uploader_id: ObjectId,        // ref: users
  conversation_id: ObjectId,    // ref: conversations — per verifica permessi accesso

  // --- File ---
  r2_key: string,               // chiave del file in R2 (es. "media/2025/07/uuid.jpg")
  r2_bucket: string,            // nome bucket R2
  original_filename: string | null,
  mime_type: string,            // es. "image/jpeg", "video/mp4"
  size_bytes: number,
  sha256_hash: string,          // hash del file originale (verifica integrità)

  // --- Thumbnail ---
  thumbnail_r2_key: string | null,  // chiave thumbnail su R2 (generata server-side)
  thumbnail_width: number | null,
  thumbnail_height: number | null,

  // --- Dimensioni (solo per immagini/video) ---
  width: number | null,
  height: number | null,
  duration_seconds: number | null,  // solo per audio/video

  // --- E2E ---
  is_encrypted: boolean,         // true se il file è cifrato E2E (AES-256-GCM)
  encryption_key: null,          // MAI conservare la chiave qui — è nel device
  // La chiave di cifratura del media è inclusa nel ciphertext del messaggio dal client

  // --- Moderazione ---
  csam_checked: boolean,         // default: false
  csam_match: boolean,           // default: false
  virus_checked: boolean,        // default: false
  virus_detected: boolean,       // default: false
  exif_stripped: boolean,        // GPS EXIF rimosso da immagini — default: false

  // --- Stato ---
  status: 'pending' | 'processing' | 'ready' | 'rejected',
  // pending: upload avviato, file non ancora confermato
  // processing: job asincrono in corso (virus scan, thumbnail, EXIF strip)
  // ready: pronto per la distribuzione
  // rejected: rifiutato (CSAM match o virus rilevato)

  deleted_at: Date | null,       // eliminato dal messaggio, file rimosso da R2

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `r2_key` | unique | Prevenire duplicati su R2 |
| `uploader_id` | single | Storico upload utente |
| `conversation_id` | single | Verifica permessi accesso |
| `{ status, createdAt }` | compound | Job processor — fetch media in 'processing' più vecchi di N minuti |
| `sha256_hash` | single | Deduplicazione file identici |

---

## 8. Collection `user_prekeys`

Le chiavi pubbliche del Signal Protocol per ogni device di ogni utente.  
Il server conserva solo le chiavi **pubbliche** — le private non lasciano mai il device.

### Schema

```typescript
{
  _id: ObjectId,

  user_id: ObjectId,    // ref: users
  device_id: string,    // UUID v4 — corrisponde a sessions.device_id

  // --- Identity Key (IK) — permanente per questo device ---
  identity_key: string,   // chiave pubblica Curve25519, base64

  // --- Signed PreKey (SPK) — ruotata ogni ~7 giorni ---
  signed_prekey: {
    key_id: number,
    public_key: string,   // Curve25519, base64
    signature: string,    // firma con identity key, base64
    created_at: Date,
  },

  // --- One-Time PreKeys (OPK) — usate una sola volta ---
  // Ogni X3DH handshake consuma una OPK; il server la rimuove dopo l'uso
  one_time_prekeys: Array<{
    key_id: number,
    public_key: string,   // Curve25519, base64
  }>,
  // Il client carica nuove OPK quando il server ne ha < 5
  // Soglia upload: quando one_time_prekeys.length < 5, il server notifica il client

  // --- Stato ---
  last_prekey_upload_at: Date,

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `{ user_id, device_id }` | compound, unique | Lookup chiavi per device specifico |
| `user_id` | single | Fetch chiavi di tutti i device di un utente (per fan-out messaggi) |
| `{ user_id, "one_time_prekeys.0" }` | single | Verifica disponibilità OPK |

---

## 9. Collection `contacts`

La rubrica di ogni utente: contatti aggiunti, bloccati, scoperti via phone discovery.

### Schema

```typescript
{
  _id: ObjectId,

  owner_id: ObjectId,     // ref: users — l'utente a cui appartiene questo contatto
  contact_id: ObjectId,   // ref: users — l'utente in rubrica

  // --- Relazione ---
  relationship: 'contact' | 'blocked',
  // 'contact': utente aggiunto in rubrica
  // 'blocked': utente bloccato — non può inviare messaggi, non vede lo stato

  // --- Metadati ---
  nickname: string | null,   // soprannome locale (visibile solo all'owner)
  discovered_via: 'phone_discovery' | 'username_search' | 'group' | 'qr_code' | 'link',

  blocked_at: Date | null,   // null se non bloccato

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `{ owner_id, contact_id }` | compound, unique | Prevenire duplicati |
| `owner_id` | single | Fetch tutti i contatti di un utente |
| `contact_id` | single | "Chi mi ha aggiunto in rubrica" |
| `{ owner_id, relationship }` | compound | Fetch solo i bloccati |

---

## 10. Collection `reports`

Le segnalazioni di contenuto inviate dagli utenti. Processo di moderazione manuale per V1.

### Schema

```typescript
{
  _id: ObjectId,

  // --- Chi segnala e cosa ---
  reporter_id: ObjectId,              // ref: users
  reported_user_id: ObjectId | null,  // ref: users
  reported_message_id: ObjectId | null, // ref: messages
  reported_conversation_id: ObjectId | null, // ref: conversations

  reason: 'spam'
        | 'harassment'
        | 'illegal_content'
        | 'csam'
        | 'misinformation'
        | 'violence'
        | 'other',

  description: string | null,  // testo libero dell'utente, max 500 chars

  // --- Processo di Review ---
  status: 'pending' | 'reviewing' | 'actioned' | 'dismissed',
  reviewed_by: ObjectId | null,   // ref: users (admin)
  reviewed_at: Date | null,
  action_taken: string | null,    // es. "user_suspended", "message_removed", "no_action"

  // --- Metadati ---
  reporter_ip_hash: string | null,  // per rilevare segnalazioni massive dallo stesso IP

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `{ status, createdAt }` | compound | Queue moderazione — pending più vecchi prima |
| `reporter_id` | single | Storico segnalazioni di un utente |
| `reported_user_id` | single | Storico segnalazioni contro un utente |
| `reported_message_id` | single, sparse | Verifica se un messaggio è già stato segnalato |
| `reason` | single | Filter per tipo di segnalazione |

---

## 11. Collection `channels`

I Canali broadcast — un mittente, molti riceventi (simile a Telegram Channels).

### Schema

```typescript
{
  _id: ObjectId,

  // --- Identità ---
  username: string,         // unico, stesso formato di users.username
  name: string,             // nome visualizzato, max 60 chars
  description: string | null, // max 300 chars
  avatar_media_id: ObjectId | null,

  // --- Proprietà ---
  owner_id: ObjectId,       // ref: users
  is_public: boolean,       // default: true — i canali privati sono invite-only
  is_verified: boolean,     // badge verificato Alpha Chat
  invite_link_token: string | null,

  // --- Statistiche (denormalizzate) ---
  subscriber_count: number,  // aggiornato da job periodico o in-process

  // --- Stato ---
  deleted_at: Date | null,

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `username` | unique | Lookup canale per username |
| `owner_id` | single | Canali di un utente |
| `{ is_public, subscriber_count }` | compound | Discovery canali pubblici ordinati per popolarità |
| `is_verified` | single | Filter canali verificati |

---

## 12. Collection `channel_members`

Iscrizioni ai canali. Ogni documento = un utente iscritto a un canale.

### Schema

```typescript
{
  _id: ObjectId,

  channel_id: ObjectId,   // ref: channels
  user_id: ObjectId,       // ref: users

  role: 'admin' | 'editor' | 'subscriber',
  // admin: può gestire il canale, aggiungere editor
  // editor: può pubblicare messaggi
  // subscriber: solo lettura

  // --- Notifiche ---
  notifications_enabled: boolean,  // default: true

  // --- Stato ---
  joined_at: Date,
  left_at: Date | null,

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `{ channel_id, user_id }` | compound, unique | Prevenire iscrizioni duplicate |
| `user_id` | single | Canali a cui un utente è iscritto |
| `{ channel_id, role }` | compound | Fetch admin/editor di un canale |

---

## 13. Collection `call_logs`

Storico delle chiamate audio e video.

### Schema

```typescript
{
  _id: ObjectId,

  // --- Partecipanti ---
  initiator_id: ObjectId,    // ref: users — chi ha avviato la chiamata
  participants: Array<{
    user_id: ObjectId,       // ref: users
    joined_at: Date | null,  // null se non ha mai risposto
    left_at: Date | null,
    status: 'answered' | 'missed' | 'declined' | 'busy',
  }>,

  // --- Contesto ---
  conversation_id: ObjectId | null,  // ref: conversations — la chat da cui è partita

  // --- Tipo ---
  call_type: 'audio' | 'video',
  is_group_call: boolean,

  // --- Daily.co ---
  daily_room_name: string | null,   // identificatore stanza Daily.co
  daily_session_id: string | null,

  // --- Tempi ---
  started_at: Date,
  answered_at: Date | null,    // quando il primo partecipante ha risposto
  ended_at: Date | null,
  duration_seconds: number | null,  // null se la chiamata non è mai stata risposta

  // --- Esito ---
  end_reason: 'completed' | 'missed' | 'declined' | 'failed' | 'cancelled',

  createdAt: Date,
  updatedAt: Date,
}
```

### Indici

| Campo / Compound | Tipo | Motivazione |
|---|---|---|
| `initiator_id` | single | Storico chiamate avviate da un utente |
| `{ "participants.user_id", started_at }` | compound | Storico chiamate di un utente (ingoing + outgoing) |
| `conversation_id` | single, sparse | Chiamate di una conversazione |
| `{ started_at, end_reason }` | compound | Analytics / dashboard admin |

---

## Relazioni tra Collection

```
users ←─────────────────────────────────────────────────────────────────┐
  │                                                                      │
  ├──→ sessions (user_id)                                                │
  ├──→ user_prekeys (user_id)                                            │
  ├──→ contacts.owner_id, contacts.contact_id                           │
  ├──→ conversation_members (user_id)                                    │
  │       └──→ conversations (_id)                                       │
  │               └──→ messages (conversation_id)                        │
  │                       ├──→ media (media_id)                          │
  │                       └──→ message_reactions (message_id)            │
  ├──→ reports.reporter_id, reports.reported_user_id                     │
  ├──→ channel_members (user_id)                                         │
  │       └──→ channels (_id)                                            │
  └──→ call_logs.initiator_id, call_logs.participants.user_id            │
                                                                         │
  Tutti i campi *_id fanno ref a users._id ──────────────────────────────┘
```

---

## Strategia di Indicizzazione — Principi

1. **Ogni query frequente ha il suo indice** — non ci sono query O(n) in produzione
2. **Compound index: ordine dei campi è equality first, range last** — MongoDB usa i campi in ordine; il campo più selettivo va primo
3. **Sparse index per campi nullable** — evita di indicizzare i documenti con il campo null
4. **TTL index per cleanup automatico** — sessioni scadute, messaggi a scomparsa, OTP Redis
5. **Nessun indice su campi a bassa cardinalità da soli** — es. `boolean` da solo non vale; solo in compound

---

## Migration Strategy

MongoDB è schema-less ma Mongoose applica la validazione a livello applicativo. Le regole:

**Aggiunta campo (retrocompatibile):**
- Aggiungere il campo allo schema Mongoose con valore di default
- I documenti esistenti senza il campo vengono trattati come se avessero il default
- Nessuna migration necessaria

**Rinominazione campo:**
- Scrivere uno script di migration che legge il campo vecchio, scrive il nuovo, rimuove il vecchio
- Testare su staging con dump di produzione prima del deploy
- Deploy in due fasi: 1) codice accetta entrambi i nomi, 2) dopo migration, codice accetta solo il nuovo

**Rimozione campo:**
- Rimuovere prima dal codice (il campo non viene più scritto né letto)
- Il campo rimane nel database come rumore inerte
- Opzionale: script di cleanup per rimuovere il campo dai documenti esistenti (unset)

**Cambio tipo campo:**
- Sempre una migration dati — mai assumere che MongoDB faccia casting automatico
- Testare con `mongosh` su staging prima del deploy

---

## Seed Data (Development)

Per l'ambiente di sviluppo, creare:

- **3 utenti:** `alice`, `bob`, `carol` con password `dev_password_123`
- **1 conversazione diretta** tra alice e bob, con 10 messaggi di test
- **1 gruppo** "Alpha Chat Team" con tutti e 3, 5 messaggi
- **1 canale** "Alpha Chat Updates" di proprietà di alice
- **1 call_log** tra alice e bob, completata, durata 120 secondi

Il seed script è in `scripts/seed.ts` e si esegue con `pnpm run seed`.

---

*Alpha Chat Database Schema v1.0 — Luglio 2025*
*Aggiornare questo documento prima di modificare qualsiasi schema Mongoose.*
