# Architettura definitiva — Motore Pagamenti P2P AlphaChat

**Versione**: 1.0 — Luglio 2026  
**Stato**: Documento di progettazione — nessun codice scritto  
**Scope**: Chat Payment Engine P2P nativo di AlphaChat — asset-agnostico, indipendente da getusda.xyz

---

## ADR-001 — Indipendenza architetturale tra AlphaChat e getusda.xyz

### Decisione

AlphaChat introduce un **Chat Payment Engine autonomo**.

Il repository getusda.xyz viene considerato una **reference implementation** e non una dipendenza.

### Conseguenze vincolanti

- Nessun endpoint di AlphaChat dipenderà dalle API interne di getusda.xyz.
- Nessuna modifica sarà apportata al repository getusda.xyz.
- Nessun codice verrà copiato tra i repository.
- Gli algoritmi potranno essere reimplementati in TypeScript quando necessario, mantenendo l'equivalenza funzionale ma non condividendo il codice.
- I due progetti avranno roadmap, deploy e versioning completamente indipendenti.

### Motivazione

getusda.xyz è un sistema phone-based orientato al portale web e ai link WhatsApp. AlphaChat è una piattaforma di messaggistica anonima, cifrata, account-based. Le due architetture hanno semantiche incompatibili e scopi distinti. Un accoppiamento tecnico tra i due sistemi creerebbe un punto di failure singolo, limiterebbe la roadmap di AlphaChat e introdurrebbe una dipendenza su un sistema esterno non controllato.

### Stato

Accettata — Luglio 2026.

---

## ADR-002 — Payment Message come entità nativa della conversazione

### Decisione

Ogni trasferimento crea automaticamente un **Payment Message** nella conversazione AlphaChat.

Il messaggio è l'**unica rappresentazione visibile del pagamento** per gli utenti. La transazione blockchain e l'escrow sono dettagli implementativi gestiti internamente dal Chat Payment Engine e mai esposti direttamente all'interfaccia.

### Conseguenze vincolanti

- Ogni `chat-transfer/create` genera un documento `messages` nella conversazione con `message_type: 'payment'`.
- Il Payment Message ha un campo `transfer_id` che lo collega al record in `chat_transfers`.
- Quando lo stato del trasferimento cambia, il Chat Payment Engine aggiorna il messaggio esistente (non ne crea uno nuovo) e invia un evento WS `payment.state_changed` a tutti i partecipanti della conversazione.
- Non esiste una schermata separata per seguire lo stato di un pagamento: la conversazione è la fonte di verità visibile.
- Il Payment Engine e la chat sono disaccoppiati: il motore **emette eventi di stato**, la chat **aggiorna il messaggio corrispondente**. Nessun accoppiamento diretto tra i due moduli.

### Stati del Payment Message

| Stato interno | Label visibile | Icona |
|---|---|---|
| `created` / `awaiting_deposit` | In attesa di deposito | ⏳ |
| `pending` | In attesa di accettazione | ⏳ |
| `accepting` / `accepted` | Completato | ✅ |
| `rejecting` / `rejected` | Rifiutato | ❌ |
| `cancelling` / `cancelled` | Annullato | 🚫 |
| `refunding` / `refunded` | Rimborsato | ↩️ |
| `expired` | Scaduto | ⏰ |
| `failed` | Errore | ⚠️ |

### Esperienza utente

**Mittente (A)**
```
💸 Hai inviato 100 USDA a Cricco
⏳ In attesa di accettazione — scade tra 47 ore
[Annulla]
```

**Destinatario (B)**
```
💸 Hai ricevuto 100 USDA da Mario
⏳ In attesa di accettazione
[Accetta]  [Rifiuta]
```

**Dopo l'accettazione — entrambi**
```
💸 Pagamento completato
✅ 100 USDA trasferiti a Cricco
```

Il messaggio si aggiorna in-place tramite evento WS — nessun reload, nessuna notifica separata.

### Benefici

- Tutta la cronologia dei pagamenti rimane nella conversazione, senza schermate dedicate.
- Esperienza coerente con le principali app di messaggistica con pagamenti integrati.
- Il Payment Engine rimane testabile in isolamento: gli eventi di stato sono interfacce definite, non chiamate dirette alla chat.
- Compatibile con la cifratura E2E: il payload del messaggio può essere cifrato con Signal come qualsiasi altro messaggio.

### Stato

Accettata — Luglio 2026.

---

## 1. Contesto e problema da risolvere

### 1.1 Lo scontro architetturale

Dopo l'analisi diretta del codice sorgente di entrambi i repository emerge un disallineamento strutturale irrecuperabile tra i due sistemi:

| Dimensione | AlphaChat | getusda.xyz |
|---|---|---|
| Identificatore utente | `user_id` (ObjectId MongoDB) + `wallet_address` | `recipientPhone` (E.164) |
| Anonimato | ✅ Totale — nessun telefono | ❌ Richiede numero verificato |
| Modello di pagamento | Account-to-account | Phone-to-phone via link WhatsApp |
| Flusso | Diretto in-app | Custodiale + claim link pubblico |

Il campo `recipientPhone` è **obbligatorio e non aggirabile** nel codice sorgente di `/api/pay/prepare`. Non esiste un percorso di adattamento — i due sistemi hanno semantiche incompatibili.

### 1.2 Conseguenza

AlphaChat deve dotarsi di un **Payment Engine proprio**, che riutilizza la logica blockchain e l'infrastruttura di escrow già esistente in getusda.xyz, ma non chiama mai le sue API HTTP.

---

## 2. Inventario dei componenti riutilizzabili

### 2.1 Da getusda.xyz — riutilizzabili senza modifiche

| Componente | File sorgente | Cosa offre |
|---|---|---|
| Custodial wallet | `lib/phone-wallet.js` | `createCustodialWallet()` → `{ address, encryptedPrivateKey }` — AES-256-GCM |
| Trasferimento da custodiale | `lib/phone-wallet.js` | `transferFromCustodial(encPk, toAddress, amount)` — invia USDA dal wallet escrow |
| Balance custodiale | `lib/phone-wallet.js` | `getCustodialBalance(address)` — verifica fondi presenti prima del refund |
| Anti-replay | `lib/anti-replay.js` | `checkAndMarkTx(txHash)` — unique index su `processed_txs` → impedisce double-spend |
| TX lock | `lib/tx-lock.js` | Lock atomico MongoDB per evitare race condition tra processi |
| Contratti ERC-20 | `lib/contracts.js` | ABI + indirizzo contratto USDA, `transfer()`, `balanceOf()` |
| Refund scheduler | `lib/refund-scheduler.js` | Logica di scadenza + rimborso automatico |
| Pattern escrow | Schema `pending_transfers` | Stati: `awaiting_deposit → pending_claim → claiming → claimed / refunding → refunded` |
| Lock atomico per refund | `refund-expired/route.js` | `findOneAndUpdate({ status: 'pending_claim' }, { $set: { status: 'refunding' } })` |

### 2.2 Da AlphaChat — già presenti e maturi

| Componente | File | Cosa offre |
|---|---|---|
| Auth + session | `auth.middleware.ts` | Bearer token, `req.user` disponibile in tutti i controller |
| Messaggi di sistema in chat | `usda.service.ts` → `_createUsdaMessage()` | Crea documenti `messages` con `message_type`, `system_metadata` |
| WS broadcast | `ws-manager.ts` + `usda.service.ts` | `usda.payment.update` inviato a mittente e destinatario in tempo reale |
| Bubble UI | `UsdaPaymentBubble`, `UsdaRequestBubble` | Rendering stati con badge, azioni, polling |
| Wallet utente | `User.wallets.usda.address` | Indirizzo Polygon già persistito e verificato |
| Verifica on-chain | `polygon-rpc.ts` → `verifyUsdaTx()` | Verifica Transfer event ERC-20 on-chain |
| Idempotenza pagamenti | `usda_payments.client_payment_id` (unique) | Prevenzione doppio invio lato AlphaChat |
| Adapter pattern | `usda-adapter.interface.ts` | Separazione contratto/implementazione già esistente |

### 2.3 Tabella confronto completa

| Componente | AlphaChat | getusda.xyz | Riutilizzabile da getusda in AlphaChat |
|---|---|---|---|
| Autenticazione | ✅ Bearer token | ❌ Phone verify | — |
| Identificazione utente | ✅ user_id + wallet | ❌ Phone E.164 | — |
| Custodial wallet creation | ❌ Assente | ✅ `createCustodialWallet()` | ✅ Reimplementare algoritmo in TS |
| Transfer da custodiale | ❌ Assente | ✅ `transferFromCustodial()` | ✅ Reimplementare algoritmo in TS |
| Anti-replay (txHash) | ✅ Parziale in `verifyUsdaTx` | ✅ `processed_txs` collection | ✅ Reimplementare pattern in TS |
| Lock atomico | ❌ Assente (race condition risk) | ✅ `findOneAndUpdate` state machine | ✅ Reimplementare pattern in TS |
| Escrow | ❌ Assente | ✅ 1 custodiale per transfer | ✅ Reimplementare schema + logica |
| Refund automatico | ❌ No-op | ✅ `refund-scheduler.js` | ✅ Reimplementare scheduler in TS |
| Messaggi chat | ✅ Completo | ❌ Assente | — |
| WS real-time | ✅ Completo | ❌ Assente | — |
| Bubble UI | ✅ Completo | ❌ Assente | — |
| Verifica on-chain | ✅ `verifyUsdaTx` | ✅ Logs polling | Già presente in AlphaChat |
| Scheduler persistente | ❌ In-memory solo | ✅ DB-based | ✅ Reimplementare scheduler DB-driven |

---

## 3. Architettura consigliata — USDA Chat Transfer Engine

### 3.1 Principio guida

Costruire un **nuovo livello di servizio interno ad AlphaChat** (`chat-transfer.service.ts`) che:

- Non chiama mai le API HTTP di getusda.xyz
- Importa direttamente `lib/phone-wallet.js` e `lib/anti-replay.js` di getusda.xyz (copiate nel monorepo o estratte in un package condiviso)
- Usa MongoDB di AlphaChat per persistere lo stato dell'escrow
- Usa il sistema messaggi + WS di AlphaChat per notifiche in-chat
- Lascia le API getusda.xyz invariate per il portale web

### 3.2 Flusso di stato della transazione

```
MITTENTE A invia 100 USDA
           │
           ▼
    [1] CREATED
    AlphaChat genera un wallet custodiale
    dedicato a questa transazione (escrow).
    Il sistema restituisce l'indirizzo escrow ad A.
           │
           ▼
    [2] AWAITING_DEPOSIT
    A firma e invia la TX on-chain:
    A.wallet → escrow_wallet (100 USDA)
    AlphaChat verifica il Transfer event.
           │
           ▼
    [3] PENDING
    Fondi confermati nell'escrow.
    Messaggio in chat: "🟡 In attesa di accettazione"
    B riceve notifica WS + push.
    Timer: 48 ore.
           │
      ┌────┴────┐
      │         │
   B Accetta  B Rifiuta
      │         │
      ▼         ▼
  [4a] ACCEPTED  [4b] REJECTED
  escrow → B.wallet  escrow → A.wallet
  TX on-chain.        TX on-chain.
  Messaggio: ✅       Messaggio: ↩️
      │
      │ (oppure nessuna risposta)
      ▼
  [4c] EXPIRED (48h)
  escrow → A.wallet (refund automatico)
  Messaggio: ⏱️ "Fondi restituiti"
      │
  [5] FAILED
  Qualsiasi errore non recuperabile.
  Messaggio: ❌ con causa
```

### 3.3 Schema dati — collezione `usda_chat_transfers`

```typescript
{
  _id: ObjectId,
  transfer_id: string,           // UUID — PK logica, idempotenza
  sender_id: ObjectId,           // ref users
  recipient_id: ObjectId,        // ref users
  conversation_id: ObjectId,     // ref conversations
  message_id: ObjectId,          // ref messages (la bubble in chat)
  
  // Importi
  amount: Decimal128,            // importo USDA
  fee: Decimal128,               // fee (inizialmente 0)
  note: string | null,
  
  // Wallet
  sender_wallet: string,         // 0x... — snapshot al momento del pagamento
  recipient_wallet: string,      // 0x... — snapshot al momento del pagamento
  escrow_wallet: string,         // 0x... — custodiale generato per questo transfer
  escrow_encrypted_pk: string,   // AES-256-GCM — mai esposto fuori dal server
  
  // Stato
  status: ChatTransferStatus,    // enum sotto
  
  // Blockchain
  tx_hash_deposit: string | null,   // A → escrow
  tx_hash_release: string | null,   // escrow → B (o → A in caso di refund)
  
  // Timing
  expires_at: Date,              // created_at + 48h
  created_at: Date,
  confirmed_at: Date | null,     // quando il deposito è on-chain
  responded_at: Date | null,     // quando B ha accettato/rifiutato
  completed_at: Date | null,
}

type ChatTransferStatus =
  | 'created'           // escrow generato, in attesa del deposito
  | 'awaiting_deposit'  // uguale a created (alias)
  | 'pending'           // deposito confermato, in attesa risposta B
  | 'accepting'         // lock: B ha premuto Accetta, TX in corso
  | 'accepted'          // completato — fondi a B
  | 'rejecting'         // lock: B ha premuto Rifiuta, TX in corso
  | 'rejected'          // completato — fondi ad A
  | 'cancelling'        // lock: A ha cancellato, TX in corso
  | 'cancelled'         // A ha cancellato prima della risposta di B
  | 'refunding'         // lock: timeout, TX in corso
  | 'refunded'          // scaduto, fondi ad A
  | 'failed';           // errore non recuperabile
```

---

## 4. API consigliate

### 4.1 Lato AlphaChat (nuove route, non rompono nulla)

```
POST   /api/v1/usda/chat-transfer/create
       Body: { conversation_id, amount, note? }
       Auth: Bearer — mittente autenticato
       → Crea escrow, restituisce { transfer_id, escrow_address, amount, expires_at }

POST   /api/v1/usda/chat-transfer/:id/deposit-confirmed
       Body: { tx_hash }
       Auth: Bearer — solo mittente
       → Verifica TX on-chain, aggiorna stato → pending, crea messaggio chat

POST   /api/v1/usda/chat-transfer/:id/accept
       Auth: Bearer — solo destinatario
       → Lock atomico → accepting, esegue escrow→B, messaggio ✅

POST   /api/v1/usda/chat-transfer/:id/reject
       Auth: Bearer — solo destinatario
       → Lock atomico → rejecting, esegue escrow→A, messaggio ↩️

POST   /api/v1/usda/chat-transfer/:id/cancel
       Auth: Bearer — solo mittente, solo se status=pending
       → Lock atomico → cancelling, esegue escrow→A, messaggio 🚫

GET    /api/v1/usda/chat-transfer/:id
       Auth: Bearer — mittente o destinatario
       → Stato attuale, importo, wallet (mascherati), timing
```

### 4.2 Lato getusda.xyz — invariate

```
POST /api/pay/prepare      → inalterata, phone-based
POST /api/pay/confirm      → inalterata
POST /api/pay/request      → inalterata
POST /api/pay/claim/{code} → inalterata
GET  /api/pay/poll-tx      → inalterata
GET  /api/pay/history      → inalterata
```

I due sistemi condividono lo stesso contratto ERC-20 USDA ma non si toccano. Totale compatibilità.

---

## 5. Gestione Escrow

### Opzione A — Custodial wallet per transfer ✅ RACCOMANDATA

Identica al pattern di getusda.xyz: ogni `create` genera un wallet Polygon usa-e-getta.

```
Vantaggi:
  - Fondi completamente separati per transfer → zero rischio mixing
  - Logica di refund semplice: svuota il wallet custodiale
  - Già testata in produzione su getusda.xyz
  - Nessun gas extra per smart contract deploy
  - Recovery triviale: basta leggere il balance del custodiale

Svantaggi:
  - PK cifrata su MongoDB di AlphaChat (rischio se DB compromesso)
  - Un wallet per transfer → many addresses (gestibile)
  - Centralizzato: AlphaChat è custode temporaneo

Sicurezza:
  - PK: AES-256-GCM, master key in env var (mai in DB)
  - Wallet vuoto dopo release/refund → PK inutile
  - Audit: tx_hash_deposit + tx_hash_release su ogni record
```

### Opzione B — Smart contract Escrow

```
Vantaggi:
  - Trustless: nessuna PK custodiale
  - Immutabile on-chain

Svantaggi:
  - Deploy e audit del contratto (costo + tempo)
  - Gas per ogni operazione (approve + depositInEscrow + release/refund)
  - Polygon: gas basso ma non zero
  - Complessità operativa molto più alta
  - Bug nel contratto → fondi persi permanentemente

Verdict: sovra-ingegneria per l'MVP.
         Rivalutare quando il volume supera $1M/giorno.
```

### Opzione C — Wallet custodiale unico

```
Svantaggi fatali:
  - Mixing dei fondi di utenti diversi → impossibile attribuire refund corretti
  - Race condition gravissime
  
Verdict: scartata.
```

---

## 6. Timeout e durabilità (48 ore)

### Problema

Un timeout in-memory (setTimeout) viene perso a ogni crash, deploy o restart. Cloud Run ha restart frequenti.

### Soluzione — DB-driven scheduler

```
Strategia:
  1. expires_at è salvato su MongoDB al momento della create.
  2. Un job periodico (ogni 5 minuti) interroga:
     db.usda_chat_transfers.find({
       status: 'pending',
       expires_at: { $lt: new Date() }
     })
  3. Per ogni record trovato, esegue il lock atomico e il refund.

Implementazione:
  - Cron interno al processo (setInterval 5min) — semplice ma muore col processo
  - Oppure: endpoint POST /api/v1/usda/chat-transfer/process-expired
    invocato da Replit Scheduled Jobs o Cloud Scheduler ogni 5 minuti
    → più robusto perché sopravvive ai restart

Garanzia:
  - Lock atomico via findOneAndUpdate({ status: 'pending' }, { $set: { status: 'refunding' } })
  - Se il processo crasha DOPO il lock ma PRIMA del completamento:
    il record rimane in stato 'refunding' → recovery manuale o job separato
    che rileva 'refunding' da più di 10 minuti e riprova
```

### Schema recovery completo

```
Stato 'refunding' da > 10min → riprova il transferFromCustodial
  ↓ se balance = 0 → già rimborsato (idempotente, segna 'refunded')
  ↓ se balance > 0 → riprova TX
  ↓ se TX fallisce → alert admin

Stato 'accepting' / 'rejecting' da > 10min → stesso pattern
```

---

## 7. Atomicità — mai fondi persi, mai doppio pagamento

### Principio: State Machine Lock

Ogni transizione di stato usa `findOneAndUpdate` con il filtro sullo stato corrente:

```javascript
// Solo uno tra N processi concorrenti acquisisce il lock
const locked = await db.collection('usda_chat_transfers').findOneAndUpdate(
  { transfer_id: id, status: 'pending' },         // condizione
  { $set: { status: 'accepting', locked_at: new Date() } },  // nuovo stato
  { returnDocument: 'after' }
);
if (!locked) return; // già acquisito da un altro processo
// → esegui TX blockchain
// → aggiorna a 'accepted' con tx_hash_release
```

Questo garantisce:
- **Zero double-accept**: solo il primo `findOneAndUpdate` riesce
- **Zero double-refund**: il lock `pending → refunding` è esclusivo
- **Zero fondi persi**: se la TX blockchain fallisce, il record rimane nel lock state e viene recuperato dal job di recovery

### Anti-replay txHash

Copiare da getusda.xyz il pattern `processed_txs`:

```javascript
// Prima di accettare un tx_hash come deposit:
await checkAndMarkTx(txHash, 'chat-transfer-deposit');
// → unique index su processed_txs.tx_hash
// → se txHash già usato → errore → impedisce riuso della stessa TX
```

Questo blocca:
- Replay attack: riuso di una TX già processata per un secondo transfer
- Double-deposit: stesso txHash presentato due volte per lo stesso transfer

---

## 8. Sicurezza

### 8.1 Superfici di attacco e mitigazioni

| Attacco | Mitigazione |
|---|---|
| **Replay attack** | `processed_txs` unique index — ogni txHash usabile una sola volta |
| **Double spend** | Lock atomico state machine — solo un processo può transitare lo stato |
| **Self-transfer** | Validazione `sender_id !== recipient_id` lato controller |
| **Impersonation** | Verifica `sender_id === req.user.id` e `recipient_id === req.user.id` su accept/reject |
| **Spoofing importo** | `verifyUsdaTx()` controlla il Transfer event on-chain con importo esatto |
| **Escrow svuotamento** | PK custodiale mai esposta fuori dal processo Node; cifrata AES-256-GCM |
| **Overflow/underflow** | Decimal128 + validazione `parseFloat` con min 0.01 e max configurabile |
| **Timing attack su lock** | MongoDB atomic `findOneAndUpdate` — nessuna finestra di race |
| **Fondi bloccati permanentemente** | Recovery job monitora stati `accepting/rejecting/refunding` da > 10min |

### 8.2 Audit log

Ogni transizione di stato viene loggata con:

```
{ transfer_id, from_status, to_status, triggered_by, tx_hash, timestamp, ip? }
```

Collezione separata `usda_transfer_audit` — append-only, mai cancellata.

### 8.3 Firma transazioni

Il sender firma la TX blockchain lato client (ThirdWeb/Reown AppKit) e invia il txHash ad AlphaChat. AlphaChat non gestisce mai le chiavi del sender — è sempre il wallet del mittente a firmare.

L'unica PK gestita dal server è quella del wallet **escrow** (custodiale temporaneo), che viene usata solo per il release/refund.

---

## 9. UX consigliata — Flusso completo

```
MITTENTE (A)                     CHAT                    DESTINATARIO (B)
─────────────────────────────────────────────────────────────────────────────

Tocca "Invia USDA"
Inserisce 100 USDA
Tocca "Continua"                                         
                                 AlphaChat crea escrow wallet
                                 Risponde con escrow_address

ThirdWeb: firma TX
A.wallet → escrow (100 USDA)    
Invia txHash ad AlphaChat       
                                 AlphaChat verifica Transfer event on-chain
                                 Crea messaggio "usda_chat_transfer" in chat

                                 ┌─────────────────────────────┐
                                 │ 📤 Hai inviato 100 USDA     │
                                 │ 🟡 In attesa di accettazione│
                                 │ Scade tra 48 ore            │
                                 │ [Annulla]                   │
                                 └─────────────────────────────┘

                                 ────── WS: usda.payment.update ──────▶

                                                          ┌──────────────────┐
                                                          │ 📥 Hai ricevuto  │
                                                          │ 100 USDA da A    │
                                                          │ 🟡 In attesa     │
                                                          │ [Accetta][Rifiuta]│
                                                          └──────────────────┘
                                                          B tocca [Accetta]

                                 AlphaChat: lock → accepting
                                 escrow → B.wallet (TX on-chain)
                                 Verifica on-chain ✅

                                 ┌─────────────────────────────┐
                                 │ ✅ Pagamento completato     │
                                 │ 100 USDA ricevuti da B      │
                                 └─────────────────────────────┘
                                 ◀───── WS: usda.payment.update ──────
[Pagamento accettato da B ✅]

─── FLUSSO ALTERNATIVO: Scadenza ────────────────────────────────────────────

Job (ogni 5min): trova transfer pending con expires_at < now
                                 Lock → refunding
                                 escrow → A.wallet (TX on-chain) 

                                 ┌─────────────────────────────┐
                                 │ ⏱️ Trasferimento scaduto    │
                                 │ I 100 USDA sono stati       │
                                 │ restituiti al mittente      │
                                 └─────────────────────────────┘
```

---

## 10. Compatibilità con i sistemi esistenti

| Sistema | Impatto | Note |
|---|---|---|
| **getusda.xyz** | ✅ Zero | API HTTP non toccate. Stesso contratto ERC-20 USDA |
| **AlphaChat `/api/v1/usda/*`** | ✅ Zero | Nuove route `/chat-transfer/*` — nessuna route esistente modificata |
| **Wallet USDA utente** | ✅ Zero | Si legge `wallets.usda.address` come già avviene |
| **Chat esistente** | ✅ Zero | Nuovo `message_type: 'usda_chat_transfer'` — non interferisce con tipi esistenti |
| **`usda_payments`** | ✅ Convivenza | Nuova collezione separata `usda_chat_transfers` |
| **Admin panel** | ⚠️ Aggiunta | Nuova sezione "Chat Transfers" consigliata |
| **R2 / Object Storage** | ✅ Zero | Non coinvolto |

---

## 11. Componenti da creare vs da riutilizzare

### Da creare (netto nuovo codice)

1. **`chat-transfer.service.ts`** — orchestratore: create, deposit-confirm, accept, reject, cancel, process-expired
2. **`usda-chat-transfer.model.ts`** — schema Mongoose per `usda_chat_transfers`
3. **`chat-transfer.controller.ts`** — controller Express per le 5 route
4. **`chat-transfer.routes.ts`** — registrazione route
5. **`UsdaChatTransferBubble.tsx`** — bubble frontend con stati + azioni (Accetta / Rifiuta)
6. **Job scheduler** — `setInterval` ogni 5min (o Cron endpoint)

### Algoritmi da reimplementare in TypeScript (ispirati da getusda.xyz — nessun codice copiato)

getusda.xyz viene usato come **riferimento concettuale**. I seguenti algoritmi vengono riscritti da zero in TypeScript all'interno di AlphaChat, senza copiare codice né creare dipendenze:

1. **`usda-custodial.service.ts`** — generazione wallet escrow usa-e-getta: chiave privata casuale, cifratura AES-256-GCM con master key da env var, firma TX ERC-20 con ethers.js o viem; concettualmente equivalente a `lib/phone-wallet.js`
2. **`usda-anti-replay.ts`** — `checkAndMarkTx(txHash)` + `rollbackTx(txHash)` con unique index su `processed_txs.tx_hash`; concettualmente equivalente a `lib/anti-replay.js`
3. **Pattern lock atomico** — `findOneAndUpdate({ status: 'pending' }, { $set: { status: 'accepting' } })` nel service; concettualmente equivalente al pattern in `lib/tx-lock.js`

### Da riutilizzare invariati (già in AlphaChat)

1. `verifyUsdaTx()` in `polygon-rpc.ts` — verifica Transfer event on-chain
2. `_createUsdaMessage()` in `usda.service.ts` — creazione messaggi di sistema
3. WS broadcast `usda.payment.update`
4. `UsdaPaymentBubble.tsx` — stati base (da estendere per accept/reject)
5. Sistema auth + middleware Bearer

---

## 12. Rischi e mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| PK custodiale esposta da DB leak | Bassa | Alta | Chiave AES in env var, PK inutile appena wallet vuoto |
| Crash tra lock e TX blockchain | Media | Media | Recovery job su stati bloccati > 10min |
| Gas spike su Polygon | Bassa | Bassa | Polygon gas stabile; fee coperta dall'app se <$0.01 |
| Recipient wallet cambia tra create e accept | Bassa | Media | Snapshot `recipient_wallet` al momento della create |
| Doppio accept concorrente | Bassa | Alta | Lock atomico `findOneAndUpdate` — protetto |
| Scheduler non gira (processo down) | Media | Media | Cron endpoint esterno + alert se expiry > 50h senza job |
| USDA rimasto bloccato in escrow | Bassa | Alta | Admin endpoint + alert automatico su balance > 0 con status terminale |

---

## 13. Roadmap di implementazione

### Fase 1 — Core engine (4-6 giorni)

1. Implementa in TypeScript gli algoritmi di custodial wallet, anti-replay e lock atomico (ispirandosi concettualmente a getusda.xyz, senza copiare codice)
2. Crea schema `usda_chat_transfers` + indici MongoDB
3. Implementa `chat-transfer.service.ts`: create + deposit-confirmed + accept + reject
4. Implementa controller + route
5. Integra con sistema messaggi esistente

### Fase 2 — Scheduler e recovery (1-2 giorni)

6. Job `process-expired` ogni 5min
7. Recovery job per stati bloccati
8. Alert su balance custodiale > 0 con status terminale

### Fase 3 — Frontend (2-3 giorni)

9. `UsdaChatTransferBubble.tsx` con stati + pulsanti Accetta/Rifiuta
10. `SendUsdaSheet` aggiornato per usare il nuovo flusso
11. Aggiornamento `ChatPage` per gestire il nuovo `message_type`

### Fase 4 — Admin e monitoring (1 giorno)

12. Sezione Admin per `usda_chat_transfers`
13. Alert su custodiali orfani
14. Export audit log

---

## 14. Confronto: Chat Payment Engine nativo vs adattamento alle API phone-based di getusda.xyz

### Opzione A — Adattare AlphaChat alle API phone-based di getusda.xyz

Questa strada è stata esplorata ed è risultata impraticabile. I motivi tecnici sono i seguenti:

**Problema 1 — Identificazione del destinatario**

`POST /api/pay/prepare` richiede `recipientPhone` (numero E.164). AlphaChat non raccoglie numeri di telefono e non intende farlo — l'identità è costruita su `userId` e `username`. Non esiste una mappatura tra i due spazi di identità.

**Problema 2 — Flusso incompatibile**

Il flusso di getusda.xyz genera un **link WhatsApp pubblico** che il destinatario clicca per reclamare i fondi. AlphaChat è un'app di messaggistica privata e cifrata. Inserire un link pubblico esterno nella chat rompe il modello di sicurezza e l'esperienza utente.

**Problema 3 — Database separato**

getusda.xyz mantiene la propria collection `phone_users` su un MongoDB separato. AlphaChat non ha accesso a quel database e non deve averlo — i due sistemi devono rimanere indipendenti.

**Problema 4 — Nessun accept/reject**

Il flusso getusda.xyz non prevede un'azione di accettazione da parte del destinatario — i fondi vengono "reclamati" tramite link, non accettati esplicitamente in-chat. Il requisito di AlphaChat (pulsanti Accetta / Rifiuta nella bubble) non può essere soddisfatto tramite questo flusso.

**Conclusione su Opzione A**: non adattabile. Non si tratta di un gap colmabile con un adapter — è un'incompatibilità semantica tra due architetture costruite per scopi diversi.

---

### Opzione B — Chat Payment Engine nativo (questa architettura)

| Criterio | Opzione A (phone-based) | Opzione B (nativo) |
|---|---|---|
| Identità destinatario | ❌ `recipientPhone` obbligatorio | ✅ `userId` / `username` AlphaChat |
| Anonimato | ❌ Richiede numero verificato | ✅ Totale — nessun telefono |
| Accept / Reject in-chat | ❌ Non supportato | ✅ Pulsanti nativi nella bubble |
| Dipendenza esterna | ❌ HTTP a getusda.xyz (SPOF) | ✅ Zero dipendenze esterne |
| getusda.xyz invariato | ✅ Sì | ✅ Sì — zero modifiche |
| Timeout 48h | ❌ Gestito da scheduler getusda.xyz | ✅ Scheduler interno AlphaChat |
| Sicurezza (anti-replay, lock) | ❌ Parziale via adapter | ✅ Completa — reimplementata in TS |
| Coesistenza con portale getusda.xyz | ✅ Sì | ✅ Sì — stesso contratto ERC-20 |
| Complessità implementativa | ❌ Alta (bridge semantico impossibile) | ⚠️ Media (nuovo modulo standalone) |
| Manutenibilità a lungo termine | ❌ Dipende da API esterna non controllata | ✅ Codice interno, testabile, versionato |

### Raccomandazione

**L'architettura nativa (Opzione B) è la scelta corretta e l'unica praticabile.**

Non è preferibile "tra due opzioni equivalenti" — è preferibile perché l'opzione A non è un'opzione: il tentativo di adattare AlphaChat alle API phone-based di getusda.xyz è stato già percorso nella fase di debug produzione e ha prodotto un errore `400 "Parametri mancanti"` strutturalmente irrisolvibile senza cambiare l'identità del sistema.

Il Chat Payment Engine nativo:

- rispetta la natura di AlphaChat (anonima, cifrata, account-based)
- non introduce dipendenze da servizi esterni non controllati
- implementa la feature richiesta (accept/reject) che getusda.xyz non può fornire
- lascia getusda.xyz completamente invariato e operativo per il portale web
- utilizza gli stessi pattern architetturali di getusda.xyz (custodial escrow, lock atomico, anti-replay) reimplementati in TypeScript, garantendo coerenza concettuale senza accoppiamento tecnico

---

## 16. Estensibilità futura — Payment Engine asset-agnostico

### Principio

Il Chat Payment Engine deve essere progettato come un **servizio generico** e non limitato a USDA. L'asset trasferito è un **parametro della transazione**, non un elemento hardcoded nella logica del motore.

### Asset supportati nell'MVP vs futuri

| Asset | MVP | Futuro |
|---|---|---|
| USDA (stablecoin proprietaria) | ✅ | ✅ |
| USDC | — | ✅ |
| USDT | — | ✅ |
| Altri token ERC-20 | — | ✅ |
| NFT (ERC-721 / ERC-1155) | — | ✅ |
| Token cross-chain | — | ✅ |

### Implicazioni per il design

**Schema `usda_chat_transfers` → rinominare `chat_transfers`**

Il nome della collection deve essere asset-agnostico fin dall'inizio. Rinominare dopo il deploy è costoso.

```
chat_transfers
  asset_type:     'ERC-20' | 'ERC-721' | 'ERC-1155'
  asset_address:  string    // indirizzo contratto ERC-20 / NFT
  asset_symbol:   string    // 'USDA', 'USDC', 'USDT', ...
  token_id:       string | null  // solo per ERC-721 / ERC-1155
  amount:         Decimal128 | null  // null per NFT (amount = 1 implicito)
```

**Servizio `chat-transfer.service.ts`**

La logica di business (stati, lock, escrow, refund) rimane identica per qualsiasi asset ERC-20. L'unica parte asset-specifica è la chiamata al contratto (`transfer()` su ABI ERC-20 vs `safeTransferFrom()` su ABI ERC-721). Questa va isolata in un modulo `asset-transfer.ts` con dispatch sul tipo:

```
assetTransfer({ type: 'ERC-20', contractAddress, to, amount })
assetTransfer({ type: 'ERC-721', contractAddress, to, tokenId })
```

**Verifica on-chain**

`verifyUsdaTx()` verifica specificamente l'evento `Transfer` del contratto USDA. Va generalizzata in `verifyAssetTx({ contractAddress, assetType, ... })` che sceglie l'ABI e i filtri corretti in base al tipo di asset.

**API — parametri aggiuntivi nella `create`**

```
POST /chat-transfer/create
  Body: {
    conversation_id,
    asset_address,   // default: indirizzo USDA se omesso
    asset_symbol,    // 'USDA', 'USDC', ...
    amount,
    note?
  }
```

Aggiungere `asset_address` e `asset_symbol` fin dall'MVP non aggiunge complessità nell'implementazione iniziale (dove saranno sempre USDA) ma evita una rottura dell'API in futuro.

### Ciò che non cambia

- State machine degli stati (CREATED → PENDING → ACCEPTED / REJECTED / REFUNDED)
- Logica di escrow con wallet custodiale dedicato
- Lock atomico e anti-replay
- Sistema messaggi + WS
- Bubble UI (mostra `asset_symbol` invece del testo hardcoded "USDA")

### Ciò che non va fatto ora

Non implementare il supporto multi-asset nell'MVP. Il principio guida è: **progettare le interfacce come se multi-asset esistesse, implementare solo USDA**. Nessun `if (asset === 'USDC')` nell'MVP — solo lo slot parametrico che, quando arriverà USDC, non richiederà modifiche strutturali.
