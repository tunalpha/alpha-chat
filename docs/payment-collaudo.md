# Chat Payment Engine — Guida al Collaudo (RC1)

> **Versione:** RC1 — Sprint 4 completato, TypeScript 0 errori, 122/122 test automatici verdi  
> **Obiettivo:** dimostrare che il comportamento reale corrisponde a quello progettato.

---

## Framework di verifica

Per ogni scenario, "passare" non significa solo che "funziona".  
Significa che **UI, Database, Blockchain e Coerenza raccontano la stessa storia**.

Per ogni scenario verificare tutti e quattro gli aspetti:

| Aspetto | Cosa controllare |
|---------|-----------------|
| **UI** | La bolla mostra lo stato corretto? I pulsanti sono quelli previsti? La bolla si aggiorna senza refresh? |
| **Database** | Lo stato in `chat_transfers` è quello atteso? L'audit in `chat_transfer_audits` contiene la sequenza corretta? |
| **Blockchain** | Le transazioni attese sono state eseguite? Non ce ne sono di duplicate? |
| **Coerenza** | UI, database e blockchain descrivono lo stesso stato al momento della verifica? |

---

## Setup

```bash
# Variabile d'ambiente richiesta per saltare la verifica on-chain in dev
export PAYMENT_SKIP_CHAIN_VERIFY=true

# Base URL (sostituire con il dominio del repl)
BASE="https://$REPLIT_DEV_DOMAIN/api-server/api/v1"

# Token di due utenti di test (A = mittente, B = destinatario)
TOKEN_A="<access_token_utente_A>"
TOKEN_B="<access_token_utente_B>"
USER_A_ID="<id_utente_A>"
USER_B_ID="<id_utente_B>"
CONV_ID="<id_conversazione_A_B>"

# Helper: stampa solo i campi rilevanti
jq_status='{ transfer_id: .data.transfer_id, status: .data.status, escrow: .data.escrow_wallet }'

# Helper: audit trail per un transfer
audit() {
  mongosh --eval "
    db.chat_transfer_audits
      .find({ transfer_id: '$1' })
      .sort({ created_at: 1 })
      .forEach(a => printjson({ from: a.from_status, to: a.to_status, by: a.triggered_by, tx: a.tx_hash }))
  "
}

# Helper: saldo escrow on-chain
escrow_balance() {
  # $1 = escrow wallet address
  cast call 0xE71eEe8e88b22f2e4fAD8c94AC2E2a3fcAA9483 \
    "balanceOf(address)(uint256)" "$1" \
    --rpc-url https://polygon-rpc.com
}
```

---

## Scenario 1 — Flusso completo: accepted ✅

**Obiettivo:** ciclo create→deposit→accept→accepted, bolla aggiornata live.

```bash
# 1.1 Crea il trasferimento
RESP=$(curl -s -X POST "$BASE/payments" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"recipient_id\":\"$USER_B_ID\",\"conversation_id\":\"$CONV_ID\",\"amount\":\"1\"}")
echo $RESP | jq "$jq_status"
TID=$(echo $RESP | jq -r '.data.transfer_id')
ESCROW=$(echo $RESP | jq -r '.data.escrow_wallet')

# 1.2 Deposita (chain verify saltata in dev)
TX_DEP="0x$(head -c32 /dev/urandom | xxd -p)"
curl -s -X POST "$BASE/payments/$TID/deposit" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"tx_hash\":\"$TX_DEP\"}" | jq "$jq_status"

# 1.3 B accetta
curl -s -X POST "$BASE/payments/$TID/accept" \
  -H "Authorization: Bearer $TOKEN_B" | jq "$jq_status"
```

**Verifica quattro aspetti:**

```bash
# UI
# A: bolla mostra "✅ Pagamento completato" — SENZA ricaricare la pagina
# B: bolla mostra "🎉 Pagamento ricevuto!" — SENZA ricaricare la pagina
# Non deve essere necessario refresh su nessuno dei due client

# Database
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" \
  | jq '.data | { status, tx_hash_deposit, tx_hash_release, completed_at }'
# Atteso: status="accepted", tx_hash_deposit=non-null, tx_hash_release=non-null, completed_at=non-null

audit $TID
# Atteso (4 righe, in ordine):
# { from: null,               to: "awaiting_deposit", by: "user",   tx: null    }
# { from: "awaiting_deposit", to: "pending",           by: "user",   tx: "0x..." }
# { from: "pending",          to: "accepting",          by: "user",   tx: null    }
# { from: "accepting",        to: "accepted",            by: "user",   tx: "0x..." }

# Blockchain (se non si usa PAYMENT_SKIP_CHAIN_VERIFY)
# tx_hash_release deve corrispondere a una transazione reale su Polygon
# escrow_balance $ESCROW  → deve restituire 0

# Coerenza
# status in DB = "accepted" ↔ UI mostra "✅ Pagamento completato" ↔ tx_hash_release presente on-chain
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 2 — Flusso completo: rejected ↩️

**Obiettivo:** il rifiuto rimborsa il mittente e chiude il transfer.

```bash
# Setup identico a Scenario 1 fino al deposit (1.1 + 1.2)

TX_DEP="0x$(head -c32 /dev/urandom | xxd -p)"
# ... (ripetere 1.1 e 1.2)

# B rifiuta
curl -s -X POST "$BASE/payments/$TID/reject" \
  -H "Authorization: Bearer $TOKEN_B" | jq "$jq_status"
```

**Verifica quattro aspetti:**

```bash
# UI
# A: "↩️ Rifiutato, fondi restituiti al tuo wallet" — senza refresh
# B: "❌ Hai rifiutato il pagamento" — senza refresh

# Database
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" \
  | jq '.data | { status, tx_hash_release, responded_at }'
# Atteso: status="rejected", tx_hash_release=non-null (rimborso), responded_at=non-null

audit $TID
# Atteso: 4 righe fino a "rejecting → rejected"
# Il tx_hash dell'ultima riga = hash del rimborso al mittente

# Blockchain
# Il rimborso è una TX verso sender_wallet, non recipient_wallet
# escrow_balance $ESCROW  → 0

# Coerenza
# DB: status="rejected" ↔ UI: rifiutato ↔ chain: fondi tornati al mittente
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 3 — Flusso completo: cancelled 🚫

**Obiettivo:** l'annullamento da parte del mittente rimborsa i fondi.

```bash
# Setup identico fino al deposit

# A annulla
curl -s -X POST "$BASE/payments/$TID/cancel" \
  -H "Authorization: Bearer $TOKEN_A" | jq "$jq_status"
```

**Verifica quattro aspetti:**

```bash
# UI
# A: "🚫 Annullato, fondi restituiti al tuo wallet" — senza refresh
# B: "🚫 Annullato dal mittente" — senza refresh

# Database
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" \
  | jq '.data | { status, tx_hash_release }'
# Atteso: status="cancelled", tx_hash_release=non-null

audit $TID
# 4 righe fino a "cancelling → cancelled"

# Blockchain
# escrow_balance $ESCROW  → 0

# Coerenza
# DB: cancelled ↔ UI: annullato ↔ chain: rimborso confermato
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 4 — ADR-004: destinatario senza wallet 🔒

**Obiettivo:** il transfer resta `pending` se il destinatario non ha un wallet. I fondi rimangono nell'escrow.

```bash
# Prerequisito: creare un utente C senza wallets.usda
TOKEN_C="<token_utente_C_senza_wallet>"
USER_C_ID="<id_utente_C>"

# Creare transfer A → C e portarlo a pending (1.1 + 1.2 con USER_C_ID)

# C tenta di accettare
curl -s -X POST "$BASE/payments/$TID/accept" \
  -H "Authorization: Bearer $TOKEN_C" | jq '.'
# Atteso: HTTP 412 + { code: "WALLET_NOT_CONFIGURED" }
```

**Verifica quattro aspetti:**

```bash
# UI
# C: pulsante [✅ Accetta] mostra errore inline "Wallet non configurato" (o simile)
# Il pulsante torna disponibile (non rimane in stato busy)
# La bolla rimane in stato "pending" — nessun aggiornamento spurio via WS

# Database
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" \
  | jq '.data.status'
# Atteso: "pending" — lo stato NON è cambiato
# Nessuna riga audit aggiunta (il lock non è stato acquisito)

# Blockchain
# Nessuna transazione emessa
# escrow_balance $ESCROW  → > 0 (fondi ancora presenti)

# Coerenza
# DB: pending ↔ UI: pulsanti ancora visibili ↔ chain: fondi nell'escrow
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 5 — Doppio click Accetta (idempotenza) 🔁

**Obiettivo:** nessun doppio rilascio, nessun doppio rimborso, mai.

```bash
# Setup fino al deposit

# Inviare due accept quasi-simultanei
curl -s -X POST "$BASE/payments/$TID/accept" -H "Authorization: Bearer $TOKEN_B" &
curl -s -X POST "$BASE/payments/$TID/accept" -H "Authorization: Bearer $TOKEN_B" &
wait
# Atteso: una risposta { status: "accepted" }, l'altra HTTP 4xx
```

**Verifica quattro aspetti:**

```bash
# UI
# La bolla mostra lo spinner UNA SOLA VOLTA e poi "✅ Pagamento completato"
# Nessun errore visibile (il secondo 4xx viene ignorato silenziosamente)

# Database
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" \
  | jq '.data | { status, tx_hash_release }'
# Atteso: UN SOLO tx_hash_release

audit $TID
# Atteso: UNA SOLA riga "pending → accepting" (non due)
# UNA SOLA riga "accepting → accepted"

# Blockchain
# Interrogare la blockchain per tx_hash_release → esiste una sola transazione
# escrow_balance $ESCROW  → 0

# Coerenza
# DB: 1 release TX ↔ chain: 1 transazione ↔ UI: stato finale "accepted"
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 6 — Riavvio server con transfer in `pending` 🔄

**Obiettivo:** il riavvio non altera uno stato stabile. Il pagamento può essere completato normalmente dopo il riavvio.

```bash
# Setup fino al deposit (transfer in "pending")
echo "Transfer ID: $TID — status: pending"

# ► Riavviare il server (da Replit UI o workflow restart)
# ► Attendere che il server sia tornato online:
#   Log: "[Payment] Payment Engine scheduler avviato"
#   Log: "[Scheduler] Passata iniziale completata ✓"

# Verifica che lo stato non sia cambiato
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq '.data.status'
# Atteso: "pending" (non toccato dal recovery — non è un lock state)

# Completare normalmente
curl -s -X POST "$BASE/payments/$TID/accept" -H "Authorization: Bearer $TOKEN_B" | jq "$jq_status"
```

**Verifica quattro aspetti:**

```bash
# UI
# La bolla sul client di B mostra ancora [✅ Accetta][❌ Rifiuta] dopo il riavvio
# Dopo l'accept: "🎉 Pagamento ricevuto!" senza refresh

# Database
# status="pending" immediatamente dopo il riavvio
# status="accepted" dopo l'accept, con completed_at valorizzato

audit $TID
# Nessuna riga aggiunta dal recovery (il recovery tocca solo lock states)
# Sequenza normale: awaiting_deposit → pending → accepting → accepted

# Blockchain
# Nessuna TX spuria emessa durante il riavvio
# TX release emessa solo dopo l'accept esplicito di B

# Coerenza
# Log scheduler + DB status + UI = coerenti in ogni fase
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 7 — Crash recovery: lock state bloccato 💥

**Obiettivo:** il recovery scheduler risolve un transfer incastrato in `accepting` dopo un crash simulato.

> Simula il caso peggiore: crash DOPO la firma blockchain ma PRIMA dell'aggiornamento MongoDB.

```bash
# Setup fino al deposit

# Iniettare manualmente un lock state bloccato (> 10 minuti fa)
mongosh --eval "
  db.chat_transfers.updateOne(
    { transfer_id: '$TID' },
    { \$set: { status: 'accepting', locked_at: new Date(Date.now() - 15*60*1000) } }
  )
"

# Attendere il ciclo scheduler (max 10 min)
# Log atteso: "[Scheduler] processStuckTransfers: 1 transfer(s) processati"
# Log atteso: "[Payment] Recovery completato"

# Oppure forzare il ciclo via log scheduler
```

**Verifica quattro aspetti:**

```bash
# UI
# La bolla era ferma sullo spinner (lock state visibile)
# Dopo il recovery: aggiornamento automatico via WS payment.state_changed
# Nessun refresh necessario

# Database
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" \
  | jq '.data | { status, tx_hash_release, completed_at }'
# Atteso: status="accepted" (o "failed" se l'escrow era già vuoto), completed_at=non-null

audit $TID
# L'ultima riga di audit mostra il recovery: triggered_by="system" o "scheduler"

# Blockchain
# tx_hash_release corrisponde a una TX reale (non duplicata rispetto al deposit)
# escrow_balance $ESCROW  → 0

# Coerenza
# DB: terminale ↔ UI: stato finale senza spinner ↔ chain: 0 USDA nell'escrow
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 8 — Scadenza automatica ⏰

**Obiettivo:** lo scheduler rimborsa automaticamente i transfer scaduti.

```bash
# Setup fino al deposit

# Forzare la scadenza
mongosh --eval "
  db.chat_transfers.updateOne(
    { transfer_id: '$TID' },
    { \$set: { expires_at: new Date(Date.now() - 1000) } }
  )
"
# Attendere il ciclo scheduler (max 5 min)
# Log: "[Scheduler] processExpiredTransfers: 1 transfer(s) scaduti processati"
```

**Verifica quattro aspetti:**

```bash
# UI
# La bolla su entrambi i client mostra "⏰ Scaduto e rimborsato"
# Aggiornamento automatico via WS — nessun refresh

# Database
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" \
  | jq '.data | { status, tx_hash_release, completed_at }'
# Atteso: status="expired", tx_hash_release=non-null (rimborso), completed_at=non-null

audit $TID
# Ultima riga: { from: "refunding", to: "expired", by: "scheduler", tx: "0x..." }

# Blockchain
# tx_hash_release = rimborso verso sender_wallet
# escrow_balance $ESCROW  → 0

# Coerenza
# DB: expired ↔ UI: ⏰ scaduto ↔ chain: fondi restituiti al mittente
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 9 — Aggiornamento live bolla (WebSocket) 📡

**Obiettivo:** il WS `payment.state_changed` aggiorna la bolla senza refresh, su entrambi i client.

```
Procedura (due browser aperti):

1. Browser A e Browser B: entrambi aperti sulla stessa conversazione

2. A crea il transfer via API → la bolla appare su ENTRAMBI i client istantaneamente
   (il messaggio "payment" è creato via broadcast message.new)

3. A deposita → su B la bolla mostra [✅ Accetta][❌ Rifiuta] senza refresh

4. B accetta → su A la bolla mostra "✅ Pagamento completato" senza refresh

5. Aprire DevTools → Network → WS su entrambi i browser
   Verificare il frame: { type: "payment.state_changed", payload: { status: "accepted", ... } }
```

**Verifica quattro aspetti:**

```bash
# UI
# [A] ogni cambio di stato aggiorna la bolla in tempo reale
# [B] ogni cambio di stato aggiorna la bolla in tempo reale
# Nessun refresh manuale necessario in nessuna delle fasi

# Database
# Dopo ogni passo: lo stato in DB corrisponde a quello mostrato nella bolla

# Blockchain
# WS non emette eventi blockchain — verifica solo che il payload status corrisponda al DB

# Coerenza
# DevTools WS payload.status = DB status = bolla UI status — in ogni istante
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 10 — Audit trail completo 📋

**Obiettivo:** ogni transizione di stato ha una voce corrispondente. Nessuna lacuna, nessun duplicato.

```bash
# Dopo aver completato gli Scenari 1, 2 e 3 (uno accepted, uno rejected, uno cancelled)

# Per ogni TID verificato:
audit $TID
```

**Verifica quattro aspetti:**

```bash
# Per il flusso accepted:
# { from: null,               to: "awaiting_deposit", by: "user",      tx: null    }
# { from: "awaiting_deposit", to: "pending",           by: "user",      tx: "0x..." }
# { from: "pending",          to: "accepting",          by: "user",      tx: null    }
# { from: "accepting",        to: "accepted",            by: "user",      tx: "0x..." }

# Per il flusso rejected:
# stessa sequenza fino a "pending → rejecting → rejected"

# Per il flusso cancelled:
# stessa sequenza fino a "pending → cancelling → cancelled"

# Regole:
# - Numero righe = numero transizioni attese (nessuna in più, nessuna in meno)
# - Campo tx_hash valorizzato solo sulle righe con TX on-chain
# - triggered_by = "user" per azioni manuali, "scheduler" per recovery/scadenza
# - created_at strettamente crescente

# UI
# Non applicabile (audit è solo backend)

# Database
# Tutte le righe presenti, corrette e nell'ordine atteso

# Blockchain
# I tx_hash nelle righe audit coincidono con TX reali su Polygon

# Coerenza
# audit.tx_hash = chat_transfers.tx_hash_deposit / tx_hash_release
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | N/A | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 11 — Escrow saldo zero post-terminale 💰

**Obiettivo:** nessun fondo rimane bloccato nell'escrow dopo uno stato terminale.

```bash
# Eseguire dopo gli Scenari 1, 2, 3, 7 e 8

# Per ogni transfer terminale:
ESCROW_ADDR=$(curl -s "$BASE/payments/$TID" \
  -H "Authorization: Bearer $TOKEN_A" | jq -r '.data.escrow_wallet')
escrow_balance $ESCROW_ADDR
# Atteso: 0
# Se il saldo è > 0 dopo uno stato terminale → BUG CRITICO — segnalare immediatamente
```

**Verifica quattro aspetti:**

```bash
# UI
# Non applicabile

# Database
# status = terminale (accepted/rejected/cancelled/expired/failed)
# tx_hash_release = non-null (rimborso o pagamento eseguito)

# Blockchain
# escrow_balance → 0 per OGNI wallet escrow verificato
# La TX corrispondente a tx_hash_release è presente on-chain verso l'indirizzo corretto

# Coerenza
# DB tx_hash_release ↔ TX on-chain verso l'indirizzo atteso ↔ escrow saldo 0
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | N/A | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Scenario 12 — Deploy con pagamento in `pending` 🚀

**Obiettivo:** un deploy in produzione non corrompe i pagamenti in corso.

```bash
# 1. Creare un transfer e portarlo a "pending"
echo "Transfer ID: $TID — status atteso dopo deploy: pending"

# ► Effettuare il deploy (o riavvio in produzione)
# ► Attendere che il server sia tornato online

# 2. Verificare che lo stato non sia cambiato
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq '.data.status'
# Atteso: "pending"

# 3. Log di avvio:
# "[Scheduler] Passata iniziale completata ✓"  ← il "pending" non viene toccato

# 4. Completare normalmente
curl -s -X POST "$BASE/payments/$TID/accept" -H "Authorization: Bearer $TOKEN_B" | jq "$jq_status"
# Atteso: "accepted"
```

**Verifica quattro aspetti:**

```bash
# UI
# Dopo il deploy: le bolle in-page mostrano ancora lo stato corretto
# (se la pagina era aperta, il WS si riconnette — nessun refresh necessario)
# Dopo l'accept: bolla aggiornata normalmente

# Database
# Subito dopo il deploy: status="pending" (invariato)
# Dopo l'accept: status="accepted"
# Nessuna riga audit spuria aggiunta durante il deploy

# Blockchain
# Nessuna TX emessa durante il deploy
# TX release solo dopo l'accept di B

# Coerenza
# Log scheduler ("pending non toccato") + DB status + UI = coerenti
```

| Aspetto | Risultato | Note |
|---------|-----------|------|
| UI | ⬜ | |
| Database | ⬜ | |
| Blockchain | ⬜ | |
| Coerenza | ⬜ | |

---

## Checklist di accettazione RC1

### Scenari

| # | Scenario | UI | DB | Chain | Coer. | Esito |
|---|----------|----|----|-------|-------|-------|
| 1 | Flusso accepted | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 2 | Flusso rejected | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 3 | Flusso cancelled | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 4 | ADR-004 wallet assente | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 5 | Doppio click idempotente | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 6 | Riavvio in pending | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 7 | Crash recovery lock state | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 8 | Scadenza automatica | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 9 | Aggiornamento live WS | ⬜ | ⬜ | N/A | ⬜ | ⬜ |
| 10 | Audit trail completo | N/A | ⬜ | ⬜ | ⬜ | ⬜ |
| 11 | Escrow saldo 0 | N/A | ⬜ | ⬜ | ⬜ | ⬜ |
| 12 | Deploy in pending | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

### Criteri di go/no-go

- [ ] Tutti gli ⬜ diventano ✅ (nessun N/A conta come fallimento)
- [ ] Nessun fondo perso o duplicato in Scenario 11
- [ ] Nessun doppio tx_hash in Scenario 5
- [ ] Nessuno stato intermedio permanente: ogni lock state si risolve entro 10 min (Scenario 7)
- [ ] Bolla aggiornata live senza refresh su entrambi i client (Scenario 9)
- [ ] 122/122 test automatici verdi al momento del tag

---

## Post-collaudo: Git tag RC1

Quando tutti i criteri di go/no-go sono soddisfatti, creare il tag di riferimento:

```bash
# Verificare che i test siano verdi
cd artifacts/api-server && npx vitest run src/payment/__tests__/ 2>&1 | tail -5

# Creare il tag localmente
git tag -a payment-engine-rc1 -m "Chat Payment Engine RC1

- Sprint 1: state machine, modelli, custodial service, anti-replay (73 test)
- Sprint 2: REST API /api/v1/payments, 6 endpoint (26 test)
- Sprint 3: scheduler processExpiredTransfers + processStuckTransfers (13 test)
- Sprint 4: ChatPaymentBubble, WS handler, doppio-click guard (10 test)
- Totale: 122/122 test automatici verdi
- TypeScript: 0 errori
- Collaudo manuale: 12/12 scenari superati"

# Pushare il tag al remote
git push origin payment-engine-rc1
```

Il tag costituisce il **punto di riferimento stabile** per confronti futuri.  
Qualsiasi modifica successiva (multi-asset, richieste avanzate, ecc.) potrà essere comparata con questo baseline.

---

> *Guida aggiornata dopo RC1 review — framework a 4 livelli (UI, Database, Blockchain, Coerenza) per ogni scenario.*
