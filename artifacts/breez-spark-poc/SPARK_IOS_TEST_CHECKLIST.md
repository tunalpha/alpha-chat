# Spark / Lightning — iOS E2E Test Checklist
*Phase 4 · Da eseguire su iPhone fisico prima del go-live*

> ⚠️ Questo checklist richiede un iPhone fisico (iPhone 12+, iOS 16+).  
> **NON** può essere completato in simulatore.  
> spark_lightning_enabled deve essere true per eseguire i test reali.

---

## Prerequisiti

- [ ] iPhone fisico con iOS 16.0+
- [ ] Alpha Chat installato come PWA (Add to Home Screen)
- [ ] Account Alpha Chat con Alpha Wallet creato e sbloccato
- [ ] `spark_lightning_enabled = true` nel pannello admin (solo per test)
- [ ] Saldo Spark > 0 (ricevuto da nodo LN esterno)
- [ ] Connessione Lightning con saldo canale sufficiente

---

## A. Inizializzazione e connessione

| # | Test | Atteso | Esito |
|---|---|---|---|
| A1 | Aprire Alpha Chat su iPhone dopo cold start | SparkWalletProvider carica lazy (no crash) | ⬜ |
| A2 | Sbloccare Alpha Wallet (PIN) → Spark si connette | `connecting → connected` entro 30s | ⬜ |
| A3 | `crossOriginIsolated` visibile in DevTools Safari | `true` (COOP/COEP attivi) | ⬜ |
| A4 | WASM Breez caricato | Nessun errore console "SharedArrayBuffer" | ⬜ |
| A5 | getInfo() restituisce nodeId e balance | UI mostra balance corretto | ⬜ |

---

## B. Ricezione pagamento

| # | Test | Atteso | Esito |
|---|---|---|---|
| B1 | Generare invoice Spark (amount=1000 sat) | Invoice BOLT11 generata | ⬜ |
| B2 | Pagare invoice da wallet LN esterno | Payment received entro 60s | ⬜ |
| B3 | Balance aggiornato in UI | Incremento corretto | ⬜ |
| B4 | Fee Alpha Platform registrata nel ledger | record `source=spark_lightning` in DB | ⬜ |

---

## C. Invio pagamento

| # | Test | Atteso | Esito |
|---|---|---|---|
| C1 | Incollare invoice BOLT11 valida | Quote mostrata: recipient, alpha fee, provider fee | ⬜ |
| C2 | Confermare pagamento | `sending → sent` entro 30s | ⬜ |
| C3 | Balance decrementato correttamente | totalDebitSat = recipient + alpha + provider | ⬜ |
| C4 | Fee breakdown visibile: 3 righe separate | Alpha fee ≠ Provider fee ≠ Amount | ⬜ |
| C5 | Pagamento verso self (stesso nodo) | Errore graceful (non crash) | ⬜ |

---

## D. Modalità background / lock screen

| # | Test | Atteso | Esito |
|---|---|---|---|
| D1 | Minimizzare app → aspettare 60s → riaprire | Spark si riconnette (visibilitychange handler) | ⬜ |
| D2 | Bloccare iPhone → sbloccare → aprire app | Stato Spark preservato (sessione IDB) | ⬜ |
| D3 | Alpha Wallet si blocca → Spark si disconnette | state → disconnected (no leak) | ⬜ |
| D4 | Sbloccare Alpha Wallet → Spark si riconnette | Richiede PIN (getMnemonic callback) | ⬜ |

---

## E. Edge case iOS PWA

| # | Test | Atteso | Esito |
|---|---|---|---|
| E1 | Killare l'app completamente → riaprire | Spark inizializza da zero, IDB locale preservato | ⬜ |
| E2 | Rotazione schermo durante pagamento | Nessun crash, transazione non doppia | ⬜ |
| E3 | Perdita connessione Wi-Fi durante send | Errore graceful, payment non perso | ⬜ |
| E4 | IDB Spark separato da IDB Alpha Wallet | Verificare in Safari Storage Inspector | ⬜ |

---

## F. Isolamento BTC

| # | Test | Atteso | Esito |
|---|---|---|---|
| F1 | Inviare BTC on-chain dopo send LN | BTC path non influenzato | ⬜ |
| F2 | Balance BTC invariato dopo pagamento LN | BTC address e saldo BTC = prima del test | ⬜ |
| F3 | Mnemonic BTC derivation non cambiata | Stesso indirizzo BTC pre/post Spark | ⬜ |

---

## G. Admin fee verification

| # | Test | Atteso | Esito |
|---|---|---|---|
| G1 | Admin panel → Spark / Lightning Fee → fee_bps=10 | Configurazione caricata correttamente | ⬜ |
| G2 | Modificare fee_bps a 15 → confermare | PATCH /spark/fee-config → 200, audit log | ⬜ |
| G3 | Verificare che la fee Alpha prossimo pagamento sia 0.15% | Quote calcolata con nuovo bps | ⬜ |

---

## Note per il tester

- Ogni test dovrebbe essere eseguito su un profilo pulito (Clear Storage in Safari)
- Se un test fallisce: annotare iOS version, Safari version, network type (Wi-Fi/5G)
- Preimage HTLC presenti in IDB (Storage Inspector) → normale, documentato in `SPARK_IDB_SECURITY_REPORT.md`
- Non eseguire test C1-C4 con importi > 10.000 sat senza approvazione

---

*Responsabile checklist: Team Backend + iOS QA*  
*Data prevista: prima del go-live (spark_lightning_enabled=true in produzione)*
