# Alpha Chat — Technical Review
### Revisione Tecnica Completa Pre-Sviluppo
> Versione 1.0 — Luglio 2025
> Status: Pre-Development Review
> Autore della revisione: Analisi multi-prospettiva (Architect / Security / Performance / UX / DevOps)

---

## Indice

1. [Executive Summary](#1-executive-summary)
2. [Prospettiva: Principal Software Architect](#2-prospettiva-principal-software-architect)
3. [Prospettiva: Senior Security Engineer](#3-prospettiva-senior-security-engineer)
4. [Prospettiva: Senior Performance Engineer](#4-prospettiva-senior-performance-engineer)
5. [Prospettiva: Senior UX Designer](#5-prospettiva-senior-ux-designer)
6. [Prospettiva: DevOps Architect](#6-prospettiva-devops-architect)
7. [Gap Analysis: Competitor](#7-gap-analysis-competitor)
8. [Scorecard Tecnica](#8-scorecard-tecnica)
9. [Alpha Chat Versione 1 — Checklist di Produzione](#9-alpha-chat-versione-1--checklist-di-produzione)

---

## 1. Executive Summary

Questa revisione analizza i due documenti di progettazione di Alpha Chat (`alpha-chat-product-design.md` e `alpha-chat-mvp-architecture.md`) come se si stesse conducendo un architectural review prima del primo sprint di sviluppo.

**Giudizio generale:** L'architettura MVP è solida nelle scelte macro e presenta una filosofia corretta (managed services, modularità, semplicità). Tuttavia, presenta **17 problemi significativi** che, se non affrontati prima dello sviluppo, possono causare riscritture costose, vulnerabilità di sicurezza o un prodotto non spedibile in beta pubblica.

**I 5 problemi più critici da risolvere subito:**
1. **Stream Chat è il cuore del prodotto ma non è controllato** — vendor lock-in senza piano di uscita chiaro a breve termine
2. **La E2E in V1 è promessa ma non implementata** — il documento dice "E2E" ma la beta usa solo TLS in transit
3. **Schema MongoDB non ha indice compound su `deleted_for`** — query O(n) su ogni fetch di messaggi con utenti che hanno eliminato molti messaggi
4. **Nessuna strategia di conflict resolution per messaggi concorrenti** — ordering non garantito senza `client_message_id` implementato end-to-end
5. **L'onboarding richiede numero di telefono via Twilio ma l'email è primaria** — incoerenza che genera UX confusa al primo avvio

---

## 2. Prospettiva: Principal Software Architect

### 2.1 Problemi Architetturali

---

#### PROBLEMA A-01 — Stream Chat: Dipendenza Critica Senza Controllo
**Gravità: Alta**

Stream Chat è descritto come il servizio che gestisce WebSocket, fan-out, delivery, presenza, typing indicators, e sincronizzazione multi-device. In pratica, Stream Chat **è** la funzionalità principale di Alpha Chat in V1.

**Il problema:** Il backend Alpha Chat diventa un thin wrapper attorno a Stream. La logica di business (blocco utenti, permessi, eliminazione) dipende da eventi Stream, contratti Stream, behavior Stream. Se Stream:
- Cambia la struttura degli eventi (breaking change)
- Va in downtime (la chat smette di funzionare)
- Aumenta i prezzi (il progetto diventa economicamente insostenibile prima del piano di migrazione)
- Modifica le policy di utilizzo

…non c'è nulla che possa essere fatto in tempi brevi.

**Il piano di migrazione "a 500K MAU" non è realistico** perché costruire un sistema WebSocket custom richiede mesi. Se si decide di migrare a 500K MAU, il prodotto sarà rotto per settimane durante la migrazione, proprio quando ha più utenti.

**Come migliorarlo:**
Definire fin da V1 un **Abstraction Layer** interno. Tutta la logica del Core parla con un'interfaccia `MessagingProvider` — non con Stream direttamente. Stream è l'implementazione concreta, sostituibile. Questo non richiede lavoro aggiuntivo significativo: è una questione di come si organizza il codice, non di cosa si costruisce.

```
Core Logic → MessagingProvider (interfaccia) → StreamChatAdapter (implementazione)
```

Così la migrazione futura è un nuovo Adapter, non una riscrittura.

---

#### PROBLEMA A-02 — Incoerenza tra Documento di Prodotto e Documento MVP
**Gravità: Media**

Il documento `alpha-chat-product-design.md` descrive l'architettura V1 con:
- Backend in **Go**
- Database **PostgreSQL + Cassandra + Elasticsearch + Redis**
- **Signal Protocol** implementato dall'inizio
- WebSocket Gateway custom con **MessagePack**
- **Kafka** per eventi
- Team di **12–15 persone**

Il documento `alpha-chat-mvp-architecture.md` descrive V1 con:
- Backend in **Node.js**
- Database **MongoDB Atlas unico**
- E2E via **Stream Chat SDK** (non Signal Protocol)
- WebSocket gestito da **Stream**
- Team di **1 sviluppatore**

I due documenti descrivono **due prodotti diversi con lo stesso nome**. Chiunque legga entrambi — un futuro co-fondatore, un investitore, un ingegnere che entra nel team — si confonderà. La confusione sui documenti porta a decisioni tecniche incoerenti durante lo sviluppo.

**Come migliorarlo:**
Aggiungere una nota chiarissima in cima al documento di prodotto che lo qualifica esplicitamente come "Visione a Lungo Termine (V3)" e aggiunge un riferimento al documento MVP come "Piano Operativo Attuale". I due documenti servono scopi diversi, devono dichiararlo esplicitamente.

---

#### PROBLEMA A-03 — `client_message_id` Citato nei Principi, Assente nell'Implementazione
**Gravità: Alta**

Il documento di prodotto cita il `client_message_id` per l'idempotenza come requisito fondamentale per evitare messaggi duplicati. Il documento MVP non lo menziona in nessuna collection, in nessun endpoint, in nessuno sprint.

**Il problema concreto:** Senza `client_message_id`:
1. L'utente preme "invia" due volte (connessione lenta, double-tap)
2. Il client fa retry automatico dopo un timeout
3. Il messaggio appare duplicato nella chat
4. Non c'è modo di deduplicarlo server-side

Questo è uno dei bug visibili più frequenti e più fastidiosi nelle app di messaging. Telegram, WhatsApp e Signal lo gestiscono tutti.

**Come migliorarlo:**
Aggiungere `client_message_id` (UUID v4 generato dal client) alla collection `messages` in MongoDB, con un indice unique composto `{ conversation_id, client_message_id }`. L'endpoint di invio messaggio diventa idempotente: se `client_message_id` esiste già, ritorna il documento esistente senza effetti collaterali.

---

#### PROBLEMA A-04 — Nessuna Strategia per l'Ordering dei Messaggi
**Gravità: Alta**

Il documento descrive `created_at` come campo per l'ordinamento dei messaggi. `created_at` è un timestamp lato server (o lato client?). In entrambi i casi:

- **Timestamp lato client:** non fidato. Due utenti con orologi di sistema sfasati producono ordinamenti incorretti.
- **Timestamp lato server:** MongoDB non garantisce che due write sequenziali abbiano `created_at` differente a risoluzione millisecondo. Due messaggi inviati contemporaneamente da due device possono avere lo stesso timestamp.

**Il problema concreto:** In una chat di gruppo con 50 persone attive, i messaggi possono apparire in ordine diverso su device diversi. È il tipo di bug che sembra impossibile da riprodurre ma gli utenti lo vedono costantemente.

**Come migliorarlo:**
Aggiungere un campo `sequence_number` per conversazione — un contatore monotonico incrementato atomicamente a ogni messaggio. MongoDB supporta `findOneAndUpdate` con `$inc` in modo atomico. Il feed messaggi si ordina per `sequence_number`, non per `created_at`. `created_at` rimane utile solo per le query range (ricerca per data).

---

#### PROBLEMA A-05 — Canali (V1) Completamente Non Specificati
**Gravità: Media**

Il documento include "Canali" in tutti i componenti V1 Core — nella tabella dei moduli, nella roadmap, negli sprint — ma non esiste **nessuna sezione dedicata** all'architettura dei canali.

Domande senza risposta:
- Qual è il limite di iscritti a un canale in V1?
- I canali sono E2E encrypted? (Tecnicamente impraticabile a grandi numeri)
- Chi può postare? Solo admin?
- I messaggi in un canale sono separati dai messaggi di gruppo in MongoDB?
- Stream Chat gestisce i canali con la stessa API dei gruppi?
- Gli iscritti a un canale ricevono push notification per ogni post?

**Come migliorarlo:**
Scrivere una sezione dedicata "Canali V1" analoga alla sezione Gruppi. I canali non sono gruppi — hanno un modello dati, un modello di permessi, e una UX fondamentalmente diversi. Senza questa specifica, lo sprint 5 non può iniziare.

---

#### PROBLEMA A-06 — BullMQ Introdotto ma Non Dichiarato nello Stack
**Gravità: Bassa**

La sezione 16.8 cita "BullMQ o semplice setImmediate per V1" per la pipeline di eliminazione media. BullMQ richiede Redis (già disponibile via Upstash). Tuttavia:

- BullMQ non è menzionato nella tabella dello stack
- `setImmediate` non è una soluzione per job asincroni affidabili — se il processo si riavvia, il job è perso
- Upstash Redis ha limitazioni sul pattern `BLPOP` usato da BullMQ nelle connessioni serverless

**Come migliorarlo:**
Decidere e dichiarare esplicitamente: si usa BullMQ per tutti i job asincroni (eliminazione media, link preview scraping, virus scan) con un istanza Redis dedicata per le code, separata dall'istanza Upstash usata per presenza e rate limiting. Upstash ha limitazioni per i pattern di long-polling usati dalle code tradizionali.

---

#### PROBLEMA A-07 — La Collection `conversations` Duplica Dati con `groups`
**Gravità: Bassa-Media**

La struttura mostra che una conversazione di tipo `group` ha il proprio documento in `conversations` (con il campo `members`) E un documento separato in `groups` (con `settings`, `invite_link_token`, ecc.). I `members` sono in `conversations`, le `settings` in `groups`.

Questo split crea:
- Due sorgenti di verità parziali per la stessa entità
- Query che devono sempre fare lookup su entrambe le collection
- Rischio di inconsistenza (member aggiunto a `conversations` ma non propagato correttamente al canale Stream)

**Come migliorarlo:**
Unificare: i dati di membership vanno in `groups` o vanno eliminati da `conversations` e gestiti solo via Stream Chat. Stream Chat mantiene internamente la membership dei canali — duplicarla in MongoDB introduce sincronizzazione da mantenere.

---

### 2.2 Funzionalità Architetturali Mancanti

- **Nessun meccanismo di versioning dei messaggi:** quando un messaggio viene modificato, il documento aggiorna `content` e `edited_at`. Ma la storia delle modifiche è persa. Telegram mostra la storia delle modifiche. Non è richiesto in V1, ma il schema non lo preclude.
- **Nessuna strategia per messaggi programmati:** citati in V2 (doc di prodotto) ma il schema non ha un campo `scheduled_for` — aggiungere questa feature in V2 richiederebbe una migration.
- **Nessuna specifica per i "Sondaggi":** citati in V2 ma non esiste un tipo di messaggio `poll` nello schema. Il tipo `type` della collection `messages` non include `poll`.

---

## 3. Prospettiva: Senior Security Engineer

### 3.1 Problemi di Sicurezza

---

#### PROBLEMA S-01 — E2E Encryption in V1 è un'Illusione
**Gravità: Critica**

Questo è il problema più grave dell'intera documentazione.

Il documento di prodotto (Sezione 5.1) dichiara esplicitamente per V1:
> "Chat 1-to-1: Messaggi di testo con **E2E encryption** — Priorità P0"
> "Chat di gruppo: Fino a 500 partecipanti con **E2E encryption** — Priorità P0"

Il documento MVP (Sezione 8.2) dice:
> "Per la beta chiusa, si usa **TLS 1.3 in transit + MongoDB Atlas Encryption at Rest**. Per la beta pubblica, si attiva l'E2E di Stream."

**TLS in transit + at-rest encryption NON è E2E encryption.** Con TLS, il server Alpha Chat vede i messaggi in chiaro. Con MongoDB encryption at rest, il dato è cifrato sul disco ma leggibile dall'applicazione. Questo è esattamente l'opposto di E2E, che per definizione significa che il server non può leggere il contenuto.

Dichiarare E2E nei materiali di marketing/documentazione mentre si usa TLS è:
1. **Tecnicamente falso** — esponibile in caso di audit o press scrutiny
2. **Legalmente rischioso** — in alcuni contesti (EU, GDPR) dichiarare E2E senza implementarla può essere considerata pubblicità ingannevole
3. **Un rischio reputazionale enorme** — se un ricercatore lo scopre, è la fine del prodotto

**Come migliorarlo:**
Due strade, una va scelta prima di scrivere una riga di codice:

**Strada A (consigliata per V1 onesto):** Dichiarare esplicitamente in tutti i materiali che V1 usa "TLS in transit, encryption at rest" e che la E2E completa arriva in V1.1 o V2. Essere onesti è una scelta di brand che Signal ha fatto e che ha costruito fiducia.

**Strada B (ambiziosa ma coerente):** Implementare l'E2E di Stream Chat fin dalla beta pubblica come promesso. Stream Chat supporta E2E nativo con libreria `stream-chat-js`. Non è Signal Protocol, ma è E2E reale: il server Stream non può leggere il contenuto. Questo deve diventare un deliverable di Sprint 2, non una nota a piè di pagina.

---

#### PROBLEMA S-02 — Phone Number Hashing: Schema Non Sicuro
**Gravità: Alta**

La sezione 15.2 descrive il contact discovery via rubrica:
> "i numeri vengono hashati sul dispositivo client prima di essere inviati. Il server confronta hash."

Il problema: i numeri di telefono hanno uno spazio di possibilità finito e prevedibile. Un attaccante con accesso al database può:
1. Generare tutti i possibili numeri di telefono italiani (~$10^9$)
2. Hashare ognuno con lo stesso algoritmo
3. Confrontare con i hash nel database e recuperare tutti i numeri

Questo è un attacco di **preimage su dizionario finito** — non richiede GPU farm, richiede meno di 1 ora su un laptop con MD5 o SHA-256 senza salt.

**Il problema specifico del documento:** non specifica quale algoritmo di hashing si usa per i numeri, non menziona salt, non menziona HMAC con chiave segreta server-side.

**Come migliorarlo:**
Signal risolve questo problema con **Private Set Intersection** (PSI) crittografico — computazionalmente costoso da implementare. La soluzione MVP accettabile è:
- HMAC-SHA256 con una chiave segreta server-side (non nel database)
- Il server non conserva i numeri in chiaro né gli hash puri
- La chiave HMAC è ruotata periodicamente (il discovery richiede re-upload della rubrica)

Questo è significativamente più sicuro dell'hashing semplice e non richiede crittografia avanzata.

---

#### PROBLEMA S-03 — JWT RS256 vs ECDSA: Incoerenza tra i Documenti
**Gravità: Media**

Il documento MVP (Sezione 9.4) specifica: "Algoritmo **RS256** (firma asimmetrica)"
Il documento di prodotto (Sezione 21.1) specifica: "Firmato con **ECDSA P-256**"

RS256 e ECDSA P-256 sono entrambi sicuri, ma hanno caratteristiche diverse:
- RS256: chiavi RSA 2048/4096 bit, operazioni di firma più lente, chiavi più grandi
- ECDSA P-256: chiavi più piccole, operazioni più veloci, equivalente di sicurezza con chiavi 3x più corte

**Il problema non è quale scegliere — è che i due documenti non concordano.** Quando uno sviluppatore inizierà a implementare l'auth, quale documento seguirà?

**Come migliorarlo:**
Scegliere uno (ECDSA P-256 / ES256 è la scelta moderna consigliata da RFC 8037 e NIST) e aggiornare entrambi i documenti. Documentare anche: dove si conserva la chiave privata (variabile d'ambiente, non hardcoded), come si gestisce la rotazione delle chiavi.

---

#### PROBLEMA S-04 — Nessuna Strategia per la Revoca del Token in Caso di Compromissione
**Gravità: Alta**

Il sistema JWT con access token da 15 minuti è corretto. Ma manca la risposta a questo scenario: **il dispositivo di un utente viene rubato alle 09:00. L'utente fa logout remoto alle 09:05. Il ladro ha ancora 10 minuti di access token valido.**

10 minuti con un access token valido sono sufficienti per:
- Scaricare tutti i messaggi
- Inviare messaggi a nome dell'utente
- Cambiare l'email/password

**Come migliorarlo:**
Implementare una **blocklist dei JWT revocati** in Redis. Quando l'utente fa logout remoto (o reset password), il `jti` (JWT ID) del token attivo viene inserito nella blocklist con TTL pari alla scadenza del token (15 minuti). Il middleware di autenticazione controlla la blocklist. Il costo è una query Redis O(1) per ogni request autenticata — accettabile.

---

#### PROBLEMA S-05 — Signed URL Media: Finestra Temporale Troppo Ampia
**Gravità: Media**

La sezione 10.4 specifica: "ogni URL di lettura è un signed URL con TTL di **24 ore**".

24 ore è una finestra eccessivamente larga. Scenari problematici:
- Un utente condivide un'immagine in una chat, poi lascia il gruppo. L'URL firmato rimane valido per 24 ore — chiunque abbia l'URL (anche chi ha lasciato il gruppo) può accedere al media.
- Un messaggio viene eliminato "per tutti" — il media viene rimosso da R2 ma i vecchi URL firmati rimangono validi per quasi 24 ore (citato come eccezione nel doc, ma non risolto).
- In caso di breach, gli URL firmati presenti in cache o logs di rete rimangono validi a lungo.

**Come migliorarlo:**
- TTL signed URL: **1 ora** per immagini e video, **15 minuti** per documenti sensibili
- Implementare URL refresh lato client: quando l'URL scade, il client richiede un nuovo signed URL prima di mostrare il media
- Per messaggi eliminati "per tutti": invalidare immediatamente i signed URL esistenti (R2 supporta la revoca degli URL firmati tramite modifica delle credenziali di firma — documentare questo meccanismo)

---

#### PROBLEMA S-06 — Rate Limiting: Mancano gli Endpoint più Critici
**Gravità: Media**

La sezione 9.5 definisce rate limiting per:
- Auth endpoints: 5 / 15 minuti per IP
- Invio messaggi: 100 / minuto per user_id
- Upload media: 20 / minuto per user_id
- API generiche: 300 / minuto per IP

**Endpoint non coperti (ma critici):**
- **Ricerca utenti per username:** senza rate limit, un attaccante può enumerare tutti gli username esistenti
- **Contact discovery via rubrica:** senza rate limit, può essere usato per bulk lookup di numeri di telefono
- **OTP verification:** il documento dice "max 3 tentativi" ma non specifica cosa succede dopo — blocco temporaneo? Blocco permanente? Notifica all'utente?
- **Cambio email/password:** operazioni ad alto rischio, dovrebbero avere rate limit più stretto dell'autenticazione normale
- **Link di invito gruppo:** un link pubblico senza rate limit può essere usato per scraping della membership dei gruppi

**Come migliorarlo:**
Aggiungere una tabella di rate limiting completa che copra tutti gli endpoint, non solo i principali. I rate limit mancanti sugli endpoint di discovery sono i più critici da aggiungere.

---

#### PROBLEMA S-07 — Nessuna Strategia di Content Moderation
**Gravità: Media**

Il documento non menziona in nessun punto come Alpha Chat gestirà:
- CSAM (Child Sexual Abuse Material) — obbligo legale di reporting in molte giurisdizioni
- Contenuti illegali (terrorismo, incitamento all'odio)
- Spam massiccio

**Il problema legale:** In EU (con DSA - Digital Services Act in vigore dal 2024) e in molte altre giurisdizioni, le piattaforme di comunicazione hanno obblighi di rimozione dei contenuti illegali. Questo vale anche per le beta pubbliche.

**Come migliorarlo:**
Anche in V1, definire:
- Un indirizzo email di abuse report visibile nella app
- Un processo interno (anche manuale per V1) per gestire le segnalazioni
- Integrazione con PhotoDNA o NCMEC hash database per CSAM (richiede meno di una settimana di integrazione)
- Una policy d'uso accettabile (TOS) che specifichi cosa è proibito

---

#### PROBLEMA S-08 — Nessuna Menzione di Certificate Pinning nei Client
**Gravità: Media**

Il documento di prodotto (Sezione 22.2) menziona certificate pinning come misura contro MITM con certificati fraudolenti. Il documento MVP non lo menziona in nessun punto della roadmap o dello stack.

Certificate pinning non implementato = un attaccante su rete corporate/VPN può intercettare tutto il traffico con un certificato self-signed. Particolarmente critico per una app che si posiziona sulla privacy.

**Come migliorarlo:**
Aggiungere al Sprint 9 (hardening): implementazione di certificate pinning in Expo (libreria `react-native-ssl-public-key-pinning`). Documentare la procedura di aggiornamento del pin quando il certificato viene rinnovato (pin backup obbligatorio).

---

## 4. Prospettiva: Senior Performance Engineer

### 4.1 Colli di Bottiglia e Problemi di Performance

---

#### PROBLEMA P-01 — Query `deleted_for` è un Full Array Scan O(n) per Utente
**Gravità: Alta**

Lo schema della collection `messages` include:
```
deleted_for: [ObjectId]  // array di user_id che hanno eliminato il messaggio
```

Ogni query che recupera i messaggi di una conversazione deve filtrare i messaggi in cui `user_id` è presente in `deleted_for`. MongoDB supporta query su array (`$nin`, `$elemMatch`), ma:

1. **L'indice su array in MongoDB non è selettivo** per query di tipo "questo elemento NON è nell'array" (`$nin` su campo array bypassa gli indici — è un collection scan).
2. In una conversazione con 10.000 messaggi in cui l'utente ha eliminato 1.000, ogni fetch della chat richiede una scansione di 10.000 documenti per identificare gli 1.000 da filtrare.
3. Con un gruppo di 500 persone dove ogni membro ha eliminato alcuni messaggi, `deleted_for` può contenere centinaia di ObjectId per messaggio — il documento cresce, le query rallentano.

**Come migliorarlo:**
Due approcci:

**Approccio A (semplice, V1):** Separare le eliminazioni "solo per me" in una collection separata `message_deletions_personal` con schema `{ user_id, message_id, conversation_id, deleted_at }` e indice compound `{ user_id, conversation_id }`. La query principale dei messaggi non tocca l'array — fa un left join / lookup separato. La collection `messages` rimane snella.

**Approccio B (alternativo):** Mantenere `deleted_for` nell'array ma aggiungere un indice multikey e limitare il numero massimo di user_id nell'array (es: oltre 100 user_id, il messaggio viene considerato "eliminato per tutti" comunque). Meno pulito ma più semplice da implementare.

---

#### PROBLEMA P-02 — Nessuna Strategia di Paginazione Definita
**Gravità: Alta**

Il documento cita "paginazione cursor-based" come principio nel documento di prodotto, ma il documento MVP non specifica:
- Qual è la dimensione della pagina di default per i messaggi? (50? 100? 20?)
- Come funziona il cursor? È basato su `created_at + _id`? Su `sequence_number`?
- Come si gestisce il caso "nuovo messaggio arriva mentre si sta caricando la pagina precedente"?
- Come si gestisce lo "scroll verso l'alto" per caricare messaggi più vecchi vs "nuovi messaggi che arrivano in fondo"?

Senza questa specifica, ogni sviluppatore implementerà la paginazione in modo diverso, e la lista messaggi avrà bug di duplicati o gap.

**Come migliorarlo:**
Definire esplicitamente il contratto di paginazione:
- Dimensione pagina: 50 messaggi per fetch iniziale, 30 per fetch successivi
- Cursor: `{ before: message_id }` per caricare più vecchi, `{ after: message_id }` per caricare più nuovi
- La query MongoDB usa `{ conversation_id: X, sequence_number: { $lt: cursor_sequence } }` con `limit(50).sort({ sequence_number: -1 })`

---

#### PROBLEMA P-03 — Link Preview: Nessuna Protezione contro SSRF e Timeout
**Gravità: Media (sicurezza + performance)**

Il documento descrive "Link preview: scraper Open Graph backend, cache MongoDB 24h". Lo scraper Open Graph nel backend è un classico vettore di **SSRF (Server-Side Request Forgery)**:

- Un utente invia un link a `http://169.254.169.254/latest/meta-data/` (metadata endpoint AWS)
- Il backend scraper fa una richiesta HTTP a quell'URL
- Il backend riceve le credenziali IAM dell'istanza

Inoltre, senza timeout configurato:
- Un link a un server lento blocca il thread Node.js
- Cascata di richieste a un dominio lento saturano il pool di connessioni

**Come migliorarlo:**
- Whitelist esplicita dei protocolli accettati (solo `https://`)
- Blocco di IP privati, loopback, e range reserved (RFC 1918: 10.x, 172.16.x, 192.168.x)
- Timeout aggressivo: 3 secondi max per lo scraping
- Rate limit per dominio: max 10 richieste/ora allo stesso dominio
- Usare una libreria dedicata (es: `metascraper` con `got` e `agent` configurato) invece di un `fetch` generico

---

#### PROBLEMA P-04 — Indici MongoDB: Mancano Indici Critici
**Gravità: Alta**

La sezione 5.3 elenca gli indici principali ma mancano indici critici per le query più frequenti:

| Query non coperta da indice | Impatto |
|---|---|
| Ricerca messaggi non letti per conversazione | Ogni apertura chat calcola i non letti con collection scan |
| `push_tokens` per `user_id` | Ogni notifica push richiede lookup senza indice |
| `contacts` per `user_id` + `contact_user_id` | Verifica blocco utente su ogni messaggio senza indice |
| `groups` per `conversation_id` | Join gruppo-conversazione senza indice |
| `messages` con filtro `deleted_for_everyone: false` | Ogni fetch filtra tombstone senza indice su boolean |
| `sessions` per `refresh_token_hash` | Refresh token lookup senza indice = collection scan ad ogni refresh |

**Come migliorarlo:**
Aggiungere alla documentazione la tabella indici completa con tutti gli indici necessari. In particolare, `sessions.refresh_token_hash` deve avere un indice unique — è una query che avviene ad ogni refresh di token (ogni 15 minuti per ogni utente attivo).

---

#### PROBLEMA P-05 — Daily.co Signaling via Stream: Latenza Doppia
**Gravità: Media**

Il documento specifica: "Il signaling (chi chiama chi, accetta/rifiuta) viaggia via Stream Chat come messaggio di tipo `system`."

Il problema di latenza: quando arriva una chiamata, il percorso è:
```
Caller → Backend Alpha Chat → Stream Chat → Stream servers → Destinatario
```

Per il signaling di una chiamata (dove ogni millisecondo conta per la perceived responsiveness), aggiungere Stream Chat come intermediario introduce 50–200ms di latenza aggiuntiva rispetto a un segnale diretto.

In più, se Stream Chat è in maintenance o ha degraded performance, le chiamate non funzionano — due servizi managed critici dipendenti in cascata.

**Come migliorarlo:**
Per V1 con Daily.co, il signaling può viaggiare anche via Stream senza problemi percepibili. Ma documentare esplicitamente che in V2, quando si sostituisce Daily.co o Stream, il signaling delle chiamate deve diventare indipendente dalla chat messaging. Aggiungere questa nota alle dipendenze critiche.

---

#### PROBLEMA P-06 — Nessuna Strategia di Caching per le Liste Conversazioni
**Gravità: Media**

La schermata più caricata di qualsiasi app di chat è la **lista delle conversazioni** (home screen). Ogni apertura dell'app esegue questa query:
```
conversations.find({ participants: user_id }).sort({ updated_at: -1 }).limit(20)
```

Con un utente che ha 100 conversazioni, questa query è eseguita:
- Ad ogni apertura dell'app
- Ad ogni refresh
- Ogni volta che arriva un nuovo messaggio (per aggiornare l'anteprima)

Senza caching, MongoDB gestisce questa query per ogni utente attivo. A 10K utenti attivi contemporaneamente, sono 10K query/secondo al DB per questa sola operazione.

**Come migliorarlo:**
Cachare in Redis la lista delle conversazioni per utente con TTL breve (30 secondi). Invalidare la cache quando arriva un nuovo messaggio in una delle conversazioni dell'utente. Stream Chat può triggerare l'invalidazione via webhook. L'hit rate su questa cache sarà molto alto (la lista non cambia tra un messaggio e l'altro nella maggior parte dei casi).

---

## 5. Prospettiva: Senior UX Designer

### 5.1 Problemi di Esperienza Utente

---

#### PROBLEMA UX-01 — Onboarding: Flusso Ambiguo tra Email e Telefono
**Gravità: Alta**

Il documento dichiara:
- Email + Password come metodo **primario**
- Telefono + SMS OTP come metodo **secondario**

Ma nella roadmap (Sprint 1), entrambi sono implementati nello stesso sprint senza prioritizzazione della schermata di scelta. Un utente alla prima apertura vede: **email o telefono?**

Questa scelta è la decisione più importante dell'onboarding e non ha una risposta progettata. WhatsApp chiede solo il numero. Signal chiede solo il numero. Telegram chiede il numero. Signal sta migrando verso username. Nessuno di questi ha due opzioni equivalenti in parallelo alla registrazione — perché la scelta paralizza.

**Come migliorarlo:**
Scegliere un'esperienza primaria con una singola schermata iniziale. Raccomandazione: **email come primario mostrato per default**, con "Usa numero di telefono" come link secondario in basso. Non due opzioni equivalenti — una è la default, l'altra è un'alternativa per chi la preferisce.

---

#### PROBLEMA UX-02 — Nessuna Specifica dell'Onboarding per Nuovi Utenti
**Gravità: Alta**

Il documento menziona "Onboarding flow" nella checklist pre-beta come un singolo item. Non esiste **nessuna specifica** di cosa l'onboarding include, in quale ordine, e con quale logica.

Domande senza risposta:
- Quante schermate ha l'onboarding?
- Il claim dell'username avviene durante la registrazione o dopo?
- Si chiede il permesso per le notifiche durante l'onboarding? (Il timing ha un impatto enorme sul tasso di accettazione — su iOS, chiedere subito porta a ~40% di accettazione, chiedere dopo aver mostrato valore porta a ~70%)
- Si chiede l'accesso alla rubrica? Con quale spiegazione?
- C'è uno schermo di "benvenuto" che spiega il prodotto?

**Come migliorarlo:**
Scrivere un flow dell'onboarding schermata per schermata, anche in formato testuale:
1. Splash screen → 2. Email/password → 3. Verifica email → 4. Claim username → 5. Foto profilo (opzionale, skippabile) → 6. Permessi notifiche (con contesto: "Ricevi messaggi anche quando l'app è chiusa") → 7. Prima chat

---

#### PROBLEMA UX-03 — Dark Mode Non Ha Specifica di Implementazione
**Gravità: Media**

Il documento menziona "Dark mode / Light mode con system preference detection" nello Sprint 8. Nessuna delle sezioni UI/UX specifica:

- I colori esatti per il tema scuro (non basta "invertire i token" — i messaggi propri e altrui devono avere contrasto leggibile su sfondo scuro)
- Come si gestisce il dark mode nelle chiamate (UI molto diversa)
- Come si gestisce il dark mode nelle anteprime dei media (thumbnails scure su sfondo scuro)
- Il nome del font scelto (la sezione UX dice "un typeface scelto" ma non specifica quale)

**Come migliorarlo:**
Definire nel documento architettura MVP almeno:
- Il sistema di colori base (primary, surface, on-surface, error, outline) per entrambi i temi
- Il font scelto (raccomandazione: **Inter** per la densità di testo nelle liste, disponibile gratuitamente, ottimo su mobile)
- La libreria di theming (React Native Paper con `PaperProvider` e `MD3DarkTheme`/`MD3LightTheme` già gestisce questo correttamente)

---

#### PROBLEMA UX-04 — Gestione degli Errori Non Specificata in Dettaglio
**Gravità: Media**

La checklist pre-beta include "Error messages: comprensibili per l'utente, non stack trace". Ma non esiste nessuna specifica di:
- Cosa succede quando l'invio di un messaggio fallisce in mid-conversation?
- Cosa succede quando la connessione cade durante un upload di un file grande?
- Cosa vede l'utente quando il server Stream Chat è in downtime?
- Come si gestisce l'errore "username già preso" durante la registrazione?
- Come si gestisce il timeout di una chiamata?

**Il problema concreto:** senza questi stati di errore specificati, ogni sviluppatore li gestisce diversamente. Alcuni mostrano toast, altri modal, altri nulla. Il risultato è un'app dove gli errori sembrano bug piuttosto che stati gestiti.

**Come migliorarlo:**
Creare una sezione "Error States Catalog" (anche in formato tabellare semplice) che mappa ogni scenario di errore all'UX di risposta: toast temporaneo, banner persistente, stato inline sul messaggio, o modal bloccante.

---

#### PROBLEMA UX-05 — Accessibility: Dichiarata ma Non Specificata
**Gravità: Media**

Il documento di prodotto dichiara (Sezione 8.6): "Accessibilità Non Negoziabile — Dynamic type, contrast ratio AA come minimo (AAA dove possibile), screen reader support completo."

Nessuna di queste specifiche è poi trasferita nel documento MVP o nella roadmap sprint. Non esiste uno sprint o un task dedicato all'accessibilità. Non esiste una testing strategy per l'accessibilità.

**Il problema:** L'accessibilità "aggiunta alla fine" non funziona mai. Gli screen reader su React Native funzionano correttamente solo se i componenti sono implementati con `accessibilityLabel`, `accessibilityRole`, e `accessibilityHint` fin dall'inizio. Aggiungerli dopo richiede di toccare ogni componente.

**Come migliorarlo:**
Aggiungere alla "Definition of Done" di ogni componente: "Verificato con VoiceOver (iOS) o TalkBack (Android), contrast ratio AA verificato con strumento automatico". Non è un sprint separato — è un requisito di ogni feature.

---

#### PROBLEMA UX-06 — Blocco Screenshot: Esperienza Incoerente tra Piattaforme
**Gravità: Bassa**

Il documento menziona "Blocco screenshot in chat (mobile, React Native)" come feature. Questo feature presenta problemi UX significativi:

- Su **iOS**: React Native non può bloccare gli screenshot nativamente. L'unico meccanismo disponibile è oscurare la schermata nella preview del task switcher. Gli screenshot riescono sempre. Le librerie che "bloccano" gli screenshot su iOS in realtà mostrano solo una schermata nera nel multitasking.
- Su **Android**: DRM flag (`FLAG_SECURE`) funziona correttamente.
- Su **Web**: impossibile bloccare gli screenshot.

**Come migliorarlo:**
Documentare onestamente il comportamento per piattaforma. Rinominare la feature in "Protezione anteprima multitasking" su iOS (che è quello che fa realmente) e "Blocco screenshot" su Android. Non promettere una feature che non può essere implementata in modo uniforme.

---

## 6. Prospettiva: DevOps Architect

### 6.1 Problemi di Deployment e Infrastruttura

---

#### PROBLEMA D-01 — Replit Non è Adatto Nemmeno per la Beta Chiusa
**Gravità: Alta**

Il documento specifica Replit come piattaforma per "Sviluppo + Alpha/Beta Chiusa (< 500 utenti attivi)". Tuttavia:

- Replit mette in sleep i servizi dopo inattività — inaccettabile per un servizio di messaggistica che deve essere sempre attivo
- Replit ha SLA di uptime non definiti per piano gratuito/standard
- Le connessioni WebSocket (Stream Chat richiede WebSocket) hanno comportamento instabile su Replit in scenari di produzione
- Il traffico di MongoDB Atlas → Replit introduce latenza variabile non controllabile
- Con 500 utenti attivi che inviano messaggi, il piano Replit standard saturerà le risorse

**Come migliorarlo:**
Separare chiaramente le fasi:
- **Sviluppo locale:** ogni sviluppatore lavora in locale con MongoDB Atlas in cloud
- **Staging:** Railway dal primo giorno (non Replit)
- **Beta chiusa:** Railway con scaling configurato
- Usare Replit **solo** per prototipazione rapida e demo, non per un ambiente con utenti reali

---

#### PROBLEMA D-02 — Nessuna Strategia di Environment Management
**Gravità: Alta**

Il documento non specifica come si gestiscono le variabili d'ambiente tra:
- Sviluppo locale
- Staging
- Beta chiusa
- Produzione

Domande senza risposta:
- Le API key di Stream Chat sono le stesse in staging e produzione?
- I dati di staging vengono separati da quelli di produzione in MongoDB Atlas?
- Come si gestisce la rotazione delle chiavi JWT tra gli ambienti?
- Il bucket Cloudflare R2 è separato per staging e produzione?

**Come migliorarlo:**
Aggiungere una sezione "Environment Strategy" con:
- 3 ambienti: `development`, `staging`, `production`
- 3 cluster MongoDB separati (non solo database separati — cluster separati per isolamento)
- 3 set di API keys per ogni servizio managed (Stream, Daily.co, Twilio, Resend)
- Un `.env.example` committed nel repo con tutti i parametri richiesti (senza valori)
- Un secret manager (Railway Secrets o Doppler) per la gestione centralizzata

---

#### PROBLEMA D-03 — CI/CD Definito solo come "GitHub Actions" Senza Dettaglio
**Gravità: Media**

Il documento cita "CI/CD: GitHub Actions → deploy automatico su Replit" nello Sprint 0. Non è specificato:
- Cosa esegue la pipeline (lint, type check, test, build)?
- Deploy automatico su ogni push su `main`? O solo su tag?
- C'è un gate di qualità prima del deploy (test che devono passare)?
- Come si gestisce un rollback se un deploy rompe la produzione?
- Lo stesso workflow fa staging e produzione o sono separati?

**Come migliorarlo:**
Definire il workflow CI/CD minimo:
1. Su ogni PR: `pnpm lint` + `pnpm typecheck` + `pnpm test`
2. Su merge su `main`: deploy automatico su staging
3. Su tag `v*.*.*`: deploy su produzione con approvazione manuale (GitHub Environments)
4. Rollback: Railway mantiene le ultime 5 versioni deployate — rollback in 1 click

---

#### PROBLEMA D-04 — MongoDB Atlas Free Tier (M0) è Inadeguato
**Gravità: Alta**

Il documento specifica MongoDB Atlas M0 (free tier: 512MB) per lo sviluppo. Anche per una beta chiusa con 100 utenti:

- 100 utenti × 50 messaggi/giorno × 90 giorni = 450.000 messaggi
- Ogni documento messaggio con media metadata = ~2KB
- Solo la collection `messages` = ~900MB > 512MB del limite M0

In aggiunta, M0 non supporta:
- Alert personalizzati
- Performance Advisor
- Backup point-in-time
- Atlas Search
- Connessioni dedicate (condivide risorse con altri cluster M0)

**Come migliorarlo:**
Usare M0 solo per sviluppo locale dei singoli sviluppatori. Per staging e beta chiusa, usare almeno **M10** ($57/mese). Il costo è trascurabile rispetto al rischio di perdere dati utente della beta per raggiungimento del limite M0.

---

#### PROBLEMA D-05 — Nessuna Strategia di Backup e Disaster Recovery
**Gravità: Alta**

La sezione 9.6 menziona "Backup automatici giornalieri con retention 7 giorni (inclusi nel piano Atlas)". Questo è il minimo. Non è specificato:

- Qual è il Recovery Time Objective (RTO)? Quanto tempo è accettabile per ripristinare il servizio?
- Qual è il Recovery Point Objective (RPO)? Quanti dati si può permettere di perdere? (Con backup giornalieri, si può perdere fino a 24 ore di dati)
- Come si fa restore di un backup? È stato mai testato?
- I dati Upstash Redis sono persistenti? (Upstash ha opzioni diverse per la persistenza)
- Come si gestisce il caso "un bug cancella accidentalmente documenti MongoDB"?

**Come migliorarlo:**
Per V1 beta:
- Aumentare la retention dei backup a 30 giorni (incluso nei piani M10+)
- Attivare Point-In-Time Recovery su MongoDB Atlas (permette restore a qualsiasi momento nelle ultime 24h)
- Documentare e testare la procedura di restore PRIMA del lancio della beta
- Definire RTO (target: < 4 ore) e RPO (target: < 1 ora) come SLA interni

---

#### PROBLEMA D-06 — Upstash Redis: Limitazioni Non Documentate
**Gravità: Media**

Upstash Redis è serverless con un modello pay-per-request. Questo introduce:

1. **Latenza variabile:** le connessioni serverless hanno cold start. Su Upstash, le prime richieste dopo un periodo di inattività possono avere latenza 50–200ms vs i tipici < 1ms di Redis tradizionale.

2. **Incompatibilità con BullMQ:** BullMQ usa pattern `BLPOP` (blocking pop) che non è supportato in modalità serverless su Upstash. Il documento suggerisce BullMQ ma usa Upstash — questi due non sono compatibili.

3. **Limite connessioni simultanee:** Upstash free tier ha un limite di connessioni simultanee che può essere raggiunto con il pattern di connessione standard di Node.js.

**Come migliorarlo:**
Separare i casi d'uso Redis:
- **Upstash:** solo per presence, OTP, rate limiting (operazioni stateless, tolleranti a piccola latenza)
- **Redis dedicato su Railway:** per le code BullMQ (job async) e per la cache dei messaggi (dove la latenza < 1ms è critica)

---

## 7. Gap Analysis: Competitor

Analisi delle funzionalità presenti nei principali competitor ma mancanti o incomplete nella specifica Alpha Chat V1.

---

### 7.1 WhatsApp — Gap Critici

| Feature WhatsApp | Stato in Alpha Chat | Impatto |
|---|---|---|
| **Visualizzazione "chi ha visto"** nel gruppo | Non specificata | Gli utenti si aspettano di sapere chi ha letto nei gruppi |
| **Messaggi con scomparsa automatica** come default di account (non solo per chat) | Solo per-chat specificato | WhatsApp ha introdotto "default timer" globale |
| **Multi-device senza telefono primario** (WhatsApp ha abbandonato il modello primary phone nel 2022) | Non specificato — il modello multi-device non è chiarito | Critico: se l'utente disinstalla dal telefono, può ancora usare il web? |
| **Poll nei gruppi** | Non in V1 | Feature molto usata nei gruppi |
| **Comunità** (super-groups con sub-gruppi) | V2 nel doc di prodotto | Differenziatore rispetto a WhatsApp per le community |
| **Sticker e GIF** | Non menzionati | Standard atteso da qualsiasi app di messaging moderno |
| **Chiamate di gruppo video** | Solo audio di gruppo in V1 (fino a 8) | WhatsApp ha videochiamate di gruppo fino a 32 |

---

### 7.2 Telegram — Gap Critici

| Feature Telegram | Stato in Alpha Chat | Impatto |
|---|---|---|
| **Bot API** | V2 nel doc di prodotto | Differenziatore enorme di Telegram — attira community di developer |
| **Messaggi salvati** (Saved Messages — chat con sé stessi) | Non specificato | Feature molto usata per salvare link, note, file |
| **Topics nei gruppi** (sub-thread) | V2 | Telegram ha introdotto Topics — Alpha Chat V1 non li ha |
| **Gruppi fino a 200.000 utenti** | Max 500 in V1, max 10K in V2 | Telegram supporta 200K — differenziatore per community grandi |
| **Modifica caption delle immagini** dopo invio | Non specificato | Telegram lo supporta, WhatsApp lo ha aggiunto |
| **Album di foto** (più foto in un singolo messaggio) | Non specificato | Standard in Telegram, iMessage |
| **Sponsor nei canali** (business model per creator) | Non specificato | Telegram ha un modello per monetizzare i canali |
| **Video notes** (messaggi video circolari) | V2 nel doc di prodotto | Differenziatore identitario di Telegram |

---

### 7.3 Signal — Gap Critici

| Feature Signal | Stato in Alpha Chat | Impatto |
|---|---|---|
| **Safety numbers** (verifica dell'identità E2E con il contatto) | Non specificato | Fondamentale per la credibilità privacy |
| **Note to Self** | Non specificato | Feature molto usata per il trasferimento di link tra device |
| **Stories** (Signal Stories, recenti) | Non in roadmap | WhatsApp e Signal le hanno — rilevanti per engagement |
| **Phone number privacy** (nascondere il numero anche dai contatti) | Parzialmente specificato — manca la meccanica esatta | Signal ha introdotto questa feature nel 2023 |
| **Sealed sender** (l'identità del mittente è nascosta anche al server) | Non specificato | Feature di privacy avanzata, differenziatore di Signal |
| **Group calls con link condivisibile** | Non specificato — le chiamate di gruppo richiedono essere nel gruppo | Signal ha link condivisibili per le chiamate |

---

### 7.4 iMessage — Gap Critici

| Feature iMessage | Stato in Alpha Chat | Impatto |
|---|---|---|
| **Tapback reactions con emoji custom** | Solo emoji generiche specificate — il numero non è definito | iMessage ha recentemente aperto a emoji custom |
| **Inline thread replies** (risposta a messaggio specifico con sub-thread visibile) | Solo reply inline classico | iMessage ha introdotto thread inline veri |
| **Audio messages** che scompaiono dopo l'ascolto (Expire After Listening) | Non specificato | Feature di privacy specifica di iMessage |
| **Shareplay** (condivisione attività in chiamata) | Non in roadmap | Differenziatore Apple, non replicabile facilmente su altre piattaforme |
| **Memoji e sticker personalizzati** | Non menzionati | Standard su iMessage e WhatsApp |

---

### 7.5 Feature Mancanti Universali (presenti in tutti i competitor)

Queste feature sono presenti in **tutti** i competitor principali e non sono specificate in Alpha Chat V1:

| Feature | Presente in | Mancante in Alpha Chat |
|---|---|---|
| **Sticker pack** (almeno un set di default) | WhatsApp, Telegram, Signal, iMessage | Non menzionati |
| **GIF search integrata** (via Giphy/Tenor) | WhatsApp, Telegram, iMessage | Non menzionata |
| **Anteprima prima di inviare le foto** | Tutti | Non specificata nella UX |
| **Zoom delle foto in-chat** | Tutti | Non specificato |
| **Condivisione del profilo via QR code** | WhatsApp, Telegram, Signal | Solo link invito gruppo specificato |
| **Report utente / segnalazione abuso** | Tutti | Non specificato (solo abuse email menzionata in S-07) |
| **Blocco con password/biometria dell'app** | Tutti | Non specificato nel documento |
| **Notifica quando contatto si iscrive** | WhatsApp, Telegram | Non specificata |
| **Last Seen "poco fa" / "molto tempo fa"** (privacy granulare) | WhatsApp, Telegram | Solo on/off specificato — non la granularità |

---

## 8. Scorecard Tecnica

### 8.1 Valutazioni

---

#### Architettura: 7/10

**Punti forti:** Scelta corretta del monolite modulare per team di 1. Managed services dove appropriato. Separazione Core/Optional chiaramente definita.

**Cosa migliorare e come:**

1. **Abstraction Layer su Stream Chat (A-01):** Definire un'interfaccia `MessagingProvider` nel codice dall'inizio. Non richiede lavoro aggiuntivo — è un modo di organizzare il codice. Migliora il progetto perché rende possibile migrare da Stream senza riscrivere la logica di business.

2. **Incoerenza tra documenti (A-02):** Aggiungere una nota disambiguante in cima al documento di prodotto. Migliora il progetto perché elimina confusione per chiunque legga entrambi i documenti.

3. **`client_message_id` (A-03):** Aggiungere il campo allo schema e alla logica di routing dal primo sprint. Migliora il progetto perché elimina il bug dei messaggi duplicati che è visibile agli utenti.

4. **`sequence_number` per ordering (A-04):** Aggiungere alla collection `messages`. Migliora il progetto perché garantisce ordering deterministico in tutti gli scenari concorrenti.

5. **Canali V1 non specificati (A-05):** Scrivere la sezione Canali prima di Sprint 5. Migliora il progetto perché senza specifica lo sprint si blocca in fase di design.

---

#### Sicurezza: 5/10

**Punti forti:** Argon2id per password è la scelta corretta. Rate limiting su endpoint auth definito. MongoDB Atlas encryption at rest abilitata. JWT con scadenza breve.

**Cosa migliorare e come:**

1. **E2E falsa (S-01):** Scegliere Strada A (onestà sul TLS) o Strada B (E2E Stream reale). Migliora il progetto perché elimina una potenziale falsa dichiarazione con conseguenze legali e reputazionali.

2. **Phone number hashing (S-02):** Usare HMAC-SHA256 con chiave server-side invece di hashing semplice. Migliora il progetto perché rende il contact discovery resistente a attacchi di preimage.

3. **JWT blocklist per revoca (S-04):** Implementare blocklist Redis per JWT revocati. Migliora il progetto perché riduce la finestra di esposizione da 15 minuti a < 1 secondo in caso di furto dispositivo.

4. **Signed URL TTL (S-05):** Ridurre TTL da 24 ore a 1 ora. Migliora il progetto perché riduce la finestra in cui un URL compromesso permette accesso non autorizzato.

5. **Rate limiting completo (S-06):** Aggiungere rate limit su ricerca, contact discovery, OTP verification. Migliora il progetto perché chiude vettori di enumerazione e brute force.

6. **Content moderation (S-07):** Aggiungere abuse reporting e integrazione NCMEC. Migliora il progetto perché è un requisito legale in molte giurisdizioni per la beta pubblica.

7. **Certificate pinning (S-08):** Aggiungere allo Sprint 9. Migliora il progetto perché protegge gli utenti su reti corporate o VPN con certificate interception.

---

#### UX: 6/10

**Punti forti:** Filosofia UX ben articolata. Progressive disclosure. Gestualità naturale. Skeleton screens invece di spinner. Ottimistic updates definiti.

**Cosa migliorare e come:**

1. **Onboarding non specificato (UX-02):** Scrivere il flow schermata per schermata. Migliora il progetto perché l'onboarding è il momento in cui si vince o si perde l'utente — deve essere progettato, non improvvisato.

2. **Scelta email/telefono paralizzante (UX-01):** Scegliere un'opzione primaria chiara. Migliora il progetto perché riduce l'attrito alla registrazione — ogni schermata di scelta in meno aumenta il conversion rate.

3. **Error states non catalogati (UX-04):** Creare un catalogo degli stati di errore. Migliora il progetto perché gli errori gestiti male sembrano bug, gli errori gestiti bene sembrano funzionalità.

4. **Sticker e GIF mancanti (7.5):** Includere almeno un set di sticker di default e integrazione Tenor/Giphy. Migliora il progetto perché la loro assenza è immediatamente notata dagli utenti che arrivano da WhatsApp o Telegram.

5. **QR code profilo (7.5):** Aggiungere al V1. Migliora il progetto perché è il meccanismo di sharing più naturale in contesti fisici (presentazioni, eventi).

---

#### Scalabilità: 7/10

**Punti forti:** Percorso di crescita ben definito. MongoDB Atlas con sharding. Daily.co e Stream gestiscono la scala esternamente. Piano di migrazione verso Railway e poi AWS.

**Cosa migliorare e come:**

1. **Indici mancanti (P-04):** Aggiungere indici su `push_tokens.user_id`, `sessions.refresh_token_hash`, `contacts.user_id`. Migliora il progetto perché senza questi indici, le query più frequenti diventano lente già a 10K utenti.

2. **`deleted_for` query non scalabile (P-01):** Separare in collection `message_deletions_personal`. Migliora il progetto perché impedisce una query O(n) su ogni fetch della chat che peggiora linearmente con il numero di messaggi eliminati.

3. **Cache lista conversazioni (P-06):** Aggiungere caching Redis della home screen. Migliora il progetto perché la query più frequente dell'app non martella il database a ogni apertura.

4. **MongoDB M0 inadeguato (D-04):** Passare a M10 per staging e beta. Migliora il progetto perché M0 ha limiti che vengono raggiunti con pochi utenti reali.

---

#### Performance: 6/10

**Punti forti:** Presigned URL per upload (il server non gestisce il bandwidth). Ottimistic updates. Skeleton screens. Lazy loading. Virtualizzazione delle liste menzionata.

**Cosa migliorare e come:**

1. **Ordering messaggi (A-04, P-02):** `sequence_number` + specifica paginazione completa. Migliora il progetto perché senza ordering deterministico e paginazione definita, la lista messaggi ha bug visibili.

2. **SSRF e timeout sullo scraper (P-03):** Aggiungere validazione IP e timeout aggressivi. Migliora il progetto perché senza questi, un singolo link a un server lento può bloccare thread Node.js.

3. **Cache conversazioni (P-06):** Redis cache sulla home screen. Migliora il progetto perché riduce il carico su MongoDB per la query più frequente.

4. **Indici completi (P-04):** Migliora il progetto perché la performance delle query dipende interamente dalla qualità degli indici — indici mancanti = lentezza non scalabile.

---

#### Manutenibilità: 7/10

**Punti forti:** TypeScript strict ovunque. Struttura monorepo con `shared-types`. Zod per validazione. Moduli ben separati con regole di dipendenza definite.

**Cosa migliorare e come:**

1. **Duplicazione dati conversations/groups (A-07):** Unificare. Migliora il progetto perché due sorgenti di verità per la stessa entità creano bug di inconsistenza difficili da debuggare.

2. **BullMQ non dichiarato (A-06):** Aggiungere allo stack e risolvere incompatibilità con Upstash. Migliora il progetto perché un componente non documentato è un componente che ogni nuovo sviluppatore reinventa da zero.

3. **Incoerenza documenti (A-02):** Disambiguare i due documenti. Migliora il progetto perché la confusione architetturale è la causa principale di decisioni tecniche incoerenti durante lo sviluppo.

---

#### Facilità di Sviluppo: 7/10

**Punti forti:** Stack Node.js/TypeScript/React Native è la scelta più accessibile per 1 sviluppatore. Managed services riducono la complessità operativa. Expo Managed Workflow. Zod elimina la duplicazione tipo/validazione.

**Cosa migliorare e come:**

1. **Ambiente di sviluppo non specificato (D-01, D-02):** Definire la strategia degli environment. Migliora il progetto perché senza questa specifica, ogni sviluppatore configura il proprio ambiente in modo diverso, rendendo il debugging cross-environment impossibile.

2. **CI/CD non dettagliato (D-03):** Specificare il workflow GitHub Actions completo. Migliora il progetto perché una pipeline CI funzionante dall'inizio previene il fenomeno "funziona sul mio PC" che rallenta ogni deploy.

3. **Testing strategy assente:** Il documento non specifica come si testa il backend. Unit test? Integration test? Mocking di Stream Chat? Senza questa decisione, ogni sviluppatore testa diversamente e il coverage è imprevedibile.

4. **Canali V1 non specificati (A-05):** Migliora il progetto perché uno sprint senza specifica causa rework — lo sviluppatore implementa qualcosa, poi lo ridisegna dopo il chiarimento.

---

#### Esperienza Utente Complessiva: 6/10

**Punti forti:** Filosofia UX corretta. Ottimistic updates. Dark mode. Privacy controls granulari. Username-first (non telefono obbligatorio).

**Cosa migliorare e come:**

1. **Feature standard mancanti (7.5):** Sticker, GIF, QR code profilo, blocco app con biometria, album foto. Migliora il progetto perché un utente che arriva da WhatsApp o Telegram si aspetta queste feature come standard — la loro assenza crea una percezione di "app incompleta" indipendentemente dalla qualità di ciò che è presente.

2. **Onboarding non progettato (UX-02):** Progettare l'onboarding schermata per schermata. Migliora il progetto perché il tasso di completamento dell'onboarding è il KPI più importante per una nuova app — una UX onboarding scadente blocca la crescita.

3. **Chiamate di gruppo video (7.1):** Aggiungere videochiamate di gruppo (almeno 4 persone) al V1. WhatsApp lo ha e gli utenti se lo aspettano. Daily.co lo supporta senza configurazione aggiuntiva.

4. **"Chi ha visto" nei gruppi (7.1):** Feature di engagement fondamentale nei gruppi — gli utenti la cercano attivamente.

---

### 8.2 Riepilogo Scorecard

| Dimensione | Punteggio | Problemi Principali |
|---|:---:|---|
| **Architettura** | 7/10 | Vendor lock-in Stream, incoerenza documenti, ordering messaggi |
| **Sicurezza** | 5/10 | E2E falsa, phone hash non sicuro, JWT revoca, content moderation |
| **UX** | 6/10 | Onboarding non specificato, sticker/GIF mancanti, error states |
| **Scalabilità** | 7/10 | Indici mancanti, `deleted_for` non scalabile, MongoDB M0 |
| **Performance** | 6/10 | Query `deleted_for` O(n), SSRF scraper, cache mancante |
| **Manutenibilità** | 7/10 | Duplicazione conversations/groups, BullMQ non dichiarato |
| **Facilità di Sviluppo** | 7/10 | Environment strategy mancante, CI/CD non dettagliato, testing assente |
| **Esperienza Utente** | 6/10 | Feature standard mancanti, onboarding da progettare, gruppi video |

**Media complessiva: 6.4/10**

---

## 9. Alpha Chat Versione 1 — Checklist di Produzione

Questa sezione definisce le funzionalità **strettamente necessarie** per pubblicare una Beta Pubblica. Tutto ciò che non è in questa lista può essere aggiunto dopo il lancio senza impedire la pubblicazione.

Il criterio di inclusione è: **"Senza questa funzionalità, l'utente non può usare l'app per comunicare o l'app è insicura / illegale da pubblicare."**

---

### BLOCCO 1 — Identità e Accesso

- [ ] **Registrazione con email + password** (Argon2id, verifica email obbligatoria)
- [ ] **Login con email + password** (JWT RS256/ES256, refresh token HttpOnly)
- [ ] **Registrazione con numero di telefono + OTP SMS** (Twilio, TTL 5 min, max 3 tentativi)
- [ ] **Claim username unico** (3–32 caratteri, case-insensitive, atomico, verificato)
- [ ] **Logout da tutti i dispositivi** (revoca tutti i refresh token dell'utente)
- [ ] **Recovery password via email** (token UUID, TTL 1 ora, invalidato dopo uso)
- [ ] **Sessioni per device visibili e revocabili** dall'utente dalle impostazioni
- [ ] **Profilo utente minimo:** nome visualizzato, foto profilo opzionale, bio opzionale
- [ ] **HTTPS obbligatorio** su tutti gli endpoint — nessun endpoint HTTP in produzione

---

### BLOCCO 2 — Chat Privata (1-to-1)

- [ ] **Invio e ricezione messaggi di testo** in tempo reale
- [ ] **Delivery status:** inviato ✓ / consegnato ✓✓ / letto ✓✓ (blu)
- [ ] **Typing indicator** ("sta scrivendo...")
- [ ] **Reply inline:** risposta a messaggio specifico con anteprima visibile
- [ ] **Aggiunta contatti via @username** (ricerca esatta, non parziale di default)
- [ ] **Blocco utente:** l'utente bloccato non può inviare messaggi né vedere l'online status
- [ ] **Eliminazione messaggi:** "solo per me" e "per tutti" (con limite 24h per utenti non-admin)
- [ ] **`client_message_id`** per idempotenza (nessun duplicato in caso di retry)
- [ ] **Ordering deterministico** dei messaggi (sequence_number monotonic o equivalente)
- [ ] **Sincronizzazione multi-device:** i messaggi appaiono su tutti i device dell'utente

---

### BLOCCO 3 — Chat di Gruppo

- [ ] **Creazione gruppo** con nome e foto opzionale
- [ ] **Aggiunta e rimozione membri** (fino a 500 partecipanti)
- [ ] **Ruoli:** Owner / Admin / Member con permessi differenziati
- [ ] **Link di invito** generato dall'admin, revocabile
- [ ] **Menzioni @username** con notifica diretta al menzionato
- [ ] **Eliminazione messaggi con permessi admin:** gli admin possono eliminare qualsiasi messaggio senza limite temporale
- [ ] **Impostazioni gruppo base:** nome, foto, chi può inviare messaggi, chi può aggiungere membri
- [ ] **Uscita dal gruppo** (con o senza trasferimento ownership se Owner)
- [ ] **Eliminazione gruppo** (solo Owner)

---

### BLOCCO 4 — Media

- [ ] **Invio foto:** compressione client-side, thumbnail istantanea, preview full-res lazy
- [ ] **Invio video:** thumbnail post-upload, progress indicator, limite 100MB
- [ ] **Invio documenti:** PDF e formati comuni, limite 100MB, download con signed URL
- [ ] **Messaggi vocali:** registrazione, waveform visuale, riproduzione, velocità 1x/1.5x/2x
- [ ] **Strip EXIF metadata GPS** da tutte le immagini prima dello storage
- [ ] **Signed URL per lettura** con TTL 1 ora (non pubblicamente accessibili)
- [ ] **Eliminazione media da R2** asincrona quando il messaggio è eliminato "per tutti"

---

### BLOCCO 5 — Chiamate

- [ ] **Chiamata vocale 1-to-1** (Daily.co, qualità adattiva)
- [ ] **Videochiamata 1-to-1** (Daily.co, adaptive bitrate)
- [ ] **UI chiamata in ingresso:** overlay full-screen, accetta / rifiuta
- [ ] **In-call controls:** mute, speaker, flip camera, hangup, timer durata
- [ ] **Notifica push per chiamata in ingresso** anche quando l'app è chiusa

---

### BLOCCO 6 — Notifiche

- [ ] **Push notification per nuovo messaggio** (Expo Push → APNs/FCM)
- [ ] **Push notification per menzione** in gruppo
- [ ] **Push notification per chiamata in ingresso**
- [ ] **Payload push senza testo del messaggio** (solo `conversation_id` e `notification_type`)
- [ ] **Mute per-chat** (silenzio notifiche per una specifica conversazione)
- [ ] **Web Push via Service Worker** per l'app web

---

### BLOCCO 7 — Privacy e Sicurezza

- [ ] **Controllo "Ultimo accesso":** visibile a tutti / solo contatti / nessuno
- [ ] **Controllo "Conferme di lettura":** on / off per account
- [ ] **Controllo "Online status":** visibile a tutti / solo contatti / nessuno
- [ ] **Rate limiting** su tutti gli endpoint write (auth, messaggi, upload, ricerca, OTP)
- [ ] **Input validation Zod** su tutte le route backend
- [ ] **Security headers Helmet.js** (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)
- [ ] **MongoDB Atlas network access** limitato all'IP del backend
- [ ] **Nessun secret nel codice** — tutti in variabili d'ambiente
- [ ] **Abuse reporting:** indirizzo email visibile nella app per segnalazioni
- [ ] **Terms of Service e Privacy Policy** pubblicati e accessibili dall'app prima della registrazione

---

### BLOCCO 8 — Infrastruttura e Affidabilità

- [ ] **MongoDB Atlas M10 o superiore** per staging e produzione (non M0)
- [ ] **Backup point-in-time attivo** su MongoDB Atlas
- [ ] **Procedura di restore testata** prima del lancio della beta
- [ ] **3 ambienti separati:** development / staging / production con database e API key distinti
- [ ] **Sentry configurato** su backend e client — ogni errore non gestito tracciato
- [ ] **UptimeRobot o equivalente** su `/api/v1/health` con alert
- [ ] **Gestione connessione persa:** banner visibile all'utente + retry automatico
- [ ] **Stato "messaggio non inviato"** con indicatore visivo e pulsante retry
- [ ] **GitHub Actions CI** funzionante: lint + typecheck + test su ogni PR
- [ ] **Deploy staging automatico** su merge su `main`
- [ ] **Deploy produzione con approvazione manuale** (non automatico su push)

---

### BLOCCO 9 — UX Minima Non Negoziabile

- [ ] **Onboarding flow completo:** registrazione → verifica email → username → foto profilo (opzionale) → permessi notifiche → prima chat
- [ ] **Empty states:** lista chat vuota, nessun contatto, nessun risultato ricerca, galleria vuota
- [ ] **Loading states:** skeleton screen (non spinner generici) per lista chat e messaggi
- [ ] **Dark mode e Light mode** con rilevamento automatico preferenza di sistema
- [ ] **Scroll to unread messages** all'apertura di una chat con messaggi non letti
- [ ] **App utilizzabile su connessione lenta (3G)** — testo funziona offline (cache locale), media si caricano progressivamente
- [ ] **Blocco app con biometria / PIN** (opzionale ma attivabile nelle impostazioni)
- [ ] **QR code del profilo** per condivisione in contesti fisici

---

### BLOCCO 10 — Conformità Legale (Obbligatoria per Beta Pubblica)

- [ ] **Privacy Policy** conforme GDPR pubblicata e accessibile
- [ ] **Terms of Service** pubblicati e accettati esplicitamente dall'utente alla registrazione
- [ ] **Meccanismo di cancellazione account** con rimozione di tutti i dati entro 30 giorni
- [ ] **Data export:** l'utente può richiedere e scaricare tutti i suoi dati (DSAR - GDPR Art. 20)
- [ ] **Cookie banner** (se presente tracking, anche anonimo come PostHog)
- [ ] **Abuse reporting operativo:** processo interno per gestire le segnalazioni prima del lancio
- [ ] **App Store guidelines compliance:** verifica lista controllo Apple App Store Review e Google Play Policy prima della submission
- [ ] **Età minima dichiarata** (13 o 16 anni secondo giurisdizione) e meccanismo di verifica minima

---

### Criteri di Uscita dalla Beta

La Beta Pubblica è pronta quando:

1. Tutti i 10 blocchi della checklist sono completati al 100%
2. Load test con 500 utenti concorrenti in staging senza degradazione
3. Lista messaggi: scroll 60fps su iPhone 12 e su Android fascia media (Pixel 6a o equivalente)
4. Apertura app: < 2 secondi su connessione 4G
5. Invio messaggio: appare in UI < 100ms (ottimistic update)
6. MongoDB query principali: P99 < 50ms (verificato con Atlas Performance Advisor)
7. Beta chiusa (50–100 utenti) completata senza bug critici aperti
8. Privacy Policy e ToS rivisti da consulente legale

---

*Documento preparato per il team Alpha Chat*
*Technical Review v1.0 — Luglio 2025*
*Revisori: Principal Software Architect · Senior Security Engineer · Senior Performance Engineer · Senior UX Designer · DevOps Architect*
