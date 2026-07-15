# Alpha Chat — Documento di Progettazione del Prodotto
> Versione 1.0 — Luglio 2025
> Status: Design Phase — Pre-Development

---

## Indice

1. [Visione del Prodotto](#visione-del-prodotto)
2. [Mission](#mission)
3. [Valori](#valori)
4. [Target Utenti](#target-utenti)
5. [Funzionalità Versione 1](#funzionalità-versione-1)
6. [Roadmap Versione 2](#roadmap-versione-2)
7. [Roadmap Versione 3](#roadmap-versione-3)
8. [UX Philosophy](#ux-philosophy)
9. [UI Philosophy](#ui-philosophy)
10. [Architettura Completa](#architettura-completa)
11. [Database](#database)
12. [Backend](#backend)
13. [Frontend](#frontend)
14. [API](#api)
15. [Sistema Notifiche](#sistema-notifiche)
16. [Sistema Gruppi](#sistema-gruppi)
17. [Sistema Media](#sistema-media)
18. [Sistema Chiamate](#sistema-chiamate)
19. [Sistema Videochiamate](#sistema-videochiamate)
20. [Sistema Username](#sistema-username)
21. [Sistema Autenticazione](#sistema-autenticazione)
22. [Sicurezza](#sicurezza)
23. [Scalabilità](#scalabilità)
24. [Piano di Sviluppo](#piano-di-sviluppo)
25. [Roadmap Milestone V1](#roadmap-milestone-v1)

---

## 1. Visione del Prodotto

Alpha Chat nasce da una convinzione semplice: **la comunicazione digitale merita di essere riprogettata da zero**, non migliorata ai margini.

Le piattaforme esistenti portano il peso delle scelte architetturali degli anni 2010: database centralizzati, modelli di monetizzazione basati sulla sorveglianza, interfacce stratificate da anni di feature creep. WhatsApp è ubiquo ma non è eccellente. Telegram è potente ma non è sicuro per default. Signal è sicuro ma non è piacevole. iMessage è elegante ma è chiuso.

**Alpha Chat vuole essere tutto questo contemporaneamente**, senza i compromessi di nessuno.

La visione è una piattaforma dove:
- La conversazione è veloce come il pensiero
- La privacy è architetturale, non una checkbox
- Il design non è decorazione ma riduzione della frizione
- La fiducia si guadagna con la trasparenza tecnica, non con le dichiarazioni di marketing
- Il wallet USDA è un layer opzionale, completamente separato dalla comunicazione

Alpha Chat non è un prodotto — è un'infrastruttura di comunicazione per il prossimo decennio.

---

## 2. Mission

> **Costruire la piattaforma di comunicazione più veloce, più sicura e più rispettosa delle persone al mondo.**

Ogni decisione tecnica, ogni scelta di design, ogni politica di dato deve rispondere a questa domanda: **serve la comunicazione tra le persone o serve noi?**

---

## 3. Valori

### 3.1 Privacy per Design, non per Politica
La privacy non è una funzionalità aggiuntiva. È un vincolo architetturale. Se il sistema non può tecnicamente accedere a un dato, non c'è policy che possa fallire.

### 3.2 Velocità come Rispetto
Ogni millisecondo di latenza è un costo pagato dall'utente. La velocità non è un obiettivo di performance — è una forma di rispetto per il tempo delle persone.

### 3.3 Semplicità Radicale
Aggiungere una funzionalità è facile. Resistere alla tentazione di aggiungerla è difficile. Alpha Chat deve avere il coraggio della sottrazione.

### 3.4 Trasparenza Tecnica
Il codice dei componenti critici (crittografia, gestione dati) deve essere open source. Gli audit di sicurezza devono essere pubblici. La fiducia si dimostra, non si dichiara.

### 3.5 Separazione delle Responsabilità
Chat e wallet sono due prodotti con due identità diverse che condividono un'autenticazione. L'utente non deve mai sentire che la sua comunicazione è strumentale a un obiettivo finanziario.

---

## 4. Target Utenti

### 4.1 Utente Primario — Il Comunicatore Quotidiano
**Chi è:** 18–45 anni, smartphone come dispositivo principale, usa già WhatsApp o Telegram
**Cosa vuole:** un'app che "funziona e basta", veloce, affidabile, non invasiva
**Pain point principale:** sorveglianza percepita, spam, lentezza in condizioni di rete debole
**Come lo acquistiamo:** superiore fluidità e design, migrazione facile dei contatti

### 4.2 Utente Secondario — Il Privacy Advocate
**Chi è:** 25–50 anni, tech-savvy, attento alle implicazioni dei dati
**Cosa vuole:** end-to-end encryption verificabile, nessuna metadata collection, open source
**Pain point principale:** dover scegliere tra sicurezza e usabilità (Signal vs WhatsApp)
**Come lo acquistiamo:** crittografia di default, audit pubblici, codice aperto

### 4.3 Utente Terziario — Il Business User
**Chi è:** professionisti, team distribuiti, piccole imprese
**Cosa vuole:** comunicazione organizzata, ricerca efficace, integrazione con workflow
**Pain point principale:** WhatsApp non scala nei team; Slack è costoso e non personale
**Come lo acquistiamo:** spazi di lavoro organizzati, ricerca avanzata, API per integrazioni (V2)

### 4.4 Utente Wallet (Opzionale)
**Chi è:** sottoinsieme degli utenti primari interessati a micro-transazioni in USDA
**Cosa vuole:** inviare valore con la stessa semplicità con cui invia un messaggio
**Pain point principale:** attrito tra app di comunicazione e app di pagamento
**Come lo acquistiamo:** integrazione fluida ma opt-in, mai prerequisito per usare la chat

---

## 5. Funzionalità Versione 1

La V1 è definita da un principio: **fare poche cose in modo straordinario**.

### 5.1 Core Messaging
| Funzionalità | Descrizione | Priorità |
|---|---|---|
| Chat 1-to-1 | Messaggi di testo con E2E encryption | P0 — Essenziale |
| Chat di gruppo | Fino a 500 partecipanti con E2E encryption | P0 — Essenziale |
| Messaggi vocali | Registrazione e riproduzione in-app, con velocità variabile | P0 — Essenziale |
| Reazioni ai messaggi | Emoji reactions con counter aggregato | P0 — Essenziale |
| Risposte inline | Reply con anteprima del messaggio originale | P0 — Essenziale |
| Messaggi a scomparsa | Timer configurabile per singola chat o gruppo | P1 — Alta |
| Inoltro messaggi | Con indicazione dell'origine | P1 — Alta |
| Menzioni | @username nei gruppi con notifica diretta | P1 — Alta |
| Messaggi non letti | Badge e scroll rapido ai non letti | P0 — Essenziale |
| Ricerca messaggi | Full-text search locale e in-chat | P1 — Alta |

### 5.2 Media
| Funzionalità | Descrizione | Priorità |
|---|---|---|
| Foto e video | Compressione adattiva, download lazy | P0 — Essenziale |
| Documenti | PDF, Office, fino a 100MB | P1 — Alta |
| Link preview | Anteprima rich delle URL condivise | P1 — Alta |
| Vista galleria | Visualizzazione aggregata dei media per chat | P2 — Media |

### 5.3 Chiamate
| Funzionalità | Descrizione | Priorità |
|---|---|---|
| Chiamate vocali 1-to-1 | E2E encrypted, WebRTC | P0 — Essenziale |
| Videochiamate 1-to-1 | E2E encrypted, adaptive bitrate | P0 — Essenziale |
| Chiamate di gruppo | Fino a 8 partecipanti audio in V1 | P1 — Alta |

### 5.4 Profilo e Identità
| Funzionalità | Descrizione | Priorità |
|---|---|---|
| Username unico | Identificazione senza numero di telefono | P0 — Essenziale |
| Profilo pubblico/privato | Controllo granulare della visibilità | P0 — Essenziale |
| Status | Testo o emoji, con scadenza opzionale | P1 — Alta |
| Avatar e foto profilo | Con controllo visibilità (tutti/contatti/nessuno) | P0 — Essenziale |

### 5.5 Impostazioni e Privacy
| Funzionalità | Descrizione | Priorità |
|---|---|---|
| Blocco utenti | Completo, silenzioso per l'utente bloccante | P0 — Essenziale |
| Conferme di lettura | On/off per account e per singola chat | P0 — Essenziale |
| "Online" last seen | On/off con controllo granulare | P0 — Essenziale |
| Blocco screenshot | Impedisce screenshot in chat sensibili (mobile) | P1 — Alta |
| Notifiche silenziose | Per chat, gruppo, o globale | P0 — Essenziale |

### 5.6 Wallet USDA (Modulo Separato, Opzionale)
| Funzionalità | Descrizione | Priorità |
|---|---|---|
| Attivazione opt-in | Wallet non attivato di default | P0 — Obbligatorio |
| Saldo USDA | Visualizzazione saldo con PIN separato | P0 — Essenziale |
| Invio e ricezione | Da/verso contatti Alpha Chat con wallet attivo | P0 — Essenziale |
| Storico transazioni | Lista con filtri | P1 — Alta |
| KYC semplificato | Per limiti base (< €1000/mese) | P0 — Obbligatorio |

> **Nota architetturale critica:** Il wallet USDA vive in un microservizio completamente separato, con autenticazione dedicata (PIN/biometria aggiuntiva), database separato, e nessuna comunicazione diretta con i dati di messaggistica. L'unico punto di contatto è l'identità dell'utente (user_id), che non porta con sé nessun dato di conversazione.

---

## 6. Roadmap Versione 2

La V2 porta Alpha Chat da **strumento di comunicazione personale** a **piattaforma di comunicazione**.

### 6.1 Community e Canali
- **Canali broadcast** (simile a Telegram Channels): 1-to-many, illimitati iscritti
- **Community con stanze** (simile a Discord Server): namespace condiviso con canali tematici
- **Sondaggi avanzati** con timer, anonimato opzionale, risultati in real-time
- **Thread di risposta** nei gruppi: conversazioni parallele senza rumore

### 6.2 Chiamate e Media Avanzati
- **Videochiamate di gruppo** fino a 16 partecipanti con griglia adattiva
- **Screen sharing** nelle videochiamate
- **Stanze audio permanenti** (simile a Clubhouse/Discord Stage)
- **Messaggi video istantanei** (video note circolari, come Telegram)

### 6.3 Produttività
- **Messaggi programmati**: invia in un orario futuro
- **Reminder integrati**: imposta promemoria su qualsiasi messaggio
- **Messaggi fissati**: pin multipli con indice navigabile
- **Bozze salvate**: testi non inviati sincronizzati su dispositivi
- **Ricerca globale avanzata**: per mittente, tipo di file, data, parola chiave

### 6.4 Personalizzazione
- **Temi e colori custom**: palette personalizzabile per chat o globale
- **Font size e spaziatura**: accessibilità nativa
- **Suoni di notifica custom**: per contatto o gruppo
- **Bubble chat personalizzate**: forme e dimensioni

### 6.5 API e Bot Framework
- **Bot API pubblica**: developers possono creare bot con comandi e interactive messages
- **Webhook support**: per integrazioni CI/CD, alerting, monitoring
- **Mini App Framework** (lightweight): app web embedded nella chat

### 6.6 Wallet USDA V2
- **Richiesta pagamento**: send a payment request con importo e nota
- **Split tra gruppi**: dividi un conto tra i partecipanti a una chat
- **Integrazione merchant**: accetta USDA con QR code
- **Limiti KYC avanzati**: per flussi > €10.000/mese

---

## 7. Roadmap Versione 3

La V3 posiziona Alpha Chat come **infrastruttura comunicativa aperta**.

### 7.1 Federazione e Interoperabilità
- **Protocollo aperto**: definizione e pubblicazione del protocollo Alpha Chat
- **Bridge verso Matrix/XMPP**: comunicazione tra ecosistemi diversi
- **Compliance EU DMA**: interoperabilità obbligatoria per piattaforme >45M utenti EU

### 7.2 AI Layer (Privacy-first)
- **Riassunti di chat** (on-device, non server-side): sintesi di conversazioni non lette
- **Smart replies contestuali** (on-device): suggerimenti risposta generati localmente
- **Traduzione automatica** (on-device per lingue principali): no cloud translation
- **Trascrizione vocale** (on-device): messaggi audio → testo, ricercabile
- **Nessun dato di conversazione inviato a modelli cloud.** Tutti i modelli AI girano on-device o in secure enclave.

### 7.3 Spaces e Collaborazione
- **Documenti condivisi**: editing collaborativo in-app (leggero, non un Google Docs)
- **Lavagne condivise**: whiteboard sincrono nelle chat di gruppo
- **Task list condivise**: to-do con assegnazioni

### 7.4 Decentralizzazione (Sperimentale)
- **Backup E2E su storage personale**: iCloud/Google Drive/self-hosted, chiave in mano all'utente
- **Verifica crittografica dell'identità**: DNS-based o via public key pinning opzionale
- **Nodi di relay opzionali**: per organizzazioni che vogliono gestire il proprio traffico

---

## 8. UX Philosophy

### 8.1 Principio Fondamentale: Zero Friction per le Azioni Frequenti
Le azioni che l'utente compie 50 volte al giorno (aprire una chat, inviare un messaggio, ascoltare un audio) devono richiedere il minimo numero di tap possibile. Le azioni rare (impostazioni avanzate, export dati) possono essere più profonde.

### 8.2 Il Silenzio è un Feature
Non tutto deve essere notificato. Non tutto deve pulsare, vibrare, lampeggiare. Alpha Chat privilegia la comunicazione voluta rispetto alla comunicazione imposta. L'utente è nel controllo del proprio flusso di attenzione.

### 8.3 Progressive Disclosure
La complessità esiste ma non è in primo piano. Un utente nuovo vede un'interfaccia essenziale. Un utente avanzato può portare in superficie funzionalità avanzate senza che queste disturbino chi non le usa.

### 8.4 Gestualità Naturale
La navigazione avviene principalmente con **swipe e gesture**, non con bottoni espliciti. Swipe right per rispondere, swipe left per eliminare, long press per il menu contestuale. Le gesture devono essere scopribili — non nascoste — ma non obbligatorie.

### 8.5 Consistenza Multi-Platform
L'esperienza su iOS, Android e Web deve essere **coerente nella funzione, adattata nella forma**. Ogni piattaforma ha le sue convenzioni (navigation bar su iOS, drawer su Android, sidebar su desktop) — Alpha Chat le rispetta pur mantenendo un'identità visiva riconoscibile.

### 8.6 Accessibilità Non Negoziabile
Dynamic type, contrast ratio AA come minimo (AAA dove possibile), screen reader support completo, navigazione da tastiera per web. L'accessibilità non è un post-it — è nella definizione di done di ogni componente.

---

## 9. UI Philosophy

### 9.1 Design System: Atomic e Token-Based
L'intera interfaccia è costruita su un sistema di design token (colori, tipografia, spaziatura, raggio dei bordi, ombre). Ogni componente è composto da atomi. Il tema scuro e il tema chiaro non sono skin — sono variazioni dei token, non riscritture dell'interfaccia.

### 9.2 Tipografia come Voce
Alpha Chat ha una voce testuale precisa. Un typeface scelto per la leggibilità ad alta velocità di scorrimento, con gerarchia chiara tra nome mittente, corpo messaggio, timestamp. Il testo non è decorazione — è il prodotto.

### 9.3 Cromatica
**Colore primario**: non blue (già WhatsApp, Telegram, Facebook). Direction suggerita: deep indigo o verde profondo — professionale, non aggressivo, distintivo.
**Palette neutri**: warm gray (non cold gray) per un'atmosfera più personale e meno "dashboard".
**Accent**: usato con parsimonia per CTA e stati attivi. Mai decorativo.

### 9.4 Icone e Illustrazioni
Icon set custom derivato da un grid system preciso — non icon font generici. Le illustrazioni (empty states, onboarding) devono essere **astratte ma calde** — geometrie che evocano connessione, non clipart.

### 9.5 Animazioni con Scopo
Ogni animazione deve avere uno scopo comunicativo:
- **Transizioni di navigazione**: orientamento spaziale (da dove vengo, dove vado)
- **Feedback di invio**: il messaggio si è "fisicamente" staccato dall'input
- **Loading state**: mai uno spinner generico — skeleton screens che rispecchiano il contenuto atteso
- **Durata**: 150ms–350ms. Niente di più lento. Niente di più veloce da non percepire.

---

## 10. Architettura Completa

### 10.1 Visione Architetturale

Alpha Chat adotta un'architettura **event-driven a microservizi**, con separazione netta tra il dominio della messaggistica e il dominio del wallet.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                │
│   iOS App    Android App    Web App    Desktop App (V2)              │
└────────────────────┬────────────────────────────────────────────────┘
                     │ HTTPS / WebSocket / WebRTC
┌────────────────────▼────────────────────────────────────────────────┐
│                        EDGE LAYER                                    │
│   CDN (media)    API Gateway    WebSocket Gateway    TURN/STUN       │
└────────────────────┬────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────────┐
│                      CORE SERVICES                                   │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Auth Service│  │  Chat Service│  │  Media Service│               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  User Service│  │ Notif. Service│ │  Call Service │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│  ┌──────────────┐  ┌──────────────┐                                  │
│  │ Group Service│  │Search Service │                                  │
│  └──────────────┘  └──────────────┘                                  │
└────────────────────┬────────────────────────────────────────────────┘
                     │  (nessuna connessione diretta al wallet)
┌────────────────────▼────────────────────────────────────────────────┐
│                    WALLET DOMAIN (ISOLATO)                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Wallet Auth (PIN/Biometria)   Wallet Service   KYC Service │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────────┐
│                    DATA LAYER                                        │
│  PostgreSQL    Redis    Cassandra    S3-compatible Object Storage     │
│  Elasticsearch (search)    TimescaleDB (metrics/telemetry)           │
└─────────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────────┐
│                 INFRASTRUCTURE LAYER                                 │
│   Kubernetes (EKS/GKE)    Service Mesh (Istio)    Kafka              │
│   Prometheus + Grafana    Jaeger (tracing)    Vault (secrets)        │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 Principi Architetturali

**Separazione per dominio, non per layer tecnico**
Ogni servizio possiede il proprio modello di dati. Nessun servizio scrive direttamente nel database di un altro. La comunicazione avviene via eventi (Kafka) o chiamate API interne gRPC.

**Event sourcing per i messaggi**
I messaggi non vengono mai cancellati dal log primario — vengono marcati come eliminati. Questo garantisce integrità dell'audit, ripristino in caso di errori, e consistenza eventual nei delivery multi-device.

**CQRS per il chat service**
Separazione tra write path (invio messaggi) e read path (lettura feed). Il write path è ottimizzato per la latenza; il read path per il throughput. Questo permette scaling indipendente.

---

## 11. Database

### 11.1 Strategia Multi-Database

Nessun database è ottimale per tutti i workload. Alpha Chat usa il database giusto per ogni tipo di dato.

---

### PostgreSQL — Dati Relazionali e Strutturati

**Usato per:** utenti, profili, contatti, gruppi, impostazioni, relazioni

**Vantaggi:**
- ACID compliance per operazioni critiche (creazione account, gestione contatti)
- Query complesse con join quando necessario
- Maturità estrema, tooling eccellente, community vastissima
- Supporto nativo JSON per schemi semi-strutturati

**Svantaggi:**
- Non scala orizzontalmente in modo nativo (richiede Citus o read replicas)
- Non ottimale per write-heavy workload ad alto volume (messaggi)

**Motivazione:** Per i dati strutturati e relazionali (utenti, contatti, gruppi) la consistenza ACID è non negoziabile. PostgreSQL è la scelta industrialmente più solida per questo dominio. Si scala con read replicas per V1 e sharding con Citus per V3.

---

### Apache Cassandra — Messaggi

**Usato per:** il corpo dei messaggi, lo storico delle chat, lo stato di delivery

**Vantaggi:**
- Write throughput eccezionale (decine di migliaia di write/s per nodo)
- Scaling lineare orizzontale: aggiungere nodi aumenta proporzionalmente la capacità
- Modello di dati time-series-friendly, ottimale per storico messaggi paginato per tempo
- Alta disponibilità con replication factor configurabile (nessun single point of failure)
- Adottato da WhatsApp, Discord, Apple iMessage backbone per gli stessi motivi

**Svantaggi:**
- Nessun join, nessuna transazione cross-partition nativa
- Il modello di dati deve essere progettato intorno ai query pattern (denormalized by design)
- Eventual consistency: richiede gestione attenta del conflict resolution lato applicativo
- Curva di apprendimento ripida per il data modeling corretto

**Motivazione:** I messaggi sono un workload write-heavy time-series. Discord ha migrato da MongoDB a Cassandra quando ha raggiunto la scala. WhatsApp usa Mnesia (Erlang) per la stessa ragione. Per V1 si può iniziare con PostgreSQL partizionato e migrare a Cassandra quando il volume lo richiede, ma la progettazione dello schema deve anticipare questa migrazione.

**Schema chiave (semplificato):**
```
Table: messages
Partition key: (conversation_id)
Clustering key: (created_at DESC, message_id)
```
Questo garantisce che tutti i messaggi di una conversazione stiano nello stesso nodo e siano naturalmente paginati per tempo.

---

### Redis — Cache e Real-time State

**Usato per:** sessioni attive, presence (online/offline), contatori non letti, rate limiting, distributed locks, pub/sub per notifiche real-time intra-service

**Vantaggi:**
- Latenza sub-millisecondo per operazioni in-memory
- Data structures native (sorted sets per code, hash per sessioni, hyperloglog per contatori approssimati)
- Pub/Sub nativo per broadcasting eventi ai WebSocket gateway
- Redis Cluster per scaling orizzontale

**Svantaggi:**
- Dati in-memory: capacità limitata dal RAM disponibile
- Persistence opzionale ma non primary — non sostituisce un DB persistente
- Costo infrastrutturale elevato a grandi scale (RAM costosa vs disk)

**Motivazione:** La presenza degli utenti (online/offline/last seen) deve essere letta con latenza < 50ms su ogni richiesta di chat. Redis è l'unica tecnologia che garantisce questo a scala. È la scelta standard nell'industria per questo workload (usata da Twitter, Instagram, Slack, GitHub).

---

### Elasticsearch — Ricerca Full-Text

**Usato per:** ricerca messaggi, ricerca utenti, ricerca gruppi

**Vantaggi:**
- Ricerca full-text con rilevanza, fuzzy matching, highlighting
- Scala orizzontalmente nativamente
- Query DSL potente per filtri combinati (per mittente, data, tipo contenuto)

**Svantaggi:**
- Non è il source of truth — è un indice derivato
- Richiede pipeline di sync dai DB primari (latenza accettabile: ~1s)
- Resource-intensive (heap JVM, RAM)
- Complessità operativa non trascurabile

**Motivazione:** La ricerca è una funzionalità critica per la retention (gli utenti cercano informazioni condivise mesi fa). PostgreSQL full-text search (tsvector) è sufficiente per V1 se il volume è basso. Elasticsearch entra in produzione per V2 quando il volume di messaggi indicizzati supera il threshold di performance di PostgreSQL.

---

### S3-Compatible Object Storage — Media

**Usato per:** foto, video, documenti, audio, backup cifrati

**Vantaggi:**
- Costo per GB ordini di grandezza inferiore a block storage o database
- Scaling virtualmente illimitato
- CDN-ready nativamente (CloudFront, Cloudflare)
- Standard de facto dell'industria con molteplici provider (AWS S3, GCP GCS, MinIO self-hosted)

**Svantaggi:**
- Non adatto per dati transazionali
- Latenza più alta del DB per metadati (compensata dal CDN per i download)

**Motivazione:** Tutti i binary large objects devono vivere in object storage. Non farlo è uno degli errori architetturali più costosi da correggere a posteriori. Il riferimento all'oggetto (URL cifrato o path) sta nel database; il contenuto sta nell'object store.

---

### 11.2 Separazione Database Wallet

Il database del wallet è fisicamente separato dai database di messaggistica:
- Cluster PostgreSQL dedicato, in una VPC separata
- Nessuna replication cross-domain
- L'unica FK esterna è lo `user_id`, che è un identificatore opaco senza dati di comunicazione
- Audit log immutabile di tutte le transazioni (append-only, nessun DELETE permesso)

---

## 12. Backend

### 12.1 Stack Tecnologico

**Lingua principale: Go (Golang)**

**Vantaggi:**
- Performance nativa vicina al C per workload I/O-bound (messaging, WebSocket handling)
- Goroutine: concorrenza economica — gestire decine di migliaia di connessioni simultanee con memoria limitata
- Compilato, deployment di binari statici senza dependency hell
- Type safety senza garbage collection unpredictable (GC pause < 1ms nella maggior parte dei casi)
- Standard library eccellente per networking e HTTP
- Adottato da Docker, Kubernetes, Cloudflare, Dropbox, Uber per gli stessi motivi

**Svantaggi:**
- Error handling verboso (no exceptions, no Result type — pre Go 1.20)
- Ecosistema ORM meno maturo di Java/Python/Node
- Generics solo da Go 1.18 — ecosystem non ancora allineato
- Meno sviluppatori disponibili rispetto a Node.js o Python

**Motivazione:** Per un sistema che deve gestire milioni di connessioni WebSocket concorrenti, Go è la scelta industrialmente più solida. WhatsApp ha dimostrato che Erlang/OTP è altrettanto valido per la messaggistica (2 milioni di connessioni per server). Tra Erlang e Go, Go ha un ecosistema più ampio, tooling migliore per sviluppatori moderni, e performance comparabili.

**Alternativa considerata:** Node.js/TypeScript
- Pro: ecosistema vasto, sviluppatori più disponibili, stessa concorrenza async
- Contro: single-threaded event loop non ideale per CPU-bound tasks, GC non deterministico, deploy più complesso

---

### 12.2 Struttura dei Servizi

**API Gateway**
- Routing, rate limiting, autenticazione JWT, logging, CORS
- Tecnologia: Nginx + custom middleware Go, o Kong/Traefik per V2
- Unico punto di ingresso per i client HTTP

**WebSocket Gateway**
- Gestisce la connessione persistente di ogni client
- Responsabile di: routing messaggi in arrivo al servizio corretto, fan-out messaggi in uscita ai client connessi
- Stateless respect all'applicazione (il "chi è connesso" sta in Redis)
- Auto-scaling: aggiungere nodi WebSocket Gateway aumenta linearmente la capacità

**Chat Service**
- Responsabile di: persisting messages, delivery status tracking, conversation management
- Legge/scrive su Cassandra per i messaggi
- Pubblica eventi su Kafka per: notifiche, search indexing, analytics

**User Service**
- CRUD utenti, profili, impostazioni
- Source of truth: PostgreSQL
- Cache profili frequenti in Redis (TTL 5 minuti)

**Auth Service**
- Vedi sezione [Sistema Autenticazione](#sistema-autenticazione)

**Media Service**
- Upload presigned URL generation (il client carica direttamente su S3, non passa per il backend)
- Validazione e transcoding asincrono (video thumbnail, resize foto, virus scan documenti)
- Delivery via CDN

**Notification Service**
- Vedi sezione [Sistema Notifiche](#sistema-notifiche)

**Group Service**
- Gestione membership, permessi, inviti
- Operazioni atomiche su PostgreSQL per consistency

**Call Service**
- Vedi sezione [Sistema Chiamate e Videochiamate](#sistema-chiamate)

**Search Service**
- Consumer Kafka per indicizzare messaggi in Elasticsearch
- API di ricerca full-text

---

### 12.3 Comunicazione Inter-Service

**Sincrona (gRPC):** per operazioni che richiedono risposta immediata (autenticazione, verifica permessi)
- Proto definitions come source of truth dei contratti
- Mutual TLS tra servizi (mTLS via Istio service mesh)

**Asincrona (Apache Kafka):** per eventi che non richiedono risposta immediata (notifiche, indicizzazione, analytics, audit log)
- Ogni servizio pubblica eventi nei propri topic
- Consumatori indipendenti — il produttore non conosce i consumatori
- Retention configurabile per replay in caso di failure

**Vantaggi di questo approccio:**
- Loose coupling: i servizi possono essere deployati, aggiornati, scalati indipendentemente
- Resilienza: un consumer lento o down non blocca il produttore
- Auditabilità: il log Kafka è una sequenza temporale immutabile di tutto quello che è successo

**Svantaggi:**
- Complessità operativa: Kafka richiede gestione, monitoring, tuning
- Eventual consistency: le notifiche possono arrivare con ritardo se il sistema è sotto carico
- Debugging distribuito più complesso (richiede tracing con Jaeger/OpenTelemetry)

---

## 13. Frontend

### 13.1 Strategia Multi-Platform

Alpha Chat adotta un approccio **native-first con shared business logic**.

**Mobile: React Native + Expo**

**Vantaggi:**
- Un codebase per iOS e Android (~80% del codice condiviso)
- Performance nativa per UI critica (messaggi, liste) tramite New Architecture (JSI, Fabric)
- Accesso completo alle API native (notifiche, contatti, camera, biometria)
- OTA updates senza passare per App Store review (Expo EAS Update)
- Community vasta, componenti esistenti di qualità

**Svantaggi:**
- Non è "native puro" — per componenti ultra-performance potrebbe servire codice nativo C++/Swift/Kotlin (raro ma possibile)
- Bundle size più grande di una native app
- Debugging più complesso di una codebase nativa

**Motivazione:** WhatsApp e Facebook usano React Native per componenti critici. Il compromesso tra velocità di sviluppo e performance è ottimale per V1. I componenti critici (lista messaggi, input) possono essere reimplementati in native per V2 se necessario.

**Web: React + Vite**

**Vantaggi:**
- Stesso framework del mobile (React) → shared hooks, utilities, business logic
- Vite: DX eccellente, build velocissimi, HMR istantaneo
- PWA supporto: installabile, offline-capable, notifiche push

**Desktop (V2): Electron o Tauri**

Tauri preferito su Electron per bundle size drammaticamente più piccolo (< 10MB vs > 100MB) e utilizzo memoria inferiore. Usa il web renderer nativo della piattaforma.

---

### 13.2 State Management

**Zustand per stato locale/globale UI**
- Leggero, senza boilerplate di Redux
- API semplice basata su hook
- Adottato da Figma, Vercel, Supabase

**React Query / TanStack Query per server state**
- Caching automatico, background refetch, ottimistic updates
- Separazione netta tra "dati che vengono dal server" e "stato UI"

**WebSocket via custom hook**
- Connessione singola per sessione, gestita centralmente
- Messaggi in arrivo vengono pushati nello store Zustand della chat relativa
- Reconnection automatica con exponential backoff

---

### 13.3 Performance Frontend

**Virtualizzazione delle liste:** React Native FlatList con `windowSize` ottimizzato, Web con react-virtual (TanStack Virtual). Nessuna chat carica più di 50 messaggi in DOM — gli altri sono smontati e rimontati on demand.

**Lazy loading:** ogni chat è un module bundle separato. L'app carica solo la schermata attiva.

**Ottimistic updates:** quando invii un messaggio, appare immediatamente nella UI con stato "sending". Se il server fallisce, torna a "failed" con opzione di retry. La latenza percepita è zero.

**Service Worker (Web):** caching delle risorse statiche, background sync, push notifications. L'app funziona offline per leggere messaggi già ricevuti.

---

## 14. API

### 14.1 Dual Protocol

Alpha Chat usa due protocolli per due workload diversi:

**REST over HTTPS — Operazioni stateless**
- Autenticazione, registrazione, gestione profilo, impostazioni, ricerca
- Standard OpenAPI 3.1 per la documentazione e la generazione automatica dei client
- Versioning via URL path: `/v1/`, `/v2/`
- Autenticazione: Bearer JWT (access token short-lived 15 minuti + refresh token 30 giorni)

**WebSocket — Real-time messaging**
- Connessione persistente per ogni sessione client attiva
- Protocollo binario MessagePack (più compatto di JSON, più leggibile di protobuf per debugging)
- Ogni frame ha: `type`, `payload`, `sequence_number` (per ordering e deduplication)
- Heartbeat ogni 30 secondi per keepalive (rilevazione connessioni zombie)

**gRPC — Comunicazione internal (non esposta al client)**
- Solo tra microservizi backend
- Proto definitions versionati nel repo

---

### 14.2 API Design Principles

**Idempotenza:** ogni operazione di write ha un `client_message_id` (UUID v4 generato dal client). Se il client rimanda per retry, il server riconosce il duplicate e ritorna lo stesso risultato senza effetti collaterali.

**Motivazione:** Nei sistemi di messaging con retry automatici, senza idempotenza si creano messaggi duplicati. Questa è una delle cause più frequenti di bug visibili agli utenti nelle piattaforme di messaging.

**Pagination cursor-based:** tutte le liste paginate usano cursori opachi (base64 di timestamp + id) invece di offset numerici. Gli offset sono instabili quando i dati cambiano — si perdono elementi o si vedono duplicati.

**Rate limiting:** per endpoint con write (invio messaggi, caricamento media) con sliding window per user_id. Per endpoint di autenticazione con limite più stretto e blocco progressivo.

**API Gateway Authentication Flow:**
```
Client → API Gateway → JWT validation → Service
                     ↑
                  Auth Service (solo per token refresh)
```

---

## 15. Sistema Notifiche

### 15.1 Architettura

Le notifiche sono una pipeline **event-driven a più stadi**:

```
Chat Service → Kafka (topic: message.delivered) → Notification Service → Push Provider
                                                                       → WebSocket (se online)
```

### 15.2 Logica di Delivery

**Se il destinatario è online (WebSocket attiva):**
- Il messaggio arriva via WebSocket in real-time
- Nessuna push notification inviata (riduce il rumore)

**Se il destinatario è offline:**
- La push notification viene inviata dopo un delay configurabile (default: 0s)
- Se il dispositivo è raggiungibile, arriva entro 3 secondi (APNs/FCM latenza media)

**Se il destinatario è in DND/muted:**
- La notifica è "silent" (aggiorna il badge senza suono né banner) su iOS
- Android: inviata al notification channel configurato con importanza LOW

### 15.3 Provider Push

**iOS: APNs (Apple Push Notification service)**
- Motivazione: obbligatorio per notifiche affidabili su iOS. Non esiste alternativa per notifiche background su iOS.
- Auth: APNs Token-based authentication (più sicuro e flessibile dei certificati)

**Android: FCM (Firebase Cloud Messaging)**
- Motivazione: standard de facto su Android. Disponibile su tutti i dispositivi Android con Google Services.
- Per dispositivi senza Google Services (Huawei): Huawei Push Kit come fallback.

**Web: Web Push Protocol (RFC 8030)**
- Standard aperto, non vendor-locked
- Supportato da tutti i browser moderni tramite Service Worker

### 15.4 Privacy delle Notifiche

Le notifiche **non includono il testo del messaggio** nel payload push per default. Il payload push contiene solo: `conversation_id`, `sender_id` (opaco), `notification_type`. Il testo viene mostrato solo se il client lo ha già ricevuto via WebSocket e il sistema operativo supporta la notification extension locale (iOS) o Notification Service Extension.

**Motivazione:** I payload push transitano per i server di Apple/Google. Non inviare il testo del messaggio nei payload push è una misura di privacy fondamentale (adottata da Signal, che mostra solo "Nuovo messaggio" senza nemmeno il mittente).

---

## 16. Sistema Gruppi

### 16.1 Tipologie

**Gruppo Standard** (V1)
- Fino a 500 partecipanti
- E2E encrypted (multi-party: Signal Protocol con sender keys)
- Admin e partecipanti, con permessi configurabili

**Gruppo Esteso / Community** (V2)
- Fino a 10.000 partecipanti
- Non E2E encrypted (tecnicamente impraticabile a questa scala con E2E multi-party)
- Encryption in transit e at rest lato server
- Sub-canali tematici

### 16.2 Crittografia nei Gruppi

La crittografia E2E in un gruppo è più complessa che in una chat 1-to-1. Alpha Chat usa il **Signal Protocol con Sender Keys** (lo stesso meccanismo usato da WhatsApp e Signal per i gruppi).

**Come funziona:**
1. Ogni membro del gruppo genera una Sender Key (SK) per quel gruppo
2. La SK viene distribuita (cifrata con la chiave pubblica di ogni membro) a tutti i partecipanti
3. Ogni messaggio è cifrato con la SK del mittente
4. I destinatari decifrano con la SK del mittente che già possiedono

**Vantaggio vs cifratura per ogni membro:** Con 500 partecipanti, cifrare un messaggio per ogni membro richiederebbe 500 operazioni di cifratura. Con Sender Keys, il mittente cifra una volta sola.

**Svantaggio:** Quando un nuovo membro entra nel gruppo, tutti i partecipanti devono rigenerare e redistribuire le Sender Keys. Questo richiede un evento di sincronizzazione (gestito trasparentemente dal protocollo).

### 16.3 Permessi e Amministrazione

Ruoli: **Owner → Admin → Membro**

Permessi configurabili per gruppo:
- Chi può aggiungere membri (tutti / solo admin)
- Chi può modificare le info del gruppo (tutti / solo admin)
- Chi può inviare messaggi (tutti / solo admin — modalità broadcast)
- Approvazione richiesta per nuovi membri

### 16.4 Inviti

**Link di invito:** URL con token criptato, revocabile dall'admin
**Invito diretto:** notifica al destinatario con chi invita e preview del gruppo
**QR code:** per aggiunta in presenza fisica

---

## 17. Sistema Media

### 17.1 Upload Flow

Alpha Chat usa un pattern di **presigned URL upload** per evitare che i media transitino per i server backend:

```
1. Client → API: "Voglio caricare un file di tipo X, dimensione Y"
2. API → Media Service: genera presigned URL S3 (TTL: 5 minuti)
3. Media Service → API → Client: URL firmato
4. Client → S3: upload diretto (nessun backend coinvolto nel trasferimento)
5. Client → API: "Upload completato, allega a messaggio ID Z"
6. Media Service: valida integrità (hash), avvia post-processing asincrono
```

**Vantaggi:**
- I server backend non vengono saturati dal bandwidth dei file
- Scaling del media upload è indipendente dal backend (S3 scala infinitamente)
- Costo infrastrutturale nettamente inferiore

**Svantaggi:**
- Flusso più complesso da implementare e debuggare
- Il client deve gestire due chiamate API invece di una
- Richiede configurazione CORS corretta su S3

### 17.2 Post-Processing Asincrono

Dopo l'upload, una pipeline asincrona (Kafka consumer + worker pool) esegue:

- **Immagini:** resize adattivo (3 dimensioni: thumbnail 100px, preview 800px, originale), strip EXIF metadata (rimuove GPS e info dispositivo per privacy), virus scan
- **Video:** generazione thumbnail, transcoding in H.264 a bitrate adattivo (480p/720p/1080p), estrazione durata
- **Documenti:** virus scan, estrazione testo per ricerca (solo su documento non cifrato E2E)
- **Audio:** waveform generation per la visualizzazione durante la riproduzione

### 17.3 Encryption dei Media E2E

Per i media in chat E2E encrypted:
- Il client cifra il file prima dell'upload con una chiave simmetrica AES-256-GCM generata localmente
- La chiave simmetrica è cifrata con le chiavi dei destinatari (come il testo)
- Il server conserva solo il blob cifrato — non può accedere al contenuto
- Il server non può eseguire virus scan su contenuti E2E (trade-off esplicito)

**Motivazione della scelta:** Non è possibile fare virus scan server-side su contenuti E2E cifrati senza spezzare la E2E. Signal ha scelto lo stesso trade-off. L'alternativa (client-side scan con hash lookup su database cloud) compromette la privacy. Per V1, il trade-off è accettabile.

### 17.4 Quotas e Limiti

- Dimensione massima singolo file: 100MB (V1), 2GB (V2)
- Storage per utente: illimitato (sostenuto da object storage economics)
- Scadenza media nelle chat E2E: opzionale, configurabile per chat

---

## 18. Sistema Chiamate

### 18.1 Architettura VoIP

Le chiamate audio usano **WebRTC** con un'architettura a due modalità:

**Peer-to-peer (P2P) — default quando possibile**
```
Caller ←────────── WebRTC ──────────→ Callee
         (NAT traversal via STUN/TURN)
```

**Server-mediated via SFU — quando P2P non è possibile**
```
Caller ──→ SFU ──→ Callee
```

**STUN (Session Traversal Utilities for NAT):** permette ai client di scoprire il proprio indirizzo IP pubblico e tipo di NAT. In molti casi (NAT di tipo "full cone" o "restricted cone") è sufficiente per stabilire P2P. Nessun media transita per il server STUN.

**TURN (Traversal Using Relays around NAT):** quando il NAT è simmetrico o di tipo enterprise (molto comune in reti aziendali), P2P non è possibile. Il TURN server fa da relay. I media transitano per il server, quindi TURN servers devono essere considerati trusted infrastructure.

**Motivazione:** Le chiamate WebRTC P2P non transitano per i server Alpha Chat. Questo è un vantaggio sia di privacy che di costo infrastrutturale. Il TURN fallback è necessario per coprire ~20–30% dei casi reali (enterprise networks, carrier-grade NAT).

### 18.2 E2E Encryption delle Chiamate

WebRTC utilizza **DTLS-SRTP** (Datagram TLS + Secure Real-time Transport Protocol) per cifrare ogni stream audio/video. Questo è il meccanismo standard di sicurezza di WebRTC.

Per aggiungere E2E verifica dell'identità (prevenire un man-in-the-middle da parte del server TURN), Alpha Chat implementa il **DTLS fingerprint exchange tramite il canale di signaling cifrato** (già E2E via Signal Protocol). Se i fingerprint combaciano, la chiamata è verificata E2E.

**Questo è lo stesso meccanismo usato da Signal per le chiamate.**

### 18.3 Call Signaling

Il signaling (scambio di SDP offer/answer, ICE candidates) avviene tramite la connessione WebSocket già attiva. Non è un sistema separato — è un tipo speciale di messaggio nel canale esistente.

Flusso:
```
1. Caller: invia "CALL_OFFER" via WebSocket
2. Callee: interfaccia mostra chiamata in ingresso
3. Callee: accetta → invia "CALL_ANSWER" + ICE candidates
4. Caller: riceve → invia propri ICE candidates
5. WebRTC handshake → media stream P2P
```

### 18.4 Chiamate di Gruppo (Audio)

Per chiamate con più di 2 partecipanti, la P2P mesh non scala (4 partecipanti = 6 connessioni bidirezionali). Si usa un **SFU (Selective Forwarding Unit)**:

- Ogni partecipante ha una connessione con l'SFU
- L'SFU riceve tutti gli stream e li invia a tutti i partecipanti
- L'SFU non decifra i media (Insertable Streams WebRTC per mantenere E2E)

**Tecnologia SFU consigliata:** mediasoup (Node.js, open source) o LiveKit (Go, open source). LiveKit è preferito per V1 per l'ecosistema più moderno e il supporto nativo a E2E via Insertable Streams.

---

## 19. Sistema Videochiamate

### 19.1 Differenze rispetto alle chiamate audio

La videochiamata usa la stessa infrastruttura WebRTC/SFU ma con requisiti aggiuntivi:

**Adaptive bitrate (ABR):**
- Il client monitora la qualità della connessione (packet loss, jitter, RTT)
- Il bitrate video si adatta dinamicamente: da 100kbps (connessione debole) a 2Mbps (connessione ottima)
- Questo garantisce che la chiamata non si interrompa in condizioni di rete degradate

**Simulcast:**
- Il mittente invia lo stesso video a 3 qualità diverse simultaneamente (180p, 480p, 720p)
- L'SFU sceglie quale qualità inviare a ciascun destinatario in base alla sua connessione
- Questo è fondamentale per le videochiamate di gruppo dove diversi partecipanti hanno connessioni diverse

**Motivazione Simulcast vs Transcoding:** Il transcoding server-side è costoso (CPU) e introduce latenza. Simulcast sposta il costo computazionale sul mittente (ammortizzato su tutti i destinatari) ed elimina la latenza di transcoding. Zoom usa simulcast. Google Meet usa simulcast.

### 19.2 Layout Adattivo

L'interfaccia della videochiamata si adatta al numero di partecipanti:
- 1-to-1: fullscreen con overlay controlli
- 3-4 partecipanti: grid 2x2
- 5-8 partecipanti: "speaker view" (chi parla è grande, altri in striscia)
- 9+ partecipanti: solo audio in V1, video opzionale in V2

### 19.3 Effetti (V2)

- Background blur (on-device, TensorFlow Lite)
- Virtual background
- Noise cancellation (RNNoise, open source, on-device)

---

## 20. Sistema Username

### 20.1 Design

Alpha Chat identifica gli utenti principalmente tramite **username**, non numero di telefono.

**Formato:** `@nomeutente` — da 3 a 32 caratteri, alfanumerici e underscore, case-insensitive (salvato lowercase)

**Unicità:** globale, unica per piattaforma

**Modificabilità:** l'username può essere cambiato, ma con un cooldown di 14 giorni per prevenire "username squatting" e confusione nei contatti

**Discovery:** gli utenti possono essere trovati cercando il loro username esatto. La ricerca parziale è opzionale e off per default (privacy-first).

### 20.2 Numero di Telefono Opzionale

A differenza di WhatsApp (numero obbligatorio) e Telegram (numero obbligatorio ma nascondibile), Alpha Chat offre due modalità di registrazione:

**Registrazione con email + password + 2FA**
- Non richiede numero di telefono
- Migliore per chi usa Alpha Chat su desktop come primario
- Recovery tramite email con verification link

**Registrazione con numero di telefono**
- OTP via SMS per verifica
- Numero visibile solo all'utente (mai mostrato ad altri utenti di default)
- Opzionale: connessione ai contatti telefonici locali per trovare chi usa già Alpha Chat

**Motivazione della scelta:** Il numero di telefono è un identificatore PII persistente che non può essere cambiato facilmente. Richiedere il telefono esclude utenti senza SIM, in regioni con costi SMS elevati, o privacy-sensitive. Signal e Telegram stanno entrambi transitando verso username-based identity per gli stessi motivi. Alpha Chat parte già con questa architettura.

**Svantaggi dell'approccio username-first:**
- Più sforzo per trovare i propri contatti (no auto-discovery via rubrica)
- Rischio di username già presi da altri utenti (bisogna gestire l'escrow)
- Recupero account più complesso in caso di perdita email (richede 2FA robusto)

---

## 21. Sistema Autenticazione

### 21.1 Stack di Autenticazione

**JWT (JSON Web Tokens) — Access Token**
- Short-lived: 15 minuti
- Contiene: user_id, device_id, iat, exp, scope
- Firmato con ECDSA P-256 (più efficiente di RSA, sicurezza equivalente)
- Stateless: ogni servizio può validarlo senza chiamare l'Auth Service

**Opaque Refresh Token — Sessione**
- Long-lived: 30 giorni con sliding window
- Conservato in database Auth Service (revocabile server-side)
- Ogni device ha il proprio refresh token
- Rotazione automatica: ogni uso genera un nuovo token e invalida il precedente

**Motivazione della scelta JWT + Refresh Token:**
- JWT stateless permette scalabilità: nessun lookup su DB per ogni richiesta autenticata
- La short lifetime (15 minuti) limita il danno se un access token viene compromesso
- Il refresh token su DB permette logout remoto (utile se il dispositivo è perso o rubato)

### 21.2 Multi-Device

Ogni device autenticato ha:
- Un device_id univoco (UUID v4)
- Il proprio refresh token
- Una coppia di chiavi crittografiche (per Signal Protocol)

Il "device registrato" è visibile nell'impostazioni. L'utente può de-autenticare qualsiasi device remoto, il che invalida il suo refresh token e revoca il suo accesso.

### 21.3 2FA / MFA

**TOTP (Time-based OTP):** compatibile con Google Authenticator, Authy, 1Password. Standard RFC 6238. Raccomandato come default per tutti.

**Backup codes:** 10 codici monouso generati all'attivazione del 2FA, da conservare offline.

**Passkeys (WebAuthn):** supporto per V2. Permette accesso biometrico senza password su dispositivi compatibili. È il futuro dell'autenticazione consumer.

**SMS OTP:** solo per recovery, mai come 2FA primario.

**Motivazione:** Il 2FA via SMS è vulnerabile a SIM-swapping attacks. Alpha Chat supporta SMS solo come recovery fallback e spinge l'utente verso TOTP o Passkeys.

### 21.4 Session Security

- Il cookie del refresh token ha flag: `HttpOnly` (non accessibile da JavaScript), `Secure` (solo HTTPS), `SameSite=Strict`
- Ogni login registra: device info, IP anonimizzato (ultimo ottetto rimosso), timestamp
- Anomaly detection: login da nuovo paese → notifica email + challenge 2FA

---

## 22. Sicurezza

### 22.1 Crittografia End-to-End — Signal Protocol

Alpha Chat usa il **Signal Protocol** per la crittografia E2E, lo stesso protocollo usato da Signal, WhatsApp e Google Messages.

**Perché Signal Protocol:**
- Apertura: specifiche pubbliche, implementazioni open source con audit indipendenti
- Forward secrecy: anche se la chiave privata a lungo termine è compromessa, i messaggi passati rimangono cifrati (ogni sessione usa chiavi ephemere)
- Break-in recovery: dopo una compromissione, il protocollo ripristina la sicurezza automaticamente (double ratchet)
- Deniability: crittograficamente, nessuno può provare a terzi che un messaggio è stato scritto da un utente specifico (plausible deniability by design)

**Componenti del Signal Protocol:**
- **X3DH (Extended Triple Diffie-Hellman):** key agreement iniziale per stabilire la sessione
- **Double Ratchet Algorithm:** gestione delle chiavi di sessione in modo che ogni messaggio usi una chiave diversa
- **Curve25519:** curva ellittica per ECDH (scambio chiavi)
- **AES-256-CBC + HMAC-SHA256 (o ChaCha20-Poly1305):** cifratura simmetrica dei messaggi

**Scelta di non sviluppare algoritmi proprietari:**
Non si sviluppano algoritmi crittografici proprietari. Signal Protocol ha anni di scrutinio pubblico, audit da università e ricercatori indipendenti, e implementazioni di riferimento certificate. Un algoritmo proprietario, per quanto tecnicamente brillante, richiede anni di revisione pubblica prima di potersi fidare. Questo è un principio di sicurezza fondamentale: la sicurezza non deve dipendere dalla segretezza dell'algoritmo (Kerckhoffs's principle).

### 22.2 Transport Security

**TLS 1.3 obbligatorio** per tutte le connessioni (HTTP, WebSocket, gRPC)
- TLS 1.2 non accettato (vulnerabilità note non mitigabili by design)
- Certificate pinning nelle app mobile per prevenire MITM con certificati fraudolenti
- HSTS preloading per il dominio web

**Motivazione:** TLS 1.3 elimina le cipher suites vulnerabili presenti in TLS 1.2, riduce il numero di round trip del handshake (da 2 a 1), e la forward secrecy è obbligatoria (non opzionale come in TLS 1.2).

### 22.3 Sicurezza dell'Infrastruttura

**Zero Trust Network Architecture**
- Nessun servizio si fida implicitamente di un altro servizio per il fatto di essere nella stessa rete
- Ogni chiamata inter-service richiede mTLS (mutual TLS) e autorizzazione esplicita via service mesh (Istio)
- Principio del minimo privilegio: ogni servizio ha accesso solo alle risorse che gli servono

**Secret Management — HashiCorp Vault**
- Nessuna secret è hardcodata in codice o in variabili d'ambiente statiche
- Le secret vengono iniettate dinamicamente al runtime tramite Vault
- Database credentials rotated automaticamente ogni 24h
- Audit log immutabile di ogni accesso a ogni secret

**Container Security**
- Container rootless (non eseguono come root)
- Image scanning automatico nel CI pipeline (Trivy, Snyk)
- Read-only filesystem per i container dove possibile
- Network policies Kubernetes: ogni pod può comunicare solo con i pod autorizzati

### 22.4 Protezione dai Dati

**GDPR Compliance by Design**
- Ogni dato ha un retention policy esplicita
- Data Subject Access Request (DSAR): utente può scaricare tutti i suoi dati in formato machine-readable
- Right to deletion: account deletion entro 30 giorni rimuove tutti i dati (eccetto quanto richiesto per compliance legale)
- Data minimization: si raccolgono solo i dati necessari per la funzionalità

**Nessuna pubblicità, nessun tracking comportamentale**
Questi non sono solo principi morali — sono scelte architetturali che semplificano la compliance e riducono la superficie di attacco.

### 22.5 Vulnerability Disclosure

**Responsible Disclosure Program pubblico** con:
- Hall of fame per i ricercatori
- Ricompense per vulnerabilità critiche (Bug Bounty)
- SLA di risposta: 24h per critical, 72h per high, 7 giorni per medium
- Partnership con Hacker One per gestione

### 22.6 Audit di Sicurezza

Audit indipendenti annuali obbligatori:
- Penetration test dell'infrastruttura (red team esterno)
- Code audit del codice crittografico (firma specializzata in cryptography)
- Audit del protocollo di autenticazione
- Risultati pubblicati integralmente (con remediation timeline)

---

## 23. Scalabilità

### 23.1 Obiettivi di Scala

| Metrica | V1 Target | V2 Target | V3 Target |
|---|---|---|---|
| Utenti registrati | 1M | 10M | 100M |
| DAU | 200K | 2M | 20M |
| Messaggi/giorno | 50M | 500M | 5B |
| Connessioni WebSocket concorrenti | 100K | 1M | 10M |
| Latenza P99 invio messaggio | < 500ms | < 300ms | < 200ms |
| Disponibilità | 99.9% | 99.95% | 99.99% |

### 23.2 Scaling Strategy per Layer

**WebSocket Gateway — Horizontal Scaling**
- Stateless: il "chi è connesso dove" sta in Redis
- Auto-scaling basato su numero connessioni attive (HPA Kubernetes)
- Load balancer L4 con sticky sessions per WebSocket (necessario per la durata della connessione)

**Chat Service — CQRS + Cassandra**
- Write path: ogni nodo Chat Service scrive su Cassandra (già distribuito)
- Read path: servito da replica read Cassandra + cache Redis L1
- Scaling orizzontale del Chat Service senza stato condiviso

**Media Service — Queue-based autoscaling**
- Il post-processing è computazionalmente intensivo ma non latency-sensitive
- Kafka queue + worker pool che scala in base alla profondità della queue
- In periodi di picco, i worker scalano; in periodi calmi, scendono a zero

**Database Scaling**
- PostgreSQL: read replicas per V1, sharding orizzontale (Citus) per V2
- Cassandra: aggiungere nodi aumenta linearmente throughput e capacità
- Redis: Redis Cluster per distribuzione dei key spaces

### 23.3 Multi-Region

**Per V2:** deployment in almeno 2 regions (EU, US-East)
- Gli utenti vengono serviti dalla region geograficamente più vicina
- I dati di messaggistica sono replicati across regions con latency accettabile (~100ms)
- Failover automatico: se una region è down, il traffico migra all'altra entro 60 secondi

**Data sovereignty:** utenti EU vengono serviti da datacenter EU (requisito GDPR). I dati non lasciano l'EU senza consenso esplicito.

### 23.4 Resilienza e Chaos Engineering

**Circuit Breaker Pattern**
- Se un microservizio risponde lentamente, il circuit breaker apre e ritorna un errore veloce invece di saturare il thread pool
- Impedisce che il problema di un servizio si propaghi a cascata agli altri

**Retry con Exponential Backoff + Jitter**
- Le retry automatiche non martellano un servizio già in difficoltà
- Il jitter (variazione random del delay) distribuisce i retry nel tempo

**Chaos Engineering**
- Fault injection regolare in staging: si uccidono random pod, si degradano connessioni di rete, si simulano latenze
- Verifica che il sistema si comporti come previsto in condizioni avverse prima che accadano in produzione

---

## 24. Piano di Sviluppo

### 24.1 Team e Struttura

**Team core per V1 (12–15 persone):**

| Ruolo | N | Responsabilità |
|---|---|---|
| Engineering Manager/CTO | 1 | Technical strategy, hiring, stakeholder |
| Backend Engineers (Go) | 4 | Chat Service, Auth Service, Media Service, API |
| Frontend Engineers (React Native) | 3 | iOS/Android apps |
| Frontend Engineer (Web) | 1 | Web app |
| DevOps / Infrastructure | 2 | Kubernetes, CI/CD, monitoring |
| Security Engineer | 1 | Protocol review, pentest coordination, vault |
| Product Designer | 1 | Design system, UX flow, UI |
| QA Engineer | 1 | Test automation, regression suite |

**Wallet team (separato, avviato a partire da M8):**
- 2 Backend Engineers specializzati in fintech
- 1 Compliance/KYC specialist
- 1 Security specialist pagamenti

### 24.2 Metodologia

**Sprint da 2 settimane** con:
- Planning (inizio sprint): prioritizzazione tasks, stima
- Daily standup (15 minuti): blockers e dipendenze
- Review (fine sprint): demo funzionalità a stakeholder
- Retrospettiva (fine sprint): miglioramento processo

**Definition of Done per ogni feature:**
- Funzionalità implementata e manuale testata
- Test automatici scritti (unit + integration)
- Code review approvata da almeno 1 peer
- Documentazione API aggiornata
- Monitoring/alerting configurato
- Nessuna regressione nel test suite

### 24.3 Infrastructure First

Prima di qualsiasi development applicativo:
1. CI/CD pipeline funzionante (GitHub Actions → staging deploy automatico)
2. Monorepo struttura definita
3. Staging environment con parità produzione
4. Secrets management (Vault) operativo
5. Monitoring (Prometheus + Grafana) e tracing (Jaeger) configurati
6. Database provisioned e backup configurati

Questo costo iniziale (~3 settimane) è non negoziabile. Le startup che skippano l'infrastruttura per andare veloci pagano 10x il costo quando devono recuperare a sistema in produzione.

---

## 25. Roadmap Milestone V1

```
TIMELINE: 12 MESI DALLA DATA DI KICK-OFF
═══════════════════════════════════════════════════════════════════════

FASE 0 — FONDAMENTA (Mese 1–2)
────────────────────────────────
M0.1 [Settimana 1-2]    Kickoff, definizione tecnica definitiva, hiring
M0.2 [Settimana 2-3]    Setup monorepo e repository
M0.3 [Settimana 3-4]    CI/CD pipeline (GitHub Actions → staging)
M0.4 [Settimana 4-6]    Infrastructure: Kubernetes cluster, Vault, monitoring
M0.5 [Settimana 5-6]    Database provisioning e schema iniziale
M0.6 [Settimana 6-8]    Design System v0: token, componenti base, design file
                         ▶ MILESTONE: Infrastructure ready, team onboarded

FASE 1 — AUTH + IDENTITY (Mese 2–3)
──────────────────────────────────────
M1.1 [Settimana 8-10]   Auth Service: registrazione email + TOTP 2FA
M1.2 [Settimana 9-10]   Auth Service: registrazione telefono + SMS OTP
M1.3 [Settimana 10-11]  Username system: claim, unicità, ricerca
M1.4 [Settimana 11-12]  Multi-device: device registration, session management
M1.5 [Settimana 12-13]  Profilo utente: foto, bio, status, privacy settings
M1.6 [Settimana 13]     Contatti: aggiungi tramite username, blocco utenti
                         ▶ MILESTONE: Autenticazione e profilo completi

FASE 2 — CORE MESSAGING (Mese 3–6)
─────────────────────────────────────
M2.1 [Settimana 14-15]  Signal Protocol: key generation, X3DH setup
M2.2 [Settimana 15-16]  WebSocket Gateway: connessione, heartbeat, reconnect
M2.3 [Settimana 16-18]  Chat 1-to-1: invio/ricezione testo E2E
M2.4 [Settimana 17-18]  Delivery status: sent ✓ / delivered ✓✓ / read ✓✓ (blue)
M2.5 [Settimana 19-20]  Multi-device sync: messaggi sincronizzati su tutti i device
M2.6 [Settimana 20-21]  Reply inline, menzioni, forward messaggi
M2.7 [Settimana 21-22]  Messaggi a scomparsa: timer configurabile
M2.8 [Settimana 22-23]  Reazioni emoji ai messaggi
M2.9 [Settimana 23-24]  Ricerca messaggi in-chat (full-text locale)
                         ▶ MILESTONE: Chat 1-to-1 feature-complete

FASE 3 — GRUPPI (Mese 5–7)
─────────────────────────────
M3.1 [Settimana 24-25]  Signal Protocol Sender Keys per gruppi
M3.2 [Settimana 25-26]  Creazione gruppo, aggiunta/rimozione membri
M3.3 [Settimana 26-27]  Ruoli: Owner/Admin/Membro, permessi configurabili
M3.4 [Settimana 27-28]  Inviti: link, QR code, invito diretto
M3.5 [Settimana 28-29]  Notifiche gruppo: menzioni, mute, DND
M3.6 [Settimana 29-30]  Admin tools: silenziamento, rimozione, ban
                         ▶ MILESTONE: Gruppi feature-complete

FASE 4 — MEDIA (Mese 5–7)
───────────────────────────
M4.1 [Settimana 22-24]  Object storage setup + presigned URL flow
M4.2 [Settimana 24-25]  Invio foto: upload, compressione, E2E encryption
M4.3 [Settimana 25-26]  Invio video: upload, thumbnail, progress indicator
M4.4 [Settimana 26-27]  Invio documenti: PDF, Office, preview
M4.5 [Settimana 27-28]  Messaggi vocali: registrazione, waveform, velocità
M4.6 [Settimana 28-29]  Link preview: Open Graph scraper, cache
M4.7 [Settimana 29-30]  Galleria media per chat
                         ▶ MILESTONE: Media feature-complete

FASE 5 — CHIAMATE (Mese 7–9)
──────────────────────────────
M5.1 [Settimana 30-31]  WebRTC setup: STUN server, ICE negotiation
M5.2 [Settimana 31-32]  TURN server deployment (infrastruttura relay)
M5.3 [Settimana 32-34]  Chiamate vocali 1-to-1: E2E, fingerprint verify
M5.4 [Settimana 34-35]  Videochiamate 1-to-1: simulcast, adaptive bitrate
M5.5 [Settimana 35-36]  SFU setup (LiveKit): chiamate audio gruppo fino a 8
M5.6 [Settimana 36-37]  UI chiamate: in-call overlay, mute, speaker, flip camera
                         ▶ MILESTONE: Chiamate e videochiamate feature-complete

FASE 6 — NOTIFICHE (Mese 7–8)
───────────────────────────────
M6.1 [Settimana 30-32]  APNs integration (iOS push)
M6.2 [Settimana 30-32]  FCM integration (Android push)
M6.3 [Settimana 32-33]  Web Push via Service Worker
M6.4 [Settimana 33-34]  Notification preferences: per-chat mute, schedule DND
M6.5 [Settimana 34]     Privacy: payload push senza testo messaggio
                         ▶ MILESTONE: Notifiche feature-complete

FASE 7 — WALLET USDA (Mese 8–11)
───────────────────────────────────
M7.1 [Settimana 34-36]  Wallet service setup (infrastruttura separata)
M7.2 [Settimana 36-38]  KYC: integrazione provider (Onfido/Jumio), flusso lite
M7.3 [Settimana 38-40]  Wallet core: saldo, deposit, withdrawal USDA
M7.4 [Settimana 40-42]  Invio/ricezione USDA tra utenti con wallet attivo
M7.5 [Settimana 42-43]  Storico transazioni, export CSV
M7.6 [Settimana 43-44]  Security review dedicata wallet
M7.7 [Settimana 44]     Compliance audit (AML/KYC)
                         ▶ MILESTONE: Wallet v1 ready (beta ristretta)

FASE 8 — HARDENING + BETA (Mese 9–11)
────────────────────────────────────────
M8.1 [Settimana 38-40]  Security audit interno: Auth, Signal Protocol, API
M8.2 [Settimana 40-42]  Penetration test esterno (red team)
M8.3 [Settimana 42-44]  Load testing: simulazione 100K DAU in staging
M8.4 [Settimana 44-46]  Bug bash: QA intensivo su tutto il product
M8.5 [Settimana 46-47]  Beta chiusa: 1.000 utenti invitati, feedback loop
M8.6 [Settimana 47-48]  Beta aperta: 10.000 utenti, monitoring intensivo
                         ▶ MILESTONE: Beta completa, go/no-go decision

FASE 9 — LANCIO V1 (Mese 12)
──────────────────────────────
M9.1 [Settimana 49]     App Store submission (iOS): review ~2-3 giorni
M9.2 [Settimana 49]     Google Play submission (Android): review ~1-2 giorni
M9.3 [Settimana 50]     Web app production deploy
M9.4 [Settimana 50]     DNS, CDN, SSL definitivi per dominio produzione
M9.5 [Settimana 51]     Soft launch: disponibile pubblicamente
M9.6 [Settimana 52]     Monitoring post-launch h24 per 2 settimane
                         ▶ MILESTONE: Alpha Chat V1 è live 🚀

═══════════════════════════════════════════════════════════════════════

RIEPILOGO MILESTONE CRITICHE
──────────────────────────────
M0 → Infrastructure ready                    Settimana 8
M1 → Auth + Identity completo                Settimana 13
M2 → Chat 1-to-1 feature-complete            Settimana 24
M3 → Gruppi feature-complete                 Settimana 30
M4 → Media feature-complete                  Settimana 30
M5 → Chiamate feature-complete               Settimana 37
M6 → Notifiche feature-complete              Settimana 34
M7 → Wallet v1 (beta ristretta)              Settimana 44
M8 → Beta pubblica + hardening               Settimana 48
M9 → LAUNCH V1                               Settimana 52

═══════════════════════════════════════════════════════════════════════

DIPENDENZE CRITICHE (cosa blocca cosa)
────────────────────────────────────────
Auth (M1) → blocca tutto il resto
Signal Protocol (M2.1) → blocca chat, gruppi, media E2E
WebSocket Gateway (M2.2) → blocca chat real-time e chiamate
Cassandra schema (M2) → blocca chat di gruppo e media
STUN/TURN (M5.1-2) → blocca chiamate
SFU (M5.5) → blocca chiamate di gruppo
Wallet infrastruttura separata (M7.1) → blocca tutto il wallet

═══════════════════════════════════════════════════════════════════════
```

---

## Note Finali

Questo documento è un documento vivo. Ogni decisione tecnica qui descritta deve essere rivista con il team prima dell'implementazione, validata contro i requisiti specifici del contesto di deployment (cloud provider scelto, budget, team skills), e aggiornata man mano che le priorità di prodotto evolvono.

I principi però non cambiano:
- La chat è il prodotto. Tutto il resto è a servizio della chat.
- La privacy è architettura, non policy.
- La velocità è rispetto per l'utente.
- Il wallet è separato. Sempre.

---

*Documento preparato dal Team Alpha — CTO, Lead Engineer, Product Designer, Security Engineer, Cloud Architect*
*Ultima revisione: Luglio 2025*
