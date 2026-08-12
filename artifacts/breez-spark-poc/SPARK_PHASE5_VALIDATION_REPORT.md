# Spark Phase 5 — Pre-Go-Live Validation Report

**Data:** 2026-08-12  
**Versione:** Phase 5 Final  
**Status globale:** ⚠️ CONDITIONALLY READY — 18/23 item PASS, 5 PENDING (iPhone reale)  
**Decisione go-live:** ❌ NON ANCORA — richede conferma esplicita utente

---

## Sommario esecutivo

Phase 5 completa l'infrastruttura di validazione pre-go-live della funzionalità Spark/Lightning. Tutti i test automatici passano (993/993). La feature rimane bloccata da `spark_lightning_enabled = false` e può essere attivata solo con conferma esplicita dell'utente. Le 5 validazioni PENDING richiedono un dispositivo iPhone fisico con saldo reale mainnet.

---

## §1 — Prerequisiti architetturali

| Item | Status | Note |
|------|--------|------|
| Feature flag `spark_lightning_enabled = false` | ✅ PASS | Dormant per default |
| Lazy-load: zero Spark JS/WASM con flag=false | ✅ PASS | `React.lazy()` + `Suspense` |
| `crossOriginIsolated = true` in dev (COOP/COEP) | ✅ PASS | PoC verificato Phase 1 |
| SharedArrayBuffer disponibile | ✅ PASS | Breez SDK WASM dipende da questo |
| Namespace IDB separato (`spark-wallet-v1`) | ✅ PASS | Non sovrapposto ad Alpha Wallet |

---

## §2 — Connect/Sync

| Item | Status | Note |
|------|--------|------|
| connect() → state=connected | ✅ PASS | 7 test automatici (Group A+B) |
| syncWallet() → state=connected post-sync | ✅ PASS | Test B1-B4 |
| disconnect() + reconnect → stessa identità | ✅ PASS | Test D1-D4 |
| identityPubkey stabile per stesso storageDir | ✅ PASS | Test A5, D2, G2 |
| Tempi connect < 30s (SLA target produzione) | ⏳ PENDING | Testato con Mock (< 1s) — richiede iPhone reale |
| Mainnet node raggiungibile (VITE_BREEZ_API_KEY) | ⏳ PENDING | Richiede iPhone reale |

---

## §8 — Failure / Retry / Idempotency

| Item | Status | Note |
|------|--------|------|
| prepareSend failure → nessun pagamento | ✅ PASS | Test B1-B3 spark-failure-idempotency |
| Invoice scaduta (expiresAt < now) rilevabile | ✅ PASS | Test A3 |
| send() failure → un solo tentativo | ✅ PASS | sendCallCount=1, test B1 |
| Doppio click → un solo pagamento (flag isPending) | ✅ PASS | Test C2 |
| paymentHash unico = idempotency key Treasury | ✅ PASS | Test C3, D2 |
| Doppio payment_received → un solo record | ✅ PASS | Test D3 |
| connect() failure → state=error, recoverable | ✅ PASS | Test E1-E3 |
| Fee breakdown pura (stesso input → stesso output) | ✅ PASS | Test F1 |
| Overflow impossibile con bigint | ✅ PASS | Test F3 (21M BTC in sat) |
| assertFeeBreakdownConsistent lancia su tampered | ✅ PASS | Test F4 |

---

## §9 — Recovery

| Item | Status | Note |
|------|--------|------|
| Refresh browser → nuova istanza → stesso identityPubkey | ✅ PASS | Test A2, G2 |
| Disconnect pulisce state (no stale data) | ✅ PASS | Test B1-B3 |
| Reconnect dopo chiusura app → stesso identityPubkey | ✅ PASS | Test C1 |
| Logout/login → same identity da seed | ✅ PASS | Test D1-D2 |
| Clear IDB Spark NON cancella IDB Alpha Wallet | ✅ PASS | Test E2 (namespace check) |
| IDB Spark = `spark-wallet-v1` (non `alpha-wallet-v3-idb`) | ✅ PASS | Test E2 |
| Seed BIP39 unico (BTC m/84' + Spark m/8797555'/1'/0') | ✅ PASS | Test F1-F2 |
| Sync post-restart → balance ≥ 0 | ✅ PASS | Test G1-G4 |
| Sync BTC on-chain separato da Lightning | ✅ PASS | Test G4 |
| Recovery su dispositivo iPhone reale | ⏳ PENDING | Richiede test fisico |

---

## §10 — IDB Security Decision

**Decisione: ACCEPT + DOCUMENT**

| Aspetto | Decisione | Rationale |
|---------|-----------|-----------|
| IDB Breez SDK non cifrata | ✅ ACCEPT | Nessuna API ufficiale per storage custom. Contenuto: state channels, HTLC IDs, timestamps — non secret keys |
| Mnemonic/seed in IDB Spark | N/A | Il mnemonic NON è scritto in IDB da Spark SDK (solo derivato in memoria per connect) |
| preimage HTLC leggibili in IDB | ✅ MITIGATE | Documentato in `SPARK_IDB_SECURITY_REPORT.md` (Phase 4). Risk tolerable: stessa protezione del device OS |
| IDB Alpha Wallet cifrata (AES-256-GCM) | ✅ INVARIATA | Il seed BTC rimane protetto — Spark non tocca questo namespace |
| iOS Secure Enclave protegge il device | ✅ ACCEPTED | Face ID / PIN lock proteggono l'accesso fisico |

**Mitigazioni implementate:**
1. Namespace IDB separato — nessuna contaminazione Alpha Wallet ↔ Spark
2. `SPARK_IDB_SECURITY_REPORT.md` con risk assessment completo (Phase 4)
3. Mnemonic decrittato in memoria solo per `connect()`, poi eliminato
4. Feature flag blocca il codice IDB Spark quando `spark_lightning_enabled = false`

---

## §12 — Portfolio Spark Integration

| Item | Status | Note |
|------|--------|------|
| Riga Lightning nel portfolio (icona ⚡, network "Lightning") | ✅ PASS | AlphaWalletPage.tsx Phase 5 |
| BTC on-chain (₿, chainId=0) separato da Lightning (⚡, chainId=-1) | ✅ PASS | Test A1-A5 spark-portfolio |
| Nessun double counting BTC + Lightning | ✅ PASS | Test B1-B5, formula separata |
| Spark offline → sparkSat=null → no riga inventata | ✅ PASS | Test C1-C5 |
| Spark offline → warning "dati parziali" | ✅ PASS | partialCount += 1 |
| Spark connesso ma vuoto (0n) → riga visibile importo zero | ✅ PASS | Test C3 |
| Prezzo Lightning = prezzo BTC (parità 1:1) | ✅ PASS | Test D1-D2 |
| Total portfolio include Lightning solo se connesso | ✅ PASS | `calcPortfolioTotal(..., sparkSat)` |
| `useSparkWalletOptional()` → null-safe quando flag=false | ✅ PASS | Nuovo export SparkWalletContext |
| Formato satoshi → BTC (8 decimali) corretto | ✅ PASS | Test F1-F5 (formatSatoshisToBtc) |

---

## §13 — History Lightning

| Item | Status | Note |
|------|--------|------|
| `SparkPaymentType` definita in spark-types.ts | ✅ PASS | `btc_lightning_sent / received`, `spark_sent / received` |
| listPayments() restituisce ogni payment con campi obbligatori | ✅ PASS | Test C1-C5 spark-connect-sync |
| limit rispettato | ✅ PASS | Test C3-C4 |
| History separata da WalletTxRecord (nessuna mescolanza) | ✅ PASS | Architettura: Spark listPayments() ≠ IDB tx-store |
| Display history Lightning su iPhone reale | ⏳ PENDING | Richiede iPhone reale |

---

## §14 — Admin Security

| Item | Status | Note |
|------|--------|------|
| PATCH `/spark/fee-config` richiede `super_admin` | ✅ PASS | `requireAdmin("super_admin")` in spark.routes.ts |
| GET `/spark/fee-config` accessibile a read_only | ✅ PASS | Middleware auth standard |
| Audit event `SPARK_FEE_UPDATED` ad ogni PATCH | ✅ PASS | spark-fee.controller.ts Phase 4 |
| Modifica Spark fee NON modifica BTC/EVM/USDA fee | ✅ PASS | Test B1-B5 spark-admin-security |
| Collection MongoDB separata (`spark_fee_configs`) | ✅ PASS | Test B2 |
| Idempotency key separata (`spark-fee` ≠ `alpha-fee`) | ✅ PASS | Test B3 |
| Validazione fee_bps 0-500 (intero) | ✅ PASS | Test C1-C6 (7 casi) |
| Validazione min_fee_sat ≥ 0 (intero) | ✅ PASS | Test C7-C11 (5 casi) |
| Validazione quote_validity_sec 5-300 (intero) | ✅ PASS | Test C12-C17 (6 casi) |
| sparkBpsToPercent: 10→"0,10%", 500→"5,00%" | ✅ PASS | Test D1-D5 |
| computeSparkExampleFee: formula floor(sat*bps/10000) | ✅ PASS | Test E1-E5 |
| Config default supera tutte le validazioni | ✅ PASS | Test F4 |

---

## §18 — Final Pre-Go-Live Checklist (23 item)

| # | Item | Status |
|---|------|--------|
| 1 | Feature flag OFF by default | ✅ PASS |
| 2 | Zero Spark code caricato con flag=false (lazy) | ✅ PASS |
| 3 | Seed derivation: BTC m/84' ≠ Spark m/8797555'/1'/0' | ✅ PASS |
| 4 | Mnemonic NON persiste fuori dalla memoria sessione | ✅ PASS |
| 5 | connect() → state machine corretta | ✅ PASS |
| 6 | syncWallet() ciclo corretto | ✅ PASS |
| 7 | disconnect() + reconnect → stessa identità | ✅ PASS |
| 8 | Invoice failure → no double-pay | ✅ PASS |
| 9 | Retry idempotente (paymentHash key) | ✅ PASS |
| 10 | Recovery refresh browser | ✅ PASS |
| 11 | IDB Security: ACCEPT+DOCUMENT | ✅ PASS |
| 12 | Portfolio: Lightning separato da BTC on-chain | ✅ PASS |
| 13 | Portfolio: no double counting | ✅ PASS |
| 14 | Portfolio: Spark offline → dati parziali (non zero inventato) | ✅ PASS |
| 15 | History SparkPaymentType definita | ✅ PASS |
| 16 | Admin: PATCH richiede super_admin | ✅ PASS |
| 17 | Admin: audit event per ogni modifica fee | ✅ PASS |
| 18 | Admin: isolamento fee Spark da BTC/EVM/USDA | ✅ PASS |
| 19 | Test suite 993/993 PASS (nessuna regressione) | ✅ PASS |
| 20 | TypeScript noEmit PASS | ✅ PASS |
| 21 | **iPhone — connect mainnet** | ⏳ PENDING |
| 22 | **iPhone — send/receive reale** | ⏳ PENDING |
| 23 | **iPhone — history Lightning reale** | ⏳ PENDING |

---

## Regressioni verificate

| Area | Status |
|------|--------|
| Signal E2E (encrypt/decrypt) | ✅ INVARIATO |
| Payment Engine (Polygon, BTC, BSC, ETH) | ✅ INVARIATO |
| Alpha Wallet (BTC on-chain, EVM) | ✅ INVARIATO |
| USDA | ✅ INVARIATO |
| Call system | ✅ INVARIATO |
| Admin panel (MultiChain, Call Monitor, Fee) | ✅ INVARIATO |
| ChatPage.tsx | ✅ NON MODIFICATA |
| WalletContext.tsx BTC | ✅ NON MODIFICATA |

---

## File prodotti in Phase 5

### alpha-chat-web
- `src/contexts/SparkWalletContext.tsx` — aggiunto `useSparkWalletOptional()` (safe hook)
- `src/pages/AlphaWalletPage.tsx` — portfolio Lightning integration (§12)
- `src/tests/spark/spark-connect-sync.test.ts` — 40 test §2 (7 gruppi A-G)
- `src/tests/spark/spark-failure-idempotency.test.ts` — 35 test §8 (6 gruppi A-F)
- `src/tests/spark/spark-recovery.test.ts` — 25 test §9 (7 gruppi A-G)
- `src/tests/spark/spark-portfolio.test.ts` — 26 test §12 (6 gruppi A-F)
- `src/tests/spark/spark-admin-security.test.ts` — 39 test §14 (6 gruppi A-F)

### breez-spark-poc
- `SPARK_PHASE5_VALIDATION_REPORT.md` — questo documento

---

## Prossimi passi per go-live

1. **Test iPhone fisico** — eseguire `SPARK_IOS_TEST_CHECKLIST.md` (Phase 4)
2. **Test send/receive mainnet** — eseguire `SPARK_SEND_RECEIVE_TEST_PLAN.md` (Phase 4)
3. **Conferma esplicita utente** → impostare `spark_lightning_enabled = true` in admin
4. **Monitor produzione** — osservare `SPARK_FEE_UPDATED` audit log, Treasury `source=spark_lightning`

---

*Generato automaticamente da Phase 5 implementation — 2026-08-12*
