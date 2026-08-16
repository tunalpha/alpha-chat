---
name: Breez Spark SDK Node.js API — AutoConfig discoveries
description: Comportamento reale del SDK Node.js v0.15.1 per connettersi e ottenere l'indirizzo Spark; diverso dalla versione WASM browser
---

# Breez Spark SDK Node.js — API corretta

## Pattern di connessione

**USA `connect()` con Seed, NON `connectWithSigner`**

```typescript
const sdk = require('@breeztech/breez-sdk-spark/nodejs');
const config = sdk.defaultConfig("mainnet");
config.apiKey = apiKey;

const conn = await sdk.connect({
  config,
  seed:       { type: "mnemonic", mnemonic, passphrase: "" },
  storageDir: "/tmp/spark-...",
});
```

**Why:** `defaultExternalSigner` + `connectWithSigner` fallisce con:
```
TypeError: arg0.eciesEncrypt is not a function
```
La funzione `eciesEncrypt` è richiesta dal WASM ma non implementata nel `DefaultSigner` del build Node.js v0.15.1.

## Ottenere l'indirizzo Spark

```typescript
const raw = await conn.receivePayment({ paymentMethod: { type: "sparkAddress" } });
// raw = { paymentRequest: "spark1...", fee: BigInt }
const sparkAddress = raw.paymentRequest; // ← NON raw.sparkAddress
```

**Why:** Per tutti i tipi di `receivePayment`, il risultato viene restituito in `paymentRequest`.
`raw.sparkAddress` è sempre `undefined` nel build Node.js.

## getInfo() — cosa restituisce davvero

```typescript
const info = await conn.getInfo({});
// info = { identityPubkey: "03abcd...", balanceSats: N, tokenBalances: Map }
// NON ha sparkAddress, spark_address, o simili
```

## Formato indirizzo Spark mainnet

- Mainnet live: `spark1...` (bech32m, derivato dalla chiave identità)
- Testnet: `sprt1...`
- **NOTA**: la memoria precedente diceva `sp1...` — ERRATO per il SDK v0.15.1 Node.js

## Versione SDK

`@breeztech/breez-sdk-spark@0.15.1` — `nodejs/breez_sdk_spark_wasm.js`

## Storage dir

Usare path assoluti in `/tmp/` per il `storageDir` (il SDK scrive IDB-like SQLite lì).
Il fee wallet usa `/tmp/spark-fee-wallet-srv`, il treasury usa `/tmp/spark-treasury-derive-tmp`.

**How to apply:** Qualsiasi codice backend Node.js che usa il Breez Spark SDK deve seguire questi pattern. Non usare `connectWithSigner` né aspettarsi `sparkAddress` da `getInfo`.
