---
name: BTC→EVM Direction Guard
description: Fix falso-completed swap BTC→EVM causato da Li.Fi che trova la TX BTC come output di un vecchio swap EVM→BTC.
---

# BTC→EVM Direction Guard — Fix Falso-Completed

## Il bug
`getLiFiStatus(btcTxHash, BTC_CHAIN_ID, ETH_CHAIN_ID)` può restituire `status: "DONE"` se la TX BTC è già registrata in Li.Fi come `receiving` di un vecchio swap **EVM→BTC** (direzione opposta). Il codice accettava `DONE` senza verificare la direzione → falso `phase: "completed"`, nessun USDT mai ricevuto.

Caso incidente (2026-08-18): TX `96b55dc7...` era l'output di USDT→BTC. Alpha la ha usata per un nuovo BTC→USDT. Li.Fi: DONE. Alpha: "Confermata". Nessun USDT.

**Why:** Li.Fi usa la TX hash come chiave univoca — la trova come receiving del vecchio swap e restituisce il suo stato.

## Fix
`receiving.chainId` deve corrispondere a `capturedToChainId` prima di accettare DONE.

### Funzione pura (esportata per test)
`_validateBtcToEvmDone(result, capturedToChainId)` in `useEvmSwapState.ts`
- `DONE + receiving.chainId === capturedToChainId` → VALID (completed ✓)
- `DONE + receiving.chainId !== capturedToChainId` → MISMATCH (continua polling)
- `DONE + receiving.chainId === undefined` → MISMATCH (non verificabile)

### Campi aggiunti a LiFiStatusResult (lifi-client.ts)
- `receivingChainId?: number` — da `response.receiving.chainId`
- `sendingChainId?: number` — da `response.sending.chainId`

### Guard applicato in:
1. `startBtcPoll` — mismatch → continua polling, NON rimuove localStorage
2. Recovery al mount — mismatch → finalState="pending" (non completed)

### Requisito 7: txHash
In caso di DONE valido: `txHash: st.txHash ?? null` — NON usare la BTC input TX come destination EVM TX.

## Test
`src/tests/critical/btc-swap-direction-guard.test.ts` — 22 test (Casi A-E + anti-regression)

## Gap residui (task proposti)
- #198: max poll timeout per swap BTC bloccati in pending
- #199: persistenza server-side swap BTC→EVM per recovery cross-device
