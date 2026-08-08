---
name: EVM Network Fee Model — Polygon USDT testnet
description: Flat fee addebitata al cliente per gas EVM; architettura, invarianti, pattern di test
---

## Architettura

**Separazione tri-parte (INVARIANTE):**
- `project_fee` = `grossAmount × 0.10%` — formula MAI modificata
- `net_amount` = `grossAmount − projectFee` — destinatario sempre riceve questo
- `network_fee_charged` = flat fee addebitata al cliente (default Polygon: 500_000 = 0.50 USDT @ 6 dec)

**Why:** il gas EVM è pagato materialmente dal gas station in POL, ma il costo economico viene recuperato tramite `network_fee_charged` addebitato al cliente.

**2 TX EVM (invariato):**
- TX1: `netAmount → recipient`
- TX2: `(projectFee + networkFeeCharged) → feeWallet` (separati in DB, combinati on-chain)

**`min_deposit_amount` ora usato anche per EVM:**
- `min_deposit_amount = grossAmount + networkFeeCharged` (se > 0)
- `null` → backward compat, detectMultiChainDeposit usa `grossAmount`

## DB fields aggiunti

```
network_fee_charged: String | null  // flat fee in base units asset (es. 500000 = 0.50 USDT)
network_fee_asset:   String | null  // "POL" | "ETH" | "BNB" | "BTC"
```

Entrambi immutabili per record dopo create. Cambi env non impattano transfer già creati.

## `ensureMultiChainEscrowGas`

Funzione privata in `multichain-payment.service.ts` — completamente separata da `usda-custodial.service.ts`.

Pattern: check `GAS_STATION_PRIVATE_KEY` → check chain/rpc → `createPublicClient` → `getGasPrice` + `getBalance` → top-up se `balance < 80_000 × 2 × gasPrice × 2`.

**Test isolation critico:** `GAS_STATION_PRIVATE_KEY` è impostato come segreto Replit → in unit test la funzione NON fa short-circuit sul check `gsPk`. Soluzione: `vi.mock("viem", ...)` nel test file con `createPublicClient` che restituisce `getBalance = 1 POL` (sufficiente → no top-up).

**How to apply:** Ogni test file che copre `releaseMultiChainTransfer` o `_releaseEvm` DEVE includere il mock viem.

## Env config

`POLYGON_FLAT_NETWORK_FEE_USDT` — default 500_000 (0.50 USDT). Letto al create time, salvato nel DB.

## Test results

- 527 totali, 524 pass, 3 fallimenti pre-esistenti (chat-payment WALLET_NOT_CONFIGURED, jwt expiry, refresh-token expiry)
- 12 nuovi test aggiunti in `multichain-payment.service.test.ts`

## Testnet E2E infrastruttura (Polygon Amoy, chainId 80002)

**Pattern env-var-before-dynamic-import (obbligatorio per testnet scripts):**
Tutti gli env var testnet (`POLYGON_RPC_URL`, `POLYGON_CHAIN_ID=80002`, `POLYGON_USDT_CONTRACT`, `ENABLE_POLYGON_USDT`, `POLYGON_FEE_WALLET`, `POLYGON_FLAT_NETWORK_FEE_USDT`) devono essere settati PRIMA dei `await import(...)` dei moduli production. Questi moduli leggono env var a caricamento (module-level `const`).

**Why:** `feeRegistry = buildDefaultFeeRegistry()`, `TOKEN_CONTRACTS`, `FEATURE_FLAGS`, `MC_CHAIN_MAP` sono tutti module-level — valutati una sola volta al caricamento del modulo. Se il dynamic import precede il set degli env var, i valori di produzione vengono letti invece di quelli testnet.

**`POLYGON_CHAIN_ID=80002` → MC_CHAIN_MAP usa `polygonAmoy`:**
`ensureMultiChainEscrowGas` usa `MC_CHAIN_MAP[network]` per firmare le TX. Se `POLYGON_CHAIN_ID` è 80002, usa `polygonAmoy` (chainId 80002) invece di `polygon` (137). Senza questo, le TX firmate con chainId mainnet vengono rifiutate da Amoy.

**`PolygonAmoyAdapter` (src/blockchain/evm/polygon-amoy.adapter.ts):**
Extend di `EvmAdapter` con `polygonAmoy` chain e 1 confirmation. Registrato nel registry con `adapterRegistry.register("polygon", factory)` prima delle chiamate ai service. NON importa `multichain-config` a runtime → sicuro come static import nel testnet script.

**File testnet:**
- `src/blockchain/evm/polygon-amoy.adapter.ts` — adapter Amoy
- `src/scripts/testnet-e2e-polygon.ts` — script E2E 12 step
- `TESTNET_SETUP.md` — guida deploy mock USDT su Amoy + istruzioni faucet
- `pnpm testnet:e2e` — npm script
