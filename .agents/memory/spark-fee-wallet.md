---
name: Alpha Spark Fee Wallet
description: Architettura, endpoint, admin UI e scelte implementative del wallet commissioni Spark Lightning (Task #152)
---

# Alpha Spark Fee Wallet

## Architettura (ledger-based, no SDK in Node.js)

**Motivo**: SDK Breez Spark Node.js usa `better-sqlite3` (nativo) non installato in api-server → no install senza review. Il saldo ledger da MongoDB è sufficiente per il monitoring admin.

**Flusso**: `collectFee()` (client Spark) → `spark_lightning` fee record in MongoDB → admin monitora via `/spark/fee-wallet/*`

**SDK backend (futuro go-live)**: integrazione possibile importando `@breeztech/breez-sdk-spark/nodejs` in api-server dopo review. Esporre `setLiveBalance()` dal service per aggiornare il saldo live.

## File nuovi

- `artifacts/api-server/src/services/spark-fee-wallet.service.ts` — logic: info, stats, history, sweep design, health
- `artifacts/api-server/src/controllers/spark-fee-wallet.controller.ts` — 6 handler
- `artifacts/api-server/src/tests/spark/spark-fee-wallet.test.ts` — 36 test (20 §)
- `artifacts/admin-panel/src/lib/spark-api.ts` — aggiunto 6 nuove funzioni + tipi wallet
- `artifacts/admin-panel/src/pages/spark-lightning-fee.tsx` — aggiunta §3 (Alpha Spark Fee Wallet) con §3.1-§3.5

## Endpoint

```
GET  /api/v1/spark/fee-wallet/info             # read_only — status, sparkAddress, ledgerBalance, flags
GET  /api/v1/spark/fee-wallet/stats            # read_only — pending/success/failed/swept count+totalSat
GET  /api/v1/spark/fee-wallet/history          # read_only — storico paginato con feePaymentId
GET  /api/v1/spark/fee-wallet/sweep-design     # read_only — soglia, BTC treasury, note
GET  /api/v1/spark/fee-wallet/health           # read_only — alert stale + config missing
PATCH /api/v1/spark/fee-wallet/configure-address  # super_admin — imposta fee_address (sp1.../sprt...)
```

## Address format (Breez Spark SDK v0.15.1 — Node.js backend)

- Mainnet live: `spark1...` (bech32m, derivato dalla chiave identità) — NON `sp1`
- Testnet/Regtest: `sprt1...`
- Validation: inizia con `spark1`, `sp1`, o `sprt` — min 20 char
- Come ottenere backend Node.js: `connect()` con Seed + `receivePayment({ paymentMethod: { type: "sparkAddress" } }).paymentRequest`
- Vedere `spark-sdk-nodejs-api.md` per i dettagli completi

## Fee Wallet attivo (auto-configurato dal server)

- **SparkAddress**: `spark1pgssx7ln84…` (salvato in MongoDB automaticamente al boot)
- **Env var mnemonic**: `ALPHA_SPARK_FEE_MNEMONIC` (Replit Secret, mai esposta)
- **MongoDB**: `sparkfeeconfigs._id='spark-fee'.fee_address` configurato via auto-configure in index.ts (setTimeout 25s)
- Auto-configure è idempotente: salta se già configurato

## Treasury Spark (auto-configurato da ALPHA_SPARK_TREASURY_MNEMONIC)

- **SparkAddress**: `spark1pgss8zjapk7qmxvga5kp5323l992e8jn4nqvnhxlg4ksc909dt3xqpjsunqyr8`
- **MongoDB**: `sparkfeeconfigs._id='spark-fee'.sweep_treasury_spark_address` — updated_at 2026-08-16T00:16:12Z
- **Mnemonic**: `ALPHA_SPARK_TREASURY_MNEMONIC` (generato via @scure/bip39, salvato come shared env var via setEnvVars; per encryption a riposo convertire a Replit Secret)
- **auto_sweep_enabled**: false (invariato — NON abilitare senza approvazione esplicita)

## Fee Wallet Spark (indirizzi completi confermati)

- **fee_address MongoDB**: `spark1pgssx7ln846vsxfyzl2hshrxnr765d06evr6n5uct5hu7rd250036r36wy2sm6`
- **updated_by**: auto-configure, updated_at 2026-08-16T00:07:15Z

## Mnemonic

- Secret: `ALPHA_SPARK_FEE_MNEMONIC` (Replit env var — mai nel codice)
- Formato: BIP39 24 parole (256 bit)
- `mnemonicConfigured`: boolean flag nell'API (mai il valore)
- Sweep design: `BTC_FEE_WALLET` env come treasury address; soglia `SPARK_SWEEP_THRESHOLD_SAT` (default 10000 sat)

## Test leakage rule

`vi.clearAllMocks()` NON svuota la coda Once → con `mockResolvedValueOnce` multipli che rimangono dalla suite precedente, i test successivi leggono valori sbagliati. Usare `vi.resetAllMocks()` in `beforeEach` per reset completo.

**Why:** clearAllMocks svuota `calls/results`, non `once queue`. resetAllMocks svuota tutto incluse implementazioni.
