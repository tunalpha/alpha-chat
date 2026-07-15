# Alpha Chat — MVP Architecture
### Startup First. Ship Fast. Grow Without Rewriting.
> Versione 1.0 — Luglio 2025
> Status: Architecture Design — Pre-Development
> Contesto: 1 sviluppatore principale + AI. Target: Beta pubblica nel minor tempo possibile.

---

## Indice

1. [Principi Guida](#1-principi-guida)
2. [Visione dell'Architettura MVP](#2-visione-dellarchitettura-mvp)
3. [Stack Tecnologico Scelto](#3-stack-tecnologico-scelto)
4. [Database Unico](#4-database-unico)
5. [Backend](#5-backend)
6. [Frontend](#6-frontend)
7. [Real-time Messaging](#7-real-time-messaging)
8. [Crittografia e Sicurezza](#8-crittografia-e-sicurezza)
9. [Sistema Media](#9-sistema-media)
10. [Autenticazione](#10-autenticazione)
11. [Chiamate e Videochiamate](#11-chiamate-e-videochiamate)
12. [Notifiche Push](#12-notifiche-push)
13. [Sistema Gruppi](#13-sistema-gruppi)
14. [Username e Identità](#14-username-e-identità)
15. [Wallet USDA](#15-wallet-usda)
16. [Hosting e Deployment](#16-hosting-e-deployment)
17. [Monitoraggio e Osservabilità](#17-monitoraggio-e-osservabilità)
18. [Percorso di Crescita](#18-percorso-di-crescita)
19. [Roadmap MVP — Sprint Plan](#19-roadmap-mvp--sprint-plan)
20. [Checklist Pre-Beta](#20-checklist-pre-beta)

---

## 1. Principi Guida

### Il Problema dell'Architettura Precedente

Il documento `alpha-chat-product-design.md` descrive l'architettura di un prodotto per milioni di utenti: Kafka, Cassandra, Kubernetes, Istio, gRPC, multi-region, service mesh, SFU custom. Tutto corretto per quella scala. Tutto sbagliato per un MVP con 1 sviluppatore.

Un team di 1 che implementa quell'architettura impiega 3 anni prima di aprire la beta. Nessuna startup può permetterselo.

### I Veri Principi

**Semplicità radicale nel presente, porte aperte nel futuro.**
Ogni scelta tecnica deve rispondere a: *"Posso costruire questo in giorni, non in settimane?"*

**Database singolo finché tiene.**
Aggiungere un secondo database moltiplica la complessità operativa. Il primo database deve reggere fino a ~50.000 utenti attivi senza problemi. Oltre, si migra con dati reali.

**Managed services ovunque possibile.**
Ogni servizio gestito da un provider è una paginetta di infrastruttura che non devi scrivere, mantenere, monitorare, aggiornare. Il costo di un managed service è irrisorio rispetto al costo del tempo di uno sviluppatore.

**Monolite prima, microservizi mai (in V1).**
Il monolite non è una scelta sbagliata — è la scelta corretta per un team piccolo. Si separa quando il dolore di non separare è più alto del costo di separare. In V1, quel momento non arriva mai.

**Le funzionalità "difficili" si comprano, non si costruiscono.**
Real-time messaging, chiamate, push notifications: esistono servizi maturi che risolvono questi problemi meglio di quanto potresti in V1. Usali.

---

## 2. Visione dell'Architettura MVP

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                         │
│                                                          │
│   React Native (iOS + Android)      React Web (PWA)      │
│                                                          │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS / WebSocket
┌───────────────────────▼─────────────────────────────────┐
│                  SINGLE BACKEND                          │
│                                                          │
│          Node.js + Express  (Monolite)                   │
│                                                          │
│   Auth │ Users │ Messages │ Groups │ Media │ Wallet      │
│                                                          │
└──────┬─────────────┬──────────────┬──────────────────────┘
       │             │              │
┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────────────────────┐
│  PostgreSQL │ │  Redis   │ │   External Managed Services  │
│  (unico DB) │ │ (cache + │ │                              │
│             │ │ presence)│ │  Stream (messaging real-time)│
│             │ └──────────┘ │  Cloudflare R2 (media)       │
└─────────────┘              │  Twilio (SMS OTP)            │
                             │  Expo Push (notifiche)       │
                             │  Daily.co (chiamate)         │
                             └──────────────────────────────┘
```

Questo è tutto. Nessun orchestratore, nessun service mesh, nessuna queue distribuita. Un backend, un database, servizi managed per le parti complesse.

---

## 3. Stack Tecnologico Scelto

### 3.1 Backend — Node.js + TypeScript + Express

**Perché scelto:**
- TypeScript condiviso tra frontend e backend elimina le discrepanze di tipo tra i due layer
- Ecosistema npm vastissimo: librerie per qualsiasi problema già risolto
- Facilità di sviluppo su Replit: ambienti Node.js sono nativi
- Il team (1 sviluppatore) conosce quasi certamente JavaScript/TypeScript meglio di Go o Rust
- I/O-bound workload (messaggi, API) non richiedono Go per le performance in V1
- Le librerie per i servizi managed (Stream, Twilio, AWS SDK) hanno SDK TypeScript di prima classe
- Framework Express: minimalista, nessuna magia nascosta, debugging lineare

**Perché escluso Go:**
Go è eccellente per alta concorrenza e bassa latenza. Ma per un team di 1, il vantaggio in performance di Go rispetto a Node.js non si manifesta prima di milioni di richieste/giorno. Il costo di switching (nuova lingua, nuovo ecosistema, librerie diverse) supera ampiamente il beneficio in V1.

**Quando migrare:**
Quando la latenza P99 delle API supera i 500ms sotto carico reale, o quando si raggiungono ~100.000 DAU con traffico reale. Non prima.

---

### 3.2 Frontend Mobile — React Native + Expo

**Perché scelto:**
- Un codebase per iOS e Android (circa 85% del codice condiviso)
- Expo Managed Workflow: nessuna configurazione nativa necessaria per V1 (nessun Xcode per ogni nuova libreria)
- Expo EAS Build: build iOS/Android nel cloud, senza Mac necessario per Android
- Over-the-air updates (EAS Update): fix critici senza re-submission all'App Store
- TypeScript condiviso con il backend (tipi degli endpoint disponibili su entrambi i lati)
- Comunità enorme, librerie di alta qualità, documentazione eccellente

**Perché escluso Flutter:**
Flutter è eccellente ma richiede Dart, un linguaggio che non condivide nulla con il backend. Nessun codice riutilizzabile, nessun tipo condiviso. Per un team di 1, questo overhead è inaccettabile.

**Perché escluso nativo (Swift/Kotlin):**
Richiederebbe due codebase separate, due set di competenze, il doppio del tempo di sviluppo. Impensabile per un MVP.

**Quando migrare:**
Quando le performance della lista messaggi o della camera non sono accettabili con React Native. Nella pratica: quasi mai in V1. WhatsApp ha usato React Native per anni su feature critiche.

---

### 3.3 Frontend Web — React + Vite + TypeScript

**Perché scelto:**
- Stesso linguaggio e framework del mobile → massimo riutilizzo dei componenti logici e degli hook
- Vite: sviluppo estremamente rapido, HMR istantaneo
- PWA-ready: installabile su desktop e mobile dal browser
- Il web client è anche la strategia di acquisizione più facile: nessun download richiesto

**Quando migrare:**
Mai. React + Vite scala benissimo fino a prodotti di grande dimensione. La migrazione eventuale sarebbe a Next.js per SSR/SEO, non per performance.

---

### 3.4 Linguaggio — TypeScript ovunque

**Perché scelto:**
- Tipi condivisi tra frontend (mobile + web) e backend tramite un pacchetto `shared-types`
- Un errore di tipo catturato a compile-time non diventa un bug in produzione
- Autocomplete e refactoring sicuro con qualsiasi IDE/editor
- L'AI (Copilot, Claude, ChatGPT) genera TypeScript di alta qualità

**Svantaggi:**
- Aggiunge uno step di compilazione
- I tipi possono essere "aggiustati" con `any` se il developer è stanco → richiede disciplina

**Decisione:** TypeScript strict mode con `noImplicitAny: true`. Nessuna eccezione.

---

## 4. Database Unico

### 4.1 La Scelta: PostgreSQL

**Perché scelto:**
PostgreSQL è il database relazionale open source più avanzato al mondo. È ACID-compliant, ha JSON nativo, full-text search built-in, window functions, array types, e una maturità di 30 anni. Per V1, può fare il lavoro di 4 database diversi (relazionale + JSON + full-text + time-series base) senza installare nulla di aggiuntivo.

**Ciò che PostgreSQL fa nativamente in V1:**

| Workload | Come PostgreSQL lo gestisce |
|---|---|
| Messaggi ordinati per tempo | Tabella messages con indice su (conversation_id, created_at DESC) |
| Full-text search messaggi | tsvector + gin index (built-in, no Elasticsearch) |
| Presenza utenti | Tabella user_presence con timestamp aggiornato da Redis via background job |
| Contatori non letti | Tabella unread_counts con increment/decrement atomici |
| Storage temporaneo | Non necessario — Redis per questo |
| Sessioni | Tabella sessions |
| Media metadata | Tabella media con URL S3 |

**Perché escluso MongoDB:**
MongoDB è popolare ma non migliore per questo use case. Le relazioni tra entità (utente → conversazione → messaggio → reazione) sono relazionali. Modellarle in documenti annidati porta a query complesse e inconsistenze. PostgreSQL con JSONB gestisce dati semi-strutturati meglio di quanto MongoDB gestisca dati relazionali.

**Perché escluso PlanetScale / MySQL:**
MySQL ha limitazioni non trascurabili rispetto a PostgreSQL (full-text search più debole, JSONB meno potente, meno tipi di indice). PlanetScale è interessante per lo sharding automatico ma introduce un vendor lock-in non necessario in V1.

**Perché escluso Cassandra / MongoDB per i messaggi:**
Cassandra eccelle a centinaia di milioni di messaggi al giorno. Fino a 10–20 milioni di messaggi al giorno, PostgreSQL con partitioning per data regge senza problemi. Discord ha gestito miliardi di messaggi su Cassandra *dopo* aver outgrown PostgreSQL. Non partiamo da Cassandra prima di aver outgrown PostgreSQL.

**Quando migrare:**
- I messaggi: quando `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50` supera i 100ms di latenza media anche con indici ottimizzati. Probabilmente non prima di 5–10 milioni di messaggi per conversazione o ~100M messaggi totali.
- La ricerca: quando il full-text search di PostgreSQL non è abbastanza veloce o ricco. Migrare il solo search a Elasticsearch lasciando tutto il resto su PostgreSQL.

---

### 4.2 Schema delle Tabelle Principali (Logico)

Questo non è SQL — è la struttura logica per orientare lo sviluppo.

**users**
Campi: id, username (unique), email (unique, nullable), phone_hash (nullable), password_hash, display_name, avatar_url, bio, status, status_expires_at, last_seen, is_online, created_at, updated_at

**sessions**
Campi: id, user_id (→ users), device_id, refresh_token_hash, device_info, ip_address, last_active, created_at, expires_at

**conversations**
Campi: id, type (direct/group), created_at, updated_at, last_message_at

**conversation_members**
Campi: conversation_id, user_id, role (member/admin/owner), joined_at, muted_until, last_read_message_id

**messages**
Campi: id, conversation_id, sender_id, type (text/image/video/audio/document/system), content (testo in chiaro o riferimento cifrato), content_iv (vettore di inizializzazione per E2E), is_deleted, reply_to_id, forwarded_from_id, expires_at, created_at, updated_at

**message_reactions**
Campi: id, message_id, user_id, emoji, created_at

**message_read_receipts**
Campi: message_id, user_id, read_at

**media**
Campi: id, uploader_id, storage_url, thumbnail_url, mime_type, size_bytes, duration_seconds, width, height, is_encrypted, created_at

**groups** (estende conversations di tipo 'group')
Campi: conversation_id, name, description, avatar_url, invite_link_token, max_members, settings_json, created_at

**contacts**
Campi: user_id, contact_user_id, nickname, is_blocked, created_at

**push_tokens**
Campi: id, user_id, device_id, platform (ios/android/web), token, created_at, updated_at

**wallet_accounts** (tabella separata, accesso ristretto)
Campi: id, user_id, balance_usda, kyc_status, is_active, created_at

**wallet_transactions** (append-only)
Campi: id, from_wallet_id, to_wallet_id, amount_usda, type, status, reference_id, created_at

---

### 4.3 Redis — Cache e Real-time State

Redis affianca PostgreSQL per workload in-memory:

**Perché Redis anche con PostgreSQL:**
PostgreSQL non è ottimale per dati che cambiano molte volte al minuto e non devono essere persistiti durabilmente. La presenza online di un utente cambia ogni 30 secondi (heartbeat). Aggiornare PostgreSQL ad ogni heartbeat per 10.000 utenti online è inutile e stressante per il DB.

**Cosa va in Redis:**
- Presenza utenti: `user:presence:{user_id}` → timestamp, TTL 2 minuti (se non rinnovato = offline)
- Sessioni WebSocket attive: `ws:session:{user_id}` → lista di connection_id attive
- Rate limiting: sliding window counter per endpoint
- Cache breve dei profili più richiesti (TTL 5 minuti)
- OTP temporanei (SMS/Email): con TTL di 5 minuti

**Provider scelto:** Redis managed via Upstash (serverless Redis, pay-per-use, zero management). Per V1, i costi sono trascurabili (< $10/mese).

**Quando migrare:**
Upstash scala bene fino a milioni di operazioni/giorno. Se il costo diventa significativo o la latenza non è accettabile, si migra a Redis Cloud o Redis Enterprise.

---

## 5. Backend

### 5.1 Struttura del Monolite

Il backend è un monolite **modulare**: un singolo processo Node.js con moduli interni ben separati. I moduli non condividono il database direttamente tra loro — ogni modulo ha le sue funzioni di accesso ai dati. Questo rende la futura estrazione in microservizi un refactoring, non una riscrittura.

```
src/
├── modules/
│   ├── auth/          → registrazione, login, token management
│   ├── users/         → profilo, contatti, blocchi, presence
│   ├── messages/      → invio, ricezione, delivery status
│   ├── conversations/ → gestione chat 1-to-1 e gruppi
│   ├── groups/        → admin gruppi, membership
│   ├── media/         → upload presigned URL, metadata
│   ├── notifications/ → invio push, preferenze
│   ├── calls/         → token per chiamate (Daily.co)
│   └── wallet/        → saldo, transazioni, KYC (modulo separato)
├── shared/
│   ├── db/            → connection pool PostgreSQL
│   ├── redis/         → client Redis
│   ├── middleware/    → auth, rate limiting, logging
│   └── utils/         → helpers comuni
└── app.ts             → entry point, router principale
```

### 5.2 API Design

**REST per tutte le operazioni standard**
- Semplice, universalmente supportato, facilmente testabile con curl o Postman
- OpenAPI spec generata automaticamente dal codice (tsoa o zod-to-openapi)
- Versioning: `/api/v1/`

**WebSocket per real-time (via Stream SDK)**
Non costruiamo il WebSocket server da zero. Vedi sezione [Real-time Messaging](#7-real-time-messaging).

**Autenticazione:**
- JWT access token (15 minuti)
- Refresh token opaque in cookie HttpOnly (30 giorni)
- Ogni request autenticata ha `req.user` iniettato dal middleware

### 5.3 Validazione Input

**Zod** per la validazione di tutte le richieste in ingresso.

Perché Zod: schema-first, TypeScript-native, i tipi vengono inferiti dallo schema (nessuna duplicazione). Un singolo schema definisce sia la validazione runtime che il tipo TypeScript.

### 5.4 ORM — Drizzle ORM

**Perché Drizzle:**
- TypeScript-first: le query sono typesafe, gli errori di colonna vengono catturati a compile-time
- Leggero: non è un ORM che nasconde il SQL — genera SQL che puoi ispezionare
- Schema-as-code: il database schema è definito in TypeScript, le migrations sono generate automaticamente
- Performance: zero overhead rispetto a query SQL grezze

**Perché escluso Prisma:**
Prisma è eccellente ma introduce un binary engine separato che può complicare il deployment su Replit. Drizzle è un pacchetto npm puro, nessun binary aggiuntivo.

**Perché escluso Sequelize:**
Vecchio, non TypeScript-native, performance non ottimali per query complesse.

---

## 6. Frontend

### 6.1 Struttura del Monorepo

```
alpha-chat/
├── apps/
│   ├── mobile/        → React Native + Expo
│   └── web/           → React + Vite
├── packages/
│   ├── shared-types/  → tipi TypeScript condivisi (User, Message, ecc.)
│   ├── ui/            → componenti UI condivisi
│   └── api-client/    → client HTTP type-safe (fetch + hooks React Query)
└── backend/           → Node.js monolite
```

Il pacchetto `shared-types` è fondamentale: il tipo `Message` è definito una volta sola e usato ovunque. Se cambia un campo nel backend, TypeScript segnala l'errore nei client immediatamente.

### 6.2 State Management

**Zustand** per lo stato globale (utente autenticato, chat attiva, settings)
**React Query (TanStack Query)** per i dati remoti (lista conversazioni, messaggi, profili)

Questa combinazione copre il 95% dei casi senza boilerplate. Redux è overengineering per questo scale.

### 6.3 Navigazione Mobile

**Expo Router** (file-based routing, simile a Next.js ma per mobile)

Perché Expo Router invece di React Navigation standalone: Expo Router è il layer ufficiale Expo sopra React Navigation, con deep linking automatico, URL-based navigation, e una Developer Experience molto più fluida.

### 6.4 UI Component Library

**React Native Paper** (mobile) + **shadcn/ui** (web)

Perché non costruire tutto da zero: i componenti base (Button, Input, Modal, Card) sono già risolti in modo professionale. La personalizzazione avviene via theming e override, non da zero.

---

## 7. Real-time Messaging

### 7.1 La Scelta: Stream Chat

**Cos'è Stream:** un servizio managed per chat in-app. Fornisce WebSocket, canali, messaggi, reactions, thread, presence — tutto tramite SDK.

**Perché scelto:**
Costruire un server WebSocket affidabile, con fan-out dei messaggi, gestione della presenza, retry automatici, ordering garantito, e multi-device sync richiede settimane di sviluppo backend. Stream lo fornisce come SDK in pochi giorni di integrazione.

Stream ha:
- SDK iOS, Android, React Native, Web nativi
- Supporto per messaggi E2E (con la propria implementazione)
- Chat 1-to-1 e gruppi
- Typing indicators, read receipts, reactions
- File e media attachment
- 5 milioni di messaggi/mese free tier → sufficiente per una beta pubblica
- Pricing chiaro e scala con il prodotto

**Cosa rimane nel nostro backend:**
- Autenticazione e generazione del token Stream (il backend firma i JWT per Stream)
- Business logic custom (es: blocco utenti, permessi gruppi)
- Salvataggio di metadata aggiuntivi nel nostro PostgreSQL
- Tutto ciò che Stream non fa (wallet, profili avanzati, impostazioni)

**Perché escluso Pusher:**
Pusher è un servizio pub/sub generico, non specificamente per chat. Richiede di costruire sopra tutta la logica (messaggi, threads, reactions, presence). Stream è già un prodotto chat completo.

**Perché escluso Socket.io costruito in casa:**
Socket.io è una libreria, non una soluzione. Costruire sopra tutto il layer applicativo di una chat (ordering, persistence, multi-device, retry) richiede mesi. In V1 non ha senso.

**Perché escluso Matrix/Synapse:**
Matrix è un protocollo di comunicazione federato con un server di riferimento (Synapse) scritto in Python. Eccellente per V3 (federazione). Per V1, l'overhead operativo di un server Matrix self-hosted è sproporzionato.

**Quando migrare via da Stream:**
Quando il costo mensile di Stream supera il costo di sviluppo e manutenzione di un sistema custom. In pratica, oltre ~500.000 MAU il costo di Stream diventa significativo (~$2.000–5.000/mese). A quella scala, il business supporta lo sviluppo custom.

---

### 7.2 Crittografia E2E con Stream

Stream supporta messaggi E2E tramite il suo SDK. Per V1, si usa l'implementazione E2E di Stream (basata su Signal Protocol sottostante).

**Limitazione:** L'E2E di Stream non è "open" come Signal Protocol puro — il protocollo non è auditato pubblicamente con la stessa profondità. È un trade-off accettabile per V1.

**In V2:** migrazione a Signal Protocol puro con gestione delle chiavi interamente client-side. L'architettura del backend non cambia — solo il layer crittografico nel client.

---

## 8. Crittografia e Sicurezza

### 8.1 Principio Fondamentale

Non si progettano algoritmi crittografici proprietari. Si usano protocolli consolidati, librerie auditate, implementazioni esistenti.

### 8.2 Crittografia dei Messaggi in V1

**Opzione A — Stream E2E (default V1):**
Delegare la crittografia E2E allo SDK Stream. I messaggi sono cifrati client-side prima di raggiungere i server Stream. Il backend Alpha Chat non vede mai il testo in chiaro.

**Opzione B — TLS in transit + encryption at rest (alternativa più semplice per early beta):**
I messaggi sono cifrati in transito (TLS 1.3) e at rest nel database (PostgreSQL tablespace encryption + backup encryption). Non è E2E pura, ma è una postura di sicurezza accettabile per una beta privata dove la priorità è validare il prodotto.

**Raccomandazione:** Partire con Opzione B per la beta chiusa (più veloce da implementare, più facile da debuggare). Implementare E2E completo tramite Stream per la beta pubblica.

**Motivazione:** L'E2E aggiunge complessità non trascurabile al debugging. In una beta chiusa con utenti fidati, la priorità è capire se il prodotto funziona, non proteggere comunicazioni mission-critical.

### 8.3 Password e Credenziali

**Argon2id** per l'hashing delle password.

Perché Argon2id: vincitore del Password Hashing Competition 2015, resistente ad attacchi GPU e ASIC, memory-hard. È la raccomandazione corrente di OWASP. bcrypt è ancora accettabile ma inferiore.

Non si usa MD5, SHA-1, SHA-256 direttamente per le password. Mai.

### 8.4 Transport Security

- TLS 1.3 obbligatorio (gestito automaticamente da Replit/Cloudflare)
- HTTPS ovunque, HTTP redirect automatico
- Headers di sicurezza: HSTS, CSP, X-Frame-Options (middleware Helmet.js)
- CORS: whitelist esplicita dei domini client

### 8.5 Autenticazione JWT

- Algoritmo: RS256 (firma asimmetrica) per i JWT. La chiave privata firma, la chiave pubblica verifica. I microservizi futuri possono verificare il token senza avere la chiave privata.
- Access token: 15 minuti
- Refresh token: opaque (UUID v4), conservato hashato in PostgreSQL, TTL 30 giorni

### 8.6 Rate Limiting

**express-rate-limit** + Redis (Upstash) per rate limiting distribuito.

- Endpoint autenticazione: 5 tentativi / 15 minuti per IP
- Invio messaggi: 100 messaggi / minuto per user_id
- Upload media: 20 upload / minuto per user_id
- API generiche: 300 richieste / minuto per IP

---

## 9. Sistema Media

### 9.1 La Scelta: Cloudflare R2

**Cos'è R2:** Object storage di Cloudflare, API-compatibile con AWS S3. Zero egress fees (non si paga per il bandwidth in uscita).

**Perché scelto:**
- **Costo:** AWS S3 addebita il bandwidth in uscita (~$0.09/GB). Per una chat con foto e video, i costi possono essere significativi. R2 ha egress gratuito, paghi solo lo storage e le operazioni.
- **Performance:** Cloudflare CDN è inclusa — i media vengono serviti dall'edge, vicino all'utente
- **Compatibilità S3:** le librerie AWS SDK funzionano senza modifica con R2 cambiando solo l'endpoint
- **Semplice da configurare su Replit:** variabili d'ambiente standard

**Alternativa AWS S3:**
S3 è più maturo con più funzionalità (lifecycle rules, replication, analytics). Raccomandato se l'ecosistema AWS è già in uso (RDS, EC2, ecc.). Per un progetto standalone, R2 è più economico.

**Quando migrare:**
R2 scala virtualmente senza limiti. Non c'è un trigger tecnico per migrare — solo un eventuale cambio di strategia cloud.

### 9.2 Upload Flow

**Presigned URL pattern:** il client richiede un URL firmato al backend, carica il file direttamente su R2, poi notifica il backend. Il file non passa mai per il server backend.

Questo è fondamentale anche per V1: non vuoi che un video da 50MB attraversi il tuo server Node.js.

**Compressione:**
- Immagini: compresse client-side (Expo ImagePicker + sharp) prima dell'upload
- Video: transcoding asincrono post-upload (Cloudflare Stream per V2; per V1, limite dimensione a 50MB e formato già accettabile)
- Audio: nessun processing — i messaggi vocali in AAC sono già piccoli (< 1MB per 5 minuti)

### 9.3 Media in Chat E2E (V2)

Per la crittografia dei media in chat E2E: il client cifra il file con AES-256-GCM prima dell'upload, carica il blob cifrato, e include la chiave nel payload del messaggio (cifrato E2E). Il server non può accedere al contenuto.

Per V1 (senza E2E completo): i media sono accessibili via URL autenticato (signed URL con TTL di 24 ore). Non pubblicamente accessibili.

---

## 10. Autenticazione

### 10.1 Registro e Login

**Due modalità supportate in V1:**

**Email + Password + 2FA (opzionale)**
- Registrazione con email e password (Argon2id hash)
- Verifica email con link (TTL 24 ore)
- 2FA opzionale via TOTP (Google Authenticator compatibile)
- Recovery via email

**Telefono + SMS OTP**
- Registrazione con numero di telefono
- OTP via SMS (Twilio SMS API)
- OTP: 6 cifre, TTL 5 minuti, max 3 tentativi
- Numero telefono: conservato hashato, non mostrato ad altri utenti

**Provider SMS: Twilio**

Perché Twilio: leader di mercato, copertura globale eccellente, SDK eccellente, pay-as-you-go (nessun costo fisso), pricing trasparente (~$0.0079 per SMS in Italia). Per una beta, il costo è trascurabile. Alternativa valida: Vonage (ex Nexmo), più economico ma con documentazione inferiore.

### 10.2 Session Management

**Access Token:** JWT firmato RS256, 15 minuti, inviato in Authorization header
**Refresh Token:** UUID v4, conservato hashato in tabella `sessions`, 30 giorni, inviato in cookie HttpOnly Secure SameSite=Strict

**Multi-device:** ogni device ha il proprio refresh token. L'utente può vedere e revocare i device attivi.

**Logout:** invalida il refresh token (delete dalla tabella sessions). L'access token rimane valido fino alla sua naturale scadenza (15 minuti) — accettabile in V1.

### 10.3 Social Login (V2)

OAuth 2.0 con Google e Apple (obbligatorio per App Store se si usa social login).

Non incluso in V1 per ridurre la complessità iniziale. L'architettura lo supporta perché l'identità è già separata dall'autenticazione nel modello dati.

---

## 11. Chiamate e Videochiamate

### 11.1 La Scelta: Daily.co

**Cos'è Daily.co:** servizio managed per chiamate audio e video via WebRTC. Fornisce infrastruttura TURN/STUN, SFU, e SDK React Native + Web.

**Perché scelto:**
Costruire un'infrastruttura WebRTC completa (STUN server, TURN server per NAT traversal, SFU per chiamate di gruppo) richiede settimane di configurazione e manutenzione continua. Daily.co:
- Gestisce tutto l'infrastruttura WebRTC
- Ha SDK React Native e Web di alta qualità
- Supporta chiamate 1-to-1 e di gruppo fino a 1.000 partecipanti
- E2E encrypted (DTLS-SRTP nativo WebRTC)
- Free tier: 10.000 minuti/mese (sufficiente per beta)
- Pricing lineare: ~$0.004/minuto partecipante

**Integrazione:**
Il backend Alpha Chat genera un token Daily.co per ogni chiamata. Il client usa l'SDK Daily per connettersi alla stanza. Non costruiamo nulla di custom — solo l'orchestrazione (chi chiama chi, rifiuto/accettazione via WebSocket).

**Perché escluso LiveKit (self-hosted SFU):**
LiveKit è open source ed eccellente per V3 (controllo totale, costo ridotto a scala). Ma richiede di gestire server SFU, TURN, monitoring, scaling. Per V1 con 1 sviluppatore, il costo operativo è troppo alto.

**Perché escluso Agora:**
Agora è un'alternativa valida. Daily.co è preferito per la migliore Developer Experience e la documentazione più chiara.

**Quando migrare:**
Quando il costo mensile di Daily.co supera il costo di gestione di LiveKit self-hosted. Approssimativamente oltre 500.000 minuti chiamata/mese (~$2.000/mese).

---

## 12. Notifiche Push

### 12.1 La Scelta: Expo Push Notifications

**Cos'è:** il servizio push di Expo che astrae sopra APNs (Apple) e FCM (Google).

**Perché scelto:**
- Integrazione nativa con Expo — praticamente zero configurazione
- Un solo endpoint per inviare push sia a iOS che Android
- Gestisce automaticamente il routing al provider corretto (APNs vs FCM)
- Free per progetti Expo
- Expo Push API è una singola chiamata HTTP dal backend

**Per il web:** Web Push API standard via Service Worker. Nessun servizio esterno necessario.

**Limitazione:** Expo Push è meno flessibile di APNs/FCM diretti per configurazioni avanzate (payload cifrati, notifiche interattive complesse). Per V1 è più che sufficiente.

**Quando migrare:**
Quando si ha bisogno di notifiche rich media, payload encrypted (per privacy del contenuto nel push), o configurazioni avanzate per retention. In pratica: V2 o quando si esce da Expo Managed Workflow.

---

## 13. Sistema Gruppi

### 13.1 Architettura Semplificata

In V1, i gruppi non sono un sistema separato — sono conversazioni di tipo `group` nel sistema di conversazioni standard.

**Stream Chat gestisce:**
- Canali di gruppo con più partecipanti
- Permessi di amministrazione (chi può scrivere, chi può aggiungere membri)
- Notifiche di gruppo

**Il backend Alpha Chat gestisce:**
- Metadata del gruppo (nome, avatar, descrizione)
- Permessi avanzati (chi può creare inviti, ecc.) tramite Stream custom permissions
- Limite massimo partecipanti (500 per V1)

**Link di invito:**
Token UUID v4 conservato nella tabella `groups`. Chi conosce il link può unirsi (o viene messo in lista d'attesa se l'admin ha attivato l'approvazione).

---

## 14. Username e Identità

### 14.1 Strategia

Alpha Chat identifica gli utenti con username univoci. Il numero di telefono è opzionale e non è mai visibile ad altri utenti.

**Regole username:**
- 3–32 caratteri, alfanumerici e underscore
- Case-insensitive (salvato lowercase)
- Unico globalmente
- Modificabile con cooldown 14 giorni
- Ricerca per username esatto (non parziale di default)

**Implementazione:**
- Tabella `users` con colonna `username` con indice UNIQUE
- Lock ottimistico per prevenire race condition nella claim dell'username

### 14.2 Discovery dei Contatti

**Via username:** cerca `@nomeutente` — il modo principale

**Via rubrica telefonica (opzionale, opt-in):** l'app legge i numeri della rubrica, li hashe con bcrypt/SHA-256, e li invia al backend. Il backend confronta con i hash conservati. Se c'è match, propone quell'utente come contatto. Il numero in chiaro non lascia mai il dispositivo.

**Motivazione privacy del hash matching:** il numero di telefono viene hashato lato client prima di essere inviato. Il server conserva hash, non numeri in chiaro. Anche se il database venisse compromesso, i numeri di telefono non sarebbero recuperabili (facilmente).

---

## 15. Wallet USDA

### 15.1 Principio di Separazione

Il wallet è un modulo separato con accesso rigorosamente controllato. Non è incluso in V1 del prodotto — è una funzionalità V2 che richiede:
- Compliance regulatoria (EMD/PSD2 in EU, licenza operatore money service)
- KYC/AML provider integrato
- Audit di sicurezza specifico

### 15.2 Architettura in V1 (Placeholder)

Per V1, il wallet è una struttura dati vuota nel database (tabella `wallet_accounts` con `is_active = false`). Non è accessibile dall'UI.

**Perché creare la tabella anche in V1:**
Evitare una migration futura che aggiunge una foreign key su una tabella esistente con milioni di righe. Creare lo schema ora, activare la funzionalità in V2.

### 15.3 Architettura V2

Quando il wallet è attivato:
- Modulo backend isolato con accesso in lettura/scrittura solo tramite funzioni dedicate
- PIN separato (4–6 cifre) + biometria per ogni operazione wallet
- Audit log append-only di ogni transazione
- Provider KYC: Onfido o Sumsub (entrambi hanno SDK pronto per React Native)
- Provider pagamenti sottostante: da definire in base al contesto regulatorio (EU → licenza EMI propria o partenariato con istituto di moneta elettronica)

---

## 16. Hosting e Deployment

### 16.1 Fase 1 — Replit (Sviluppo + Beta chiusa)

**Replit** come piattaforma di sviluppo e hosting iniziale.

**Perché Replit per lo sviluppo:**
- Ambiente di sviluppo cloud: nessuna configurazione locale
- Database PostgreSQL managed integrato
- Deployment con un click
- Collaborazione in tempo reale con AI (Replit AI)
- Preview automatico ad ogni push

**Limitazioni di Replit per produzione:**
- Performance non ottimali per applicazioni high-traffic
- Meno controllo sull'infrastruttura rispetto a cloud providers
- Adatto per beta chiusa (< 1.000 utenti attivi)

### 16.2 Fase 2 — Railway o Render (Beta Pubblica)

Per la beta pubblica (1.000–10.000 utenti), si migra su:

**Railway** (raccomandato):
- Deploy da GitHub con un click
- PostgreSQL managed integrato
- Redis integrato
- Scaling verticale semplice
- Prezzo trasparente e ragionevole ($5–20/mese per V1)
- Nessuna gestione del server

**Alternativa: Render**
- Simile a Railway, leggermente meno flessibile
- Free tier disponibile per test

**Perché non AWS/GCP/Azure direttamente:**
Richiedono configurazione di VPC, security groups, load balancer, autoscaling groups — complessità operativa significativa. Per V1 e V2, un PaaS (Platform as a Service) come Railway è più appropriato.

### 16.3 Fase 3 — AWS/GCP (Scale)

Quando il costo del PaaS supera il costo di gestione infrastruttura diretta. Questo accade tipicamente oltre ~50.000 DAU o quando servono requisiti specifici (multi-region, compliance GDPR con data residency garantita).

### 16.4 CDN — Cloudflare

Cloudflare su tutto il dominio, free tier:
- CDN per asset statici
- DDoS protection automatica
- SSL/TLS terminazione
- R2 object storage (già scelto)

---

## 17. Monitoraggio e Osservabilità

### 17.1 Logging — Pino

**Pino** per il logging strutturato (JSON) in Node.js.

Perché Pino: il logger più veloce per Node.js, output JSON strutturato (filtrabile, ricercabile), integrazione nativa con il request lifecycle Express.

### 17.2 Error Tracking — Sentry

**Sentry** per il tracciamento degli errori in produzione.

Perché Sentry: cattura automaticamente eccezioni non gestite, fornisce stack trace, context, e breadcrumbs. Free tier per progetti piccoli. Alerting via email/Slack quando si verifica un errore.

Integrazione in 10 minuti con `@sentry/node` e `@sentry/react-native`.

### 17.3 Uptime Monitoring — Better Uptime o UptimeRobot

Ping dell'endpoint `/api/health` ogni minuto. Alert via email/SMS se il servizio è giù. Free per 1 monitor.

### 17.4 Analytics Prodotto — PostHog

**PostHog** per analytics di prodotto (page views, funnel, retention, feature flags).

Perché PostHog: open source, self-hostable (nessun dato a terzi), free tier generoso (1M eventi/mese), feature flags integrati (utile per rollout graduali).

---

## 18. Percorso di Crescita

### 18.1 Da Monolite a Moduli Separati

Il monolite modulare è progettato per essere "split" quando necessario. L'ordine naturale di separazione:

1. **Primo a separarsi: Media Service**
   *Quando:* quando l'upload di file appesantisce l'unico processo Node.js
   *Come:* estrarre il modulo `media/` in un servizio separato con la stessa interfaccia HTTP

2. **Secondo: Notification Service**
   *Quando:* quando le notifiche push rallentano le API
   *Come:* estrarre in servizio asincrono con Kafka o BullMQ

3. **Terzo: Wallet Service**
   *Quando:* quando il wallet è attivato (V2), per isolamento di sicurezza obbligatorio
   *Come:* già progettato per essere isolato

### 18.2 Da PostgreSQL a Database Specializzati

L'ordine naturale di aggiunta:

1. **Elasticsearch per la ricerca** — quando il full-text search di PostgreSQL non è abbastanza veloce. PostgreSQL rimane il source of truth; Elasticsearch è solo un indice.

2. **Cassandra per i messaggi** — quando le query sulla tabella `messages` (miliardi di righe) diventano lente nonostante gli indici. La migrazione dei dati storici è l'operazione più complessa (richiede uno script di migrazione attento).

3. **Redis Cluster** — quando l'istanza Redis singola non basta per la presence di milioni di utenti online.

### 18.3 Da Stream Chat a Sistema Custom

Stream Chat scala bene fino a un certo punto. Quando il costo diventa significativo o si hanno requisiti che Stream non supporta:

1. Progettare il protocollo WebSocket interno (basato su libwebsockets o socket.io)
2. Implementare Signal Protocol puro per E2E
3. Migrare i messaggi da Stream al database interno

Questa migrazione è la più complessa e non va pianificata prima che sia necessaria.

---

## 19. Roadmap MVP — Sprint Plan

Obiettivo: **Beta Pubblica in 16 settimane** con 1 sviluppatore principale.

```
TIMELINE: 16 SETTIMANE
═══════════════════════════════════════════════════════════════════════

SPRINT 0 — SETUP (Settimana 1)
────────────────────────────────
□ Setup monorepo (Turborepo o pnpm workspaces)
□ Backend: Node.js + Express + TypeScript boilerplate
□ Database: PostgreSQL su Replit, Drizzle ORM setup
□ Redis: Upstash configurato
□ CI/CD: GitHub Actions → deploy automatico su Replit
□ Sentry installato e configurato (errori da subito monitorati)
□ Stream Chat account: credenziali configurate
□ Cloudflare R2 bucket creato
□ Daily.co account: credenziali configurate
  ▶ DELIVERABLE: Ambiente funzionante, "hello world" deployato

SPRINT 1 — AUTH + IDENTITÀ (Settimane 2–3)
────────────────────────────────────────────
□ Tabelle DB: users, sessions, contacts
□ Registrazione con email + password (Argon2id)
□ Login + JWT access token + refresh token
□ Middleware di autenticazione per tutte le route protette
□ Verifica email (link con token, Resend API per le email)
□ Sistema username: claim, validazione, unicità
□ Profilo utente: foto (Cloudflare R2), bio, status
□ Rate limiting su endpoint autenticazione
□ Test: registrazione, login, logout, refresh token
  ▶ DELIVERABLE: Auth funzionante e testato

SPRINT 2 — CHAT CORE (Settimane 4–6)
──────────────────────────────────────
□ Integrazione Stream Chat SDK backend (generazione token)
□ Integrazione Stream Chat SDK mobile (React Native)
□ Integrazione Stream Chat SDK web
□ UI chat list: lista conversazioni con preview ultimo messaggio
□ UI chat view: bubble messaggi, input, invio
□ Delivery status: sent / delivered / read (Stream built-in)
□ Typing indicator (Stream built-in)
□ UI profilo contatto
□ Aggiunta contatti via username
□ Blocco utenti
  ▶ DELIVERABLE: Chat 1-to-1 funzionante su mobile e web

SPRINT 3 — MEDIA (Settimane 7–8)
──────────────────────────────────
□ Presigned URL endpoint (backend → R2)
□ Upload immagini: picker, compressione, upload, visualizzazione
□ Upload documenti: picker, upload, download
□ Messaggi vocali: registrazione, waveform, riproduzione, velocità
□ Link preview: scraper backend, cache 24h
□ Galleria media per conversazione
□ Limiti dimensione e tipo file con feedback chiaro
  ▶ DELIVERABLE: Invio media completo

SPRINT 4 — GRUPPI (Settimane 9–10)
─────────────────────────────────────
□ Creazione gruppo (Stream Channel type: "group")
□ Aggiunta / rimozione membri
□ Ruoli: owner, admin, member (Stream permissions)
□ Inviti via link (token nel DB + Stream)
□ Impostazioni gruppo: nome, avatar, descrizione
□ Menzioni @username con notifica
□ Admin tools: silenziamento, ban
  ▶ DELIVERABLE: Gruppi funzionanti fino a 500 partecipanti

SPRINT 5 — NOTIFICHE (Settimane 9–10, parallelo Gruppi)
─────────────────────────────────────────────────────────
□ Expo Push Notifications: token device, salvataggio
□ Backend: invio push via Expo Push API
□ Notifica per nuovo messaggio (privacy: no testo nel payload)
□ Notifica per menzione
□ Preferenze notifiche: per-chat mute, DND schedule
□ Web Push via Service Worker
  ▶ DELIVERABLE: Notifiche push su iOS, Android, Web

SPRINT 6 — CHIAMATE (Settimane 11–12)
────────────────────────────────────────
□ Daily.co: creazione room, token generazione
□ Signaling via Stream Chat (messaggio tipo "call_offer")
□ UI chiamata in ingresso (overlay con accetta/rifiuta)
□ Chiamate vocali 1-to-1: Daily.co SDK mobile
□ Videochiamate 1-to-1: Daily.co SDK mobile
□ Chiamate vocali web
□ In-call UI: mute, speaker, flip camera, hangup
□ Chiamate di gruppo audio (fino a 8, Daily.co managed SFU)
  ▶ DELIVERABLE: Chiamate e videochiamate funzionanti

SPRINT 7 — FEATURES COMPLETE (Settimane 13–14)
─────────────────────────────────────────────────
□ Messaggi a scomparsa: timer configurabile
□ Reazioni emoji ai messaggi
□ Reply inline con preview
□ Forward messaggio
□ Ricerca messaggi (PostgreSQL full-text)
□ Ricerca utenti per username
□ Impostazioni privacy: last seen, read receipts, online status
□ Blocco screenshot (mobile)
□ Multi-device: verifica sincronizzazione
□ Dark mode / Light mode
  ▶ DELIVERABLE: Feature set V1 completo

SPRINT 8 — HARDENING + BETA CHIUSA (Settimane 15–16)
───────────────────────────────────────────────────────
□ Security review: header sicurezza, input validation, SQL injection
□ Rate limiting verificato su tutti gli endpoint critici
□ Load test: 500 utenti concorrenti in staging
□ Bug fixing: lista da Sprint 1–7
□ Onboarding flow: prima apertura, claim username, primo contatto
□ Empty states: lista chat vuota, nessun contatto, nessun media
□ Error states: connessione persa, messaggio non inviato, retry
□ Performance: scroll lista messaggi fluido (60fps)
□ Beta chiusa: 50–100 utenti invitati
□ Feedback collection: PostHog + canale feedback in-app
  ▶ DELIVERABLE: Beta chiusa live

SETTIMANA 17–18 — BETA PUBBLICA
──────────────────────────────────
□ Fix critici emersi dalla beta chiusa
□ App Store submission (iOS) — review ~3 giorni
□ Google Play submission (Android) — review ~2 giorni
□ Web app dominio definitivo
□ Landing page pubblica
□ Monitoraggio intensivo h24 per la prima settimana
  ▶ DELIVERABLE: Alpha Chat Beta Pubblica 🚀

═══════════════════════════════════════════════════════════════════════

RIEPILOGO TIMELINE
────────────────────
Settimana 1:   Setup e infrastruttura
Settimane 2–3: Auth e identità
Settimane 4–6: Chat core (la feature più importante)
Settimane 7–8: Media
Settimane 9–10: Gruppi + Notifiche (paralleli)
Settimane 11–12: Chiamate
Settimane 13–14: Feature complete
Settimane 15–16: Hardening + Beta chiusa
Settimane 17–18: Beta pubblica

TOTALE: 18 settimane (~4 mesi e mezzo)

═══════════════════════════════════════════════════════════════════════
```

---

## 20. Checklist Pre-Beta

### Sicurezza (Non Negoziabile)
- [ ] HTTPS ovunque (nessun endpoint HTTP in produzione)
- [ ] Rate limiting su tutti gli endpoint write
- [ ] Input validation su tutte le route (Zod schema)
- [ ] SQL injection impossibile (ORM parametrizzato, nessuna query con stringa concatenata)
- [ ] XSS impossibile (React sanitizza per default, nessun dangerouslySetInnerHTML)
- [ ] Password hashate con Argon2id (nessuna password in chiaro in DB o log)
- [ ] JWT con scadenza breve (15 minuti)
- [ ] Refresh token hashati nel DB
- [ ] Nessun secret in codice (tutti in variabili d'ambiente)
- [ ] Headers di sicurezza (Helmet.js)

### Performance
- [ ] Lista messaggi: scroll a 60fps su iPhone 12 e Android di fascia media
- [ ] Apertura app: < 2 secondi su connessione 4G
- [ ] Invio messaggio: appare nella UI < 100ms (optimistic update)
- [ ] Caricamento immagini: thumbnail istantanea, full-res lazy

### Affidabilità
- [ ] Gestione connessione persa: banner + retry automatico
- [ ] Messaggi non inviati: stato "failed" con retry manuale
- [ ] App funziona con connessione lenta (3G)
- [ ] Sentry configurato: ogni errore non gestito viene tracciato
- [ ] Backup database: automatico ogni 24 ore

### UX Minima
- [ ] Onboarding: claim username, foto profilo (opzionale), primo contatto
- [ ] Empty states: lista chat vuota, nessun risultato ricerca
- [ ] Loading states: skeleton screen (non spinner bianchi)
- [ ] Error messages: messaggi comprensibili, non stack trace

---

## Tabella di Confronto: Architettura Enterprise vs MVP

| Componente | Enterprise (doc precedente) | MVP (questo documento) | Quando migrare |
|---|---|---|---|
| Backend | Go + microservizi | Node.js monolite | > 100K DAU o team > 5 persone |
| Real-time | WebSocket custom + Kafka | Stream Chat SDK | > 500K MAU o costo Stream > $2K/mese |
| Database messaggi | Cassandra | PostgreSQL | > 100M messaggi totali |
| Ricerca | Elasticsearch | PostgreSQL full-text | Quando tsvector non basta |
| Cache/Presence | Redis self-hosted | Upstash Redis | > 10M op/giorno |
| Object storage | AWS S3 | Cloudflare R2 | Mai (R2 scala senza limiti) |
| Chiamate | LiveKit SFU self-hosted | Daily.co managed | > 500K min/mese |
| Notifiche | APNs/FCM diretti | Expo Push | Uscita da Expo Managed Workflow |
| Auth | Auth custom completo | JWT + Refresh Token | Mai (è già scalabile) |
| Infrastruttura | Kubernetes + Istio | Railway / Render | > 50K DAU o requisiti compliance |
| SMS OTP | Provider custom | Twilio | Mai (Twilio scala) |
| Monitoraggio | Prometheus + Grafana + Jaeger | Sentry + Better Uptime | > 50K DAU |

---

## Note Finali

Questa architettura non è un compromesso — è la scelta **corretta per questa fase**. Usare Kubernetes per servire 100 utenti non è "scalabile" — è spreco. La scalabilità vera è sapere quando aggiungere complessità e quando resisterle.

I prodotti che sopravvivono non sono quelli con l'architettura più elegante in partenza. Sono quelli che arrivano agli utenti, validano il prodotto, e poi crescono l'architettura insieme agli utenti.

**Ship first. Optimize later. Rewrite never.**

---

*Documento preparato per il team Alpha Chat*
*Ultima revisione: Luglio 2025*
