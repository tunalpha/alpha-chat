---
name: SCHED-03 Anti Double-Pay Fix
description: Scheduler fix che impedisce rollback da "releasing" a "pending" quando tx_hash_release è già in DB
---

## Regola

In `processStuckReleasingTransfers`, il branch `else` (txStatus="failed"/"unknown") NON deve
mai chiamare `_rollbackToStatus("releasing","pending")` se `tx_hash_release` è valorizzato.

**Why:** Il codice raggiunge questo branch solo se tx_hash_release è già in DB (il caso null
è gestito in cima con `continue`). Un rollback a "pending" aprirebbe la strada a un secondo
TX1 con nonce diverso. Se TX1 originale è ancora in mempool — scenario tipico di RPC glitch
che fa restituire "unknown" — entrambe potrebbero minarsi → double pay.

**How to apply:**
- Se tx_hash_release è SET + TX1 "failed/unknown": rinnova lock + logger.error strutturato
  (alert per admin, non rollback automatico).
- Se tx_hash_release è null: il caso non raggiunge mai questo branch (gestito con `continue`).
- Il pattern "catch → txStatus='unknown'" è il trigger più pericoloso: RPC down durante
  getTransactionStatus → txStatus="unknown" → senza il fix → rollback → double TX1.

## Evidenza nel codice

`artifacts/api-server/src/payment/multichain-scheduler.ts` — funzione `processStuckReleasingTransfers`,
branch else dopo `else if (txStatus === "pending")`.

Header aggiornato: HARDENING SCHED-03 nella docstring del file.
JSDoc aggiornato: "failed/unknown → SCHED-03: NON rollback, alert admin + rinova lock".

## Test copertura

File: `multichain-scheduler.test.ts` — describe "SCHED-03 — Anti Double-Pay Hardening" (5 test):
- Test A: tx_hash_release=null → rollback consentito (percorso pre-TX1)
- Test B: tx_hash_release=SET + "unknown" → NO rollback
- Test C: tx_hash_release=SET + "failed"  → NO rollback
- Test D: 3 cicli scheduler con TX1 "unknown" → 0 rollback, 3 lock-renewal, 0 secondo TX1
- Test E: RPC throws (catch→"unknown") + tx_hash_release=SET → NO rollback

Test aggiornato: "TX1 failed on-chain" (ex-test che aspettava rollback) ora verifica lock-renewal.
