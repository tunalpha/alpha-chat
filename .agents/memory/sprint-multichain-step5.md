---
name: Sprint Multi-Chain STEP 5 — Production Blockers
description: Fix C-01..C-03, H-01..H-03, H-06, H-07; pattern pre-broadcast persist; test strategy
---

## Fix introdotti

### C-01/C-02: Pre-persist before broadcast (anti double-pay)
Pattern: `buildAndSignToken` → persist hash in DB → `broadcastAndWait`

```
TX1: sign → persist tx_hash_release → broadcast
TX2: sign → persist tx_hash_fee    → broadcast
Catch: condizione { tx_hash_release: null } → no rollback se TX1 già in DB
```

`SplitTxAdapter` interface (locale in service.ts) dichiara `buildAndSignToken` + `broadcastAndWait`.
Cast: `adapter as unknown as SplitTxAdapter` (necessario per TS: `as SplitTxAdapter` dà errore senza `unknown`).

### C-03: Pre-persist tx_hash_refund before refund broadcast
Stesso pattern. Catch usa `{ tx_hash_refund: null }` come condizione sicura.
BTC refund rimane con `sendNative` (non split-capable in STEP 5).

### H-01: Balance query dentro il try block
`getTokenBalance` (e `getBalance` BTC) spostata INSIDE try, non prima.
Se lancia → catch con `{ tx_hash_refund: null }` → rollback sicuro.

### H-02: Ownership check nel controller
`getOwnedTransfer(transferId, userId)` helper in controller.
Wrong userId → lancia `AppError 404` (non 403 — privacy preserving).

### H-03: GAS_STATION_PRIVATE_KEY assente
Prima: warn + return. Ora: `GasReserveDepletedError(network, escrow, 1n, 0n)`.
→ transfer va in `waiting_for_gas` (non failed).

### H-06: userId canonico nel controller
`req.user?.userId` (non `req.user?.id`). Helper `requireUserId(req)`.
Stesso fix nel rate limiter.

### H-07: locked_at: null nel zero-balance update
Zero balance refund → il $set del final update ora include `locked_at: null`.
Prima: il transfer rimaneva locked → bloccato dallo scheduler.

### C-02 Scheduler
Nuovo ramo `tx2Staged` in `processStuckReleasingTransfers`:
- tx_hash_fee staged + TX2 confirmed on-chain → mark released
- TX2 pending → rinnova lock
- TX2 unknown/failed → azzera `tx_hash_fee: null` (safe per retry)

## Test strategy

### File modificato: multichain-payment.service.test.ts
- `makeEvmAdapter()` helper locale genera mock `buildAndSignToken`+`broadcastAndWait`
- Per refund e retryEVMFeeTx (1 solo call a buildAndSignToken): usa `tx1Hash` slot (idx=0)
- DB call count con TX2: 4 (acquireLock + persist_tx1 + persist_tx2 + final)
- DB call count senza TX2 (fee_wallet=null): 3 (acquireLock + persist_tx1 + final)
- DB call count refund EVM: 3 (acquireLock + persist_refund + final)

### File nuovo: multichain-step5-fixes.test.ts
9 test, tutti verdi. Logger mock: `{ logger: { info, warn, error, debug, child } }` (named export, NON `{ default: ... }`).
AppError: `.httpStatus` (non `.statusCode` né `.status`).

## Risultato finale
- 586 test totali (9 nuovi)
- 583 pass
- 3 pre-esistenti falliti (jwt.service x1, refresh-token.service x2 — immutati)
- 0 regressioni

**Why:** Pre-broadcast persist è il pattern chiave per evitare double-pay su crash post-broadcast.
La condizione `{ tx_hash_X: null }` nel rollback catch garantisce che il recovery sia idempotente.
