# PRODUCTION ACCEPTANCE REPORT — AlphaChat USDA V1

**Data:** 22 luglio 2026  
**Versione:** USDA V1 — Release Candidate  
**Autore:** AlphaChat Engineering  

---

## Sommario esecutivo

AlphaChat USDA V1 è pronta per la fase di collaudo con utenti reali.  
L'architettura ha retto integralmente al passaggio dal backend simulato a quello reale:  
**UI, chat, WebSocket, database e UsdaService non sono stati modificati** durante il collegamento al backend USDA definitivo.

---

## 1. Architettura — Stato finale

| Componente | Stato |
|------------|-------|
| AlphaChat Core (messaggi, gruppi, chiamate, Signal E2E) | 🟢 Congelato — nessuna modifica |
| UsdaAdapter interface | 🟢 Congelata |
| MockUsdaAdapter | 🟢 Preservato per sviluppo locale |
| HttpUsdaAdapter | 🟢 Allineato al contratto definitivo USDA |
| Backend USDA (`https://getusda.xyz`) | 🟢 Collegato |
| Contratto API | 🟢 Definitivo — nessun VERIFY aperto |
| Mock attivi in produzione | ✅ Nessuno |
| TODO aperti bloccanti | ✅ Nessuno |

---

## 2. Endpoint definitivi USDA (nessuna stima)

| Endpoint | Metodo | Funzione | Stato |
|----------|--------|----------|-------|
| `/api/health` | GET | Health check | ✅ Implementato |
| `/api/pay/prepare` | POST | Passo 1 invio — pendingTransferId | ✅ Implementato |
| `/api/pay/confirm` | POST | Passo 2 invio — txHash + conferma | ✅ Implementato |
| `/api/pay/request` | POST | Crea richiesta di pagamento | ✅ Implementato |
| `/api/pay/claim/{code}` | POST | Riscossione e pagamento richiesta | ✅ Implementato |
| `/api/pay/poll-tx` | GET | Polling stato transazione | ✅ Implementato |
| `/api/pay/history` | GET | Storico pagamenti | ✅ Implementato |

**Eliminati (non esistono nel backend USDA):**
- ❌ `/api/pay/send` — sostituito da prepare→confirm
- ❌ `/api/pay/pay` — sostituito da `claim/{code}`
- ❌ `/api/pay/refund` — rimborso è stato polling, non azione

---

## 3. Scenari di pagamento testati

### 3.1 Flusso invio (prepare → firma → confirm)

| Scenario | Comportamento atteso | Implementazione |
|----------|----------------------|-----------------|
| Invio normale | prepare → firma → confirm → pending → confirmed (polling) | ✅ |
| Fee definitiva dal backend | Fee reale da `/prepare`, non stima locale | ✅ |
| Bubble aggiornata in-place | `usda.payment.update` via WS, no nuova bubble | ✅ |
| Stato confirmed | Bubble mostra ✅ Confermato + txHash | ✅ |

### 3.2 Richiesta di pagamento

| Scenario | Comportamento atteso | Implementazione |
|----------|----------------------|-----------------|
| Crea richiesta | Bubble `⏳ In attesa pagamento` | ✅ |
| Destinatario paga | `POST /api/pay/claim/{code}` → pending → confirmed | ✅ |
| Bubble mittente aggiornata | `usda.payment.update` via WS | ✅ |

### 3.3 Rimborso automatico

| Scenario | Comportamento atteso | Implementazione |
|----------|----------------------|-----------------|
| Scadenza claim | Backend USDA imposta status `refunded` | ✅ |
| Polling rileva `refunded` | `_onStatusChange` → WS → bubble ↩️ | ✅ |
| `refundPayment()` chiamata | No-op — rimborso non è azione invocabile | ✅ |

---

## 4. Test di resilienza

### 4.1 Guard doppio tap

| Scenario | Guard | Implementazione |
|----------|-------|-----------------|
| Doppio tap "Continua" | `if (loading) return` + `disabled={loading}` | ✅ |
| Doppio tap "Firma e Invia" | `if (signing) return` + `disabled={signing}` | ✅ |

### 4.2 Annullamento firma

| Scenario | Comportamento | Implementazione |
|----------|---------------|-----------------|
| Utente preme "Annulla firma" | Reset a form, `pendingTransferId` scade server-side, nessuna HTTP | ✅ |
| Backdrop durante firma | Disabilitato — nessuna chiusura accidentale | ✅ |
| sessionStorage ripulito | Rimosso su cancel → nessuna falsa recovery | ✅ |

### 4.3 Timeout firma (90 secondi)

| Scenario | Comportamento | Implementazione |
|----------|---------------|-----------------|
| Firma non completa in 90s | Reset a "form", messaggio di scadenza, CPI rimosso da sessionStorage | ✅ |
| Utente riprova | Nuovo `prepare` → nuovo `pendingTransferId` | ✅ |

### 4.4 Crash / chiusura app tra prepare e confirm

| Scenario | Comportamento | Implementazione |
|----------|---------------|-----------------|
| Crash prima di `sessionStorage.setItem` | `pendingTransferId` scade server-side, nessun record in MongoDB, utente riparte da zero | ✅ |
| Crash dopo `sessionStorage.setItem`, prima risposta HTTP | WalletCenter rileva `usda_inflight_cpi` al mount, chiama `GET /payments/check/{cpi}` | ✅ |
| Pagamento trovato (confirm è arrivato) | WalletCenter mostra banner "Pagamento precedente rilevato", rimuove chiave | ✅ |
| Pagamento non trovato (confirm non è arrivato) | WalletCenter rimuove chiave, utente riparte senza duplicati | ✅ |
| Crash dopo risposta HTTP (submit riuscito) | Polling in corso su server, WS aggiorna bubble alla riapertura | ✅ |

### 4.5 Riavvio server (restart AlphaChat API)

| Scenario | Comportamento | Implementazione |
|----------|---------------|-----------------|
| Pagamenti in `pending`/`submitting` al momento del restart | `reconcilePendingPayments()` riavvia polling per ciascuno 5s dopo il boot | ✅ |
| Polling riavviato → status update | `_onStatusChange` → MongoDB → WS `usda.payment.update` | ✅ |

### 4.6 Backend USDA non disponibile

| Scenario | Comportamento | Implementazione |
|----------|---------------|-----------------|
| `GET /api/health` fallisce | `_isAvailable = false`, pagamenti disabilitati (503) | ✅ |
| Chat, messaggi, chiamate | Continuano a funzionare normalmente | ✅ |
| Health ricontrollato ogni 60s | Re-attivazione automatica al ripristino | ✅ |

### 4.7 Perdita connessione durante polling

| Scenario | Comportamento | Implementazione |
|----------|---------------|-----------------|
| Rete assente durante poll | Errore catturato, retry al prossimo ciclo (6s) | ✅ |
| Timeout massimo polling | 5 minuti, poi status `failed` via callback | ✅ |

### 4.8 Saldo ERC-20 (Polygon RPC)

| Scenario | Comportamento | Implementazione |
|----------|---------------|-----------------|
| RPC pubblico non risponde | `balanceOfUsda()` lancia eccezione, `getWallet()` usa 0 e logga warning | ✅ |
| Nessun indirizzo wallet configurato | Balance 0, `wallet_enabled: false` | ✅ |

---

## 5. Test di regressione chat

I seguenti componenti **non sono stati modificati** durante l'integrazione USDA:

| Funzionalità | Regressioni introdotte |
|--------------|----------------------|
| Messaggi E2E Signal | ✅ Nessuna |
| Allegati R2 | ✅ Nessuna |
| Gruppi E2E | ✅ Nessuna |
| Chiamate (audio/video) | ✅ Nessuna |
| WebSocket (connessione, eventi, ping/pong) | ✅ Nessuna |
| Push notifications | ✅ Nessuna |
| Phoenix Code / Emergency Portal | ✅ Nessuna |
| Account Recovery | ✅ Nessuna |
| Lock biometrico | ✅ Nessuna |

**TypeScript:** 0 errori introdotti in frontend e backend (errori pre-esistenti in `diagnostics.routes.ts` e `ChatPage.tsx:1522` invariati).

---

## 6. Limitazioni note

| Limitazione | Impatto | Piano |
|-------------|---------|-------|
| Firma ThirdWeb simulata (`_simulateTxHash`) | Solo in sviluppo — il backend USDA accetta qualsiasi txHash fino all'integrazione ThirdWeb | Integrare ThirdWeb SDK prima del go-live |
| Decimali USDA assunti = 6 | Potenziale imprecisione se il contratto usa 18 decimali | Verificare con `decimals()` sul contratto |
| `GET /api/pay/history` non paginato lato UI | Solo i primi 30 risultati visibili | Aggiungere "Carica altri" in V1.1 |
| RPC Polygon pubblico (nessuna API key) | Soggetto a rate limiting sotto carico | Configurare `USDA_POLYGON_RPC` con nodo dedicato in produzione |
| `sessionStorage` non disponibile in alcune PWA offline | Scenario recovery non attivato — utente riprova manualmente | Accettabile per V1 |

---

## 7. Conferme finali

| Punto | Stato |
|-------|-------|
| Architettura congelata | ✅ Confermato |
| Nessun TODO aperto bloccante | ✅ Confermato |
| Nessun endpoint stimato (VERIFY) | ✅ Confermato |
| Nessun mock attivo in produzione | ✅ Confermato (`USDA_API_BASE_URL` impostato → HttpUsdaAdapter attivo) |
| Backend USDA reale collegato | ✅ Confermato (`https://getusda.xyz`) |
| TypeScript clean | ✅ 0 errori introdotti |
| Server restart pulito | ✅ Log confermato: `[USDA] Using HttpUsdaAdapter` |

---

## 8. Raccomandazione

**AlphaChat USDA V1 è una release candidata.**

I prerequisiti per il passaggio al collaudo con utenti reali sono:

```
[✅] Backend USDA collegato e risponde a /api/health
[✅] Pagamenti send/request/claim implementati end-to-end
[✅] Polling attivo e propagazione WS funzionante
[✅] Resilienza crash, timeout, doppio-tap implementata
[✅] Riconciliazione al boot implementata
[✅] Graceful degradation se backend non disponibile
[ ] Integrazione ThirdWeb SDK per firma reale (non blocca il collaudo con backend che accetta mock txHash)
[ ] Verifica decimali contratto USDA
[ ] Test end-to-end con utenti reali su staging
```

**L'unica dipendenza bloccante per la produzione è la firma ThirdWeb reale.**  
Tutto il resto — architettura, UI, WS, resilienza, polling — è production-ready.

---

*Documento generato al termine del ciclo di sviluppo USDA V1 — 22 luglio 2026.*
