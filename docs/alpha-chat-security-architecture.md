# Alpha Chat — Security Architecture
### Priorità Assoluta: Portare la Sicurezza da 5/10 a 9/10
> Versione 1.0 — Luglio 2025
> Status: Pre-Development — Security Design Phase
> Contesto: Nessuna nuova funzionalità viene sviluppata finché questo documento non è implementato integralmente.

---

## Premessa

La sicurezza non è una feature. Non è uno sprint. Non è una checklist da fare alla fine.

È un attributo architetturale che deve essere progettato nel sistema prima che esista una riga di codice. Un sistema sicuro non nasce dall'aggiunta di sicurezza a un sistema insicuro — nasce da decisioni di progettazione prese all'inizio.

Questo documento:
1. Analizza ogni problema di sicurezza identificato nella Technical Review
2. Aggiorna l'architettura di ogni componente per riflettere le decisioni di sicurezza
3. Definisce la Security Roadmap — le attività da completare prima dello sviluppo

**Tutti i protocolli crittografici usati sono standard consolidati e pubblicamente verificati. Nessun algoritmo proprietario.**

---

## Indice

1. [Analisi dei Problemi di Sicurezza](#1-analisi-dei-problemi-di-sicurezza)
2. [Architettura di Sicurezza Aggiornata](#2-architettura-di-sicurezza-aggiornata)
3. [Security Roadmap — Pre-Development](#3-security-roadmap--pre-development)

---

## 1. Analisi dei Problemi di Sicurezza

### 1.1 Formato dell'Analisi

Per ogni problema:
- **Descrizione tecnica:** cosa è il problema in dettaglio
- **Rischio:** quale attacco o danno abilita
- **Probabilità:** quanto è probabile che venga sfruttato
- **Impatto:** conseguenze se sfruttato
- **Soluzione:** protocollo/meccanismo standard adottato
- **Difficoltà di implementazione:** stima realistica per 1 sviluppatore
- **Priorità:** ordine di risoluzione

---

### SEC-01 — E2E Encryption Dichiarata ma Non Implementata
**Priorità: CRITICA — Risolve prima di tutto il resto**

**Descrizione tecnica:**
Il documento di prodotto dichiara E2E encryption come P0 per chat 1-to-1 e di gruppo. Il documento MVP specifica che la beta chiusa usa TLS in transit + encryption at rest MongoDB. TLS e encryption at rest sono protezioni server-side: il server Alpha Chat e il server Stream Chat possono leggere ogni messaggio in chiaro. Questo non è E2E. End-to-End Encryption significa per definizione che **solo i dispositivi dei partecipanti** possono leggere il contenuto — nessun server intermedio, inclusi quelli di Alpha Chat.

**Rischio:**
- Violazione della fiducia degli utenti se la realtà viene scoperta
- Rischio legale per pubblicità ingannevole (EU Consumer Rights Directive, GDPR Art. 5(1)(a) — principio di lealtà)
- In caso di data breach del server, tutti i messaggi di tutti gli utenti sono esposti in chiaro
- In caso di ordine dell'autorità giudiziaria, Alpha Chat può essere obbligata a consegnare i messaggi in chiaro

**Probabilità di sfruttamento:** Alta — qualsiasi ricercatore di sicurezza che analizza il traffico di rete può verificare in pochi minuti se la E2E è reale o simulata.

**Impatto:** Catastrofico — reputazionale, legale, e sulla fiducia degli utenti. Un'app di messaging smascherata per falsa E2E non si riprende.

**Soluzione — Signal Protocol (libsignal)**

Si adotta il **Signal Protocol** tramite la libreria ufficiale `libsignal` (open source, mantenuta da Signal Foundation). È il protocollo più verificato al mondo per la messaggistica E2E.

Il Signal Protocol si compone di:

**X3DH (Extended Triple Diffie-Hellman) — Key Agreement Iniziale**
- Permette a due utenti di stabilire un segreto condiviso senza mai comunicarlo direttamente
- Basato su Curve25519 (ECDH) — curva ellittica standard, raccomandazione NIST
- Ogni utente pubblica sul server: Identity Key (IK), Signed PreKey (SPK), One-Time PreKeys (OPK)
- Il server conserva solo le chiavi pubbliche — non può ricostruire il segreto

**Double Ratchet Algorithm — Sessione E2E**
- Ogni messaggio usa una chiave di cifratura diversa (derivata da una chain di ratchet)
- Forward Secrecy: anche se la chiave privata a lungo termine viene compromessa, i messaggi passati rimangono illeggibili
- Break-in recovery: dopo una compromissione, il protocollo ripristina la sicurezza automaticamente
- Basato su HKDF (HMAC-based Key Derivation Function, RFC 5869)

**Cifratura simmetrica dei messaggi: AES-256-GCM**
- Algoritmo simmetrico autenticato (AEAD)
- Standard NIST, usato da TLS 1.3, Signal, WhatsApp
- Produce ciphertext + authentication tag — il destinatario verifica autenticità e integrità prima di decifrare

**Architettura risultante:**
```
Mittente (device)                    Server Alpha Chat              Destinatario (device)
│                                           │                              │
│── Cifra messaggio con Double Ratchet ──→  │ ← Testo cifrato (opaco) →   │
│                                           │                              │── Decifra con Double Ratchet
│                                           │                              │
│   SERVER NON PUÒ LEGGERE IL CONTENUTO     │
```

**Gestione chiavi:**
- Le coppie di chiavi sono generate e conservate esclusivamente sul dispositivo (Keychain iOS / Android Keystore)
- Il server conserva solo le chiavi pubbliche necessarie per X3DH
- Al cambio di device, l'utente ri-esegue l'X3DH con i nuovi contatti alla prima riapertura delle chat

**Relazione con Stream Chat:**
Stream Chat viene usato come **transport layer** (delivery, ordering, sincronizzazione multi-device), non come layer di sicurezza. Il contenuto che Stream vede è ciphertext opaco. Stream non può decifrarlo. Questo è il modello esatto usato da Skype (in certi scenari) e dalla maggior parte dei sistemi E2E su infrastruttura managed.

**Nota su V1 vs Beta:**
- **Beta chiusa (prime 100 persone):** TLS + at-rest encryption, con dichiarazione onesta all'utente ("La E2E completa è in sviluppo attivo")
- **Beta pubblica:** E2E via libsignal obbligatoria — nessun utente pubblico senza E2E reale

**Difficoltà di implementazione:** Alta (3–4 settimane di Sprint dedicato). `libsignal` ha binding JavaScript/TypeScript. La complessità è nella gestione del key store sul device, nella sincronizzazione multi-device delle prekey, e nel bundle management.

---

### SEC-02 — Phone Number Hashing Vulnerabile a Dictionary Attack
**Priorità: ALTA**

**Descrizione tecnica:**
Il contact discovery permette agli utenti di trovare contatti caricando la rubrica hashata. Se si usa SHA-256 o MD5 senza salt sui numeri di telefono, l'hash è riproducibile: i numeri di telefono hanno uno spazio finito (~10^10 per paese). Un attaccante con accesso al database può generare tutti i numeri di un paese, hashare ognuno, e confrontare con i valori nel database. Questo attacco è noto come **preimage attack su dizionario finito** e richiede meno di un'ora su hardware commodity.

**Rischio:**
- Enumerazione completa della user base (chi usa Alpha Chat)
- Collegamento di identità reali (numeri di telefono) agli account
- Violazione del principio di privacy by design

**Probabilità:** Media-Alta — richiede accesso al database (data breach) o accesso a un account con permessi admin. Non è un attacco remoto diretto.

**Impatto:** Alto — espone dati PII (numeri di telefono) di tutti gli utenti che hanno usato il contact discovery.

**Soluzione — HMAC-SHA256 con Server Secret + Pepper**

Si usa **HMAC-SHA256** (RFC 2104) con una chiave segreta server-side (chiamata "pepper"):

```
phone_hash = HMAC-SHA256(key=SERVER_PEPPER, message=E164_normalized_number)
```

Dove:
- `SERVER_PEPPER` è una chiave segreta di 32 byte, generata crittograficamente, conservata come secret di ambiente (mai nel database)
- Il numero è normalizzato in formato E.164 prima dell'hashing (`+39XXXXXXXXXX`)
- Il risultato è un hash non riproducibile senza la chiave server

**Proprietà risultanti:**
- Senza `SERVER_PEPPER`, il database è inutile per un attaccante — non può verificare se un numero corrisponde a un hash
- Con rotazione periodica del `SERVER_PEPPER` (ogni 6 mesi), tutti gli hash diventano obsoleti — il discovery richiede re-upload della rubrica
- Il server non conserva il numero in chiaro — conserva solo l'hash

**Nota di implementazione:**
Il numero in chiaro non deve mai essere loggato, tracciato in analytics, o incluso nei body delle richieste API. Il client hasha prima di inviare; il server confronta hash con hash.

**Difficoltà di implementazione:** Bassa (< 1 giorno). HMAC-SHA256 è disponibile nella standard library di Node.js (`crypto.createHmac`). La complessità è principalmente nella normalizzazione E.164 e nella gestione della rotazione del pepper.

---

### SEC-03 — Incoerenza Algoritmo JWT: RS256 vs ES256
**Priorità: MEDIA**

**Descrizione tecnica:**
Il documento MVP specifica RS256 (RSA + SHA256), il documento di prodotto specifica ECDSA P-256 (ES256). RS256 usa chiavi RSA da 2048+ bit; ES256 usa chiavi su curva ellittica P-256 (256 bit, sicurezza equivalente a RSA 3072). I due algoritmi non sono interoperabili. Lo stesso codebase non può usare entrambi senza gestire due set di chiavi.

**Rischio:** Non è un rischio di sicurezza diretto — entrambi sono sicuri. Il rischio è operativo: incoerenza nella documentazione porta a implementazioni divergenti.

**Probabilità di errore:** Medio — chiunque implementi l'auth si trova due indicazioni contraddittorie.

**Impatto:** Medio — se implementato in modo incoerente, i token generati da un servizio non sono verificabili da un altro.

**Soluzione — Adozione di ES256 (ECDSA P-256)**

**ES256** è la scelta standard moderna:
- Chiavi 3x più piccole di RSA equivalente → token più compatti
- Operazioni di firma e verifica più veloci
- Raccomandato da RFC 7518, RFC 8037 e da Google, Apple, Auth0
- Supportato nativamente da `jose` (libreria JWT TypeScript raccomandata)

**Specifica tecnica JWT per Alpha Chat:**

```
Header:  { "alg": "ES256", "typ": "JWT" }

Payload Access Token:
{
  "sub":  "<user_id>",          // subject — user MongoDB ObjectId
  "did":  "<device_id>",        // device che ha effettuato il login
  "jti":  "<uuid_v4>",          // JWT ID univoco (per revoca)
  "iat":  <unix_timestamp>,
  "exp":  <iat + 900>,          // 15 minuti
  "scope": "access"
}

Firma: ECDSA P-256 con chiave privata conservata come env secret
```

**Gestione chiavi:**
- Chiave privata EC P-256 generata una volta, conservata in variabile d'ambiente (`JWT_PRIVATE_KEY` in formato PEM)
- Chiave pubblica derivata dalla privata, disponibile a tutti i servizi per la verifica (può essere pubblica)
- Rotazione chiavi: ogni 90 giorni, con overlap di 24h (il vecchio token continua ad essere accettato durante la transizione)
- Coppia di chiavi separata per staging e produzione — mai la stessa chiave

**Difficoltà di implementazione:** Bassa (< 1 giorno). `jose` (libreria npm) gestisce ES256 in modo completo.

---

### SEC-04 — JWT Senza Meccanismo di Revoca Rapida
**Priorità: ALTA**

**Descrizione tecnica:**
I JWT access token hanno durata 15 minuti e sono stateless — il server non conserva stato per ogni token. Se un token viene compromesso (device rubato, leak in un log), rimane valido fino alla scadenza naturale. Con logout remoto, il refresh token viene revocato (il device non può più ottenere nuovi access token dopo 15 minuti) ma il token corrente rimane valido per la finestra residua.

**Rischio:**
- Device rubato alle 09:00, logout remoto alle 09:05: l'attaccante ha 10 minuti di accesso pieno
- Token presente in un log o in una cache HTTP intercettata: valido fino alla scadenza
- Cambio password non invalida immediatamente i token attivi

**Probabilità:** Media — richiede accesso al token, ma i token compaiono in log di server, reverse proxy, CDN.

**Impatto:** Alto — 15 minuti sono sufficienti per scaricare storico messaggi, inviare messaggi, modificare il profilo.

**Soluzione — JWT Blocklist in Redis con `jti` Claim**

Ogni JWT access token include un campo `jti` (JWT ID) univoco (UUID v4). Al momento della revoca (logout, logout remoto, cambio password, cambio email), il `jti` viene inserito in una **blocklist Redis** con TTL pari alla scadenza residua del token.

**Flusso di verifica:**
```
Request autenticata
        ↓
Verifica firma JWT (ES256) — stateless, O(1) crittografico
        ↓
Estrai jti dal payload
        ↓
Redis GET "blocklist:{jti}" — O(1), < 1ms
        ↓
Se esiste → 401 Unauthorized (token revocato)
Se non esiste → richiesta autorizzata
```

**Costo operativo:**
- Una query Redis O(1) per ogni request autenticata — < 1ms di overhead
- La blocklist si auto-pulisce tramite TTL Redis — nessun cleanup manuale
- In caso Redis sia temporaneamente non disponibile: fail-safe (si accetta il token, non si blocca il sistema) con logging dell'anomalia

**Trigger di revoca:**
| Evento | Azione |
|---|---|
| Logout dal device corrente | Revoca il `jti` del token corrente + invalida refresh token |
| Logout remoto da altro device | Invalida il refresh token del device target (nessun jti da revocare — non si conosce il token attivo) |
| Cambio password | Revoca tutti i refresh token dell'utente + inserisce in blocklist tutti i `jti` delle sessioni attive |
| Cambio email | Come cambio password |
| Rilevamento anomalia | Come cambio password |
| Sospensione account | Come cambio password |

**Difficoltà di implementazione:** Bassa-Media (1–2 giorni). Redis già presente in stack. Il middleware auth aggiunge una query Redis.

---

### SEC-05 — Signed URL Media con TTL 24 Ore
**Priorità: ALTA**

**Descrizione tecnica:**
Ogni URL per leggere un media da Cloudflare R2 è un presigned URL con TTL 24 ore. Questo crea scenari di accesso non autorizzato:
- Un utente espulso da un gruppo può accedere ai media inviati prima dell'espulsione per 24 ore dopo aver perso l'accesso
- Un messaggio eliminato "per tutti" ha il media rimosso da R2, ma un URL firmato ottenuto prima dell'eliminazione rimane valido
- URL presenti in log di rete (proxy, CDN, analytics) permettono accesso non autorizzato

**Rischio:**
- Accesso a contenuti dopo revoca dei permessi
- Persistenza di accesso a media di messaggi eliminati
- Leak di media privati tramite URL intercettati in log

**Probabilità:** Media — il caso "URL in log di rete" è quasi certo in ambienti corporate.

**Impatto:** Medio-Alto — privacy degli utenti e coerenza con il comportamento di eliminazione.

**Soluzione — Signed URL con TTL 1 ora + Refresh Client-Side + Token Binding**

**TTL ridotto:**
- Immagini e video: TTL **1 ora**
- Documenti sensibili: TTL **15 minuti**
- Thumbnail: TTL **6 ore** (meno sensibili, più frequentemente richieste)

**Refresh client-side:**
Il client tiene traccia della scadenza degli URL. Quando un URL è a meno di 5 minuti dalla scadenza e il media è ancora visibile sullo schermo, richiede silenziosamente un nuovo URL al backend. Il backend verifica i permessi attuali prima di generare il nuovo URL — se l'utente non ha più accesso (espulso dal gruppo, chat eliminata), restituisce 403.

**Verifica permessi al momento della generazione del signed URL:**
Il backend, prima di generare il presigned URL, verifica che l'utente richiedente abbia ancora accesso alla conversazione che contiene il media. Non è sufficiente avere l'`media_id` — serve appartenere alla conversazione.

**Invalidazione per messaggi eliminati:**
Cloudflare R2 non supporta l'invalidazione di signed URL individuali. La strategia è:
1. Eliminare il file da R2 immediatamente all'eliminazione del messaggio (non asincrono con 1 ora di delay come specificato nel documento MVP — questo va corretto)
2. I signed URL esistenti puntano a un oggetto che non esiste più → R2 restituisce 404
3. L'eliminazione da R2 è sincrona per la logica di business, anche se l'effettiva propagazione nel CDN può avere latenza minima

**Difficoltà di implementazione:** Bassa (< 1 giorno). Modifica al TTL nei parametri di generazione URL + aggiunta verifica permessi.

---

### SEC-06 — Rate Limiting Incompleto: Endpoint di Discovery e OTP Vulnerabili
**Priorità: ALTA**

**Descrizione tecnica:**
Il rate limiting definito copre solo gli endpoint principali (auth, messaggi, upload). Mancano protezioni su endpoint che abilitano:
- **Enumerazione username:** `GET /api/v1/users?username=X` senza rate limit permette verificare in automatico l'esistenza di qualsiasi username
- **Bulk phone lookup:** il contact discovery senza rate limit permette verificare migliaia di numeri per sessione
- **OTP brute force:** "max 3 tentativi" senza definire il meccanismo di lockout — un attaccante può aprire nuove sessioni
- **Invite link scraping:** leggere i metadati di un gruppo via link pubblico senza rate limit

**Rischio:**
- Enumerazione della user base (chi usa Alpha Chat, quali username esistono)
- Brute force OTP: con 6 cifre e nessun lockout efficace, la probabilità di indovinare un OTP è 1/1.000.000 — con 1.000 tentativi/secondo si risolve in 17 minuti
- Profilazione dei gruppi tramite link pubblici

**Probabilità:** Alta — questi attacchi sono automatizzabili e non richiedono competenze avanzate.

**Impatto:** Medio-Alto — privacy degli utenti e sicurezza dell'account.

**Soluzione — Tabella Rate Limiting Completa**

Strategia: **sliding window** in Redis per tutti gli endpoint, con due dimensioni di rate limiting in parallelo: per IP e per user_id/device_id (quando disponibile).

| Endpoint | Limite per IP | Limite per User | Lockout |
|---|---|---|---|
| `POST /auth/register` | 5/ora | — | 24h dopo 10 tentativi |
| `POST /auth/login` | 10/15min | 5/15min | 1h dopo 10 tentativi |
| `POST /auth/otp/send` | 3/ora | 3/ora | 24h dopo 5 tentativi |
| `POST /auth/otp/verify` | 3/codice | 3/codice | Lock OTP specifico dopo 3 errori |
| `POST /auth/refresh` | 30/ora | 30/ora | — |
| `POST /auth/password-reset` | 3/ora | 3/24h | — |
| `GET /users/search` | 30/min | 30/min | — |
| `POST /contacts/discover` | 1/ora | 1/ora | — |
| `GET /invite/:token` | 20/min | — | — |
| `POST /messages` | 100/min | 100/min | — |
| `POST /media/upload-url` | 20/min | 20/min | — |
| `POST /media/confirm` | 20/min | 20/min | — |
| `POST /calls/create` | 10/min | 10/min | — |

**OTP Lockout specifico:**
Ogni OTP ha un limite di 3 tentativi di verifica associato al codice stesso (non solo all'IP). Dopo 3 errori, l'OTP viene invalidato e l'utente deve richiederne uno nuovo (soggetto al rate limit di invio). Ogni nuovo OTP invalida i precedenti.

**Progressive lockout per login:**
Dopo N tentativi falliti:
- 5 tentativi: CAPTCHA obbligatorio (hCaptcha o Cloudflare Turnstile — no Google reCaptcha per privacy)
- 10 tentativi: blocco account con notifica email
- Sblocco: link via email con verifica di identità

**Difficoltà di implementazione:** Media (3–4 giorni). Il middleware Redis per sliding window è già nell'architettura — si estende a tutti gli endpoint mancanti.

---

### SEC-07 — Content Moderation e Obblighi Legali Assenti
**Priorità: ALTA (prerequisito legale per Beta Pubblica)**

**Descrizione tecnica:**
Alpha Chat nella sua specifica attuale non ha nessun meccanismo per:
- Rilevare e riportare CSAM (Child Sexual Abuse Material) — obbligo legale in EU (Regulation 2021/1232, in attesa di conferma della proposta Chat Control), USA (NCMEC reporting, 18 U.S.C. § 2258A), e la maggior parte delle giurisdizioni
- Gestire segnalazioni di contenuti illegali
- Rispondere a richieste legali di autorità (preservation orders, etc.)

**Rischio:**
- Responsabilità penale per gli operatori della piattaforma in alcune giurisdizioni
- Sanzioni GDPR per mancata risposta a richieste di Data Subject
- Shutdown della app negli App Store se violano le policy Apple/Google su contenuti illegali

**Probabilità di necessità:** Certa — qualsiasi piattaforma pubblica riceve segnalazioni di abuso.

**Impatto:** Catastrofico se non gestito — rischio legale personale per i fondatori.

**Soluzione — Minimum Viable Compliance per Beta Pubblica**

**CSAM Detection (PhotoDNA / NCMEC)**
I media caricati su R2 vengono sottoposti a hash matching con il database NCMEC (National Center for Missing & Exploited Children) tramite il servizio **PhotoDNA Cloud Service** di Microsoft (o il modulo NCMEC diretto). Questo processo:
- Non rompe la E2E: avviene lato server sui media in chiaro (i media non-E2E sono accessibili al server; per i media E2E, il client può opzionalmente inviare l'hash prima di cifrare — Signal usa questo approccio con perceptual hashing)
- Produce solo una corrispondenza positiva/negativa — non accede al contenuto
- In caso di match: report automatico a NCMEC, blocco del file, sospensione dell'account

**In-app Reporting**
Ogni messaggio ha un'opzione "Segnala" nel menu contestuale (long press). Le segnalazioni vanno in una coda interna (`reports` collection MongoDB) con:
- `reporter_id`, `reported_message_id`, `reported_user_id`
- `reason` (enum: spam, harassment, illegal_content, csam, other)
- `timestamp`, `status` (pending / reviewed / actioned)

Per V1, il processo di review è manuale (un admin legge le segnalazioni). Per V2, si aggiunge un sistema di moderazione strutturato.

**Legal Compliance Contact**
- Email `legal@alphachat.app` pubblicata nelle policy e accessibile dall'app
- Email `abuse@alphachat.app` per segnalazioni di abuso urgenti
- Entrambe monitorate con SLA di risposta: 24h per CSAM, 72h per altri contenuti illegali

**Privacy Policy e Terms of Service**
Obbligatori prima della beta pubblica:
- Privacy Policy conforme GDPR (Art. 13/14 — informazioni al momento della raccolta dati)
- Terms of Service con clausola di età minima (16 anni in EU per GDPR)
- Data Retention Policy esplicita
- Cookie/tracking policy (PostHog richiede consenso in EU)

**Difficoltà di implementazione:** Media (1 settimana). PhotoDNA richiede approvazione Microsoft (processo ~1-2 settimane). La `reports` collection e la UI di segnalazione sono rapide da implementare.

---

### SEC-08 — Certificate Pinning Assente nei Client Mobile
**Priorità: MEDIA**

**Descrizione tecnica:**
Senza certificate pinning, un'app mobile accetta qualsiasi certificato TLS firmato da una Certificate Authority riconosciuta dal sistema operativo. In reti corporate, VPN aziendali, o ambienti con proxy di ispezione SSL (Burp Suite, mitmproxy), un certificato intercettatore valido permette di decifrare tutto il traffico HTTPS — inclusi i token JWT, le richieste API, e i metadati delle conversazioni (non il contenuto E2E, ma i metadata sì).

**Rischio:**
- Intercettazione di JWT access token → impersonazione dell'utente
- Intercettazione dei metadati delle conversazioni (chi parla con chi, quando)
- Man-in-the-middle dell'handshake WebSocket con Stream Chat

**Probabilità:** Medio-Bassa per utenti consumer. Alta per utenti in ambienti corporate con proxy di ispezione.

**Impatto:** Alto — compromissione dell'account.

**Soluzione — Public Key Pinning + Backup Pin**

Si usa **HTTP Public Key Pinning** a livello applicativo (non l'header HPKP deprecato). Nella app React Native, si usa la libreria `react-native-ssl-public-key-pinning`:

```
Configurazione pin:
- Domain: api.alphachat.app
- Primary pin: SHA-256 hash della chiave pubblica del certificato corrente
- Backup pin: SHA-256 hash della chiave pubblica del certificato di riserva (non ancora in uso)
```

**Regole operative obbligatorie:**
1. **Mai deployare senza backup pin** — se il certificato viene ruotato senza backup pin configurato, l'app smette di funzionare per tutti gli utenti
2. La procedura di rotazione del certificato richiede: 1) deploy del backup pin, 2) attesa che il 95% degli utenti aggiorni l'app, 3) rotazione del certificato, 4) aggiornamento del primary pin nel prossimo release
3. Il pin viene verificato solo per `api.alphachat.app` — non per CDN Cloudflare o Stream Chat (domini di terze parti con certificati che cambiano più frequentemente)

**Difficoltà di implementazione:** Bassa-Media (1–2 giorni). La libreria gestisce la verifica. La complessità è nel processo operativo di rotazione.

---

### SEC-09 — Nessuna Strategia di Anomaly Detection e Incident Response
**Priorità: MEDIA**

**Descrizione tecnica:**
Il documento attuale specifica Sentry per error tracking e UptimeRobot per uptime. Non esiste nessuna specifica per:
- Rilevare accessi anomali (login da paese mai visto, login da 5 device diversi in un'ora)
- Rilevare pattern di attacco in corso (brute force, scraping, DDoS applicativo)
- Rispondere a un incident (cosa si fa se si scopre un breach alle 3 di notte?)

**Rischio:**
- Un attacco in corso passa inosservato per ore o giorni
- Senza un piano di risposta, il tempo di reazione a un breach è caotico e lungo
- I danni si amplificano con il ritardo nella risposta

**Probabilità di incident:** Alta — qualsiasi servizio pubblico viene attaccato.

**Impatto:** Dipende dalla risposta. Un breach gestito in 30 minuti ha impatto diverso da uno gestito in 48 ore.

**Soluzione — Anomaly Detection Minima + Incident Response Plan**

**Anomaly Detection (V1 — Regole semplici in Redis)**

Si implementano alert automatici per:

| Anomalia | Trigger | Azione |
|---|---|---|
| Login da nuovo paese | IP geolocalizzato in paese mai usato dall'utente | Email di notifica all'utente + challenge 2FA |
| Login concorrente su 5+ device | Più di 5 refresh token attivi simultanei | Notifica all'utente con lista device |
| 100+ messaggi in 1 minuto | Contatore Redis per user_id | Throttle automatico + alert admin |
| 10+ tentativi OTP falliti nello stesso giorno | Contatore Redis per user_id | Lock account + alert admin |
| Upload di 50+ file in 1 ora | Contatore Redis per user_id | Throttle + review manuale |
| Accesso API da IP non presente nella whitelist server | Log MongoDB | Alert immediato — possibile SSRF o pivot |

**Incident Response Plan (IRP) — Documento separato obbligatorio pre-lancio**

Il documento IRP deve definire:
1. **Detection:** come ci accorgiamo di un incident (alert automatici, segnalazione esterna)
2. **Triage:** come si valuta la gravità (P1/P2/P3)
3. **Containment:** azioni immediate (disabilitare endpoint, revocare token, isolare componente)
4. **Notification:** quando e come si notificano gli utenti (GDPR richiede notifica entro 72h per data breach che costituisce rischio per i diritti degli interessati)
5. **Recovery:** come si ripristina il servizio normale
6. **Post-mortem:** analisi e misure preventive

**Difficoltà di implementazione:** Media (3–4 giorni per l'anomaly detection; il documento IRP richiede 1 giorno di scrittura separata).

---

### SEC-10 — Gestione Secrets: Variabili d'Ambiente Non Strutturata
**Priorità: MEDIA**

**Descrizione tecnica:**
Il documento specifica "nessun secret nel codice — tutti in variabili d'ambiente". Le variabili d'ambiente sono una buona pratica di base, ma non sono un sistema di secrets management. Problemi:
- Le variabili d'ambiente appaiono in log di deployment, CI/CD, e in output di `process.env` se non gestite con attenzione
- Non c'è rotazione automatica delle chiavi
- Non c'è audit log di chi ha accesso a quale secret
- In un monorepo con GitHub, se la pipeline CI ha accesso ai secret di produzione, un contributor malevolo può esfiltrarli

**Rischio:**
- Leak di chiavi API (Stream, Twilio, Daily.co) tramite log o CI
- Nessuna visibilità su chi ha accesso a cosa
- Difficoltà di rotazione rapida delle chiavi in caso di sospetto leak

**Probabilità:** Medio-Alta — gli errori di configurazione nei CI sono comuni.

**Impatto:** Alto — le chiavi API esposte permettono uso non autorizzato dei servizi.

**Soluzione — Doppler per Secrets Management**

**Doppler** è un secrets manager moderno, con piano gratuito adeguato per V1:
- UI web per gestire tutti i secret per ambiente (development/staging/production)
- CLI per sincronizzare i secret localmente senza che appaiano in `.env` nel repo
- Integrazione nativa con GitHub Actions e Railway
- Audit log di ogni accesso a ogni secret
- Rotazione automatica opzionale
- In caso di leak sospetto: revoca di tutti i secret di un progetto in un click

**Struttura secrets per Alpha Chat:**

```
ENVIRONMENT: development
  MONGODB_URI_DEV=...
  JWT_PRIVATE_KEY_DEV=...
  STREAM_API_KEY_DEV=...
  (etc.)

ENVIRONMENT: staging
  MONGODB_URI_STAGING=...
  JWT_PRIVATE_KEY_STAGING=...
  STREAM_API_KEY_STAGING=...

ENVIRONMENT: production
  MONGODB_URI_PROD=...
  JWT_PRIVATE_KEY_PROD=...        ← chiave EC P-256 dedicata produzione
  STREAM_API_KEY_PROD=...
  PHONE_HMAC_PEPPER=...           ← pepper per hashing numeri di telefono
  NCMEC_API_KEY=...               ← PhotoDNA
```

**Accesso ai secret di produzione:**
Solo il sistema CI/CD (GitHub Actions) con permessi limitati. Nessuno sviluppatore ha accesso diretto ai secret di produzione — solo via Doppler con MFA obbligatorio.

**Difficoltà di implementazione:** Bassa (1 giorno). Doppler ha un'integrazione diretta con Railway e GitHub Actions.

---

### SEC-11 — SSRF nel Link Preview Scraper
**Priorità: ALTA**

**Descrizione tecnica:**
Il backend implementa uno scraper Open Graph per le preview dei link. Senza validazione dell'URL, un attaccante può inviare un link a:
- `http://169.254.169.254/latest/meta-data/` (AWS Instance Metadata Service)
- `http://10.0.0.1/admin` (interfacce di amministrazione nella rete interna)
- `http://localhost:27017` (MongoDB locale)
- `file:///etc/passwd` (file system locale)

In tutti questi casi, il backend esegue la richiesta HTTP e può restituire il contenuto al client. Questa vulnerabilità è chiamata **SSRF (Server-Side Request Forgery)** ed è al numero 10 della OWASP Top 10.

**Rischio:**
- Accesso al metadata service cloud → furto credenziali IAM
- Scan della rete interna (port scanning tramite tempi di risposta)
- Accesso a servizi interni non esposti pubblicamente

**Probabilità:** Alta — SSRF è facile da sfruttare e spesso automaticamente testato da scanner di sicurezza.

**Impatto:** Critico in ambienti cloud — le credenziali IAM dal metadata service danno accesso completo all'infrastruttura.

**Soluzione — URL Allowlist + DNS Rebinding Protection + Timeout**

```
Validazione URL prima dello scraping:

1. Schema: solo "https://" (no http, no ftp, no file, no data)
2. Hostname resolution: risolvere il DNS e verificare che l'IP non sia in:
   - 127.0.0.0/8 (loopback)
   - 10.0.0.0/8 (RFC 1918 privato)
   - 172.16.0.0/12 (RFC 1918 privato)
   - 192.168.0.0/16 (RFC 1918 privato)
   - 169.254.0.0/16 (link-local, include AWS metadata)
   - ::1/128 (IPv6 loopback)
   - fc00::/7 (IPv6 private)
3. Porta: solo 80 e 443
4. Timeout: max 3 secondi per la risposta
5. Redirect: max 3 redirect, ogni redirect ri-esegue la validazione IP
6. Response size: max 500KB (evita memory exhaustion)
7. Content-Type: accettare solo text/html
```

**DNS Rebinding protection:**
Dopo la validazione DNS iniziale, il resolver viene usato di nuovo al momento della connessione effettiva (evita l'attacco in cui il DNS risponde con IP valido la prima volta e IP privato la seconda).

**Libreria consigliata:** `ssrf-req-filter` (npm) o implementazione custom con `got` + `agent` personalizzato.

**Difficoltà di implementazione:** Bassa-Media (1–2 giorni). La validazione è una funzione pura facilmente testabile.

---

## 2. Architettura di Sicurezza Aggiornata

Questa sezione integra tutte le decisioni di sicurezza nell'architettura di ogni componente. Sostituisce e supera le sezioni di sicurezza del documento `alpha-chat-mvp-architecture.md` nelle aree coperte.

---

### 2.1 Architettura E2E End-to-End (Revisione Completa)

**Principio:** Il server Alpha Chat non deve mai avere accesso al contenuto dei messaggi. Mai.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MODELLO DI SICUREZZA E2E                          │
│                                                                      │
│  Device A                  Server Alpha Chat          Device B       │
│  ─────────                 ─────────────────          ────────       │
│                                                                      │
│  [Keychain]                                          [Keychain]      │
│  IK_A (privata)           [Pubkey Store]             IK_B (privata)  │
│  SPK_A (privata)     IK_A_pub, SPK_A_pub             SPK_B (privata) │
│  OPK_A[] (private)   OPK_A_pub[]                    OPK_B[] (priv.) │
│                                                                      │
│  X3DH Handshake:                                                     │
│  1. A legge chiavi pubbliche di B dal server                         │
│  2. A calcola SharedSecret tramite X3DH (Curve25519)                 │
│  3. B fa lo stesso al prossimo accesso online                        │
│  4. Nessun segreto transita per il server                            │
│                                                                      │
│  Double Ratchet:                                                     │
│  [Messaggio 1] ─→ AES-256-GCM(key_1) ─→ [ciphertext_1] ─→ Decrypt  │
│  [Messaggio 2] ─→ AES-256-GCM(key_2) ─→ [ciphertext_2] ─→ Decrypt  │
│  key_1 ≠ key_2 (ogni messaggio chiave diversa)                      │
│                                                                      │
│  Cosa vede il server:                                                │
│  { ciphertext: "Ax3B9...", iv: "kj2...", sender_key_id: 42 }        │
│  Il contenuto è opaco — impossibile decifrare senza le chiavi device │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Store sul Device:**
- iOS: Secure Enclave / Keychain Services (hardware-backed quando disponibile)
- Android: Android Keystore System (hardware-backed su dispositivi con TEE)
- Web: SubtleCrypto API + IndexedDB cifrata (sicurezza ridotta rispetto a mobile — comunicarlo agli utenti)

**Sincronizzazione Multi-Device:**
Problema: il Double Ratchet è per-sessione. Se un utente ha 3 device, ogni device ha una sessione E2E separata con ogni contatto.

Soluzione (Signal Protocol standard):
- Ogni device dell'utente A ha una propria coppia di chiavi registrata sul server
- Quando B invia un messaggio ad A, il server fa fan-out e invia una copia cifrata separatamente per ogni device di A
- Ogni copia è cifrata con le chiavi pubbliche del device specifico
- Il server vede N copie cifrate — una per device — ma non può decifrarne nessuna

**Backup delle chiavi:**
- Il backup delle chiavi E2E è un problema aperto in tutti i sistemi E2E
- V1: nessun backup automatico — se l'utente perde il device senza trasferimento, perde le sessioni E2E attive (i messaggi futuri funzioneranno, i vecchi no se non li ha visti)
- V2: backup cifrato con passphrase utente su Cloudflare R2 (lo stesso approccio di Signal con il PIN di recovery)

---

### 2.2 Architettura di Autenticazione (Revisione Completa)

```
┌─────────────────────────────────────────────────────────────────────┐
│                   AUTHENTICATION FLOW COMPLETO                       │
│                                                                      │
│  REGISTRAZIONE                                                       │
│  ─────────────                                                       │
│  1. Client: genera device_id (UUID v4, salvato localmente)           │
│  2. Client: genera coppia chiavi E2E (IK, SPK, 10x OPK)             │
│  3. Client → POST /auth/register                                     │
│     { email, password (Argon2id lato server), username,              │
│       device_id, public_keys: { IK, SPK, OPK[] } }                  │
│  4. Server: crea user, salva password_hash Argon2id                  │
│  5. Server: salva public_keys nel Key Store                          │
│  6. Server → Client: { user_id }                                     │
│  7. Server: invia email di verifica (link con token UUID, TTL 24h)   │
│                                                                      │
│  LOGIN                                                               │
│  ──────                                                              │
│  1. Client → POST /auth/login { email, password, device_id }         │
│  2. Server: verifica Argon2id, verifica email confermata             │
│  3. Server: genera access token ES256 (15min, include jti)           │
│  4. Server: genera refresh token UUID v4, hasha con SHA-256,         │
│     salva hash in sessions collection                                │
│  5. Server → Client:                                                 │
│     - Access token in response body                                  │
│     - Refresh token in cookie HttpOnly Secure SameSite=Strict        │
│                                                                      │
│  REQUEST AUTENTICATA                                                 │
│  ──────────────────                                                  │
│  1. Client: header Authorization: Bearer <access_token>             │
│  2. Middleware: verifica firma ES256                                  │
│  3. Middleware: GET Redis "blocklist:{jti}" → 401 se esiste          │
│  4. Middleware: inietta req.user = { id, device_id }                 │
│                                                                      │
│  REFRESH TOKEN                                                       │
│  ─────────────                                                       │
│  1. Client → POST /auth/refresh (cookie inviato automaticamente)     │
│  2. Server: estrae token dal cookie                                  │
│  3. Server: hasha e confronta con sessions collection (+ indice)     │
│  4. Server: verifica sessions.expires_at > now                       │
│  5. Server: Token Rotation → genera nuovo refresh token,             │
│     invalida il vecchio (UPDATE sessions)                            │
│  6. Server → Client: nuovo access token + nuovo cookie refresh       │
│                                                                      │
│  LOGOUT REMOTO                                                       │
│  ─────────────                                                       │
│  1. Client → DELETE /auth/sessions/:device_id                        │
│  2. Server: cancella sessions document del device target             │
│  3. Server: il device target non può più fare refresh                │
│  4. Nota: l'access token attivo scade naturalmente (max 15min)       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**2FA — TOTP (RFC 6238)**

Il documento corrente menziona TOTP come opzionale. La posizione aggiornata:
- TOTP è **fortemente raccomandato** durante l'onboarding — un modale informativo spiega perché
- TOTP è **obbligatorio** per operazioni ad alto rischio: cambio email, cambio password, attivazione wallet (V2), revoca sessioni
- SMS OTP: **solo per recovery**, mai come 2FA primario (SIM-swapping attack)

**Backup Codes:**
- 10 codici monouso generati all'attivazione TOTP
- Mostrati una volta sola, non recuperabili — l'utente deve salvarli
- Hashati con Argon2id nel database (non in chiaro)

---

### 2.3 Schema Database — Campi di Sicurezza Aggiornati

**Collection `users` — Campi aggiunti/modificati:**
```
{
  ...
  password_hash: String,           // Argon2id — mai SHA-*, MD5, bcrypt
  email_verified: Boolean,         // false fino a click sul link
  email_verified_at: Date,
  phone_hash: String (nullable),   // HMAC-SHA256(PEPPER, E164_number) — mai il numero in chiaro
  totp_secret: String (nullable),  // chiave TOTP cifrata con env key (non in chiaro nel DB)
  totp_enabled: Boolean,
  backup_codes: [String],          // hash Argon2id dei backup codes — mai in chiaro
  failed_login_attempts: Number,   // contatore per progressive lockout
  locked_until: Date (nullable),   // timestamp sblocco dopo lockout
  security_email_notifications: Boolean,  // notifica login da nuovo device
  ...
}
```

**Collection `sessions` — Campi aggiunti:**
```
{
  ...
  refresh_token_hash: String,   // SHA-256 del refresh token — mai il token in chiaro
  country_code: String,         // geolocalizzazione IP per anomaly detection
  is_suspicious: Boolean,       // flagged per review se anomalia rilevata
  ...
}
```

**Collection `messages` — Campi E2E aggiunti:**
```
{
  ...
  // I seguenti campi sostituiscono il campo "content" in chiaro
  ciphertext: String,           // contenuto cifrato AES-256-GCM (base64)
  ciphertext_iv: String,        // initialization vector (base64)
  sender_key_id: Number,        // quale SPK/OPK del mittente è stato usato
  // Il campo "content" non esiste per messaggi E2E — il server non ha il plaintext
  ...
}
```

**Collection `user_prekeys` (nuova — per Signal Protocol):**
```
{
  _id: ObjectId,
  user_id: ObjectId,
  device_id: String,
  identity_key: String,         // chiave pubblica Curve25519 (base64)
  signed_prekey: {
    key_id: Number,
    public_key: String,
    signature: String           // firma con identity key
  },
  one_time_prekeys: [{
    key_id: Number,
    public_key: String
  }],
  created_at: Date,
  updated_at: Date
}
```
Indice: `{ user_id: 1, device_id: 1 }` unique.

**Collection `reports` (nuova — per content moderation):**
```
{
  _id: ObjectId,
  reporter_id: ObjectId,
  reported_user_id: ObjectId,
  reported_message_id: ObjectId (nullable),
  reported_conversation_id: ObjectId (nullable),
  reason: "spam" | "harassment" | "illegal_content" | "csam" | "misinformation" | "other",
  description: String (nullable),    // testo libero opzionale del reporter
  status: "pending" | "reviewed" | "actioned" | "dismissed",
  reviewed_by: ObjectId (nullable),  // admin che ha gestito la segnalazione
  action_taken: String (nullable),
  created_at: Date,
  updated_at: Date
}
```

**Collection `jwt_blocklist` (nuova — Redis, non MongoDB):**
Conservata esclusivamente in Redis con TTL:
```
Key:   "blocklist:{jti}"
Value: "1"
TTL:   secondi rimanenti alla scadenza del token
```

---

### 2.4 Architettura API — Security Headers e Middleware Stack

**Middleware stack aggiornato (ordine di esecuzione):**

```
Request in ingresso
      │
      ▼
[1] TLS Termination (Cloudflare / Railway)
      │
      ▼
[2] Helmet.js — Security Headers
    Content-Security-Policy, HSTS, X-Frame-Options,
    X-Content-Type-Options, Referrer-Policy,
    Permissions-Policy (no camera, no microphone unless in-call)
      │
      ▼
[3] CORS — whitelist esplicita
    Allowed: https://app.alphachat.app, capacitor://localhost (mobile)
    Methods: GET, POST, PUT, PATCH, DELETE
    Credentials: true (per cookie)
      │
      ▼
[4] Rate Limiting (Redis sliding window) — per IP
      │
      ▼
[5] Request ID (UUID v4 per ogni request — per tracing)
      │
      ▼
[6] Body Parser + Zod Validation
    Max body size: 100KB (JSON), 0 (media — usare presigned URL)
      │
      ▼
[7] JWT Verification (se endpoint protetto)
    - Verifica firma ES256
    - Verifica scadenza
    - Verifica jti nella blocklist Redis
    - Inietta req.user
      │
      ▼
[8] Rate Limiting per User (Redis) — dopo auth, per user_id
      │
      ▼
[9] Route Handler
      │
      ▼
[10] Error Handler — mai esporre stack trace in produzione
     { "error": "codice_errore", "message": "descrizione utente" }
     Stack trace: solo in log interno (Pino), mai nella response
```

---

### 2.5 Architettura Media — Security Aggiornata

**Upload flow aggiornato con sicurezza:**

```
1. Client → POST /api/v1/media/upload-url
   { type: "image/jpeg", size_bytes: 2048000, conversation_id }
   
   Server verifica:
   ✓ type in whitelist: image/jpeg, image/png, image/webp, image/gif,
     video/mp4, video/quicktime, audio/aac, audio/mpeg,
     application/pdf (solo questi)
   ✓ size_bytes ≤ 104857600 (100MB)
   ✓ utente appartiene alla conversation_id
   ✓ rate limit upload non superato

2. Server → Client: { upload_url (TTL 5min), media_id }

3. Client → R2: PUT diretto
   - Validazione Content-Type in R2 (deve corrispondere a quello dichiarato)
   - Upload da IP client, non da IP server (server non vede i byte)

4. Client → POST /api/v1/media/{media_id}/confirm
   { sha256_hash: "<hash del file calcolato dal client>" }
   
   Server verifica:
   ✓ File esiste in R2 e ha la dimensione dichiarata
   ✓ Avvia job asincrono: virus scan + EXIF strip + thumbnail

5. Job asincrono (BullMQ):
   a. Virus scan (ClamAV o VirusTotal API)
   b. CSAM hash matching (PhotoDNA)
   c. EXIF strip GPS per immagini
   d. Genera thumbnail (lato server, file non cifrato)
   e. Se E2E: il client ha già cifrato il file — il server conserva il blob cifrato
      e non può accedere al contenuto per thumbnail (thumbnail generata dal client
      prima della cifratura e inviata separatamente)
   f. Aggiorna media document: { status: "ready" | "rejected", ... }

6. Signed URL generati al momento della richiesta di lettura:
   - TTL: 1 ora per immagini/video, 15 min per documenti
   - Verifica permessi prima di generare: utente ∈ conversazione
   - Eliminazione sincrona da R2 per messaggi "eliminati per tutti"
```

---

### 2.6 Architettura di Monitoring di Sicurezza

**Stack di monitoring sicurezza per V1:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                   SECURITY MONITORING STACK                          │
│                                                                      │
│  Sentry (già nel piano)                                              │
│  ─────────────────────                                               │
│  - Error tracking + stack trace (solo in Sentry, mai in response)   │
│  - Alert immediato su: AuthenticationError, RateLimitExceeded,       │
│    SSRFAttemptDetected, CSAMMatchDetected                            │
│                                                                      │
│  Pino (logging strutturato)                                          │
│  ──────────────────────────                                          │
│  - Ogni request: { request_id, user_id, endpoint, status, ms }      │
│  - Auth events: { type: "login|logout|failed_login",                 │
│                   user_id, ip_hash, country, device_id }             │
│  - Security events: { type: "rate_limit|ssrf_attempt|...",          │
│                        ip_hash, endpoint, details }                  │
│  - Mai loggare: password, token, OTP, chiavi E2E, numeri telefono   │
│                                                                      │
│  PostHog (analytics prodotto)                                        │
│  ────────────────────────────                                        │
│  - Solo eventi anonimi di prodotto (apertura chat, invio messaggio)  │
│  - Mai eventi con contenuto di messaggi                              │
│  - IP non inviato a PostHog (anonimizzato prima dell'invio)          │
│                                                                      │
│  Alert via email (Sentry + webhook custom)                           │
│  ──────────────────────────────────────────                          │
│  P0 (risposta < 15min): CSAM match, tentativo accesso infrastruttura │
│  P1 (risposta < 1h):    Login anomalo, brute force rilevato          │
│  P2 (risposta < 4h):    Rate limit massiccio, error rate elevato     │
│  P3 (risposta < 24h):   Warning, pattern sospetto                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Security Roadmap — Pre-Development

Queste sono le attività da completare **prima di scrivere la prima riga di codice applicativo**. La Security Roadmap non è uno sprint separato — è la fase zero dello sviluppo.

---

### FASE 0-SEC — Fondamenta di Sicurezza (Parallela a Sprint 0)
**Durata stimata: 2 settimane**
**Da completare prima di: Sprint 1 (Auth)**

---

#### 0-SEC-01 — Decisione definitiva su E2E: Strada A o Strada B
**Priorità: Bloccante**

Prima di ogni altra cosa, il team deve scegliere e documentare:

**Strada A — Beta pubblica con TLS + onestà:**
- La beta pubblica viene dichiarata esplicitamente come "non E2E" nella privacy policy e nelle FAQ
- Il copy nell'app usa "messaggi protetti" o "crittografia in transito" — mai "E2E"
- Signal Protocol viene implementato in V1.1 (sprint aggiuntivo post-beta)
- Vantaggio: beta pubblica in 18 settimane come pianificato
- Svantaggio: competizione diretta su privacy è più difficile da vincere

**Strada B — E2E prima della beta pubblica:**
- Signal Protocol (libsignal) viene aggiunto come Sprint 2.5 tra Chat Core ed Eliminazione Messaggi
- La timeline si estende di 3–4 settimane (22 settimane totali invece di 18)
- Il copy usa "E2E" liberamente e onestamente
- Vantaggio: credibilità privacy dall'inizio, nessun debito tecnico da pagare dopo
- Svantaggio: timeline più lunga

**Raccomandazione:** Strada B. Una chat che non è E2E è un prodotto in competizione su funzionalità con WhatsApp — dove WhatsApp vince sempre. Una chat E2E dal primo giorno è un prodotto in competizione su fiducia con Signal — dove c'è spazio di mercato reale.

**Output richiesto:** Decisione documentata nel changelog del documento MVP con motivazione.

---

#### 0-SEC-02 — Setup Secrets Management con Doppler
**Durata: 1 giorno**

- [ ] Creare account Doppler
- [ ] Configurare 3 ambienti: `development`, `staging`, `production`
- [ ] Definire e documentare l'elenco completo dei secret necessari (tutti i servizi)
- [ ] Integrare Doppler CLI nel progetto (`.doppler.yaml` nel repo)
- [ ] Configurare integrazione GitHub Actions → Doppler
- [ ] Configurare integrazione Railway → Doppler
- [ ] Regola: nessun secret in `.env` committato — solo `.env.example` con placeholder
- [ ] Verificare che `git log` non contenga mai token o chiavi (installare `git-secrets` o `gitleaks` nel pre-commit hook)

---

#### 0-SEC-03 — Generazione e Configurazione Chiavi Crittografiche
**Durata: 1 giorno**

- [ ] Generare coppia di chiavi EC P-256 per JWT — separata per staging e produzione
  ```
  openssl ecparam -name prime256v1 -genkey -noout -out jwt_private.pem
  openssl ec -in jwt_private.pem -pubout -out jwt_public.pem
  ```
- [ ] Conservare le chiavi in Doppler (mai nel repo, mai in email, mai in Slack)
- [ ] Generare `PHONE_HMAC_PEPPER` (32 byte random):
  ```
  openssl rand -hex 32
  ```
- [ ] Conservare il pepper in Doppler (solo per production) — separato dal pepper di staging
- [ ] Generare `SESSION_SECRET` per cookie signing (già esistente nel progetto — verificare)
- [ ] Documentare la procedura di rotazione per ogni chiave: chi lo fa, come, con quale frequenza

---

#### 0-SEC-04 — Threat Model Formale
**Durata: 2–3 giorni**

Documentare il threat model di Alpha Chat usando il framework **STRIDE** (Microsoft):

| Threat | Componente | Mitigazione |
|---|---|---|
| **S**poofing — impersonare un utente | Auth Service | JWT firmati ES256, 2FA TOTP |
| **T**ampering — modificare messaggi in transito | Transport | TLS 1.3, E2E Signal Protocol |
| **R**epudiation — negare di aver inviato un messaggio | Messages | `sender_id` firmato nel ciphertext E2E |
| **I**nformation Disclosure — leggere messaggi altrui | All layers | E2E, signed URL con verifica permessi |
| **D**enial of Service — rendere l'app irraggiungibile | API layer | Rate limiting, Cloudflare DDoS |
| **E**levation of Privilege — accedere a dati non autorizzati | Auth middleware | RBAC, middleware per ogni route |

Il threat model deve coprire:
- I 5 componenti principali: Client, Backend, MongoDB, Stream Chat, Cloudflare R2
- Gli attori: utente normale, utente malevolo, attaccante esterno, admin compromesso
- I data flow: messaggi, media, chiamate, autenticazione
- Le trust boundaries: cosa il server si fida del client, cosa non si fida

**Output:** `docs/alpha-chat-threat-model.md`

---

#### 0-SEC-05 — Definizione della Privacy Policy e del Modello Dati di Privacy
**Durata: 2 giorni (con consulente legale se disponibile)**

Prima che esista un utente reale, definire:

- [ ] **Data inventory:** ogni dato raccolto, perché, per quanto tempo, dove
- [ ] **Legal basis** per ogni trattamento (GDPR Art. 6): consenso, contratto, legittimo interesse
- [ ] **Data retention policy:**
  - Messaggi: conservati finché l'utente non cancella la chat o l'account
  - Metadati di sessione: 90 giorni dalla scadenza
  - Logs di sistema: 30 giorni
  - Dati account: cancellati entro 30 giorni dalla cancellazione account
  - Backup: retention 30 giorni (poi cancellati automaticamente)
- [ ] **DSAR process** (Data Subject Access Request): procedura per rispondere alla richiesta di un utente di ricevere i propri dati
- [ ] **Right to Erasure process:** procedura per la cancellazione account + verifica che il processo funzioni
- [ ] **Cookie/tracking policy:** PostHog con IP anonimizzato, opt-out disponibile
- [ ] Bozza di Privacy Policy in linguaggio comprensibile (non legalese)

**Output:** `docs/alpha-chat-privacy-policy-draft.md` + `docs/alpha-chat-data-inventory.md`

---

#### 0-SEC-06 — Architectural Decision Record (ADR) per Signal Protocol
**Durata: 1 giorno (solo se si sceglie Strada B)**

Documentare formalmente la decisione di implementazione E2E:

- [ ] Scegliere la libreria: `@signalapp/libsignal-client` (binding ufficiale Node.js di libsignal)
- [ ] Documentare il key management flow completo (generazione, registrazione, rotazione)
- [ ] Documentare il comportamento al primo messaggio tra due utenti (X3DH)
- [ ] Documentare il comportamento quando le OPK si esauriscono (fallback a SPK senza OPK)
- [ ] Documentare la strategia per il multi-device (un set di chiavi per device)
- [ ] Documentare cosa succede quando un utente reimposta il device (nuove chiavi, vecchie sessioni E2E perdute — comunicarlo all'utente)

**Output:** Sezione dedicata nel documento MVP o documento separato `docs/alpha-chat-e2e-implementation.md`

---

#### 0-SEC-07 — Incident Response Plan
**Durata: 1 giorno**

Scrivere il piano di risposta agli incident **prima** di avere utenti reali. I punti obbligatori:

- [ ] Definizione dei livelli di severità (P0/P1/P2/P3) con esempi
- [ ] Contatti di escalation (anche se il team è di 1 persona: si documenta il processo per quando cresce)
- [ ] Procedure step-by-step per i 3 scenari più probabili:
  1. Data breach (accesso non autorizzato al database)
  2. Account compromise massivo (leak di password o JWT privati)
  3. CSAM rilevato sulla piattaforma
- [ ] Template di comunicazione agli utenti in caso di breach (GDPR richiede notifica entro 72h)
- [ ] Contatti CERT nazionali e NCMEC per il reporting obbligatorio
- [ ] Procedura di "kill switch": come si blocca immediatamente l'accesso a tutta la piattaforma in caso di emergenza

**Output:** `docs/alpha-chat-incident-response-plan.md`

---

#### 0-SEC-08 — Security Checklist di Development
**Durata: 0.5 giorni**

Aggiungere al repository una checklist di sicurezza che ogni PR deve soddisfare prima del merge:

- [ ] Nessuna stringa hardcodata di secret, password, chiave
- [ ] Tutti gli input validati con Zod prima di essere usati
- [ ] Nessuna query MongoDB costruita con template string (sempre usare operatori Mongoose)
- [ ] Nessun dato PII (email, telefono, nome) in log strutturati
- [ ] Ogni nuovo endpoint ha rate limiting configurato
- [ ] Ogni nuovo endpoint ha autenticazione configurata (o è esplicitamente pubblico con motivazione)
- [ ] Ogni nuovo campo MongoDB che contiene dati sensibili è documentato nel data inventory
- [ ] Test scritto per il caso di input malformato / injection attempt

**Output:** `.github/PULL_REQUEST_TEMPLATE.md` con sezione Security Checklist

---

#### 0-SEC-09 — Configurazione Pre-commit Hooks di Sicurezza
**Durata: 0.5 giorni**

- [ ] Installare `gitleaks` come pre-commit hook: scansione automatica di ogni commit per pattern di secret (API key, token, password, chiavi PEM)
- [ ] Configurare `.gitleaks.toml` con pattern aggiuntivi specifici per i servizi usati (Stream API key format, Twilio auth token format, etc.)
- [ ] Installare `eslint-plugin-security` per catturare pattern vulnerabili a livello di lint:
  - Uso di `eval()`
  - Template string nelle query
  - `child_process.exec` con input non sanitizzato
  - `Math.random()` per valori crittografici (deve usare `crypto.randomBytes`)

---

### Riepilogo Security Roadmap

```
SECURITY ROADMAP — PRE-DEVELOPMENT
═══════════════════════════════════════════════════════════════

SETTIMANA 0 (parallela a Sprint 0 infrastruttura):
  Giorno 1:    0-SEC-01 — Decisione E2E (Strada A o B) — BLOCCANTE
  Giorno 1-2:  0-SEC-02 — Setup Doppler secrets management
  Giorno 2:    0-SEC-03 — Generazione chiavi crittografiche
  Giorno 2-3:  0-SEC-09 — Pre-commit hooks (gitleaks, eslint-security)
  Giorno 3-4:  0-SEC-08 — Security checklist per PR

SETTIMANA 1 (ancora Sprint 0):
  Giorno 1-3:  0-SEC-04 — Threat Model STRIDE
  Giorno 3-4:  0-SEC-07 — Incident Response Plan
  Giorno 4-5:  0-SEC-05 — Privacy Policy draft + data inventory

SE STRADA B (E2E da V1):
  Giorno 5:    0-SEC-06 — ADR Signal Protocol

DIPENDENZE:
  0-SEC-01 sblocca → 0-SEC-06 (solo Strada B)
  0-SEC-02 sblocca → 0-SEC-03
  0-SEC-03 sblocca → Sprint 1 (Auth non può iniziare senza le chiavi)
  0-SEC-04 informa → tutte le decisioni di implementazione successive

OUTPUT TOTALE:
  docs/alpha-chat-threat-model.md
  docs/alpha-chat-incident-response-plan.md
  docs/alpha-chat-privacy-policy-draft.md
  docs/alpha-chat-data-inventory.md
  docs/alpha-chat-e2e-implementation.md (solo Strada B)
  .github/PULL_REQUEST_TEMPLATE.md
  .gitleaks.toml
  .env.example

CRITERIO DI COMPLETAMENTO:
  Tutti gli 8 item completati e documentati.
  Decisione E2E presa e aggiornata nel documento MVP.
  Le chiavi crittografiche sono in Doppler — mai nel repo.
  Il Threat Model è stato revisionato da almeno 1 persona esterna.
  La Privacy Policy draft è stata letta da un consulente legale.

═══════════════════════════════════════════════════════════════

SOLO DOPO IL COMPLETAMENTO DI QUESTA ROADMAP INIZIA LO SPRINT 1.
```

---

### Obiettivo Sicurezza: da 5/10 a 9/10

| Problema | Prima | Dopo |
|---|---|---|
| E2E dichiarata non implementata | ❌ Critico | ✅ Risolto (Strada A: onestà; Strada B: libsignal) |
| Phone hashing vulnerabile | ❌ Alto | ✅ HMAC-SHA256 con pepper server-side |
| JWT incoerente RS256/ES256 | ⚠️ Medio | ✅ ES256 definitivo in tutti i documenti |
| JWT senza revoca rapida | ❌ Alto | ✅ jti blocklist Redis |
| Signed URL TTL 24h | ⚠️ Medio | ✅ TTL 1h + verifica permessi al refresh |
| Rate limiting incompleto | ❌ Alto | ✅ Tabella completa tutti gli endpoint |
| Content moderation assente | ❌ Alto | ✅ PhotoDNA + in-app reporting + legal contacts |
| Certificate pinning assente | ⚠️ Medio | ✅ react-native-ssl-public-key-pinning |
| Anomaly detection assente | ⚠️ Medio | ✅ Regole Redis + alert Sentry |
| Secrets in env non strutturati | ⚠️ Medio | ✅ Doppler con audit log |
| SSRF nello scraper | ❌ Alto | ✅ IP blocklist + timeout + schema allowlist |

**Tutti i protocolli crittografici usati in questo documento:**
- Signal Protocol (X3DH + Double Ratchet): standard aperto, audit pubblici multipli
- AES-256-GCM: NIST FIPS 197 + SP 800-38D
- ECDH Curve25519: RFC 7748
- ES256 (ECDSA P-256): RFC 7518, NIST FIPS 186-5
- HMAC-SHA256: RFC 2104 + FIPS 198-1
- Argon2id: vincitore Password Hashing Competition 2015, OWASP raccomandato
- TLS 1.3: RFC 8446
- HKDF: RFC 5869
- TOTP: RFC 6238

Nessun algoritmo proprietario. Nessuna crittografia "inventata". Tutti i protocolli hanno decenni di scrutinio pubblico.

---

*Documento preparato per il team Alpha Chat*
*Security Architecture v1.0 — Luglio 2025*
*Nota: Questo documento va aggiornato dopo ogni security audit e dopo ogni cambiamento architetturale significativo.*
