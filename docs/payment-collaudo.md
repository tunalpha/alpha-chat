# Chat Payment Engine — Guida al Collaudo

> **Versione:** Sprint 4 completato  
> **Criterio di accettazione:** tutti gli scenari producono l'esito atteso senza fondi persi, duplicati o stati incoerenti.

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

# Atteso: { status: "awaiting_deposit" }
# UI (A): bolla "In attesa del tuo deposito"
# UI (B): bolla "In attesa del deposito"

# 1.2 Deposita (chain verify saltata in dev)
TX="0x$(head -c32 /dev/urandom | xxd -p)"
curl -s -X POST "$BASE/payments/$TID/deposit" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"tx_hash\":\"$TX\"}" | jq "$jq_status"

# Atteso: { status: "pending" }
# UI (A): "Depositato, in attesa risposta" + [🚫 Annulla]
# UI (B): [✅ Accetta] [❌ Rifiuta]

# 1.3 B accetta
curl -s -X POST "$BASE/payments/$TID/accept" \
  -H "Authorization: Bearer $TOKEN_B" | jq "$jq_status"

# Atteso: { status: "accepted" }
# UI (A): "✅ Pagamento completato"
# UI (B): "🎉 Pagamento ricevuto!" — senza refresh
```

**Verifica finale:**
```bash
# Stato MongoDB
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq '.data | { status, tx_hash_release, completed_at }'
# Audit trail completo
# Vedere Scenario 10 per la verifica audit
```

---

## Scenario 2 — Flusso completo: rejected ↩️

```bash
# Setup identico a Scenario 1 fino al deposit (1.1 + 1.2)

# B rifiuta
curl -s -X POST "$BASE/payments/$TID/reject" \
  -H "Authorization: Bearer $TOKEN_B" | jq "$jq_status"

# Atteso: { status: "rejected" }
# UI (A): "↩️ Rifiutato, fondi restituiti"
# UI (B): "❌ Hai rifiutato il pagamento"
# Verifica: saldo escrow = 0, fondi tornati a sender_wallet
```

---

## Scenario 3 — Flusso completo: cancelled 🚫

```bash
# Setup identico fino al deposit

# A annulla
curl -s -X POST "$BASE/payments/$TID/cancel" \
  -H "Authorization: Bearer $TOKEN_A" | jq "$jq_status"

# Atteso: { status: "cancelled" }
# UI (A): "🚫 Annullato"
# UI (B): "🚫 Annullato dal mittente"
```

---

## Scenario 4 — ADR-004: destinatario senza wallet 🔒

**Obiettivo:** il trasferimento resta `pending` se B non ha un wallet configurato. Nessuna perdita di fondi.

```bash
# Prerequisito: USER_B non deve avere wallets.usda configurato
# Oppure creare un utente C senza wallet

# Setup identico fino al deposit (con USER_C come recipient)

# C tenta di accettare
curl -s -X POST "$BASE/payments/$TID/accept" \
  -H "Authorization: Bearer $TOKEN_C"

# Atteso: HTTP 412 + { code: "WALLET_NOT_CONFIGURED" }
# Il transfer rimane in status: "pending"
# I fondi sono ancora nell'escrow
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq '.data.status'
# Atteso: "pending"
```

---

## Scenario 5 — Doppio click Accetta (idempotenza) 🔁

**Obiettivo:** la seconda richiesta di accept su un transfer già in `accepting` fallisce gracefully, senza doppio rilascio.

```bash
# Setup fino al deposit

# Inviare due accept quasi-simultanei (simulazione doppio-click)
curl -s -X POST "$BASE/payments/$TID/accept" -H "Authorization: Bearer $TOKEN_B" &
curl -s -X POST "$BASE/payments/$TID/accept" -H "Authorization: Bearer $TOKEN_B" &
wait

# Atteso:
# - Una richiesta restituisce { status: "accepted" } con tx_hash_release
# - L'altra restituisce HTTP 4xx + { code: "TRANSFER_NOT_FOUND" } (il record
#   era già in "accepting" e il findOne({status:"pending"}) non lo trovava)
#   OPPURE una delle due era già completata prima che l'altra acquisisse il lock

# Verifica: UN SOLO tx_hash_release, UN SOLO evento audit "pending → accepting"
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq '.data | { status, tx_hash_release }'
```

**Frontend:** `busyRef.current = true` (sincrono) blocca il secondo click anche prima del re-render.

---

## Scenario 6 — Riavvio server durante pagamento in `pending` 🔄

**Obiettivo:** il riavvio non corrompe un transfer in stato stabile (`pending`).

```bash
# Setup fino al deposit (transfer in "pending")
echo "Transfer in pending: $TID"

# Riavvia il server (dalla UI Replit o via workflow restart)
# Attendere che il server sia tornato online (log: "Alpha Chat API listening")

# Verifica che lo stato sia invariato
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq '.data.status'
# Atteso: "pending" — non modificato dal recovery (non è un lock state)

# Completare il pagamento normalmente
curl -s -X POST "$BASE/payments/$TID/accept" -H "Authorization: Bearer $TOKEN_B" | jq "$jq_status"
# Atteso: "accepted"
```

---

## Scenario 7 — Riavvio server durante `accepting` (crash recovery) 💥

**Obiettivo:** il recovery riporta il transfer allo stato corretto dopo un crash in un lock state.

> Questo scenario simula il caso peggiore: crash DOPO la firma blockchain ma PRIMA dell'aggiornamento MongoDB.

```bash
# Setup fino al deposit

# Iniettare manualmente un transfer bloccato in "accepting" con locked_at vecchio
# (in un ambiente di test con MongoDB shell o mongo-express)
mongosh --eval "
  db.chat_transfers.updateOne(
    { transfer_id: '$TID' },
    { \$set: { status: 'accepting', locked_at: new Date(Date.now() - 15*60*1000) } }
  )
"

# Verifica che il recovery lo risolva:
# A. Aspettare il ciclo scheduler (max 10 min) — il log mostrerà:
#    "[Scheduler] Recovery completato ✓ { from: 'accepting', to: 'accepted' }"
#
# B. Oppure forzare processStuckTransfers via script di test:
#    node -e "require('./dist/payment/payment-scheduler.service.js').processStuckTransfers()"

# Verifica finale
curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq '.data | { status, completed_at }'
# Atteso: { status: "accepted", completed_at: <timestamp> }
```

---

## Scenario 8 — Scadenza automatica ⏰

**Obiettivo:** un transfer `pending` con `expires_at` nel passato viene rimborsato automaticamente dallo scheduler.

```bash
# Setup fino al deposit

# Modificare expires_at nel passato (MongoDB shell)
mongosh --eval "
  db.chat_transfers.updateOne(
    { transfer_id: '$TID' },
    { \$set: { expires_at: new Date(Date.now() - 1000) } }
  )
"

# Attendere il ciclo scheduler (max 5 min) — log:
# "[Scheduler] Transfer scaduto rimborsato ✓ { transferId: '$TID', txHash: '0x...' }"

curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq '.data | { status, tx_hash_release }'
# Atteso: { status: "expired", tx_hash_release: "0x..." }

# UI: bolla mostra "⏰ Scaduto e rimborsato" su entrambi i client senza refresh
```

---

## Scenario 9 — Aggiornamento live bolla senza refresh 📡

**Obiettivo:** verificare che `payment.state_changed` via WebSocket aggiorni la bolla immediatamente.

```bash
# Setup: due browser aperti — A nella conversazione, B nella stessa

# Procedura:
# 1. A crea il trasferimento → bolla appare su entrambi i client
# 2. A deposita → bolla su B mostra [✅ Accetta][❌ Rifiuta] senza refresh
# 3. B accetta → bolla su A mostra "✅ Pagamento completato" in tempo reale
# 4. Verificare che lo stato sia cambiato senza ricaricare la pagina

# Log da controllare nei browser DevTools (Network → WS):
# → payload: { type: "payment.state_changed", payload: { status: "accepted", ... } }
```

---

## Scenario 10 — Audit trail completo 📋

**Obiettivo:** ogni transizione di stato ha una corrispondente voce in `chat_transfer_audits`.

```bash
# Dopo aver completato lo Scenario 1 (accepted)

# Via MongoDB shell o db-manager:
mongosh --eval "
  db.chat_transfer_audits
    .find({ transfer_id: '$TID' })
    .sort({ created_at: 1 })
    .forEach(a => printjson({ from: a.from_status, to: a.to_status, by: a.triggered_by, tx: a.tx_hash }))
"

# Atteso (flusso accept):
# { from: null,          to: "awaiting_deposit", by: "user",      tx: null    }
# { from: "awaiting_deposit", to: "pending",    by: "user",      tx: "0x..." }
# { from: "pending",    to: "accepting",         by: "user",      tx: null    }
# { from: "accepting",  to: "accepted",           by: "user",      tx: "0x..." }
#
# Nessuna riga mancante, nessuna riga duplicata.
```

---

## Scenario 11 — Verifica escrow non bloccato 💰

**Obiettivo:** al termine di ogni flusso, il wallet escrow deve avere saldo 0.

```bash
# Dopo ogni scenario terminale (accepted/rejected/cancelled/expired)
ESCROW_ADDR=$(curl -s "$BASE/payments/$TID" -H "Authorization: Bearer $TOKEN_A" | jq -r '.data.escrow_wallet')

# Leggere saldo on-chain (Polygon Mainnet/Amoy)
# Via cast (foundry):
cast call 0xE71eEe8e88b22f2e4fAD8c94AC2E2a3fcAA9483 \
  "balanceOf(address)(uint256)" $ESCROW_ADDR \
  --rpc-url https://polygon-rpc.com

# Atteso: 0
# Se il saldo non è 0 dopo uno stato terminale → fondi bloccati → BUG CRITICO
```

---

## Scenario 12 — Deploy con pagamento in pending 🚀

**Obiettivo:** un deploy (riavvio in produzione) non corrompe un pagamento in corso.

```bash
# 1. Creare un transfer e portarlo a "pending"
# 2. Effettuare il deploy (o riavvio in produzione)
# 3. Verificare che il transfer sia ancora "pending" dopo il riavvio
# 4. Completare il pagamento normalmente

# Il recovery scheduler girerà subito all'avvio (setTimeout 8s):
# Log: "[Scheduler] Passata iniziale completata ✓"
# Il record "pending" non è un lock state → non viene toccato

# Completare:
curl -s -X POST "$BASE/payments/$TID/accept" -H "Authorization: Bearer $TOKEN_B" | jq "$jq_status"
# Atteso: "accepted"
```

---

## Checklist di accettazione

| # | Scenario | Esito | Note |
|---|----------|-------|------|
| 1 | Flusso accepted | ⬜ | |
| 2 | Flusso rejected | ⬜ | |
| 3 | Flusso cancelled | ⬜ | |
| 4 | ADR-004 wallet assente → 412 | ⬜ | |
| 5 | Doppio click idempotente | ⬜ | |
| 6 | Riavvio server in pending | ⬜ | |
| 7 | Crash recovery in accepting | ⬜ | |
| 8 | Scadenza automatica scheduler | ⬜ | |
| 9 | Aggiornamento live bolla WS | ⬜ | |
| 10 | Audit trail completo | ⬜ | |
| 11 | Escrow saldo 0 post-terminale | ⬜ | |
| 12 | Deploy con pagamento in pending | ⬜ | |

**Criteri di go/no-go:**
- Tutti i ⬜ diventano ✅
- Nessun fondo perso o duplicato
- Nessuno stato intermedio permanente (lock state > 10 min → recovery)
- Bolla aggiornata live su entrambi i client senza refresh
