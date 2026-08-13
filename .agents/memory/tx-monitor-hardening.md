---
name: TX Monitor Hardening
description: Bug e fix al sistema storico transazioni Alpha Wallet (EVM/BTC/Lightning) — classe di bug "silent checkpoint advancement"
---

## Regola

Il monitor non deve MAI avanzare `evmLastBlock[chainId]` se:
1. `apiWalletGetEvmTransactions` lancia un'eccezione (errore di rete, errore backend)
2. `result.latestBlock` è `"0x0"` o falsy (indica che `eth_blockNumber` è fallito)
3. Alchemy restituisce `{ error: { code, message } }` invece di `{ result: { transfers } }`

**Why:** Se il checkpoint avanza su un poll fallito, tutte le TX nel range perso sono perse per sempre (il prossimo poll parte dal blocco corrente, saltando il gap).

## Chain supportate (agosto 2026)

| Chain | chainId | Endpoint |
|---|---|---|
| Ethereum | 1 | Alchemy `eth-mainnet.g.alchemy.com/v2/{KEY}` |
| Polygon | 137 | Alchemy `polygon-mainnet.g.alchemy.com/v2/{KEY}` |
| BSC | 56 | Alchemy `bnb-mainnet.g.alchemy.com/v2/{KEY}` |
| Bitcoin | 0 | Blockstream (restituisce TUTTE le tx, nessun gap) |
| Lightning | — | Breez SDK event-driven, no polling, no gap |

## Fix applicati

### Backend (`alpha-wallet.controller.ts`)
- BSC Alchemy URL era `""` (empty) → fixato a `bnb-mainnet.g.alchemy.com`
- Aggiunto `order: "desc"` su entrambe le chiamate `alchemy_getAssetTransfers` → 50 TX più recenti invece delle più vecchie
- Guard: se `eth_blockNumber` ritorna null → throw `AppError("ALCHEMY_BLOCK_ERROR", 502)`
- Guard: se Alchemy risponde con `{ error: {...} }` → throw `AppError("ALCHEMY_ERROR", 502)`
- Guard: chain sconosciuta → throw `AppError("UNSUPPORTED_CHAIN", 501)`

### Frontend (`tx-monitor.ts`)
- In `_poll()` inline loop: se `result.latestBlock === "0x0"` o falsy → `hadError = true`, `continue` (checkpoint invariato)
- In `pollEvmChain()`: stessa guardia — ritorna `fromBlock ?? "0x0"` senza avanzare
- La guardia frontend è belt-and-suspenders: il backend dovrebbe già aver thrown

## Recovery manuale transazioni mancanti

Il bottone 🔄 in Alpha Wallet → Storico:
1. `TxMonitor.resetState()` → cancella `evmLastBlock` da IDB
2. `txMonitor.forcePoll()` → poll immediato da block 0 con `order: "desc"`
3. 50 TX più recenti per ogni chain recuperate
4. `saveTxRecord` è idempotente → nessun duplicato

## Test

File: `src/tests/wallet/tx-monitor-hardening.test.ts`
- chain con throw → checkpoint NON avanza
- `latestBlock="0x0"` → checkpoint NON avanza
- checkpoint già avanzato NON regredisce su `"0x0"`
- errore parziale non blocca le altre chain
- TX recenti (blockNum alto) processate
- dedup: stesso txHash processato 2× → 1 solo record
