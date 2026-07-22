# Architettura definitiva — Motore Pagamenti P2P AlphaChat

**Versione**: 1.0 — Luglio 2026  
**Stato**: Documento di progettazione — nessun codice scritto  
**Scope**: Pagamenti USDA peer-to-peer nativi in AlphaChat, senza dipendenza dalle API phone-based di getusda.xyz

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
| Custodial wallet creation | ❌ Assente | ✅ `createCustodialWallet()` | ✅ Direttamente |
| Transfer da custodiale | ❌ Assente | ✅ `transferFromCustodial()` | ✅ Direttamente |
| Anti-replay (txHash) | ✅ Parziale in `verifyUsdaTx` | ✅ `processed_txs` collection | ✅ Da aggiungere |
| Lock atomico | ❌ Assente (race condition risk) | ✅ `findOneAndUpdate` state machine | ✅ Pattern da replicare |
| Escrow | ❌ Assente | ✅ 1 custodiale per transfer | ✅ Schema + logica |
| Refund automatico | ❌ No-op | ✅ `refund-scheduler.js` | ✅ Da portare |
| Messaggi chat | ✅ Completo | ❌ Assente | — |
| WS real-time | ✅ Completo | ❌ Assente | — |
| Bubble UI | ✅ Completo | ❌ Assente | — |
| Verifica on-chain | ✅ `verifyUsdaTx` | ✅ Logs polling | Già presente in AlphaChat |
| Scheduler persistente | ❌ In-memory solo | ✅ DB-based | ✅ Da portare |

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

### Da portare da getusda.xyz (copia o shared package)

1. `lib/phone-wallet.js` → rinominare `lib/usda-custodial.ts` — `createCustodialWallet`, `transferFromCustodial`, `getCustodialBalance`
2. `lib/anti-replay.js` → `lib/usda-anti-replay.ts` — `checkAndMarkTx`, `rollbackTx`
3. `lib/tx-lock.js` → integrare nel service (pattern, non necessariamente il file)

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

1. Copia `phone-wallet.js` e `anti-replay.js` in AlphaChat, converti in TypeScript
2. Crea schema `usda_chat_transfers` + indici
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

## 14. Raccomandazione finale

**Architettura consigliata**: _Custodial Wallet per Transfer + State Machine MongoDB + Scheduler DB-driven_

Questa soluzione:

- **Riusa al massimo** il codice già testato (escrow pattern, anti-replay, lock) da getusda.xyz
- **Non duplica** infrastruttura blockchain — stesso contratto ERC-20, stesso RPC Polygon
- **Non rompe** nulla — né le API getusda.xyz né le API AlphaChat esistenti
- **È sicura** contro replay, double-spend e race condition
- **È durabile** — sopravvive a crash e restart perché lo stato è su MongoDB
- **È anonima** — nessun telefono, nessun link pubblico, identità solo via account AlphaChat
- **È scalabile** — il pattern custodial wallet regge centinaia di transfer concorrenti
- **È evolvibile** — l'adapter pattern permette di sostituire il custodiale con uno smart contract in futuro senza toccare il service layer

La scelta alternativa (smart contract escrow) è architetturalmente più elegante ma ha costi di sviluppo, audit e gas sproporzionati rispetto al volume attuale. Va rivalutata quando il sistema è maturo e il volume lo giustifica.
