# Alpha Chat — MVP Architecture
### Startup First. Ship Fast. Grow Without Rewriting.
> Versione 3.0 — Luglio 2025
> Status: Architecture Design — Pre-Development
> Contesto: 1 sviluppatore principale + AI. Target: Beta pubblica nel minor tempo possibile.

---

## Changelog v3.0
- **E2E:** decisione definitiva — Signal Protocol (libsignal) dalla Versione 1. Non in V2, non "più avanti". Dal primo messaggio. La sezione 8.2 è riscritta integralmente.
- **Timeline:** aggiornata a ~22 settimane (Sprint 2.5 aggiunto per Signal Protocol)
- **Sicurezza:** allineamento con `alpha-chat-security-architecture.md` — ES256 (non RS256), JWT blocklist Redis, HMAC-SHA256 per phone hashing, signed URL TTL 1h
- **Feature filter:** ogni nuova funzionalità deve superare tre domande prima di entrare nel documento (vedi Sezione 1.4)

## Changelog v2.0
- **Database:** sostituito PostgreSQL con MongoDB Atlas come database unico per V1
- **Architettura:** riprogettata come sistema completamente modulare (Core + Moduli Opzionali)
- **Nuova sezione:** specifica completa della funzionalità di eliminazione messaggi (Versione 1)
- Aggiornate tutte le sezioni coerenti con le nuove scelte

---

## Indice

1. [Principi Guida](#1-principi-guida)
2. [Architettura Modulare](#2-architettura-modulare)
3. [Visione dell'Architettura MVP](#3-visione-dellarchitettura-mvp)
4. [Stack Tecnologico Scelto](#4-stack-tecnologico-scelto)
5. [Database Unico — MongoDB Atlas](#5-database-unico--mongodb-atlas)
6. [Backend](#6-backend)
7. [Frontend](#7-frontend)
8. [Real-time Messaging](#8-real-time-messaging)
9. [Crittografia e Sicurezza](#9-crittografia-e-sicurezza)
10. [Sistema Media](#10-sistema-media)
11. [Autenticazione](#11-autenticazione)
12. [Chiamate e Videochiamate](#12-chiamate-e-videochiamate)
13. [Notifiche Push](#13-notifiche-push)
14. [Sistema Gruppi](#14-sistema-gruppi)
15. [Username e Identità](#15-username-e-identità)
16. [Eliminazione Messaggi](#16-eliminazione-messaggi)
17. [Wallet USDA — Modulo Opzionale](#17-wallet-usda--modulo-opzionale)
18. [Hosting e Deployment](#18-hosting-e-deployment)
19. [Monitoraggio e Osservabilità](#19-monitoraggio-e-osservabilità)
20. [Percorso di Crescita](#20-percorso-di-crescita)
21. [Roadmap MVP — Sprint Plan](#21-roadmap-mvp--sprint-plan)
22. [Checklist Pre-Beta](#22-checklist-pre-beta)

---

## 1. Principi Guida

### Il Problema dell'Architettura Precedente

Il documento `alpha-chat-product-design.md` descrive l'architettura di un prodotto per milioni di utenti: Kafka, Cassandra, Kubernetes, Istio, gRPC, multi-region, service mesh, SFU custom. Tutto corretto per quella scala. Tutto sbagliato per un MVP con 1 sviluppatore.

Un team di 1 che implementa quell'architettura impiega 3 anni prima di aprire la beta. Nessuna startup può permetterselo.

### I Veri Principi

**Semplicità radicale nel presente, porte aperte nel futuro.**
Ogni scelta tecnica deve rispondere a: *"Posso costruire questo in giorni, non in settimane?"*

**Database singolo finché tiene.**
Aggiungere un secondo database moltiplica la complessità operativa. Il database scelto deve reggere fino a ~50.000 utenti attivi senza problemi. Oltre, si aggiunge con dati reali come guida.

**Managed services ovunque possibile.**
Ogni servizio gestito da un provider è infrastruttura che non devi scrivere, mantenere, monitorare, aggiornare. Il costo di un managed service è irrisorio rispetto al costo del tempo di uno sviluppatore.

**Monolite modulare, non microservizi.**
Il monolite non è una scelta sbagliata — è la scelta corretta per un team piccolo. I moduli sono ben separati internamente, pronti per essere estratti quando il dolore supera il costo di separare.

**Modularità come principio architetturale.**
Ogni componente è indipendente. Un modulo opzionale (Wallet, AI, Marketplace) si aggiunge senza toccare il Core. Si aggiorna senza rischio di regressione sulla messaggistica. Si disattiva senza impatto sugli altri moduli.

**Le funzionalità "difficili" si comprano, non si costruiscono.**
Real-time messaging, chiamate, push notifications: esistono servizi maturi che risolvono questi problemi meglio di quanto si possa fare in V1.

---

## 2. Architettura Modulare

### 2.1 Visione

Alpha Chat è progettata come una piattaforma modulare in cui il **Core** di messaggistica è indipendente da qualsiasi modulo aggiuntivo. I moduli opzionali si agganciano al Core tramite interfacce definite, senza modificarne il comportamento.

```
╔═══════════════════════════════════════════════════════════════╗
║                      ALPHA CHAT PLATFORM                      ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   ┌─────────────────────────── CORE ──────────────────────┐   ║
║   │                                                       │   ║
║   │   Chat         Gruppi        Canali (V1)              │   ║
║   │   Chiamate     Videochiamate Media                    │   ║
║   │   Notifiche                                           │   ║
║   │                                                       │   ║
║   └───────────────────────────────────────────────────────┘   ║
║                                                               ║
║   ┌────────────── MODULI OPZIONALI ───────────────────────┐   ║
║   │                                                       │   ║
║   │   Wallet USDA    AI Assistant    Business Tools       │   ║
║   │   Cloud Storage  Marketplace                          │   ║
║   │                                                       │   ║
║   └───────────────────────────────────────────────────────┘   ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

### 2.2 Moduli Core (Versione 1)

Questi moduli compongono il prodotto base. Sono tutti sviluppati e rilasciati in V1.

| Modulo | Responsabilità | Dipendenze |
|---|---|---|
| **Chat** | Messaggi 1-to-1, delivery status, E2E | Auth, Media, Notifiche |
| **Gruppi** | Chat multi-utente, permessi, inviti | Chat, Notifiche |
| **Canali** | Broadcast 1-to-many, iscrizioni | Auth, Media |
| **Chiamate** | Audio 1-to-1 e di gruppo | Auth, Notifiche |
| **Videochiamate** | Video 1-to-1 | Auth, Notifiche |
| **Media** | Upload, storage, delivery | Auth |
| **Notifiche** | Push, preferenze, DND | Auth |

> **Regola fondamentale del Core:** nessun modulo Core fa riferimento a un modulo Opzionale. Il Core non sa che il Wallet esiste.

### 2.3 Moduli Opzionali

Questi moduli si aggiungono al Core in versioni successive senza modificare il Core stesso. Si attivano per utente (opt-in) o per configurazione del sistema.

| Modulo | Descrizione | Versione |
|---|---|---|
| **Wallet USDA** | Micro-transazioni in USDA, completamente separato dalla messaggistica | V2 |
| **AI Assistant** | Riassunti chat, smart reply, trascrizione vocale — tutto on-device | V3 |
| **Business Tools** | Profili business, broadcast, analytics, bot API | V2 |
| **Cloud Storage** | Backup E2E su storage personale (iCloud/Drive/self-hosted) | V3 |
| **Marketplace** | Mini App Framework, integrazioni third-party | V3 |

### 2.4 Principio di Isolamento del Wallet

Il modulo Wallet USDA è **architetturalmente separato** da tutti i moduli Core:

```
Core DB (MongoDB Atlas)          Wallet DB (MongoDB Atlas separato)
      │                                        │
      │  ← Nessuna connessione diretta →       │
      │                                        │
   user._id ─────────────────────────── user_ref (FK opaca)
```

- Wallet ha il proprio cluster MongoDB separato
- Wallet ha il proprio set di route API (`/api/v1/wallet/...`)
- Wallet ha autenticazione aggiuntiva (PIN + biometria)
- Un aggiornamento del modulo Wallet non richiede deploy del Core
- Il Core non importa nessun modulo del Wallet

---

## 3. Visione dell'Architettura MVP

```
┌─────────────────────────────────────────────────────────────┐
│                       CLIENT LAYER                           │
│                                                              │
│   React Native (iOS + Android)        React Web (PWA)        │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS / WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                   SINGLE BACKEND                             │
│                                                              │
│          Node.js + Express  (Monolite Modulare)              │
│                                                              │
│  ┌────────────────── CORE ──────────────────────────────┐   │
│  │  Auth │ Users │ Messages │ Groups │ Media │ Notif.  │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌────────────── MODULI OPZIONALI ──────────────────────┐   │
│  │  Wallet (disabilitato in V1)  │  AI (V3)             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└───────┬──────────────┬─────────────────┬────────────────────┘
        │              │                 │
┌───────▼──────┐ ┌─────▼─────┐ ┌────────▼───────────────────┐
│ MongoDB Atlas│ │  Upstash  │ │  External Managed Services  │
│ (unico DB)   │ │  Redis    │ │                             │
│              │ │ (cache +  │ │  Stream Chat  (messaging)   │
│              │ │ presence) │ │  Cloudflare R2  (media)     │
└──────────────┘ └───────────┘ │  Twilio  (SMS OTP)          │
                               │  Expo Push  (notifiche)     │
                               │  Daily.co  (chiamate)       │
                               └─────────────────────────────┘
```

Un backend, un database principale, Redis per lo stato in-memory, servizi managed per le parti complesse. Nessun orchestratore, nessun service mesh, nessuna queue distribuita in V1.

---

## 4. Stack Tecnologico Scelto

### 4.1 Backend — Node.js + TypeScript + Express

**Perché scelto:**
- TypeScript condiviso tra frontend e backend elimina le discrepanze di tipo tra i due layer
- Ecosistema npm vastissimo: librerie per qualsiasi problema già risolto
- Facilità di sviluppo su Replit: ambienti Node.js sono nativi e preconfigurati
- Un team di 1 conosce quasi certamente JavaScript/TypeScript meglio di Go o Rust
- I/O-bound workload (messaggi, API) non richiedono Go per le performance in V1
- Le librerie per i servizi managed (Stream, Twilio, MongoDB) hanno SDK TypeScript di prima classe
- Framework Express: minimalista, nessuna magia nascosta, debugging lineare

**Perché escluso Go:**
Go è eccellente per alta concorrenza e bassa latenza. Il vantaggio di Go rispetto a Node.js non si manifesta prima di milioni di richieste/giorno. Il costo di switching (nuova lingua, ecosistema diverso, librerie diverse) supera il beneficio in V1.

**Quando migrare:**
Quando la latenza P99 delle API supera stabilmente i 500ms sotto carico reale, o quando si supera ~100.000 DAU. Non prima.

---

### 4.2 Frontend Mobile — React Native + Expo

**Perché scelto:**
- Un codebase per iOS e Android (~85% del codice condiviso)
- Expo Managed Workflow: nessuna configurazione nativa necessaria per V1
- Expo EAS Build: build iOS/Android nel cloud, senza necessità di Mac per Android
- Over-the-air updates (EAS Update): fix critici senza re-submission all'App Store
- TypeScript condiviso con il backend (tipi degli endpoint disponibili su entrambi i lati)
- Comunità enorme, librerie di alta qualità

**Perché escluso Flutter:** richiede Dart, nessun codice condiviso con il backend Node.js. Overhead inaccettabile per un team di 1.

**Perché escluso nativo (Swift/Kotlin):** due codebase, due set di competenze, il doppio del tempo. Impensabile per un MVP.

**Quando migrare:**
Quando le performance della lista messaggi o della camera non sono accettabili. Nella pratica: raramente in V1. WhatsApp ha usato React Native per feature critiche per anni.

---

### 4.3 Frontend Web — React + Vite + TypeScript

**Perché scelto:**
- Stesso linguaggio e framework del mobile → massimo riutilizzo di hook e logica
- Vite: sviluppo velocissimo, HMR istantaneo
- PWA-ready: installabile da browser, nessun download richiesto
- Il web è la strategia di acquisizione più rapida per una beta

**Quando migrare:**
Mai per performance. L'eventuale migrazione sarebbe a Next.js solo per SSR/SEO, non per capacità tecnica.

---

### 4.4 Linguaggio — TypeScript Ovunque

TypeScript strict mode con `noImplicitAny: true` su tutti i package. Un errore di tipo a compile-time non diventa un bug in produzione. L'AI genera TypeScript di alta qualità.

Il pacchetto `shared-types` è il punto centrale: i tipi `Message`, `User`, `Conversation` sono definiti una volta e usati ovunque — backend, mobile, web.

---

## 5. Database Unico — MongoDB Atlas

### 5.1 La Scelta: MongoDB Atlas

**MongoDB Atlas** è il database unico per la Versione 1.

**Cos'è MongoDB Atlas:** il servizio managed di MongoDB, hostato su cloud (AWS/GCP/Azure a scelta), con backup automatici, monitoring integrato, scaling verticale e orizzontale tramite UI, e free tier permanente (M0: 512MB).

---

**Perché MongoDB Atlas per Alpha Chat:**

**1. Sviluppo rapido**
MongoDB lavora con documenti JSON-nativi. I messaggi, i profili, le conversazioni sono naturalmente documenti — non tabelle con relazioni da gestire tramite JOIN. Aggiungere un campo a un documento non richiede una migration: il campo esiste nei nuovi documenti, non esiste in quelli vecchi, e il codice gestisce entrambi i casi. In un contesto startup dove lo schema evolve ogni settimana, questa flessibilità è un vantaggio concreto.

**2. Esperienza del team**
Node.js e MongoDB sono nati insieme nell'ecosistema JavaScript. Mongoose (il principale ODM per Node.js) è ampiamente documentato, con esempi ovunque e supporto AI eccellente. La curva di apprendimento per uno sviluppatore Node.js che inizia con MongoDB è misurata in ore, non in giorni.

**3. Semplicità di gestione**
MongoDB Atlas gestisce in automatico: backup giornalieri, monitoring delle performance, alert su anomalie, aggiornamenti di versione, replica set per alta disponibilità. Non c'è nulla da configurare sul server. Il database è operativo in 5 minuti dalla creazione dell'account.

**4. Integrazione nativa con Node.js e TypeScript**
Il driver ufficiale MongoDB per Node.js è mantenuto da MongoDB Inc., aggiornato ad ogni release, con tipi TypeScript di prima classe. Mongoose aggiunge schema validation, middleware (hooks), e virtual fields — ottenendo garanzie strutturali simili a quelle di un ORM relazionale, mantenendo la flessibilità del documento.

**5. Scalabilità senza riscrivere l'applicazione**
MongoDB Atlas offre tre percorsi di crescita senza modificare il codice applicativo:
- **Scaling verticale:** upgrade del cluster (da M0 free a M10, M30, M50) tramite un click nella UI
- **Atlas Search:** full-text search integrato nativamente (Lucene-based), attivabile sulla stessa istanza senza aggiungere Elasticsearch
- **Sharding orizzontale:** quando la singola istanza non basta, MongoDB gestisce la distribuzione dei dati su più nodi automaticamente — l'applicazione non cambia

---

**Perché escluso PostgreSQL:**
PostgreSQL è un database eccellente per dati relazionali con schema stabile. In un contesto startup con schema in rapida evoluzione, le migrations frequenti sono un costo. Aggiungere un campo a una tabella PostgreSQL su milioni di righe richiede una migration attenta. Aggiungere un campo a un documento MongoDB non richiede nulla. Per il modello dati di Alpha Chat (messaggi, conversazioni, profili, reazioni), il documento è un'astrazione più naturale della tabella relazionale.

**Perché escluso Firebase Firestore:**
Firestore è un ottimo database real-time per prototipi. Ma crea dipendenza vendor totale (Google), non ha query aggregate flessibili, e il pricing può scalare in modo non prevedibile con volumi elevati. MongoDB Atlas è più flessibile, più economico a parità di volume, e non lock-in.

**Perché esclusa Supabase:**
Supabase è PostgreSQL managed con real-time built-in. Ottimo strumento, ma la scelta del database rimane PostgreSQL — con tutti i pro e i contro già descritti. La real-time layer di Supabase non sostituisce Stream Chat per una piattaforma di messaging completa.

---

### 5.2 Struttura delle Collection Principali (Logica)

Questa è la struttura logica dei documenti — non schema Mongoose. Serve per orientare lo sviluppo.

**Collection: `users`**
```
{
  _id: ObjectId,
  username: String (unique, lowercase),
  email: String (unique, nullable),
  phone_hash: String (nullable),
  password_hash: String,
  display_name: String,
  avatar_url: String,
  bio: String,
  status: { text: String, emoji: String, expires_at: Date },
  last_seen: Date,
  is_online: Boolean,
  privacy: {
    last_seen: "everyone" | "contacts" | "nobody",
    read_receipts: Boolean,
    online_status: Boolean
  },
  created_at: Date,
  updated_at: Date
}
```

**Collection: `sessions`**
```
{
  _id: ObjectId,
  user_id: ObjectId (→ users),
  device_id: String,
  refresh_token_hash: String,
  device_info: { platform, os_version, app_version },
  ip_address: String,
  last_active: Date,
  created_at: Date,
  expires_at: Date
}
```

**Collection: `conversations`**
```
{
  _id: ObjectId,
  type: "direct" | "group" | "channel",
  participants: [ObjectId] (→ users),
  members: [{
    user_id: ObjectId,
    role: "owner" | "admin" | "member",
    joined_at: Date,
    muted_until: Date,
    last_read_message_id: ObjectId
  }],
  last_message: { preview, sender_id, sent_at },
  created_at: Date,
  updated_at: Date
}
```

**Collection: `messages`**
```
{
  _id: ObjectId,
  conversation_id: ObjectId (→ conversations),
  sender_id: ObjectId (→ users),
  type: "text" | "image" | "video" | "audio" | "document" | "system",
  content: String,
  content_iv: String (per E2E),
  status: "sent" | "delivered" | "read",
  reply_to: { message_id: ObjectId, preview: String, sender_id: ObjectId },
  forwarded_from: { message_id: ObjectId, conversation_id: ObjectId },
  reactions: [{ user_id: ObjectId, emoji: String, created_at: Date }],
  media: { url: String, thumbnail_url: String, mime_type, size_bytes, duration_seconds },
  deleted_for: [ObjectId],        ← "Elimina solo per me" (array di user_id)
  deleted_for_everyone: Boolean,  ← "Elimina per tutti"
  deleted_for_everyone_at: Date,
  deleted_by: ObjectId,
  edited: Boolean,
  edited_at: Date,
  expires_at: Date,
  created_at: Date,
  updated_at: Date
}
```

**Collection: `groups`**
```
{
  _id: ObjectId,
  conversation_id: ObjectId (→ conversations),
  name: String,
  description: String,
  avatar_url: String,
  invite_link_token: String,
  max_members: Number,
  settings: {
    who_can_send: "everyone" | "admins_only",
    who_can_add_members: "everyone" | "admins_only",
    require_invite_approval: Boolean
  },
  created_at: Date
}
```

**Collection: `contacts`**
```
{
  _id: ObjectId,
  user_id: ObjectId,
  contact_user_id: ObjectId,
  nickname: String,
  is_blocked: Boolean,
  created_at: Date
}
```

**Collection: `media`**
```
{
  _id: ObjectId,
  uploader_id: ObjectId,
  storage_url: String,
  thumbnail_url: String,
  mime_type: String,
  size_bytes: Number,
  duration_seconds: Number,
  width: Number,
  height: Number,
  is_encrypted: Boolean,
  created_at: Date
}
```

**Collection: `push_tokens`**
```
{
  _id: ObjectId,
  user_id: ObjectId,
  device_id: String,
  platform: "ios" | "android" | "web",
  token: String,
  created_at: Date,
  updated_at: Date
}
```

---

### 5.3 Indici Principali

Gli indici sono fondamentali per le performance. Da creare fin dall'inizio:

| Collection | Indice | Motivo |
|---|---|---|
| `users` | `{ username: 1 }` unique | Ricerca utente per username |
| `users` | `{ email: 1 }` unique sparse | Login e verifica email |
| `messages` | `{ conversation_id: 1, created_at: -1 }` | Feed messaggi paginato |
| `messages` | `{ sender_id: 1, created_at: -1 }` | Messaggi per utente |
| `conversations` | `{ participants: 1, updated_at: -1 }` | Lista chat dell'utente |
| `sessions` | `{ user_id: 1 }` | Sessioni attive per utente |
| `sessions` | `{ expires_at: 1 }` TTL | Pulizia automatica sessioni scadute |

> **Nota:** MongoDB Atlas crea automaticamente l'indice su `_id`. Gli indici TTL (Time To Live) eliminano automaticamente i documenti scaduti senza background jobs.

---

### 5.4 ODM — Mongoose

**Mongoose** come Object Document Mapper.

**Perché Mongoose:**
- Schema validation con tipi, required, default, custom validators
- Middleware (pre/post hooks) per logica cross-cutting (timestamp automatici, soft delete)
- Virtual fields per proprietà computate senza salvarle nel DB
- Populate per referenze tra documenti (simile ai JOIN, usato con parsimonia)
- TypeScript support nativo con `mongoose.InferSchemaType`

**Perché non il driver MongoDB nativo direttamente:**
Il driver nativo è più performante ma richiede validazione manuale. Per V1, la Developer Experience di Mongoose supera il margine di performance. Si può passare al driver nativo per query critiche se necessario.

---

### 5.5 Redis (Upstash) — Cache e Real-time State

Redis affianca MongoDB per workload in-memory che non richiedono persistenza duratura.

**Cosa va in Redis:**
- Presenza utenti: `user:presence:{user_id}` → timestamp con TTL 2 minuti (nessun rinnovo = offline)
- Sessioni WebSocket attive: `ws:session:{user_id}` → lista connection_id
- Rate limiting: sliding window counter per endpoint e user_id
- Cache profili frequenti: TTL 5 minuti
- OTP temporanei (SMS/Email): TTL 5 minuti

**Provider: Upstash** — serverless Redis, pay-per-request, zero management. Costo trascurabile in V1 (< $10/mese per beta).

**Quando migrare:**
Upstash scala fino a milioni di operazioni/giorno. Si migra a Redis Cloud o Redis Enterprise solo se il costo Upstash diventa significativo.

---

### 5.6 Roadmap Database Futura

In V1 MongoDB Atlas gestisce tutto. I database aggiuntivi si aggiungono solo quando i dati reali dimostrano che servono:

| Database aggiuntivo | Quando aggiungerlo | Cosa gestisce |
|---|---|---|
| **Atlas Search** (integrato in Atlas) | Quando la ricerca full-text base non basta | Ricerca messaggi avanzata — attivabile sulla stessa istanza Atlas senza migrazioni |
| **TimescaleDB / InfluxDB** | > 50K DAU con bisogno di analytics time-series | Metriche di sistema, analytics prodotto |
| **Cassandra** | > 100M messaggi totali con query lente | Sostituzione della collection `messages` ad alto volume |
| **Elasticsearch standalone** | Quando Atlas Search non è sufficiente | Ricerca full-text avanzata con relevance tuning |

> **Principio:** non aggiungere un database prima che il problema che risolve sia reale e misurabile.

---

## 6. Backend

### 6.1 Struttura del Monolite Modulare

Il backend è un **monolite modulare**: un singolo processo Node.js con moduli interni ben separati. Ogni modulo possiede il proprio layer di accesso ai dati — nessun modulo accede direttamente alle collection di un altro. Questo rende l'eventuale estrazione in servizi separati un refactoring, non una riscrittura.

```
src/
├── core/
│   ├── auth/           → registrazione, login, JWT, refresh token
│   ├── users/          → profilo, contatti, blocchi, presence
│   ├── messages/       → invio, ricezione, delivery, eliminazione
│   ├── conversations/  → gestione chat 1-to-1
│   ├── groups/         → membership, permessi, inviti
│   ├── channels/       → broadcast, iscrizioni (V1 base)
│   ├── media/          → presigned URL, metadata, post-processing
│   ├── notifications/  → push tokens, invio, preferenze
│   └── calls/          → token Daily.co, signaling
│
├── optional/
│   ├── wallet/         → saldo USDA, transazioni (disabilitato in V1)
│   ├── ai/             → (V3, non presente in V1)
│   └── business/       → (V2, non presente in V1)
│
├── shared/
│   ├── db/             → connessione MongoDB, istanza Mongoose
│   ├── redis/          → client Upstash Redis
│   ├── middleware/     → auth JWT, rate limiting, logging, error handler
│   ├── utils/          → helpers, validatori, formatters
│   └── types/          → tipi condivisi con i client
│
└── app.ts              → entry point, router principale, middleware globali
```

### 6.2 API Design

**REST per tutte le operazioni standard**
- Semplice, universalmente supportato, testabile con curl/Postman
- Versioning: `/api/v1/`
- OpenAPI spec generata dal codice (zod-to-openapi)

**WebSocket per real-time:** gestito da Stream Chat SDK — non costruiamo il server WebSocket.

**Autenticazione:**
- JWT access token (15 minuti) nell'header `Authorization: Bearer`
- Refresh token opaque in cookie `HttpOnly Secure SameSite=Strict` (30 giorni)
- Ogni request autenticata ha `req.user` iniettato dal middleware

### 6.3 Validazione Input — Zod

Ogni route ha uno schema Zod per la validazione del body, dei params, e della query string. Un singolo schema definisce sia la validazione runtime che il tipo TypeScript — zero duplicazione.

### 6.4 Separazione Moduli: Regola di Dipendenza

```
DIPENDENZE PERMESSE:         DIPENDENZE VIETATE:
Core → Shared               Optional → Core ✗ (il wallet non modifica la chat)
Optional → Shared           Core → Optional ✗ (la chat non sa che il wallet esiste)
Optional → Core (read-only, tramite API interna)
```

I moduli opzionali possono leggere dati del Core tramite funzioni di servizio esposte — mai accedendo direttamente alle collection del Core.

---

## 7. Frontend

### 7.1 Struttura del Monorepo

```
alpha-chat/
├── apps/
│   ├── mobile/           → React Native + Expo
│   └── web/              → React + Vite (PWA)
├── packages/
│   ├── shared-types/     → tipi TypeScript (User, Message, Conversation...)
│   ├── ui/               → componenti UI condivisi (es: MessageBubble)
│   └── api-client/       → client HTTP type-safe + React Query hooks
└── backend/              → Node.js monolite
```

### 7.2 State Management

**Zustand** per lo stato UI globale (utente autenticato, chat attiva, settings, UI state)
**TanStack Query (React Query)** per i dati dal server (lista conversazioni, profili, messaggi paginati)

Redux è overengineering per questo scale. Questa combinazione copre il 95% dei casi con il minimo boilerplate.

### 7.3 Navigazione Mobile

**Expo Router** — file-based routing, deep linking automatico, Developer Experience ottima.

### 7.4 UI Component Library

**React Native Paper** (mobile) + **shadcn/ui** (web). Theming centralizzato, nessuna costruzione da zero dei componenti base.

---

## 8. Real-time Messaging

### 8.1 La Scelta: Stream Chat

**Cos'è Stream:** servizio managed per chat in-app. Fornisce WebSocket, canali, messaggi, reactions, thread, presence, typing indicators — tutto tramite SDK.

**Perché scelto:**
Costruire un server WebSocket affidabile — con fan-out dei messaggi, gestione presenza, retry automatici, ordering garantito, multi-device sync — richiede settimane. Stream lo fornisce come SDK in pochi giorni di integrazione. Il backend Alpha Chat si occupa di autenticazione e business logic; Stream si occupa del delivery.

Caratteristiche rilevanti:
- SDK React Native e Web nativi
- Chat 1-to-1 e gruppi
- Typing indicators, read receipts, reactions built-in
- 5 milioni di messaggi/mese free tier → sufficiente per beta pubblica
- Supporto eliminazione messaggi per mittente e per tutti (usato nella sezione 16)

**Cosa rimane nel backend Alpha Chat:**
- Generazione token Stream (il backend firma i JWT per Stream)
- Business logic custom (blocco utenti, permessi gruppi avanzati)
- Metadata aggiuntivi in MongoDB
- Tutto ciò che Stream non fa (wallet, profili avanzati, chiamate)

**Perché escluso Pusher:** pub/sub generico, non una soluzione chat. Richiederebbe di costruire tutta la logica sopra.

**Perché escluso Socket.io custom:** è una libreria, non una soluzione. Costruire ordering, persistence, multi-device, retry richiede mesi.

**Perché escluso Matrix/Synapse:** overhead operativo eccessivo per V1. Ottimo per V3 (federazione).

**Quando migrare:**
Oltre ~500.000 MAU, quando il costo Stream (~$2.000–5.000/mese) supera il costo di sviluppo di un sistema custom.

---

### 8.2 Crittografia E2E — Signal Protocol dalla Versione 1

**Decisione definitiva (Luglio 2025):** Alpha Chat implementa Signal Protocol da V1. Non esiste una "fase intermedia" con solo TLS. Dal primo messaggio inviato in beta pubblica, il server non può leggere il contenuto.

**Libreria:** `@signalapp/libsignal-client` — binding ufficiale Node.js della libreria libsignal mantenuta da Signal Foundation. Open source, audit pubblici, zero algoritmi proprietari.

**Protocolli adottati:**
- **X3DH (Extended Triple Diffie-Hellman):** key agreement iniziale tra due utenti che non si sono mai scritti. Basato su Curve25519 (RFC 7748).
- **Double Ratchet Algorithm:** ogni messaggio usa una chiave derivata diversa. Forward secrecy garantita — la compromissione di una chiave non espone i messaggi passati.
- **AES-256-GCM:** cifratura simmetrica autenticata (AEAD) di ogni messaggio. Standard NIST.

**Cosa il server vede:**
```
{ ciphertext: "Ax3B9f...", iv: "kj2...", sender_key_id: 42 }
```
Il contenuto è opaco. Il server Alpha Chat e il server Stream Chat non possono decifrarlo.

**Key Store:**
- iOS: Secure Enclave / Keychain Services (hardware-backed)
- Android: Android Keystore System (TEE hardware-backed)
- Web: SubtleCrypto API + IndexedDB cifrata

**Sincronizzazione multi-device:** ogni device ha una propria sessione E2E. Un messaggio inviato a un utente con 3 device viene cifrato 3 volte — una copia per device — e consegnato separatamente. Stream gestisce il fan-out; ogni copia è indipendente e opaca.

**Sprint dedicato:** Sprint 2.5 (3–4 settimane), inserito tra Sprint 2 (Chat Core) e Sprint 3 (Eliminazione Messaggi). Vedi Sezione 21 per la roadmap aggiornata.

**Nota per la beta chiusa (primo gruppo ristretto di test):** la beta chiusa può avvenire con TLS + at-rest encryption dichiarandolo onestamente agli utenti invitati ("stai testando una versione non ancora E2E"). La beta **pubblica** non viene aperta finché Signal Protocol non è operativo e testato.

---

## 9. Crittografia e Sicurezza

### 9.1 Principio Fondamentale

Non si progettano algoritmi crittografici proprietari. Si usano protocolli consolidati, librerie auditate, implementazioni esistenti.

### 9.2 Password — Argon2id

Vincitore del Password Hashing Competition 2015, resistente ad attacchi GPU e ASIC. È la raccomandazione attuale di OWASP. Non si usano MD5, SHA-1, SHA-256 direttamente per le password — mai.

### 9.3 Transport Security

- TLS 1.3 obbligatorio (gestito da Replit/Cloudflare)
- HTTPS ovunque, redirect automatico da HTTP
- Security headers via Helmet.js: HSTS, CSP, X-Frame-Options, X-Content-Type-Options
- CORS: whitelist esplicita dei domini client

### 9.4 JWT

- Algoritmo RS256 (firma asimmetrica): la chiave privata firma, la chiave pubblica verifica
- Access token: 15 minuti
- Refresh token: opaque UUID v4, hashato in MongoDB, TTL 30 giorni

### 9.5 Rate Limiting

Express-rate-limit + Upstash Redis per rate limiting distribuito:

- Auth endpoints: 5 tentativi / 15 minuti per IP
- Invio messaggi: 100 / minuto per user_id
- Upload media: 20 / minuto per user_id
- API generiche: 300 / minuto per IP

### 9.6 MongoDB Security

- MongoDB Atlas: encryption at rest attiva di default (AES-256)
- Network access: whitelist IP del backend — nessun accesso pubblico al DB
- Utente database con privilegi minimi (read/write sul solo database di produzione)
- Backup automatici giornalieri con retention 7 giorni (inclusi nel piano Atlas)

---

## 10. Sistema Media

### 10.1 La Scelta: Cloudflare R2

Object storage API-compatibile con AWS S3. Zero egress fees — si paga solo storage e operazioni, non il bandwidth in uscita. CDN Cloudflare inclusa.

**Perché non AWS S3:** S3 addebita ~$0.09/GB in egress. Per una piattaforma media-heavy, i costi di bandwidth possono essere significativi. R2 elimina questo costo.

### 10.2 Upload Flow (Presigned URL)

Il client richiede un URL firmato al backend → carica direttamente su R2 → notifica il backend. Il file non transita mai per il server Node.js.

```
1. Client → POST /api/v1/media/upload-url  (tipo, dimensione)
2. Backend → R2: genera presigned URL (TTL 5 minuti)
3. Backend → Client: { upload_url, media_id }
4. Client → R2: PUT diretto con il file
5. Client → POST /api/v1/media/{media_id}/confirm
6. Backend: valida integrità, aggiorna stato in MongoDB
```

### 10.3 Post-Processing

Asincrono e non bloccante:
- Immagini: resize adattivo (thumbnail/preview/originale), strip EXIF metadata GPS
- Video: thumbnail extraction, verifica formato
- Audio: nessun processing — AAC già ottimale
- Tutti i file: virus scan (ClamAV managed o Cloudflare Gateway)

### 10.4 Signed URL per la Lettura

I media non sono pubblicamente accessibili. Ogni URL di lettura è un signed URL con TTL di 24 ore, generato dal backend al momento della richiesta. Questo garantisce che solo gli utenti autorizzati possano accedere ai file.

---

## 11. Autenticazione

### 11.1 Modalità di Registrazione

**Email + Password (primario)**
- Hash Argon2id
- Verifica email con link (TTL 24h, provider email: Resend API)
- 2FA opzionale via TOTP (RFC 6238, compatibile con Google Authenticator)
- Recovery via email

**Telefono + SMS OTP (secondario)**
- OTP 6 cifre via Twilio, TTL 5 minuti, max 3 tentativi
- Numero conservato hashato, mai visibile ad altri utenti

**Social Login — V2** (OAuth 2.0 con Google e Apple Sign In)

### 11.2 Session Management

- Access Token: JWT RS256, 15 minuti, in `Authorization: Bearer`
- Refresh Token: UUID v4 hashato in MongoDB, 30 giorni, cookie `HttpOnly Secure SameSite=Strict`
- Multi-device: ogni device ha il proprio refresh token, visibile e revocabile dall'utente

### 11.3 Provider SMS — Twilio

Pay-as-you-go (~$0.0079/SMS in Italia), copertura globale, SDK TypeScript eccellente. Alternativa: Vonage (più economico, documentazione inferiore).

---

## 12. Chiamate e Videochiamate

### 12.1 La Scelta: Daily.co

Servizio managed WebRTC con STUN/TURN/SFU gestiti. SDK React Native + Web.

**Perché scelto:** costruire infrastruttura WebRTC completa (STUN, TURN, SFU) richiede settimane e manutenzione continua. Daily.co:
- Gestisce tutta l'infrastruttura WebRTC
- E2E encrypted (DTLS-SRTP nativo WebRTC)
- Free tier: 10.000 minuti/mese (sufficiente per beta)
- Pricing lineare: ~$0.004/minuto partecipante

**Integrazione:** il backend genera un token Daily.co per ogni chiamata. Il client usa l'SDK Daily. Il signaling (chi chiama chi, accetta/rifiuta) viaggia via Stream Chat come messaggio di tipo `system`.

**Perché escluso LiveKit:** ottimo per V3 (controllo totale, self-hosted). Per V1 con 1 sviluppatore, il costo operativo è sproporzionato.

**Quando migrare:** oltre ~500.000 minuti/mese (~$2.000/mese).

---

## 13. Notifiche Push

### 13.1 La Scelta: Expo Push Notifications

Astrae APNs (Apple) e FCM (Google) in un unico endpoint. Zero configurazione aggiuntiva per chi usa Expo.

**Per il web:** Web Push API standard via Service Worker — nessun servizio esterno.

**Privacy:** il payload push non contiene il testo del messaggio. Contiene solo `conversation_id` e `notification_type`. Il contenuto viene mostrato solo dal client dopo averlo ricevuto localmente.

**Quando migrare:** quando si ha bisogno di payload encrypted o configurazioni avanzate APNs/FCM. In pratica: all'uscita da Expo Managed Workflow.

---

## 14. Sistema Gruppi

### 14.1 Struttura

I gruppi sono conversazioni di tipo `group` nella collection `conversations`. Stream Chat gestisce il delivery dei messaggi nel canale di gruppo.

**Stream gestisce:** fan-out messaggi ai partecipanti, typing indicators, notifiche di gruppo.
**Backend Alpha Chat gestisce:** metadata gruppo (MongoDB), permessi avanzati, inviti, admin tools, limite 500 partecipanti.

### 14.2 Ruoli e Permessi

- **Owner:** tutti i permessi + trasferimento ownership + eliminazione gruppo
- **Admin:** aggiunta/rimozione membri + silenziamento + modifica info gruppo
- **Member:** invio messaggi (se permesso dalle impostazioni) + lettura

### 14.3 Inviti

- **Link:** token UUID salvato in MongoDB, revocabile dall'admin, opzionale lista d'attesa con approvazione
- **QR code:** generato dal link di invito
- **Invito diretto:** notifica push al destinatario con preview del gruppo

---

## 15. Username e Identità

### 15.1 Regole

- Formato: `@nomeutente`, 3–32 caratteri, alfanumerici + underscore
- Case-insensitive (salvato lowercase), unico globalmente
- Modificabile con cooldown di 14 giorni
- Ricerca per username esatto (non parziale di default — privacy)

**Implementazione MongoDB:** indice unique sul campo `username` (lowercase). Upsert con `{ upsert: false }` per garantire che il claim sia atomico — nessuna race condition.

### 15.2 Discovery Contatti

**Via username:** metodo principale, zero frizione.

**Via rubrica (opt-in):** i numeri vengono hashati sul dispositivo client prima di essere inviati. Il server confronta hash. Il numero in chiaro non lascia mai il dispositivo.

---

## 16. Eliminazione Messaggi

### 16.1 Panoramica

Alpha Chat implementa un sistema di eliminazione messaggi ispirato a Telegram: granulare, reversibile nell'intenzione, con propagazione real-time su tutti i dispositivi. L'eliminazione è una funzionalità V1 obbligatoria.

---

### 16.2 Interazione Utente

**Trigger:** long press su qualsiasi messaggio nella chat.

**Menu contestuale** (appare dopo long press):

| Azione | Visibile per | Note |
|---|---|---|
| Copia | Tutti | Copia il testo negli appunti |
| Rispondi | Tutti | Apre il campo risposta con anteprima |
| Inoltra | Tutti | Apre il selettore conversazione |
| Modifica | Solo mittente | Visibile solo se il messaggio è proprio |
| Elimina | Solo mittente (regole avanzate nei gruppi) | Apre la dialog di eliminazione |

**Dialog di eliminazione** (dopo aver selezionato "Elimina"):

```
┌─────────────────────────────────────────┐
│          Elimina messaggio              │
├─────────────────────────────────────────┤
│  ○  Elimina solo per me                 │
│                                         │
│  ○  Elimina per tutti                   │
│     (visibile per 24 ore dall'invio)    │
├─────────────────────────────────────────┤
│        [ Annulla ]  [ Elimina ]         │
└─────────────────────────────────────────┘
```

> **Nota UX:** il bottone "Elimina" diventa rosso. "Elimina per tutti" è disponibile solo se il messaggio rientra nella finestra temporale consentita (24 ore).

---

### 16.3 Modalità di Eliminazione

#### Modalità A — "Elimina solo per me"

**Cosa succede:**
- Il messaggio viene rimosso dalla visualizzazione dell'utente che ha eseguito l'azione
- Gli altri partecipanti continuano a vedere il messaggio normalmente
- Il messaggio non viene eliminato dal database

**Implementazione:**
Nel documento MongoDB del messaggio, l'`_id` dell'utente viene aggiunto all'array `deleted_for`:
```
messages.deleted_for: [user_id_1, user_id_2, ...]
```
Ogni query che recupera i messaggi per un utente filtra i documenti in cui `user_id` è presente in `deleted_for`. Questo avviene a livello di query MongoDB, non a livello applicativo.

**Limiti temporali:** nessuno — si può eliminare solo per sé qualsiasi messaggio ricevuto in qualsiasi momento.

**Effetto sugli allegati:** il file rimane su Cloudflare R2 e accessibile agli altri partecipanti. Solo la visualizzazione del messaggio viene rimossa per l'utente corrente.

---

#### Modalità B — "Elimina per tutti"

**Cosa succede:**
- Il messaggio viene rimosso dalla visualizzazione di tutti i partecipanti della conversazione
- Tutti i dispositivi connessi ricevono l'aggiornamento in real-time
- Il contenuto del messaggio viene cancellato dal database; rimane solo un "tombstone"
- Negli eventuali messaggi di risposta (reply) che citano il messaggio eliminato, l'anteprima diventa "Messaggio eliminato"

**Implementazione:**

Nel documento MongoDB il messaggio viene aggiornato come segue:
```
{
  deleted_for_everyone: true,
  deleted_for_everyone_at: <timestamp>,
  deleted_by: <user_id>,
  content: null,
  media: null
}
```
Il documento rimane nel database (tombstone) per mantenere la continuità del thread e permettere ai messaggi di risposta di mostrare "Messaggio eliminato". Non viene mai rimosso fisicamente.

**Propagazione real-time:** il backend pubblica un evento `message.deleted` via Stream Chat. Tutti i client connessi a quella conversazione ricevono l'evento e rimuovono il messaggio dalla lista visualizzata.

**Dispositivi offline:** alla prossima connessione, il client sincronizza lo stato dei messaggi aggiornati (Stream Chat gestisce questa sincronizzazione automaticamente).

---

### 16.4 Regole di Autorizzazione

#### Chat Private (1-to-1)

| Azione | Chi può eseguirla |
|---|---|
| Elimina solo per me | Entrambi i partecipanti, qualsiasi messaggio ricevuto |
| Elimina per tutti | Solo il mittente del messaggio |
| Finestra temporale "elimina per tutti" | Entro 24 ore dall'invio |

#### Gruppi

| Azione | Chi può eseguirla |
|---|---|
| Elimina solo per me | Qualsiasi membro, qualsiasi messaggio |
| Elimina per tutti (messaggio proprio) | Il mittente, entro 24 ore |
| Elimina per tutti (qualsiasi messaggio) | Admin e Owner, senza limite temporale |

> **Motivazione dei permessi admin nei gruppi:** gli admin devono poter rimuovere contenuti inappropriati o violazioni delle regole del gruppo, indipendentemente dal mittente o dal tempo trascorso. Questo è coerente con il comportamento di Telegram.

#### Canali

| Azione | Chi può eseguirla |
|---|---|
| Elimina solo per me | Iscritti, solo sui messaggi ricevuti |
| Elimina per tutti | Solo Owner e Admin del canale |
| Finestra temporale | Nessun limite per Owner/Admin |

---

### 16.5 Limite Temporale per "Elimina per tutti"

**V1: 24 ore dall'invio**

**Motivazione della scelta:**
Un limite temporale bilancia due interessi contrapposti: il diritto dell'utente di correggere un errore (messaggio inviato alla persona sbagliata, contenuto errato) e la ragionevole aspettativa del destinatario che i messaggi ricevuti permangano. 24 ore è il tempo scelto da WhatsApp (60 ore, più generoso) e Telegram (48 ore). Alpha Chat sceglie 24 ore come default per V1, modificabile da impostazioni di sistema in V2.

**Come viene comunicato all'utente:**
Se il messaggio ha più di 24 ore, nella dialog di eliminazione l'opzione "Elimina per tutti" è disabilitata con nota: "Non disponibile dopo 24 ore dall'invio". L'utente può comunque scegliere "Elimina solo per me".

---

### 16.6 Comportamento dei Messaggi di Risposta (Reply)

Quando un messaggio viene eliminato per tutti e altri messaggi lo citano in risposta:

- L'anteprima nel messaggio di risposta diventa: *"Messaggio eliminato"* in corsivo
- Il messaggio di risposta stesso rimane visibile
- Non è possibile toccare l'anteprima per navigare al messaggio originale (non esiste più)

Questo comportamento è coerente con Telegram e WhatsApp.

---

### 16.7 Sincronizzazione Multi-Device

**Elimina solo per me:**
- L'eliminazione viene sincronizzata su tutti i dispositivi dell'utente che ha eseguito l'azione
- Il messaggio scompare da tutti i dispositivi dell'utente (mobile + web + desktop)
- I dispositivi degli altri partecipanti non sono coinvolti

**Elimina per tutti:**
- L'eliminazione viene propagata in real-time a tutti i dispositivi di tutti i partecipanti
- I dispositivi offline ricevono l'aggiornamento alla prossima connessione
- Stream Chat garantisce la consegna dell'evento anche ai client disconnessi (message history sync)

---

### 16.8 Gestione degli Allegati (Media)

| Scenario | Comportamento file su R2 |
|---|---|
| Elimina solo per me | Il file rimane su R2. Gli altri partecipanti possono accedervi. |
| Elimina per tutti | Il file su R2 viene eliminato in modo asincrono entro 1 ora. I signed URL esistenti scadono naturalmente (TTL 24h). Dopo l'eliminazione, i vecchi URL tornano 404. |
| Eliminazione da admin (gruppo/canale) | Il file su R2 viene eliminato in modo asincrono. Stesso comportamento di "Elimina per tutti". |

**Pipeline di eliminazione media:**
Quando un messaggio viene eliminato per tutti con allegato, un job asincrono (coda in-memory con BullMQ o semplice setImmediate per V1) cancella il file da R2. Questo avviene in background per non bloccare la risposta API.

---

### 16.9 Audit e Accountability

Per i canali e i gruppi con più di 100 membri, le eliminazioni eseguite da admin vengono registrate in un audit log (collection `moderation_log` in MongoDB) con:

- `action: "message_deleted"`
- `moderator_id`, `target_message_id`, `target_sender_id`
- `reason` (opzionale, può essere aggiunto dall'admin)
- `timestamp`

Questo log è visibile solo agli Owner del gruppo/canale e non è accessibile ai membri ordinari.

---

### 16.10 Edge Case

| Scenario | Comportamento |
|---|---|
| Utente non connesso quando il messaggio viene eliminato | Riceve l'aggiornamento alla prossima connessione. Stream Chat bufferizza gli eventi. |
| Messaggio già eliminato da un altro device | Idempotente — l'operazione è no-op se `deleted_for_everyone` è già `true`. |
| Eliminazione fallisce per errore di rete | Il client mostra errore e permette retry. Il messaggio rimane visibile fino a conferma del backend. |
| Messaggio fissato (pinned) che viene eliminato per tutti | Il pin viene rimosso automaticamente dal sistema. |
| Messaggio in una notifica push già inviata | La notifica push già consegnata non può essere ritirata. Il messaggio scompare dalla chat ma potrebbe essere ancora visibile nella notification center dell'OS fino alla cancellazione manuale. |

---

## 17. Wallet USDA — Modulo Opzionale

### 17.1 Principio di Separazione

Il Wallet USDA è un **modulo opzionale totalmente separato** dal Core. Non è incluso nella Versione 1 del prodotto. La chat funziona completamente senza che il wallet esista.

**Requisiti per l'attivazione (V2):**
- Compliance regolamentare (PSD2/EMD2 in EU, licenza EMI o partenariato con istituto autorizzato)
- KYC/AML provider integrato (Onfido, Sumsub)
- Audit di sicurezza specifico sul modulo finanziario
- Cluster MongoDB separato per i dati finanziari

### 17.2 Placeholder in V1

In V1, il modulo wallet esiste nel codice ma non è attivo:
- Nessuna route wallet esposta
- Nessuna UI wallet nel client
- La collection `wallet_accounts` è già definita nel schema (per evitare migrations future su dati esistenti) ma nessun documento ha `is_active: true`

### 17.3 Architettura V2

- Cluster MongoDB Atlas separato (isolamento fisico dei dati finanziari)
- PIN dedicato (4–6 cifre) + biometria per ogni operazione wallet
- Audit log append-only di ogni transazione (documenti immutabili — nessun update/delete permesso)
- Route API separate: `/api/v1/wallet/...` con middleware autenticazione aggiuntivo
- Zero condivisione di codice con i moduli Core della chat

---

## 18. Hosting e Deployment

### 18.1 Fase 1 — Replit (Sviluppo + Alpha/Beta Chiusa)

**Perché Replit:**
- Ambiente Node.js nativo, zero configurazione locale
- Collaborazione AI integrata (Replit AI)
- Deploy immediato per test
- Adatto per sviluppo e beta chiusa (< 500 utenti attivi)

**Limitazione:** non progettato per alta disponibilità in produzione. Si usa esclusivamente per sviluppo e test interni.

### 18.2 Fase 2 — Railway (Beta Pubblica)

**Railway** come piattaforma per la beta pubblica (500–10.000 utenti):

- Deploy da GitHub con un click
- Scaling verticale semplice tramite UI
- Redis managed integrato (alternativa a Upstash)
- Variabili d'ambiente e secrets sicuri
- Pricing trasparente (~$5–20/mese per V1)
- Nessuna gestione del server

> **Nota:** MongoDB continua su Atlas indipendentemente dall'hosting del backend — non si usa il database managed di Railway.

**Alternativa: Render** — simile a Railway, free tier disponibile per test.

**Perché non AWS/GCP/Azure direttamente:** richiedono configurazione VPC, security groups, load balancer. Complessità operativa sproporzionata per un team di 1 in V1.

### 18.3 Fase 3 — AWS/GCP (Scale, > 50K DAU)

Quando il costo del PaaS supera il beneficio. Tipicamente oltre ~50.000 DAU o con requisiti di compliance specifici (data residency GDPR garantita).

### 18.4 CDN — Cloudflare

Cloudflare su tutto il dominio (free tier):
- CDN per asset statici del frontend
- DDoS protection automatica
- SSL/TLS terminazione
- R2 object storage (media)

---

## 19. Monitoraggio e Osservabilità

### 19.1 Logging — Pino

Logger strutturato JSON per Node.js. Output filtrabile, integrazione nativa con Express, il più veloce per Node.js.

### 19.2 Error Tracking — Sentry

Cattura eccezioni non gestite in produzione. Stack trace, context, breadcrumbs. Free tier. Alerting via email quando si verifica un errore critico. Integrazione: `@sentry/node` + `@sentry/react-native`.

### 19.3 Uptime Monitoring — UptimeRobot

Ping su `/api/v1/health` ogni minuto. Alert email/SMS se giù. Free per 1 monitor.

### 19.4 Analytics Prodotto — PostHog

Open source, self-hostable, free tier 1M eventi/mese. Feature flags integrati per rollout graduali delle funzionalità.

---

## 20. Percorso di Crescita

### 20.1 Da Monolite a Moduli Separati

Il monolite modulare è già organizzato per essere split. Ordine naturale di estrazione:

1. **Media Service** — primo a separarsi quando l'upload file appesantisce il processo principale
2. **Notification Service** — quando le push lente impattano le API
3. **Wallet Service** — in V2, per isolamento di sicurezza obbligatorio (già progettato separato)

### 20.2 Evoluzione del Database

| Trigger | Azione |
|---|---|
| Ricerca lenta | Attivare **Atlas Search** (built-in in MongoDB Atlas, zero migrazioni) |
| Collection `messages` > 100M documenti lenta | Valutare sharding Atlas o migrazione a Cassandra |
| Analytics complesse | Aggiungere **TimescaleDB** per metriche time-series |
| Search avanzato oltre Atlas Search | Aggiungere **Elasticsearch** standalone |

### 20.3 Da Stream Chat a Sistema Custom

Quando il costo mensile Stream supera il costo di sviluppo e manutenzione custom (~500K MAU):
1. Progettare protocollo WebSocket interno
2. Implementare Signal Protocol puro per E2E
3. Migrare messaggi da Stream a MongoDB

Questa è la migrazione più complessa. Non va pianificata prima che sia necessaria.

---

## 21. Roadmap MVP — Sprint Plan

**Obiettivo: Beta Pubblica in 18 settimane** con 1 sviluppatore + AI.

```
TIMELINE: 18 SETTIMANE
═══════════════════════════════════════════════════════════════════════

SPRINT 0 — SETUP INFRASTRUTTURA (Settimana 1)
──────────────────────────────────────────────
□ Setup monorepo (pnpm workspaces)
□ Backend: Node.js + Express + TypeScript boilerplate
□ MongoDB Atlas: cluster M0, connessione Mongoose, collection setup
□ Upstash Redis: configurato e connesso
□ CI/CD: GitHub Actions → deploy automatico su Replit
□ Sentry: installato su backend e client
□ Stream Chat: account, API keys, test connessione
□ Cloudflare R2: bucket creato, credenziali configurate
□ Daily.co: account, API keys, test connessione
□ Struttura modulare Core/Optional: cartelle e boilerplate
  ▶ DELIVERABLE: Ambiente funzionante, struttura modulare, hello world deployato

SPRINT 1 — AUTH + IDENTITÀ (Settimane 2–3)
────────────────────────────────────────────
□ Collection MongoDB: users, sessions, contacts (schema Mongoose)
□ Registrazione con email + password (Argon2id)
□ Login + JWT RS256 access token + refresh token (cookie HttpOnly)
□ Middleware autenticazione per tutte le route protette
□ Verifica email via Resend API (link con token UUID)
□ Sistema username: claim, validazione unicità, indice MongoDB
□ Profilo utente: avatar (R2), bio, status con scadenza
□ Rate limiting su endpoint autenticazione (Redis sliding window)
□ Registrazione telefono + SMS OTP via Twilio
□ Test: registrazione, login, logout, refresh token, rate limit
  ▶ DELIVERABLE: Auth completo, username system funzionante

SPRINT 2 — CHAT CORE (Settimane 4–6)
──────────────────────────────────────
□ Stream Chat SDK: generazione token backend, integrazione mobile e web
□ Collection MongoDB: conversations, messages (con campi deleted_for,
  deleted_for_everyone, deleted_by per supportare eliminazione V1)
□ UI chat list: lista conversazioni, preview ultimo messaggio, badge non letti
□ UI chat view: bubble messaggi, input, invio testo
□ Delivery status: sent ✓ / delivered ✓✓ / read ✓✓ blu (Stream built-in)
□ Typing indicator (Stream built-in)
□ Aggiunta contatti via @username
□ Blocco utenti (blocco bidirezionale)
  ▶ DELIVERABLE: Chat 1-to-1 funzionante su mobile e web

SPRINT 3 — ELIMINAZIONE MESSAGGI (Settimana 7)
─────────────────────────────────────────────────
□ Long press menu: Copia, Rispondi, Inoltra, Modifica, Elimina
□ Dialog "Elimina per me" vs "Elimina per tutti" (con timer 24h)
□ Backend: PATCH /api/v1/messages/{id}/delete con logica di autorizzazione
□ MongoDB: aggiornamento campi deleted_for / deleted_for_everyone
□ Propagazione real-time via Stream Chat (evento message.deleted)
□ Sincronizzazione multi-device per "Elimina solo per me"
□ Tombstone UI: "Messaggio eliminato" nei reply che citano il messaggio
□ Eliminazione media da R2 (job asincrono)
□ Permessi: differenziati per chat privata, gruppo (admin), canale
□ Edge case: messaggio già eliminato, dispositivo offline, pinned message
  ▶ DELIVERABLE: Sistema eliminazione messaggi completo e testato

SPRINT 4 — MEDIA (Settimane 8–9)
──────────────────────────────────
□ Presigned URL endpoint (backend → R2 → client)
□ Upload immagini: picker, compressione client-side, signed URL lettura
□ Upload video: picker, thumbnail post-upload, progress indicator
□ Upload documenti: PDF, limite 100MB, download con signed URL
□ Messaggi vocali: registrazione, waveform, riproduzione, velocità 1x/1.5x/2x
□ Link preview: scraper Open Graph backend, cache MongoDB 24h
□ Galleria media per conversazione (grid scrollabile)
□ Limiti dimensione/tipo con feedback UI chiaro
  ▶ DELIVERABLE: Invio e ricezione media completo

SPRINT 5 — GRUPPI + CANALI (Settimane 10–11)
─────────────────────────────────────────────
□ Gruppi: creazione, stream channel type "group"
□ Aggiunta / rimozione membri (con permessi Owner/Admin/Member)
□ Link invito (token MongoDB + Stream), QR code
□ Impostazioni gruppo: nome, avatar, descrizione, permessi
□ Menzioni @username con notifica dedicata
□ Admin tools: silenziamento membro, rimozione, ban
□ Eliminazione messaggi nei gruppi con permessi admin (Sprint 3 extension)
□ Canali V1 base: broadcast 1-to-many, iscrizione/disiscrizione
  ▶ DELIVERABLE: Gruppi completi (500 partecipanti) + Canali base

SPRINT 6 — NOTIFICHE (Settimana 10, parallelo Sprint 5)
────────────────────────────────────────────────────────
□ Expo Push: salvataggio token device in MongoDB
□ Backend: invio push via Expo Push API (payload senza testo messaggio)
□ Notifica per nuovo messaggio, menzione, chiamata in ingresso
□ Preferenze notifiche: mute per-chat, DND schedule globale
□ Web Push via Service Worker
  ▶ DELIVERABLE: Notifiche push su iOS, Android, Web

SPRINT 7 — CHIAMATE E VIDEOCHIAMATE (Settimane 12–13)
───────────────────────────────────────────────────────
□ Daily.co: creazione room, token backend, URL stanza
□ Signaling via Stream Chat (messaggio system tipo "call_offer/answer/end")
□ UI chiamata in ingresso: overlay full-screen con accetta/rifiuta
□ Chiamate vocali 1-to-1 su mobile (Daily.co SDK)
□ Videochiamate 1-to-1 su mobile (Daily.co SDK, adaptive bitrate)
□ Chiamate web (Daily.co SDK web)
□ In-call UI: mute, speaker, flip camera, hangup, timer durata
□ Chiamate audio di gruppo fino a 8 (Daily.co SFU managed)
  ▶ DELIVERABLE: Chiamate e videochiamate funzionanti

SPRINT 8 — FEATURES COMPLETE (Settimane 14–15)
────────────────────────────────────────────────
□ Messaggi a scomparsa: timer per chat (dopo lettura o dopo N ore)
□ Reazioni emoji: aggiunta, rimozione, counter aggregato
□ Reply inline: preview messaggio originale, scroll al messaggio citato
□ Forward: selettore destinazione, etichetta "Inoltrato"
□ Modifica messaggio: entro 24h, con indicatore "modificato"
□ Ricerca messaggi: MongoDB text index sulla collection messages
□ Ricerca utenti per @username
□ Impostazioni privacy: last seen, read receipts, online status (per contatti/tutti/nessuno)
□ Blocco screenshot in chat (mobile, React Native)
□ Dark mode / Light mode con system preference detection
□ Multi-device: verifica sincronizzazione messaggi e stato
  ▶ DELIVERABLE: Feature set V1 completo

SPRINT 9 — HARDENING + BETA CHIUSA (Settimane 16–17)
──────────────────────────────────────────────────────
□ Security review: OWASP Top 10, injection, broken auth, rate limiting
□ MongoDB: audit indici, explain() sulle query lente
□ Load test: 500 utenti concorrenti in staging (k6 o Artillery)
□ Bug fixing lista da Sprint 1–8
□ Onboarding flow: prima apertura, claim username, aggiunta primo contatto
□ Empty states: nessuna chat, nessun contatto, galleria vuota
□ Error states: connessione persa (banner), messaggio non inviato (retry)
□ Performance: scroll lista messaggi 60fps, apertura app < 2s su 4G
□ Beta chiusa: 50–100 utenti invitati su TestFlight (iOS) e Play Internal (Android)
□ Feedback: PostHog funnel + canale feedback in-app
  ▶ DELIVERABLE: Beta chiusa live, monitoraggio attivo

SETTIMANA 18 — BETA PUBBLICA
──────────────────────────────
□ Fix critici emersi dalla beta chiusa
□ App Store submission iOS (review ~3 giorni)
□ Google Play submission Android (review ~2 giorni)
□ Web app su dominio definitivo con Cloudflare
□ Landing page pubblica
□ Monitoraggio h24 per la prima settimana post-lancio
  ▶ DELIVERABLE: Alpha Chat Beta Pubblica 🚀

═══════════════════════════════════════════════════════════════════════

RIEPILOGO TIMELINE
────────────────────
Settimana 1:      Setup infrastruttura modulare
Settimane 2–3:    Auth + identità
Settimane 4–6:    Chat core 1-to-1
Settimana 7:      Eliminazione messaggi (feature V1 obbligatoria)
Settimane 8–9:    Media
Settimane 10–11:  Gruppi + Canali (+ Notifiche in parallelo)
Settimane 12–13:  Chiamate e videochiamate
Settimane 14–15:  Feature set completo
Settimane 16–17:  Hardening + Beta chiusa
Settimana 18:     Beta pubblica

TOTALE: 18 settimane (~4 mesi e mezzo)

═══════════════════════════════════════════════════════════════════════
```

---

## 22. Checklist Pre-Beta

### Sicurezza (Non Negoziabile)
- [ ] HTTPS ovunque (nessun endpoint HTTP in produzione)
- [ ] Rate limiting su tutti gli endpoint write
- [ ] Input validation con Zod su tutte le route
- [ ] NoSQL injection impossibile (Mongoose sanitize, nessuna query con input non validato)
- [ ] XSS impossibile (React sanitizza per default)
- [ ] Password hashate con Argon2id
- [ ] JWT con scadenza 15 minuti, RS256
- [ ] Refresh token hashati in MongoDB
- [ ] Nessun secret nel codice (tutti in variabili d'ambiente)
- [ ] Security headers via Helmet.js
- [ ] MongoDB Atlas: network access solo da IP del backend

### Eliminazione Messaggi (Feature V1 Specifica)
- [ ] "Elimina solo per me" rimuove il messaggio solo per l'utente richiedente
- [ ] "Elimina per tutti" propaga l'evento a tutti i dispositivi di tutti i partecipanti
- [ ] Finestra 24h verificata: dopo 24h, "Elimina per tutti" è disabilitato per utenti normali
- [ ] Admin gruppo possono eliminare qualsiasi messaggio senza limite temporale
- [ ] I messaggi di risposta che citano il messaggio eliminato mostrano "Messaggio eliminato"
- [ ] I media dei messaggi eliminati per tutti vengono rimossi da R2
- [ ] Dispositivi offline ricevono la sincronizzazione alla riconnessione
- [ ] Idempotenza: eliminare due volte lo stesso messaggio è un no-op

### Performance
- [ ] Lista messaggi: scroll 60fps su iPhone 12 e Android di fascia media
- [ ] Apertura app: < 2 secondi su connessione 4G
- [ ] Invio messaggio: appare in UI < 100ms (optimistic update)
- [ ] Caricamento immagini: thumbnail istantanea, full-res lazy
- [ ] MongoDB query principali: < 50ms (verificato con explain())

### Affidabilità
- [ ] Gestione connessione persa: banner visibile + retry automatico
- [ ] Messaggi non inviati: stato "failed" con bottone retry
- [ ] App utilizzabile con connessione lenta (3G)
- [ ] Sentry configurato: ogni errore non gestito viene tracciato
- [ ] MongoDB Atlas: backup automatico configurato

### UX Minima
- [ ] Onboarding: claim username, foto profilo opzionale, primo contatto
- [ ] Empty states: lista chat vuota, nessun risultato ricerca, galleria vuota
- [ ] Loading states: skeleton screen (non spinner generici)
- [ ] Error messages: comprensibili per l'utente, non stack trace

---

## Tabella di Confronto: Architettura Enterprise vs MVP

| Componente | Enterprise (doc precedente) | MVP (questo documento) | Quando migrare |
|---|---|---|---|
| Backend | Go + microservizi | Node.js monolite modulare | > 100K DAU o team > 5 persone |
| Architettura | Microservizi separati | Monolite modulare Core + Optional | Quando un modulo è il bottleneck |
| Real-time | WebSocket custom + Kafka | Stream Chat SDK | > 500K MAU o costo > $2K/mese |
| Database | PostgreSQL + Cassandra + Elasticsearch | MongoDB Atlas (unico) | Aggiunta selettiva con Atlas Search e sharding |
| Cache/Presence | Redis self-hosted | Upstash Redis | > 10M op/giorno |
| Object storage | AWS S3 | Cloudflare R2 | Mai (R2 scala senza limiti) |
| Chiamate | LiveKit SFU self-hosted | Daily.co managed | > 500K min/mese |
| Notifiche | APNs/FCM diretti | Expo Push | Uscita da Expo Managed Workflow |
| Auth | Auth custom completo | JWT RS256 + Refresh Token | Mai (già scalabile) |
| Infrastruttura | Kubernetes + Istio | Replit → Railway | > 50K DAU o compliance specifici |
| SMS OTP | Provider custom | Twilio | Mai (Twilio scala) |
| Monitoraggio | Prometheus + Grafana + Jaeger | Sentry + UptimeRobot | > 50K DAU |
| Wallet | Microservizio separato fin da V1 | Modulo disabilitato, attivato in V2 | Quando compliance e KYC sono pronti |

---

## Note Finali

Questa architettura non è un compromesso — è la scelta **corretta per questa fase**. Ogni tecnologia è stata scelta perché è la migliore per un team di 1 oggi, con un percorso chiaro verso la scala.

La modularità non è solo organizzazione del codice — è una promessa: il wallet non tocca la chat, i moduli futuri non rompono ciò che già funziona, ogni componente può essere aggiornato indipendentemente.

L'eliminazione dei messaggi non è un dettaglio UI — è una funzionalità architetturale che richiede attenzione al database (tombstone), alla sincronizzazione real-time, ai permessi granulari, e alla gestione dei media. Trattarla come un sprint dedicato (Sprint 3) è la scelta corretta.

**Ship first. Stay modular. Grow without rewriting.**

---

*Documento preparato per il team Alpha Chat*
*Ultima revisione: Luglio 2025 — Versione 2.0*
