---
name: Spark Fee Wallet — Sweep System (Phase C)
description: Architettura, decisioni e vincoli del sistema di sweep dal fee wallet Spark verso il treasury. CONGELATO.
---

# Spark Fee Wallet Sweep System

## Architettura

### Flusso
```
scheduler (15min)
  └─ checkAndQueueAutoSweep()
       ├─ cfg.auto_sweep_enabled=false → skip
       ├─ saldo < thresholdSat → skip
       └─ crea SparkSweepOperation (pending)
            └─ executePendingSweep()  ← fire-and-forget
                 ├─ findOneAndUpdate status pending→processing (lock atomico)
                 ├─ sweepFeeWalletTo() via executor SDK
                 ├─ success → SparkSweepOperation=success + AlphaWalletFeeRecord=swept
                 └─ failed → SparkSweepOperation=failed (fee records invariati)

admin POST /sweep/trigger
  └─ triggerManualSweep() — stesso flow, sempre consentito sotto soglia
```

### File creati
- `src/models/spark-sweep-operation.model.ts` — stati: pending/processing/success/failed
- `src/services/spark-fee-wallet-executor.ts` — SDK Node.js connector (lazy, mnemonic da env)
- `src/services/spark-sweep.service.ts` — logica sweep + auto-sweep + reconcile
- `src/controllers/spark-sweep.controller.ts` — 7 REST handlers
- `src/schedulers/spark-sweep.scheduler.ts` — interval 15min + reconcile on startup
- `src/tests/spark/spark-sweep.test.ts` — 19 test (13 §+3 sub), tutti PASS

### File modificati
- `src/models/spark-fee-config.model.ts` — 3 nuovi campi sweep
- `src/routes/v1/spark.routes.ts` — 8 nuove route sweep
- `src/index.ts` — startSparkSweepScheduler() dopo 20s
- admin: `spark-api.ts` + `spark-lightning-fee.tsx` §3.5

## Decisioni architetturali

### Lock atomico
`SparkSweepOperationModel.findOneAndUpdate({ _id, status:"pending" }, { status:"processing" })` — atomico su MongoDB. Solo un sweep alla volta. Processing stale >15min → reconciliazione.

### Reconciliazione recovery
- On startup (5s delay) e on stale detection
- `listFeeWalletRecentPayments()` → cerca per amountSat ±5% e timestamp in window
- Trovato → success + mark swept; Non trovato → failed

### auto_sweep_enabled = false (default)
L'auto-sweep è disabilitato per default. Deve essere abilitato esplicitamente dall'admin DOPO verifica produzione. Il manuale funziona sempre.

### Mnemonic security
- ALPHA_SPARK_FEE_MNEMONIC letto SOLO in `getMnemonicFromEnv()` nell'executor
- Mai in log, mai in error message, mai in response, mai nel service
- lastError sanitizzato con regex prima del salvataggio

## Test results (19/19)
- §1 sotto soglia → nessun sweep
- §2 sopra soglia → sweep accodato
- §3 manuale sotto soglia → consentito
- §4 doppio click → lock idempotente
- §5 scheduler+manuale → una sola operazione
- §6 restart → no double sweep (reconcile)
- §7 timeout → reconcile failed
- §8 failed → fee records NON swept
- §9 success → fee records swept
- §10 treasury invalido → 400 + blocco
- §11 unauthorized → 409 (403 gestito da middleware)
- §12 mnemonic never in response
- §13 isolamento: no import proibiti, no mnemonic in logger

**Why:** La policy payment non-regression richiede zero contaminazione tra sweep e payment engine.
**How to apply:** Non modificare mai executePendingSweep/sweepFeeWalletTo senza approval esplicita.
