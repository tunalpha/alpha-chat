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

## Address format (Breez Spark SDK v0.15.1)

- Mainnet: `sp1...` (bech32-like, static, derivato da mnemonic)
- Testnet/Regtest: `sprt1...`
- Validation: deve iniziare con `sp1` o `sprt`, min 20 char
- Come ottenere: `getInfo().sparkAddress` via SDK (browser PoC o backend)

## Mnemonic

- Secret: `ALPHA_SPARK_FEE_MNEMONIC` (Replit Secret — mai nel codice)
- Formato: BIP39 24 parole (256 bit)
- `mnemonicConfigured`: boolean flag nell'API (mai il valore)
- Sweep design: `BTC_FEE_WALLET` env come treasury address; soglia `SPARK_SWEEP_THRESHOLD_SAT` (default 10000 sat)

## Test leakage rule

`vi.clearAllMocks()` NON svuota la coda Once → con `mockResolvedValueOnce` multipli che rimangono dalla suite precedente, i test successivi leggono valori sbagliati. Usare `vi.resetAllMocks()` in `beforeEach` per reset completo.

**Why:** clearAllMocks svuota `calls/results`, non `once queue`. resetAllMocks svuota tutto incluse implementazioni.
