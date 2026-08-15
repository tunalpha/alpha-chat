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

## Fee Wallet attivo (generato da agente)

- **SparkAddress**: `sp1qdalx0t5eqvjg9740pwxdx8a4g6l4jc848feshf0eux64g7lr58r5wdemqg`
- **PubkeyHex**: `037bf33d74c8192417d5785c6698fdaa35facb07a9d3985d2fcf0daaa3df1d0e3a`
- **Env var mnemonic**: `ALPHA_SPARK_FEE_MNEMONIC` (settata, mai esposta)
- **Env var address**: `ALPHA_SPARK_FEE_ADDRESS` (settata)
- **MongoDB**: `sparkfeeconfigs._id='spark-fee'.fee_address` configurato

## Derivazione offline (no network) tramite SDK WASM Node.js

```javascript
// defaultExternalSigner(mnemonic, passphrase, network, keySetConfig)
// network = 'mainnet' (lowercase!) — 'MAINNET' causa errore variant
const sdk = require('@breeztech/breez-sdk-spark/nodejs');
const signer = sdk.defaultExternalSigner(mnemonic, '', 'mainnet', null);
const pk = signer.identityPublicKey(); // { bytes: number[] } — non Uint8Array!
signer.free();
const pubkeyBytes = Buffer.from(pk.bytes); // 33 bytes
// Bech32m encode HRP 'sp'
const bm = require('bech32/dist/index.js');
const sparkAddress = bm.bech32m.encode('sp', bm.bech32m.toWords(pubkeyBytes));
```

**Nota importante**: `identityPublicKey()` ritorna `{ bytes: number[] }`, NON Uint8Array — `pk.bytes` è l'array.

## Mnemonic

- Secret: `ALPHA_SPARK_FEE_MNEMONIC` (Replit env var — mai nel codice)
- Formato: BIP39 24 parole (256 bit)
- `mnemonicConfigured`: boolean flag nell'API (mai il valore)
- Sweep design: `BTC_FEE_WALLET` env come treasury address; soglia `SPARK_SWEEP_THRESHOLD_SAT` (default 10000 sat)

## Test leakage rule

`vi.clearAllMocks()` NON svuota la coda Once → con `mockResolvedValueOnce` multipli che rimangono dalla suite precedente, i test successivi leggono valori sbagliati. Usare `vi.resetAllMocks()` in `beforeEach` per reset completo.

**Why:** clearAllMocks svuota `calls/results`, non `once queue`. resetAllMocks svuota tutto incluse implementazioni.
