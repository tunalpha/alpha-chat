# USDA Backend Connection Report

**Data:** 22 luglio 2026  
**Sprint:** Collegamento Backend USDA Reale  
**Stato:** ✅ HttpUsdaAdapter configurato e attivo

---

## 1. Variabili d'ambiente configurate

| Variabile | Valore (oscurato) | Note |
|-----------|-------------------|------|
| `USDA_API_BASE_URL` | `https://getusda.xyz` | Attiva HttpUsdaAdapter |
| `USDA_CHAIN_ID` | `137` | Polygon Mainnet |
| `USDA_CONTRACT_ADDRESS` | `0xe714655fD1B3ba96B887DF1F94336c2A78E24001` | ERC-20 USDA token |

**Non configurate (non esistono nel backend USDA):**
- ❌ `USDA_API_KEY` — il backend non richiede autenticazione
- ❌ `USDA_API_SECRET` — non previsto
- ❌ `USDA_ENV` — non previsto
- ❌ Bearer Token — nessun header di autenticazione

---

## 2. Endpoint verificati dalla documentazione USDA

| Endpoint | Metodo | Stato | Utilizzo |
|----------|--------|-------|----------|
| `/api/health` | GET | ✅ Documentato | Health check — sostituisce `/capabilities` |
| `/api/pay/poll-tx` | GET | ✅ Documentato | Polling stato transazione (`?code={code}`) |
| `/api/pay/claim/{code}` | POST | ✅ Documentato | Riscossione pagamento |

---

## 3. Endpoint da verificare con il backend reale (VERIFY)

Questi endpoint seguono il pattern `/api/pay/...` dedotto dalla documentazione. I path, i corpi delle richieste e la struttura delle risposte devono essere confermati con il team USDA prima del go-live.

| Endpoint | Metodo | Path presunto | Corpo richiesta presunto |
|----------|--------|---------------|--------------------------|
| Invia pagamento | POST | `/api/pay/send` | `{ from_user_id, to_user_id, amount, fee, note, reference_id }` |
| Crea richiesta | POST | `/api/pay/request` | `{ from_user_id, to_user_id, amount, note, reference_id }` |
| Paga richiesta | POST | `/api/pay/pay` | `{ code, payer_id }` |
| Rimborso | POST | `/api/pay/refund/{code}` | — (solo path) |
| Storico | GET | `/api/pay/history` | `?user_id&type&limit&skip` |

---

## 4. Differenze rispetto al MockUsdaAdapter

| Comportamento | MockUsdaAdapter | HttpUsdaAdapter |
|---------------|-----------------|-----------------|
| Autenticazione | Nessuna | Nessuna (confermato) |
| Prefisso API | N/A | `/api/...` (nessun `/v1`) |
| Health check | Sempre OK | `GET /api/health` |
| Capabilities | Hardcoded | Derivate da `/api/health` |
| Saldo wallet | In-memory (mock) | ERC-20 `balanceOf` via Polygon RPC |
| Auto-conferma | 3 secondi (setTimeout) | Polling `GET /api/pay/poll-tx` ogni 6s |
| Webhook | Non supportato | Non supportato (polling interno) |
| Firma transazione | Simulata (800ms) | Non richiesta (backend custodiale) |
| `/prepare` | Simulato | Calcolato localmente (fee 0.1%) |
| Aggiornamento WS | `usda.payment.update` | `usda.payment.update` (identico) |
| Durata polling | N/A | Max 5 minuti, poi `failed` |
| Timeout request | N/A | 10 secondi + 3 retry esponenziali |

---

## 5. Architettura balance (ERC-20 via Polygon RPC)

Il backend USDA non espone un endpoint HTTP per il saldo. Il saldo viene letto direttamente dalla blockchain via JSON-RPC:

```
Contratto: 0xe714655fD1B3ba96B887DF1F94336c2A78E24001  (Polygon Mainnet)
Decimali:  6 (standard dollar-pegged stablecoin)
RPC:       https://polygon-rpc.com  (pub. RPC, no API key)
           Configurabile via USDA_POLYGON_RPC env var
Metodo:    eth_call → balanceOf(address) → 0x70a08231...
```

**File:** `artifacts/api-server/src/usda/polygon-rpc.ts`

---

## 6. Health check e graceful degradation

- `GET /api/v1/usda/health` — endpoint AlphaChat (non richiede autenticazione)
- Chiama `GET /api/health` sul backend USDA, cache 60 secondi
- Se il backend non risponde:
  - `_isAvailable = false`
  - Le operazioni di pagamento lanciano `UsdaUnavailableError` (503)
  - Il frontend disabilita i pulsanti di pagamento
  - La chat rimane pienamente operativa
- Il check si ripete automaticamente ogni 60 secondi

---

## 7. Polling interno

Il backend USDA non supporta webhook. Gli aggiornamenti di stato avvengono tramite polling interno:

```
submitPayment / payRequest
  → avvia polling (6s intervallo, max 5 min)
  → GET /api/pay/poll-tx?code={code}
  → stato cambiato → _onStatusChange(externalId, status, txHash)
    → _handleExternalStatusChange() in usda.service.ts
      → aggiorna MongoDB
      → aggiorna system_metadata del messaggio
      → broadcast usda.payment.update via WebSocket
        → bubble aggiornata in-place nel frontend
```

---

## 8. File modificati (solo strato di integrazione)

| File | Tipo modifica |
|------|---------------|
| `artifacts/api-server/src/usda/http-usda.adapter.ts` | **Riscrittura completa** — endpoint, polling, health, no-auth |
| `artifacts/api-server/src/usda/polygon-rpc.ts` | **Nuovo** — ERC-20 balanceOf via eth_call |
| `artifacts/api-server/src/services/usda.service.ts` | `getWallet()` con balance reale; `checkHealth()`; callback Http |
| `artifacts/api-server/src/controllers/usda.controller.ts` | Aggiunto `getHealth` handler |
| `artifacts/api-server/src/routes/v1/usda.routes.ts` | `GET /health` (unauthenticated) |

**Non modificati (invariati):**
- ❌ `UsdaAdapter` interface — nessun cambiamento
- ❌ `MockUsdaAdapter` — preservato per sviluppo locale
- ❌ `usda.service.ts` (logica pagamenti) — invariata
- ❌ Database / modelli MongoDB — invariati
- ❌ UI / componenti frontend — invariati
- ❌ WebSocket / eventi — invariati
- ❌ Chat, messaggi, gruppi, chiamate — invariati

---

## 9. Test eseguiti

| Test | Risultato |
|------|-----------|
| TypeScript `--noEmit` backend | ✅ 0 errori (8 pre-esistenti in `diagnostics.routes.ts` esclusi) |
| API server restart con `USDA_API_BASE_URL` impostato | ✅ HttpUsdaAdapter attivo (log confermato) |
| `GET /api/v1/usda/health` endpoint disponibile | ✅ (registrato in routes) |
| `balanceOfUsda()` unit logic | ✅ Calcolo decimali verificato (BigInt 6 decimali) |
| `_mapUsdaStatus()` — tutti gli stati | ✅ Mappatura copre tutti i 9 stati AlphaChat |
| Polling loop — avvio/stop su stato terminale | ✅ Logica verificata in codice |
| Graceful degradation — `_isAvailable = false` | ✅ Lancia `UsdaUnavailableError` (503) |

**Test end-to-end con pagamenti reali:** in attesa di conferma endpoint dal team USDA (path marcati VERIFY).

---

## 10. Checklist pre-go-live

```
[✅] USDA_API_BASE_URL impostato → HttpUsdaAdapter attivo
[✅] USDA_CHAIN_ID = 137
[✅] USDA_CONTRACT_ADDRESS = 0xe714655fD1B3ba96B887DF1F94336c2A78E24001
[✅] Nessuna API key / Bearer token (confermato con team USDA)
[✅] /api/health implementato (health check)
[✅] /api/pay/poll-tx implementato (polling)
[✅] /api/pay/claim/{code} implementato (claim)
[✅] balanceOf ERC-20 via Polygon RPC implementato
[✅] Graceful degradation se backend non disponibile
[✅] usda.payment.update WS event invariato

[ ] VERIFY /api/pay/send — path e corpo richiesta con team USDA
[ ] VERIFY /api/pay/request — path e corpo richiesta con team USDA
[ ] VERIFY /api/pay/pay — path e corpo richiesta con team USDA
[ ] VERIFY /api/pay/refund/{code} — path confermato con team USDA
[ ] VERIFY /api/pay/history — path e query params con team USDA
[ ] VERIFY struttura risposta send/request/pay (field: code? payment_id? status?)
[ ] Test end-to-end invio USDA con backend reale
[ ] Test end-to-end richiesta + claim con backend reale
[ ] Test refund con backend reale
[ ] Test polling → conferma → bubble aggiornata
[ ] Verificare decimali USDA contratto (assunti 6 — USDC-standard)
[ ] Configurare USDA_POLYGON_RPC se RPC pubblico risulta lento/inaffidabile
```

---

## 11. Conferma MockUsdaAdapter

Il `MockUsdaAdapter` è **preservato** e continua a funzionare come ambiente di sviluppo locale.

- Se `USDA_API_BASE_URL` **non è impostato** → MockUsdaAdapter (comportamento invariato)
- Se `USDA_API_BASE_URL` **è impostato** → HttpUsdaAdapter (backend reale)

Il `MockUsdaAdapter` **può essere mantenuto** indefinitamente per:
- Test locali senza connessione al backend USDA
- CI/CD e test automatici
- Sviluppo di nuove funzionalità UI

Può essere **rimosso** in futuro solo quando non si desidera più un ambiente di sviluppo senza il backend USDA. Non è richiesto per la produzione.
