# USDA Backend Connection Report

**Data:** 22 luglio 2026  
**Sprint:** Collegamento Backend USDA Reale — Contratto Definitivo  
**Stato:** ✅ HttpUsdaAdapter allineato al contratto API definitivo

---

## 1. Variabili d'ambiente configurate

| Variabile | Valore | Note |
|-----------|--------|------|
| `USDA_API_BASE_URL` | `https://getusda.xyz` | Attiva HttpUsdaAdapter |
| `USDA_CHAIN_ID` | `137` | Polygon Mainnet |
| `USDA_CONTRACT_ADDRESS` | `0xe714655fD1B3ba96B887DF1F94336c2A78E24001` | ERC-20 USDA token |

**Non configurate (non esistono nel backend USDA):**
- ❌ `USDA_API_KEY` — il backend non richiede autenticazione
- ❌ `USDA_API_SECRET` — non previsto
- ❌ Bearer Token — nessun header di autenticazione

---

## 2. Contratto API definitivo USDA

### Endpoint confermati

| Endpoint | Metodo | Utilizzo |
|----------|--------|----------|
| `GET /api/health` | GET | Health check — nessuna autenticazione |
| `POST /api/pay/prepare` | POST | Passo 1 invio: ottieni `pendingTransferId` + `recipientAddress` |
| `POST /api/pay/confirm` | POST | Passo 2 invio: conferma con `pendingTransferId` + `txHash` |
| `POST /api/pay/request` | POST | Crea richiesta di pagamento |
| `POST /api/pay/claim/{code}` | POST | Riscossione (ex claim) **e** pagamento di richiesta (ex pay) |
| `GET /api/pay/poll-tx` | GET | Polling stato transazione (`?code={code}`) |
| `GET /api/pay/history` | GET | Storico pagamenti |

### Endpoint eliminati

| Endpoint rimosso | Motivo |
|------------------|--------|
| `POST /api/pay/send` | Sostituito dal flusso prepare → confirm |
| `POST /api/pay/pay` | Sostituito da `POST /api/pay/claim/{code}` |
| `POST /api/pay/refund/{code}` | Il rimborso non è un'azione — stato osservato via polling |

---

## 3. Flusso sendPayment (sequenza in due passi)

```
UsdaService.submitPayment()
        │
        ▼
POST /api/pay/prepare
  body: { from_user_id, to_user_id, amount, note }
  risposta: { pendingTransferId, recipientAddress, fee, total, amount_units }
        │
        ▼
Firma blockchain (ThirdWeb SDK in produzione — simulata in sviluppo)
  → txHash
        │
        ▼
POST /api/pay/confirm
  body: { pendingTransferId, txHash, reference_id }
  risposta: { code, status, tx_hash?, claim_expires_at? }
        │
        ▼
_startPolling(code)   ← polling ogni 6s via GET /api/pay/poll-tx
        │
        ▼
usda.payment.update   ← WS event in-place bubble update
```

---

## 4. Flusso requestPayment (singola chiamata — invariato)

```
POST /api/pay/request
  body: { from_user_id, to_user_id, amount, note, reference_id }
  risposta: { code, status, claim_expires_at? }
```

---

## 5. Flusso claimPayment e payRequest (stesso endpoint)

Sia la riscossione di un pagamento inviato, sia il pagamento di una richiesta,
usano lo stesso endpoint USDA:

```
POST /api/pay/claim/{code}
  body: { [txHash]?, [payer_id]? }
  risposta: { status, tx_hash?, claimed_at? }
```

Il `code` è l'`external_payment_id` salvato in MongoDB al momento della creazione.

---

## 6. Rimborso — nessuna azione invocabile

Il rimborso **non è un'operazione** che AlphaChat può invocare.

È uno stato (`refunded`) che il backend USDA assegna autonomamente alla transazione e che viene osservato tramite polling:

```
GET /api/pay/poll-tx?code={code}
  → { status: "refunded", tx_hash?: "...", ... }
  → _onStatusChange(externalId, "refunded", txHash)
    → aggiorna MongoDB
    → broadcast usda.payment.update
      → bubble aggiornata in-place (stato ↩️ Rimborso automatico)
```

`refundPayment()` nell'adapter è un no-op mantenuto per compatibilità con l'interfaccia `UsdaAdapter`.

---

## 7. Polling — stati riconosciuti

| Stato USDA backend | Stato AlphaChat | Terminale? |
|--------------------|-----------------|------------|
| `pending` | `pending` | No (continua polling) |
| `confirmed` | `confirmed` | ✅ Sì |
| `claimed` | `claimed` | ✅ Sì |
| `refunded` | `refunded` | ✅ Sì |
| `failed` | `failed` | ✅ Sì |
| `pending_claim` | `pending_claim` | No (continua polling) |
| Timeout 5 min | `failed` | ✅ Sì |

---

## 8. Saldo ERC-20 (non via HTTP)

Il backend USDA non espone un endpoint HTTP per il saldo.

```
Contratto: 0xe714655fD1B3ba96B887DF1F94336c2A78E24001  (Polygon Mainnet)
Metodo:    eth_call → balanceOf(address) → selector 0x70a08231
Decimali:  6 (dollar-pegged stablecoin standard)
RPC:       https://polygon-rpc.com  (default, no API key)
           Configurabile via USDA_POLYGON_RPC
Timeout:   8 secondi
```

---

## 9. Graceful degradation

- `GET /api/v1/usda/health` (AlphaChat, unauthenticated) → chiama `GET /api/health`
- Se il backend non risponde: `_isAvailable = false`
- `preparePayment()` e `submitPayment()` lanciano `UsdaUnavailableError` (HTTP 503)
- Il frontend disabilita i pulsanti di pagamento
- La chat rimane pienamente operativa
- Il check si ripete automaticamente ogni 60 secondi

---

## 10. File modificati

| File | Tipo modifica |
|------|---------------|
| `artifacts/api-server/src/usda/http-usda.adapter.ts` | Adeguamento contratto definitivo |
| `artifacts/api-server/src/usda/polygon-rpc.ts` | Nuovo — ERC-20 balanceOf |
| `artifacts/api-server/src/services/usda.service.ts` | getWallet balance reale; checkHealth; callback Http |
| `artifacts/api-server/src/controllers/usda.controller.ts` | getHealth handler |
| `artifacts/api-server/src/routes/v1/usda.routes.ts` | GET /health (unauthenticated) |

**Non modificati:**
- `UsdaAdapter` interface
- `MockUsdaAdapter` (preservato per sviluppo locale)
- `usda.service.ts` (logica pagamenti, webhook handler)
- Database / modelli MongoDB
- UI / componenti frontend
- WebSocket / eventi
- Chat, messaggi, gruppi, chiamate

---

## 11. Checklist pre-go-live

```
[✅] USDA_API_BASE_URL = https://getusda.xyz  → HttpUsdaAdapter attivo
[✅] USDA_CHAIN_ID = 137
[✅] USDA_CONTRACT_ADDRESS configurato
[✅] Nessuna API key / Bearer token (confermato)
[✅] POST /api/pay/prepare implementato
[✅] POST /api/pay/confirm implementato
[✅] POST /api/pay/request implementato
[✅] POST /api/pay/claim/{code} — sia payRequest che claimPayment
[✅] GET /api/pay/poll-tx — polling con tutti e 5 gli stati
[✅] GET /api/pay/history implementato
[✅] GET /api/health — health check + graceful degradation
[✅] refundPayment no-op — rimborso via polling
[✅] balanceOf ERC-20 via Polygon RPC
[✅] TypeScript clean (0 errori introdotti)

[ ] Test end-to-end: invio USDA (prepare → sign → confirm → poll → confirmed)
[ ] Test end-to-end: richiesta + claim
[ ] Test: polling → refunded (rimborso automatico backend)
[ ] Integrare ThirdWeb SDK per firma reale (sostituisce _simulateTxHash)
[ ] Verificare decimali USDA contratto (assunti 6 — da confermare)
[ ] Configurare USDA_POLYGON_RPC se RPC pubblico risulta lento
```

---

## 12. Conferma MockUsdaAdapter

Il `MockUsdaAdapter` è **preservato** per sviluppo locale e test automatici.

- `USDA_API_BASE_URL` **non impostato** → MockUsdaAdapter (auto-conferma 3s)
- `USDA_API_BASE_URL` **impostato** → HttpUsdaAdapter (backend reale)

Può essere rimosso in futuro ma non è richiesto per la produzione.
