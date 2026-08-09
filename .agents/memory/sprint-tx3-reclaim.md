---
name: TX3 Escrow Gas Reclaim
description: Implementazione del reclaim del nativo residuo (POL/ETH/BNB) dall'escrow verso la Gas Station dopo ogni pagamento completato.
---

## Regola fondamentale
TX3 è fire-and-forget: un fallimento NON deve mai invalidare un pagamento già released.
`void _reclaimEscrowGas(doc, signerPk)` dopo `emitMCPaymentStateChanged(completed!)`.

## Campi aggiornati in IMultiChainTransfer
- `tx_hash_reclaim: string | null` — idempotency key (guard: `{ tx_hash_reclaim: null }` in findOneAndUpdate)
- `pol_reclaimed: string | null` — importo recuperato in wei (string BigInt)
- `reclaim_error: string | null` — `"INSUFFICIENT_BALANCE"` = permanente (no retry); altro = transitorio (scheduler riprova)

## Flusso TX3
1. Guard: network ≠ bitcoin, GAS_STATION_PRIVATE_KEY disponibile, tx_hash_reclaim = null
2. `Promise.all([getGasPrice, getBalance, getTransactionCount])` — 3 RPC in parallelo
3. `transferAmount = escrowBalance − TX3_GAS_UNITS(21_000n) × gasPrice`
4. Se balance ≤ gasCost → persist `INSUFFICIENT_BALANCE`, return (nessun retry)
5. `sendTransaction({ to: gsAddress, value: transferAmount, gas: 21000n, gasPrice, nonce })`
6. `waitForTransactionReceipt({ timeout: 30_000 })`
7. Persist success: `{ tx_hash_reclaim, pol_reclaimed, reclaim_error: null }` con guard `{ tx_hash_reclaim: null }`
8. In caso di errore: try-catch totale, persist `reclaim_error = errMsg.slice(0,500)`

## Scheduler retry (processFailedReclaims)
Query: `{ status:"released", tx_hash_reclaim:null, reclaim_error:{$nin:[null,"INSUFFICIENT_BALANCE"]}, completed_at:{$gt:7daysAgo}, network:{$ne:"bitcoin"} }`
Interval: ogni 30 minuti. Incluso in `_runAll()`.

## privateKeyToAccount DENTRO il try-catch
CRITICO: le chiamate a `privateKeyToAccount(escrowPk)` e `privateKeyToAccount(gsPk)` DEVONO stare dentro il try-catch. Se fuori, con chiavi mock/invalide in test, propagano unhandled rejection anche con `void`.

**Why:** In unit test il mock viem non copre `viem/accounts`, quindi chiavi non valide (es. "0xMOCK_PRIVATE_KEY") fanno esplodere `@noble/curves` prima del try-catch.

## Test updates
- `multichain-payment.service.test.ts`: aggiunto `getTransactionCount: vi.fn().mockResolvedValue(5)` al mock viem; il test "fee_wallet null" aggiornato da 3 a 4 `findOneAndUpdate` (3 release + 1 reclaim TX3)
- `multichain-reclaim.test.ts`: 32 test coprono R-01..R-14 + invariante matematica

## Pre-existing test failures (non correlati)
- `payment-quote.test.ts > TEST J`: `payment-quote.ts` contiene "custodial" → check regex fallisce
- `chat-payment.service.test.ts > acceptTransfer WALLET_NOT_CONFIGURED`: comportamento cambiato in sprint precedente
