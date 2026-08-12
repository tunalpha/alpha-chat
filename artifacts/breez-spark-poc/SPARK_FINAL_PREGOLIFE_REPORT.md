# Spark / Lightning — Final Pre-Go-Live Validation Report

**Data:** 2026-08-12  
**Fase:** Phase 5 — Final Pre-Go-Live Validation  
**Responsabile:** Team Backend + iOS QA  
**Status:** ⛔ NO-GO — 5 gruppi di test fisici/mainnet PENDING  

> ⚠️ **Regola assoluta:** `spark_lightning_enabled = false` durante tutto questo documento.  
> Nessun go-live, nessun deploy, nessuna attivazione del flag senza approvazione esplicita dell'utente.  
> I test PENDING non sono stati simulati: richiedono iPhone fisico, fondi mainnet, e condizioni operative reali.

---

## 1. PASS — Test completati con successo

### 1.1 Architettura e isolamento

| ID | Item | Metodo | Note |
|----|------|--------|------|
| ARCH-1 | Feature flag `spark_lightning_enabled = false` per default | Code review | Dormant: zero codice Spark eseguito a runtime |
| ARCH-2 | Lazy-load: zero JS/WASM Spark con flag=false | Build analysis | `React.lazy()` + `Suspense` — chunk separato |
| ARCH-3 | Seed BIP39 unico: BTC `m/84'/0'/0'` ≠ Spark `m/8797555'/1'/0'` | Code review | Nessuna collisione, WalletContext BTC invariato |
| ARCH-4 | Mnemonic non persiste fuori dalla memoria sessione | Code review | Letto da `sessionStorage["aw_bio_pin"]` → decrypt → in memoria → usa → scarta |
| ARCH-5 | IDB Spark `spark-wallet-v1` ≠ IDB Alpha Wallet `alpha-wallet-v3-idb` | Automated test (E2) | Namespace separati, nessuna contaminazione |
| ARCH-6 | ChatPage.tsx, Signal, Payment Engine, WalletContext BTC non modificati | Git diff | Zero righe toccate nei file protetti |
| ARCH-7 | `useSparkWalletOptional()` — safe hook, null se provider assente | Automated test | Non lancia mai, null-safe per tutti i consumatori opzionali |

### 1.2 Connect / Sync (§2)

| ID | Item | Test | Esito |
|----|------|------|-------|
| CS-1 | connect() → state=connected | spark-connect-sync A2 | ✅ PASS |
| CS-2 | getInfo() post-connect: nodeId (str) + balanceSat (bigint ≥ 0) | spark-connect-sync A3 | ✅ PASS |
| CS-3 | getInfo() senza connect → lancia | spark-connect-sync A4 | ✅ PASS |
| CS-4 | identityPubkey stabile per stesso storageDir | spark-connect-sync A5 | ✅ PASS |
| CS-5 | syncWallet() → state=connected post-sync | spark-connect-sync B1 | ✅ PASS |
| CS-6 | syncWallet() senza connect → lancia | spark-connect-sync B2 | ✅ PASS |
| CS-7 | balance invariato post-sync (Mock) | spark-connect-sync B4 | ✅ PASS |
| CS-8 | listPayments({}) → array non vuoto, campi obbligatori | spark-connect-sync C2 | ✅ PASS |
| CS-9 | limit rispettato (limit=1 → max 1 item) | spark-connect-sync C3 | ✅ PASS |
| CS-10 | limit=0 → array vuoto | spark-connect-sync C4 | ✅ PASS |
| CS-11 | disconnect() → state=disconnected | spark-connect-sync D1 | ✅ PASS |
| CS-12 | reconnect post-disconnect → stesso identityPubkey | spark-connect-sync D3-D4 | ✅ PASS |
| CS-13 | connect() con isEnabled=false → state=disabled (no-op) | spark-connect-sync E2 | ✅ PASS |

### 1.3 Failure / Retry / Idempotency (§8)

| ID | Item | Test | Esito |
|----|------|------|-------|
| FI-1 | prepareSend failure → nessun pagamento, sendCallCount=0 | spark-failure A2 | ✅ PASS |
| FI-2 | Invoice scaduta (expiresAt < now) rilevabile prima di send | spark-failure A3 | ✅ PASS |
| FI-3 | send() failure → lancia, un solo tentativo (no auto-retry) | spark-failure B1-B3 | ✅ PASS |
| FI-4 | Doppio click: flag isPending blocca secondo invio | spark-failure C2 | ✅ PASS |
| FI-5 | paymentHash = idempotency key Treasury (non timestamp) | spark-failure C3, D2 | ✅ PASS |
| FI-6 | Doppio payment_received → un solo record (Set guard) | spark-failure D3 | ✅ PASS |
| FI-7 | connect() failure → state=error, recoverable | spark-failure E1-E2 | ✅ PASS |
| FI-8 | Recovery da connect failure (disabilita fail → reconnect OK) | spark-failure E3 | ✅ PASS |
| FI-9 | Fee breakdown pura: stesso input → stesso output | spark-failure F1 | ✅ PASS |
| FI-10 | Fee negativa impossibile per qualsiasi input valido | spark-failure F2 | ✅ PASS |
| FI-11 | Overflow impossibile con bigint (max BTC = 21M * 1e8 sat) | spark-failure F3 | ✅ PASS |
| FI-12 | assertFeeBreakdownConsistent lancia su breakdown manipolato | spark-failure F4 | ✅ PASS |

### 1.4 Recovery (§9)

| ID | Item | Test | Esito |
|----|------|------|-------|
| REC-1 | Nuova istanza → state=disconnected (clean start) | spark-recovery A1 | ✅ PASS |
| REC-2 | Refresh browser (nuova istanza) → stesso identityPubkey | spark-recovery A2 | ✅ PASS |
| REC-3 | disconnect() pulisce state, getInfo() post-disconnect → lancia | spark-recovery B1-B2 | ✅ PASS |
| REC-4 | Reconnect post-chiusura → stesso identityPubkey | spark-recovery C1 | ✅ PASS |
| REC-5 | Logout/login (nuova istanza) → same identity da seed | spark-recovery D1-D2 | ✅ PASS |
| REC-6 | Clear IDB Spark ≠ Clear IDB Alpha Wallet (namespace separati) | spark-recovery E2 | ✅ PASS |
| REC-7 | Seed BIP39 unico: BTC `m/84'` + Spark `m/8797555'/1'/0'` | spark-recovery F1-F2 | ✅ PASS |
| REC-8 | Sync post-restart → balance ≥ 0, state=connected | spark-recovery G1-G3 | ✅ PASS |
| REC-9 | Sync BTC on-chain separato da Lightning (IDB distinti) | spark-recovery G4 | ✅ PASS |

### 1.5 Portfolio Integration (§12)

| ID | Item | Test | Esito |
|----|------|------|-------|
| PF-1 | Riga Lightning (⚡, chainId=-1) separata da BTC on-chain (₿, chainId=0) | spark-portfolio A1-A5 | ✅ PASS |
| PF-2 | No double counting: sparkSat + btcSat calcolati separatamente al prezzo BTC | spark-portfolio B1-B5 | ✅ PASS |
| PF-3 | sparkSat=null (Spark offline) → nessuna riga Lightning inventata | spark-portfolio C1 | ✅ PASS |
| PF-4 | sparkSat=null → partialCount++ → warning "⚠️ dati parziali" | spark-portfolio C2 | ✅ PASS |
| PF-5 | sparkSat=0n (connesso ma vuoto) → riga visibile, importo "0.00000000 BTC" | spark-portfolio C3 | ✅ PASS |
| PF-6 | Spark connecting → sparkSat=null (no riga inventata durante caricamento) | spark-portfolio C4 | ✅ PASS |
| PF-7 | Prezzo Lightning = prezzo BTC (parità 1:1, sat) | spark-portfolio D1-D2 | ✅ PASS |
| PF-8 | 100k sat @ $100k/BTC = $100 (conversione corretta) | spark-portfolio D3 | ✅ PASS |
| PF-9 | formatSatoshisToBtc: 50k sat → "0.00050000 BTC" (8 decimali) | spark-portfolio F2 | ✅ PASS |
| PF-10 | calcPortfolioTotal: sparkSat incluso solo quando ≠ null | AlphaWalletPage.tsx code review | ✅ PASS |

### 1.6 Admin Security (§14)

| ID | Item | Test | Esito |
|----|------|------|-------|
| ADM-1 | PATCH `/spark/fee-config` richiede `super_admin` | spark-admin A1-A2 | ✅ PASS |
| ADM-2 | Audit event `SPARK_FEE_UPDATED` ad ogni PATCH | spark-admin A3 | ✅ PASS |
| ADM-3 | Modifica Spark fee NON modifica BTC/EVM/USDA fee (collection separata) | spark-admin B1-B5 | ✅ PASS |
| ADM-4 | `fee_bps`: intero 0-500, test limite -1/0/10/500/501/10.5 | spark-admin C1-C6 | ✅ PASS |
| ADM-5 | `min_fee_sat`: intero ≥ 0, test -1/0/1/1000/0.5 | spark-admin C7-C11 | ✅ PASS |
| ADM-6 | `quote_validity_sec`: intero 5-300, test 0/4/5/30/300/301 | spark-admin C12-C17 | ✅ PASS |
| ADM-7 | sparkBpsToPercent: 10→"0,10%", 500→"5,00%", 0→"0,00%" | spark-admin D1-D5 | ✅ PASS |
| ADM-8 | computeSparkExampleFee: 100k sat @ 10bps → 100 sat | spark-admin E1-E5 | ✅ PASS |
| ADM-9 | Config default (10 bps, 1 sat min, 30s) supera tutte le validazioni | spark-admin F4 | ✅ PASS |

### 1.7 Regressioni (zero)

| Area | Status |
|------|--------|
| Signal E2E (encrypt/decrypt, gruppi, multi-device) | ✅ INVARIATO |
| Payment Engine (Polygon USDT, BTC UTXO, BSC, ETH) | ✅ INVARIATO |
| Alpha Wallet (BTC on-chain, EVM send, history, bridge) | ✅ INVARIATO |
| USDA (getusda.xyz, wagmi, ThirdWeb) | ✅ INVARIATO |
| Chiamate (audio, ICE, WebRTC, call monitor) | ✅ INVARIATO |
| ChatPage.tsx | ✅ NON MODIFICATA |
| WalletContext.tsx BTC | ✅ NON MODIFICATA |
| Admin panel (MultiChain, Call Monitor, Fee, Spark Fee) | ✅ INVARIATO |

**Suite complessiva: 993 / 993 test PASS · Build SUCCESS · TypeScript clean (Spark)**

---

## 2. FAIL — Nessun fallimento

Nessun test automatico ha prodotto esito FAIL.  
I 993 test sono tutti GREEN.

---

## 3. PENDING — Test non eseguibili senza dispositivo/fondi reali

> **Regola rispettata:** nessun risultato simulato. Tutti gli item seguenti richiedono condizioni operative reali non disponibili nell'ambiente di sviluppo automatizzato.

### 3.1 Test iPhone fisico (Priorità 1)

**Requisiti non soddisfatti:** iPhone fisico (iPhone 12+, iOS 16+), Alpha Chat installato come PWA, account con Alpha Wallet sbloccato, saldo Spark > 0, `spark_lightning_enabled = true` solo durante il test fisico.

| ID | Test | Motivo PENDING |
|----|------|----------------|
| IOS-A1 | Apertura Alpha Chat dopo cold start → SparkWalletProvider carica senza crash | Nessun iPhone fisico disponibile |
| IOS-A2 | Sblocco Alpha Wallet (PIN) → Spark si connette entro 30s (`connecting → connected`) | Nessun iPhone fisico disponibile |
| IOS-A3 | `crossOriginIsolated = true` visibile in Safari DevTools (COOP/COEP attivi) | Nessun iPhone fisico disponibile |
| IOS-A4 | WASM Breez caricato senza errori "SharedArrayBuffer" in console | Nessun iPhone fisico disponibile |
| IOS-A5 | `getInfo()` restituisce nodeId e balance corretto visibile in UI | Nessun iPhone fisico disponibile |
| IOS-B1 | Generare invoice Spark (amount=1000 sat) → BOLT11 generato | Nessun iPhone fisico disponibile |
| IOS-B2 | Pagare invoice da wallet LN esterno → payment received entro 60s | Nessun iPhone fisico + nessun fondo mainnet |
| IOS-B3 | Balance aggiornato in UI dopo ricezione (incremento corretto) | Nessun iPhone fisico disponibile |
| IOS-B4 | Fee Alpha Platform registrata: record `source=spark_lightning` in DB | Nessun iPhone fisico + nessun fondo mainnet |
| IOS-C1 | Incollare invoice BOLT11 → quote mostrata (recipient, alpha fee, provider fee) | Nessun iPhone fisico disponibile |
| IOS-C2 | Confermare pagamento → `sending → sent` entro 30s | Nessun iPhone fisico + nessun fondo mainnet |
| IOS-C3 | Balance decrementato: totalDebitSat = recipient + alpha + provider | Nessun iPhone fisico + nessun fondo mainnet |
| IOS-C4 | Fee breakdown visibile in UI: 3 righe separate | Nessun iPhone fisico disponibile |
| IOS-C5 | Pagamento verso self (stesso nodo) → errore graceful, no crash | Nessun iPhone fisico disponibile |
| IOS-D1 | Minimizzare app → 60s → riaprire → Spark si riconnette (visibilitychange) | Nessun iPhone fisico disponibile |
| IOS-D2 | Bloccare iPhone → sbloccare → Spark riprende (IDB locale preservato) | Nessun iPhone fisico disponibile |
| IOS-D3 | Alpha Wallet si blocca → Spark si disconnette (no leak) | Nessun iPhone fisico disponibile |
| IOS-D4 | Sblocco Alpha Wallet → Spark si riconnette (getMnemonic callback) | Nessun iPhone fisico disponibile |
| IOS-E1 | Kill app → riaprire → Spark reinizializza da IDB locale | Nessun iPhone fisico disponibile |
| IOS-E2 | Rotazione schermo durante pagamento → no crash, no doppio pagamento | Nessun iPhone fisico disponibile |
| IOS-E3 | Perdita Wi-Fi durante send → errore graceful, payment non perso | Nessun iPhone fisico disponibile |
| IOS-E4 | IDB Spark separato da IDB Alpha Wallet (verificato in Safari Storage Inspector) | Nessun iPhone fisico disponibile |
| IOS-F1 | Invio BTC on-chain dopo send LN → path BTC non influenzato | Nessun iPhone fisico + nessun fondo |
| IOS-F2 | Balance BTC invariato dopo pagamento LN | Nessun iPhone fisico + nessun fondo |
| IOS-F3 | Mnemonic BTC derivation invariata pre/post Spark: stesso indirizzo BTC | Nessun iPhone fisico disponibile |
| IOS-G1 | Admin panel → Spark fee → `fee_bps=10` caricato correttamente | Nessun iPhone fisico disponibile |
| IOS-G2 | Modificare `fee_bps=15` → PATCH 200, audit log presente | Nessun iPhone fisico disponibile |
| IOS-G3 | Prossimo pagamento usa 0.15% (nuovo bps applicato) | Nessun iPhone fisico + nessun fondo |

### 3.2 Test mainnet reale controllato (Priorità 2)

**Requisiti non soddisfatti:** canale Lightning mainnet con liquidità, fondi reali (≤ 10.000 sat per test), nodo Breez SDK mainnet attivo, `VITE_BREEZ_API_KEY` mainnet funzionante in contesto browser reale.

| ID | Test | Motivo PENDING |
|----|------|----------------|
| MN-1 | BOLT11 receive: generare invoice → pagare da nodo esterno → ricevuto correttamente | Nessun fondo mainnet / nessun browser reale |
| MN-2 | BOLT11 send: prepareSend → fee breakdown corretto → send → completed | Nessun fondo mainnet / nessun browser reale |
| MN-3 | Fee Breez effettiva: `estimatedProviderFeeSat` corrisponde a fee reale pagata | Nessun fondo mainnet |
| MN-4 | Alpha platform fee 0.10%: `alphaPlatformFeeSat = ceil(amountSat * 10 / 10_000)` | Nessun fondo mainnet |
| MN-5 | Recipient-exact: `totalDebitSat` include alpha fee + provider fee + amount | Nessun fondo mainnet |
| MN-6 | Treasury: record `source=spark_lightning`, `network=lightning`, `_id=spark_{hash}` scritto | Nessun fondo mainnet |
| MN-7 | Idempotenza mainnet: secondo send con stesso paymentHash → upsert, non duplicato | Nessun fondo mainnet |
| MN-8 | Storico listPayments() dopo send/receive mostra i pagamenti reali | Nessun fondo mainnet |
| MN-9 | Riconciliazione: `getInfo().balanceSat` post-send = balancePre - totalDebitSat | Nessun fondo mainnet |
| MN-10 | Nessun doppio pagamento su rete Lightning reale (HTLC non ripetuto) | Nessun fondo mainnet |

---

## 4. Rischi residui

### 4.1 Tecnici — già documentati e accettati

| Rischio | Severità | Mitigazione | Stato |
|---------|----------|-------------|-------|
| IDB Spark non cifrata (preimage HTLC leggibili) | Medio | Documentato in `SPARK_IDB_SECURITY_REPORT.md`. Stessa protezione del device OS. IDB Alpha Wallet (seed) cifrata AES-256-GCM e invariata. | **ACCEPTED** |
| Mnemonic derivato in memoria durante `connect()` | Basso | Durata in memoria: millisecondi. Non scritto su disco, non serializzato, non loggato. `sessionStorage["aw_bio_pin"]` è la sola persistenza. | **ACCEPTED** |
| Breez SDK WASM non supportato su vecchi browser | Basso | Requisito minimo documentato: iOS 16+, Safari 16+, Chrome 91+. Graceful failure: Spark offline → portfolio mostra "dati parziali". | **ACCEPTED** |
| Canale Lightning non disponibile all'avvio | Basso | LSP Breez gestisce apertura canale automaticamente. Fallback: balance=0, no crash. | **ACCEPTED** |

### 4.2 Operativi — PENDING su esito test fisici

| Rischio | Severità | Mitigazione disponibile | Dipendenza |
|---------|----------|------------------------|-----------|
| Tempi di connect > 30s su iOS con connessione lenta | Alto | Retry UI con stato "connecting…" già implementato. Timeout non ancora validato su rete reale. | Test IOS-A2 |
| Background PWA iOS: Spark non mantiene WS aperto | Alto | visibilitychange handler implementato. Comportamento iOS con PWA background non validato. | Test IOS-D1-D4 |
| Send fallisce post-background (invoice scaduta) | Medio | expiresAt check implementato. Comportamento reale non validato. | Test IOS-D1 + MN-2 |
| Fee effettiva Breez diversa da `estimatedProviderFeeSat` | Basso | Le quote Breez SDK sono stime. In produzione verificare allineamento. | Test MN-3 |

### 4.3 Rischi post-go-live (da gestire in Admin Monitoring Spark)

Quando il flag verrà attivato:
- **Volume**: monitorare numero pagamenti/giorno per dimensionare il supporto
- **Treasury**: riconciliazione `alpha_wallet_fee_records` `source=spark_lightning` vs `listPayments()` del SDK
- **Health**: endpoint di health per stato nodo Breez (canali, liquidità, LSP)
- **Kill switch**: `spark_lightning_enabled=false` rimane il meccanismo di spegnimento di emergenza — verificare che il frontend risponda entro 1 ciclo di polling (max 60s)

---

## 5. Modifiche necessarie prima del go-live

### 5.1 Obbligatorie (bloccanti)

| Modifica | Dove | Motivo |
|----------|------|--------|
| Completare test IOS-A1..G3 su iPhone fisico | QA fisico | Senza questo, comportamento iOS non validato |
| Completare test MN-1..MN-10 su mainnet reale | Test controllato | Senza questo, fee accounting e HTLC reali non validati |
| Impostare `spark_lightning_enabled=true` SOLO per il periodo di test fisico, poi rimettere `false` fino al go-live | Admin panel | Procedura obbligatoria per test fisici |

### 5.2 Consigliate (non bloccanti)

| Modifica | Dove | Motivo |
|----------|------|--------|
| Admin Monitoring Spark (post-go-live sprint) | Admin panel | Visibilità su volume, fee, Treasury, health nodo |
| Push notification su ricezione Lightning | api-server / iOS PWA | UX: l'utente riceve notifica anche da background |
| Webhook Breez SDK → backend (event-driven vs polling) | api-server | Alternativa più affidabile al sync periodico |
| Timeout connect configurabile da admin | spark-fee-config | Permette di ottimizzare SLA per diversi tipi di rete |

### 5.3 Non necessarie (già complete)

- ~~Architettura seed derivation~~ ✅
- ~~Keystore wiring (getMnemonic)~~ ✅
- ~~Fee engine (calculateSparkFeeBreakdown)~~ ✅
- ~~Treasury accounting (recordSparkFee, idempotency)~~ ✅
- ~~Admin UI (spark-lightning-fee.tsx)~~ ✅
- ~~Portfolio integration (AlphaWalletPage.tsx)~~ ✅
- ~~Isolamento BTC / Signal / Payment Engine~~ ✅
- ~~IDB Security Report~~ ✅

---

## 6. Decisione GO / NO-GO

### ⛔ NO-GO — in attesa di test fisici

**Motivazione:** Le 37 validazioni PENDING (IOS-A1..G3 + MN-1..MN-10) non sono sostituibili da simulazioni software. Rappresentano gli unici test capaci di rilevare:

1. Comportamento reale di WebAssembly Breez SDK su iOS Safari PWA
2. Tempi di connect/sync su rete reale (potenzialmente > 30s)
3. Gestione background/foreground iOS (limitazioni PWA Apple non simulabili)
4. Routing HTLC reale su rete Lightning mainnet
5. Fee effettiva Breez vs stima (`estimatedProviderFeeSat`)
6. Registrazione Treasury con pagamento reale (non mock)

**La parte software è in ottimo stato.** I 993 test automatici confermano che tutta la logica implementabile senza dispositivo fisico funziona correttamente. Il codice è pronto per il test fisico.

### Condizioni per sbloccare GO

1. ✅ Completare **tutti** i test IOS-A1..F3 su iPhone fisico (richiede `spark_lightning_enabled=true` solo durante il test, poi rimettere `false`)
2. ✅ Completare **tutti** i test MN-1..MN-10 con fondi reali ≤ 10.000 sat
3. ✅ Zero FAIL nei test fisici
4. ✅ Approvazione esplicita dell'utente
5. ✅ `spark_lightning_enabled=true` impostato dall'admin panel **solo dopo** l'approvazione

---

## Appendice — File prodotti nelle Phase 3-5

| File | Percorso | Scopo |
|------|----------|-------|
| Architecture Design | `breez-spark-poc/SPARK_ARCHITECTURE_DESIGN.md` | 21 sezioni, seed derivation, architettura completa |
| IDB Security Report | `breez-spark-poc/SPARK_IDB_SECURITY_REPORT.md` | Analisi rischi IDB, decisione ACCEPT+DOCUMENT |
| iOS Test Checklist | `breez-spark-poc/SPARK_IOS_TEST_CHECKLIST.md` | 27 test fisici da eseguire su iPhone |
| Send/Receive Test Plan | `breez-spark-poc/SPARK_SEND_RECEIVE_TEST_PLAN.md` | Test plan mainnet controllato |
| Phase 5 Validation Report | `breez-spark-poc/SPARK_PHASE5_VALIDATION_REPORT.md` | Report automatico 23-item |
| **Final Pre-Go-Live Report** | `breez-spark-poc/SPARK_FINAL_PREGOLIFE_REPORT.md` | **Questo documento** |

---

*Generato in Phase 5 Final — 2026-08-12 · spark_lightning_enabled = false*
