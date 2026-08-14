---
name: Spark Reliability Fixes — Audit Finding 1,2,4,5,7,9,10,11
description: 8 fix critici implementati dopo l'audit Lightning/Spark del 14 agosto 2026. Regola architetturale TRANSACTION HISTORY INTEGRITY adottata.
---

## Regola architetturale adottata

**TRANSACTION HISTORY INTEGRITY**
> No successfully completed transaction may ever remain permanently absent from transaction history.

Questa regola si applica a: Alpha Wallet (EVM/BTC), Lightning/Spark, MultiChain, e qualsiasi futuro sistema di pagamento.

---

## Fix implementati

### Finding 1 — Reconciliation post-connect
**File:** `AlphaWalletPage.tsx` — `usePortfolioBalances()`
**Pattern:** useEffect([spark.state]) → quando state diventa "connected": listLightningTxs(500) → filtra pending+receive+bolt11 → listPayments SDK → updateLightningTx per ogni match.
**Why:** App chiusa durante attesa invoice → al riavvio senza questo fix l'invoice rimane "pending" per sempre.

### Finding 2 — Double-send lock
**File:** `AlphaWalletPage.tsx` — `SendView`
**Pattern:** `sendInProgressRef = useRef(false)` + guard all'inizio del branch Lightning + `finally { sendInProgressRef.current = false }`.
**Why:** Lock nel codice (non solo nella UI) — la UI può essere bypassata su rete lenta o doppio tap.

### Finding 4 — saveLightningTx awaited
**File:** `AlphaWalletPage.tsx` — `generateInvoice` + `handleSignAndSend`
**Pattern:** `try { await saveLightningTx({...}); } catch { console.warn(...); }` — mai fire-and-forget.
**Why:** Se IDB fallisce silenziosamente, il pagamento completato non compare mai in history.

### Finding 5 — Double-connect guard
**File:** `SparkWalletContext.tsx` — `connect()`
**Pattern:** Guard all'inizio: `if (state === "connecting" || state === "connected" || state === "syncing") return;`
**Why:** Senza guard, due connect() quasi-contemporanei creano un SDK orfano.

### Finding 7 — History IDB ↔ SDK reconciliation
**File:** `AlphaWalletPage.tsx` — `HistoryView`
**Pattern:** Al caricamento tab Lightning: listPayments SDK → update pending→paid, inserisci SDK records assenti in IDB.
**Why:** Se IDB è svuotata (iOS storage pressure) i pagamenti esistono nell'SDK ma non nella history UI.

### Finding 9 — Fee config error handler
**File:** `SparkWalletContext.tsx`
**Pattern:** `.catch(() => { console.warn(...); })` — fallback ai defaults hardcoded `{ fee_bps: 10, min_fee_sat: 1, quote_validity_sec: 30 }`.

### Finding 10 — storageDir con userId
**File:** `App.tsx` — `SparkWalletProviderWrapper`
**Pattern:** `storageDir={`spark-${userId}-v1`}` — isolamento IDB per utente sullo stesso device.
**Why:** Con storageDir fisso, due utenti sullo stesso device condividono la stessa IDB Spark.

### Finding 11 — addEventListener failure → console.warn
**File:** `adapters/live.ts` — `subscribeToEvents`
**Pattern:** `.catch((err: unknown) => { console.warn("[SparkLive] addEventListener fallito:", ...) })`.
**Why:** Fallimento silenzioso impedisce la diagnosi. Il fallback polling 15s copre la ricezione.

### Finding 14 — expiresAt SDK come fonte primaria
**File:** `AlphaWalletPage.tsx` — `generateInvoice`
**Pattern:** `result.expiresAt ? result.expiresAt * 1000 : await parseBolt11Expiry(result.bolt11)`.
**Why:** SDK fornisce già il timestamp di scadenza — il parsing bech32 manuale è ridondante.

---

## Finding 6 (IDB non cifrata) — SOSPESO
Breez SDK 0.15.1 NON espone API custom storage. Non implementare cifratura improvvisata.
Già analizzato e documentato in `artifacts/breez-spark-poc/SPARK_IDB_SECURITY_REPORT.md`.
Monitorare aggiornamenti SDK Breez per API custom storage (feature request aperta, nessuna ETA).

## Finding 3 (iOS lifecycle) — SOSPESO
Capacitor in standby. Da affrontare quando Capacitor viene ripreso (useEffect visibilitychange → Capacitor App plugin appStateChange).

---

## Test di regressione
File: `src/tests/spark/spark-reliability-fixes.test.ts`
28 test, tutti PASS. Coprono Finding 1,2,4,5,7,9,10,11,14 + invariante TRANSACTION HISTORY INTEGRITY.

## Stato Lightning
`spark_lightning_enabled=false` in produzione — rimane così fino alla conclusione di tutti i fix e go/no-go decision.
